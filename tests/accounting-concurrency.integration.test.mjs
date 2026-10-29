import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

test("concurrent posting of one draft assigns one number and posts exactly once", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for PostgreSQL integration tests");
    return;
  }

  const setup = new Client({ connectionString: process.env.DATABASE_URL });
  const first = new Client({ connectionString: process.env.DATABASE_URL });
  const second = new Client({ connectionString: process.env.DATABASE_URL });
  let ids;
  await setup.connect();
  await first.connect();
  await second.connect();
  try {
    const org = (await setup.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ('CI concurrency org', 'CI concurrency org') RETURNING id",
    )).rows[0].id;
    const user = (await setup.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, 'CI concurrency user', 'active') RETURNING id",
      [`ci-concurrency-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`],
    )).rows[0].id;
    await setup.query("INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant')", [org, user]);
    const entity = (await setup.query("INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, 'CI concurrency entity') RETURNING id", [org])).rows[0].id;
    const year = (await setup.query("INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, 'CI-CONCURRENCY', '2026-01-01', '2026-12-31') RETURNING id", [entity])).rows[0].id;
    const period = (await setup.query("INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, 'CI-CONCURRENCY', '2026-01-01', '2026-12-31') RETURNING id", [entity, year])).rows[0].id;
    const journal = (await setup.query("INSERT INTO accounting_journals (accounting_entity_id, code, name) VALUES ($1, 'CONC', 'Concurrent posting') RETURNING id", [entity])).rows[0].id;
    const debit = (await setup.query("INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'CONC-1', 'Banco', 'asset') RETURNING id", [entity])).rows[0].id;
    const credit = (await setup.query("INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type) VALUES ($1, 'CONC-2', 'Capital', 'equity') RETURNING id", [entity])).rows[0].id;
    const entry = (await setup.query(
      "INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, created_by) VALUES ($1, $2, $3, '2026-10-20', 'Concurrent posting test', $4) RETURNING id",
      [entity, period, journal, user],
    )).rows[0].id;
    await setup.query(
      "INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, debit, credit) VALUES ($1, $2, 1, $3, 125, 0), ($1, $2, 2, $4, 0, 125)",
      [entity, entry, debit, credit],
    );
    ids = { org, user, entity, year, period, journal, debit, credit, entry };

    const results = await Promise.allSettled([
      first.query("SELECT * FROM post_journal_entry($1, $2)", [entry, user]),
      second.query("SELECT * FROM post_journal_entry($1, $2)", [entry, user]),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "only one concurrent confirmation should succeed");
    assert.equal(results.filter(result => result.status === "rejected").length, 1, "the competing confirmation should be rejected");
    const stored = await setup.query("SELECT status, entry_number FROM journal_entries WHERE id = $1", [entry]);
    assert.equal(stored.rows[0].status, "posted");
    assert.equal(Number(stored.rows[0].entry_number), 1);
    const numbered = await setup.query(
      "SELECT count(*)::int AS count FROM journal_entries WHERE accounting_entity_id = $1 AND journal_id = $2 AND entry_number = 1",
      [entity, journal],
    );
    assert.equal(numbered.rows[0].count, 1);
  } finally {
    if (ids) {
      await setup.query("SET session_replication_role = replica").catch(() => undefined);
      await setup.query("DELETE FROM journal_entry_lines WHERE entry_id = $1", [ids.entry]).catch(() => undefined);
      await setup.query("DELETE FROM journal_entries WHERE id = $1", [ids.entry]).catch(() => undefined);
      await setup.query("DELETE FROM chart_of_accounts WHERE accounting_entity_id = $1", [ids.entity]).catch(() => undefined);
      await setup.query("DELETE FROM accounting_journals WHERE id = $1", [ids.journal]).catch(() => undefined);
      await setup.query("DELETE FROM accounting_periods WHERE id = $1", [ids.period]).catch(() => undefined);
      await setup.query("DELETE FROM fiscal_years WHERE id = $1", [ids.year]).catch(() => undefined);
      await setup.query("DELETE FROM accounting_entities WHERE id = $1", [ids.entity]).catch(() => undefined);
      await setup.query("DELETE FROM organisation_memberships WHERE organisation_id = $1 AND user_id = $2", [ids.org, ids.user]).catch(() => undefined);
      await setup.query("DELETE FROM app_users WHERE id = $1", [ids.user]).catch(() => undefined);
      await setup.query("DELETE FROM organisations WHERE id = $1", [ids.org]).catch(() => undefined);
      await setup.query("SET session_replication_role = origin").catch(() => undefined);
    }
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
});
