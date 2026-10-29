import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

test("PostgreSQL posting controls enforce balanced entries and immutable posted lines", async (t) => {
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
      ["ContaExpress Integration Test", "ContaExpress IT"],
    )).rows[0].id;
    const user = (await client.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, $2, 'active') RETURNING id",
      [`ci-posting-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, "CI Posting Test"],
    )).rows[0].id;
    await client.query(
      "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant')",
      [org, user],
    );
    const entity = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, $2) RETURNING id",
      [org, "ContaExpress IT Entity"],
    )).rows[0].id;
    const fiscalYear = (await client.query(
      "INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, $2, '2026-01-01', '2026-12-31') RETURNING id",
      [entity, "FY-2026-IT"],
    )).rows[0].id;
    const period = (await client.query(
      "INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, $3, '2026-01-01', '2026-12-31') RETURNING id",
      [entity, fiscalYear, "2026-IT"],
    )).rows[0].id;
    const journal = (await client.query(
      "INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'IT', 'Integration Test Journal') RETURNING id",
      [entity],
    )).rows[0].id;
    const asset = (await client.query(
      "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'IT-101', 'Banco de teste', 'asset') RETURNING id",
      [entity],
    )).rows[0].id;
    const equity = (await client.query(
      "INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'IT-501', 'Capital de teste', 'equity') RETURNING id",
      [entity],
    )).rows[0].id;

    const balancedEntry = (await client.query(
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-10-01', 'Lançamento equilibrado de teste', $4) RETURNING id",
      [entity, period, journal, user],
    )).rows[0].id;
    await client.query(
      "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 1000, 0), ($1, $2, 2, $4, 0, 1000)",
      [entity, balancedEntry, asset, equity],
    );

    const posted = await client.query("SELECT * FROM post_journal_entry($1, $2)", [balancedEntry, user]);
    assert.equal(posted.rows[0].entry_id, balancedEntry);
    assert.equal(Number(posted.rows[0].assigned_number), 1);
    assert.equal((await client.query("SELECT status FROM journal_entries WHERE id = $1", [balancedEntry])).rows[0].status, "posted");

    await assert.rejects(
      client.query("UPDATE journal_entry_lines SET debit = 900 WHERE entry_id = $1 AND line_number = 1", [balancedEntry]),
      /Não é permitido alterar linhas de um lançamento confirmado/,
    );
    await assert.rejects(
      client.query("DELETE FROM journal_entries WHERE id = $1", [balancedEntry]),
      /Não é permitido apagar um lançamento confirmado/,
    );

    const unbalancedEntry = (await client.query(
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-10-02', 'Lançamento desequilibrado de teste', $4) RETURNING id",
      [entity, period, journal, user],
    )).rows[0].id;
    await client.query(
      "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 1000, 0), ($1, $2, 2, $4, 0, 900)",
      [entity, unbalancedEntry, asset, equity],
    );
    await assert.rejects(
      client.query("SELECT * FROM post_journal_entry($1, $2)", [unbalancedEntry, user]),
      /O total de débitos deve ser igual ao total de créditos/,
    );
    assert.equal((await client.query("SELECT status FROM journal_entries WHERE id = $1", [unbalancedEntry])).rows[0].status, "draft");
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
