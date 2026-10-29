import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

async function expectQueryError(client, sql, params, pattern) {
  await client.query("SAVEPOINT expected_failure");
  try {
    await client.query(sql, params);
    assert.fail("Expected PostgreSQL query to fail.");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    assert.match(String(error.message), pattern);
  } finally {
    await client.query("RELEASE SAVEPOINT expected_failure");
  }
}

test("PostgreSQL reversal is balanced, linked, one-time, and respects closed periods", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for PostgreSQL integration tests");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const org = (await client.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ($1, $2) RETURNING id",
      ["ContaExpress Reversal Test", "ContaExpress Reversal IT"],
    )).rows[0].id;
    const user = (await client.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, $2, 'active') RETURNING id",
      [`ci-reversal-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, "CI Reversal Test"],
    )).rows[0].id;
    await client.query(
      "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant')",
      [org, user],
    );
    const entity = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, $2) RETURNING id",
      [org, "ContaExpress Reversal IT Entity"],
    )).rows[0].id;
    const fiscalYear = (await client.query(
      "INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, 'FY-REV-IT', '2026-01-01', '2026-12-31') RETURNING id",
      [entity],
    )).rows[0].id;
    const period = (await client.query(
      "INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, '2026-REV-IT', '2026-01-01', '2026-12-31') RETURNING id",
      [entity, fiscalYear],
    )).rows[0].id;
    const journal = (await client.query(
      "INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'REV', 'Reversal Test Journal') RETURNING id",
      [entity],
    )).rows[0].id;
    const debitAccount = (await client.query(
      "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'REV-101', 'Banco', 'asset') RETURNING id",
      [entity],
    )).rows[0].id;
    const creditAccount = (await client.query(
      "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'REV-501', 'Capital', 'equity') RETURNING id",
      [entity],
    )).rows[0].id;

    const original = (await client.query(
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-10-10', 'Original para estorno', $4) RETURNING id",
      [entity, period, journal, user],
    )).rows[0].id;
    await client.query(
      "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 800, 0), ($1, $2, 2, $4, 0, 800)",
      [entity, original, debitAccount, creditAccount],
    );
    await client.query("SELECT * FROM post_journal_entry($1, $2)", [original, user]);

    const reversal = (await client.query(
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by, reverses_entry_id) VALUES ($1, $2, $3, '2026-10-11', 'Estorno do original', $4, $5) RETURNING id",
      [entity, period, journal, user, original],
    )).rows[0].id;
    await client.query(
      `INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit)
       SELECT accounting_entity_id, $2, line_number, account_id, credit, debit
       FROM journal_entry_lines WHERE accounting_entity_id = $1 AND entry_id = $3 ORDER BY line_number`,
      [entity, reversal, original],
    );
    await client.query("SELECT * FROM post_journal_entry($1, $2)", [reversal, user]);
    await client.query(
      "UPDATE journal_entries SET status = 'reversed', updated_at = now() WHERE id = $1 AND accounting_entity_id = $2",
      [original, entity],
    );

    const originalStatus = await client.query("SELECT status FROM journal_entries WHERE id = $1", [original]);
    assert.equal(originalStatus.rows[0].status, "reversed");
    const reversalLink = await client.query("SELECT reverses_entry_id, status FROM journal_entries WHERE id = $1", [reversal]);
    assert.equal(reversalLink.rows[0].reverses_entry_id, original);
    assert.equal(reversalLink.rows[0].status, "posted");

    const net = await client.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::numeric(20,2) AS net
       FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
       WHERE e.accounting_entity_id = $1 AND e.id IN ($2, $3) AND e.status IN ('posted', 'reversed') AND l.account_id = $4`,
      [entity, original, reversal, debitAccount],
    );
    assert.equal(Number(net.rows[0].net), 0);

    await expectQueryError(
      client,
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by, reverses_entry_id) VALUES ($1, $2, $3, '2026-10-12', 'Estorno duplicado', $4, $5)",
      [entity, period, journal, user, original],
      /journal_entries_single_reversal_idx|duplicate key/i,
    );
    await expectQueryError(
      client,
      "SELECT * FROM post_journal_entry($1, $2)",
      [original, user],
      /Apenas lançamentos em rascunho podem ser confirmados/,
    );

    const closedPeriod = (await client.query(
      "INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on, status) VALUES ($1, $2, '2026-CLOSED-IT', '2026-11-01', '2026-11-30', 'closed') RETURNING id",
      [entity, fiscalYear],
    )).rows[0].id;
    const blocked = (await client.query(
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-11-05', 'Lançamento em período fechado', $4) RETURNING id",
      [entity, closedPeriod, journal, user],
    )).rows[0].id;
    await client.query(
      "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 100, 0), ($1, $2, 2, $4, 0, 100)",
      [entity, blocked, debitAccount, creditAccount],
    );
    await expectQueryError(
      client,
      "SELECT * FROM post_journal_entry($1, $2)",
      [blocked, user],
      /O período contabilístico não está aberto/,
    );
    assert.equal((await client.query("SELECT status FROM journal_entries WHERE id = $1", [blocked])).rows[0].status, "draft");
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
