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

test("posting permissions enforce accountant role and journal numbers remain unique", async (t) => {
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
      ["ContaExpress Permissions Integration", "ContaExpress Permissions IT"],
    )).rows[0].id;
    const accountant = (await client.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, 'Accountant', 'active') RETURNING id",
      [`ci-permission-accountant-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`],
    )).rows[0].id;
    const auditor = (await client.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, 'Auditor', 'active') RETURNING id",
      [`ci-permission-auditor-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`],
    )).rows[0].id;
    await client.query(
      "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant'), ($1, $3, 'auditor')",
      [org, accountant, auditor],
    );
    const entity = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, 'Permissions Entity') RETURNING id",
      [org],
    )).rows[0].id;
    const fiscalYear = (await client.query(
      "INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, 'FY-PERM-IT', '2026-01-01', '2026-12-31') RETURNING id",
      [entity],
    )).rows[0].id;
    const period = (await client.query(
      "INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, '2026-PERM-IT', '2026-01-01', '2026-12-31') RETURNING id",
      [entity, fiscalYear],
    )).rows[0].id;
    const journal = (await client.query(
      "INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'PERM', 'Permissions Journal') RETURNING id",
      [entity],
    )).rows[0].id;
    const debitAccount = (await client.query(
      "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'P-101', 'Banco', 'asset') RETURNING id",
      [entity],
    )).rows[0].id;
    const creditAccount = (await client.query(
      "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'P-501', 'Capital', 'equity') RETURNING id",
      [entity],
    )).rows[0].id;

    async function draft(date, description) {
      const entry = (await client.query(
        "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [entity, period, journal, date, description, accountant],
      )).rows[0].id;
      await client.query(
        "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 100, 0), ($1, $2, 2, $4, 0, 100)",
        [entity, entry, debitAccount, creditAccount],
      );
      return entry;
    }

    const forbidden = await draft("2026-10-20", "Auditor cannot post");
    await expectQueryError(
      client,
      "SELECT * FROM post_journal_entry($1, $2)",
      [forbidden, auditor],
      /não tem permissão para confirmar lançamentos/i,
    );
    assert.equal((await client.query("SELECT status FROM journal_entries WHERE id = $1", [forbidden])).rows[0].status, "draft");

    const first = await draft("2026-10-21", "First numbered entry");
    const second = await draft("2026-10-22", "Second numbered entry");
    const postedFirst = await client.query("SELECT * FROM post_journal_entry($1, $2)", [first, accountant]);
    const postedSecond = await client.query("SELECT * FROM post_journal_entry($1, $2)", [second, accountant]);
    assert.equal(Number(postedFirst.rows[0].assigned_number), 1);
    assert.equal(Number(postedSecond.rows[0].assigned_number), 2);

    const numbers = await client.query(
      "SELECT entry_number FROM journal_entries WHERE accounting_entity_id = $1 AND journal_id = $2 AND status = 'posted' ORDER BY entry_number",
      [entity, journal],
    );
    assert.deepEqual(numbers.rows.map(row => Number(row.entry_number)), [1, 2]);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
