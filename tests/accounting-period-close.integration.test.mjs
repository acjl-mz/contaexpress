import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

test("monthly close creation is idempotent for the same entity and period", async (t) => {
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
      ["ContaExpress Monthly Close IT", "ContaExpress Monthly Close IT"],
    )).rows[0].id;
    const user = (await client.query(
      "INSERT INTO app_users (email, full_name, status) VALUES ($1, $2, 'active') RETURNING id",
      [`ci-close-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, "Monthly Close Test"],
    )).rows[0].id;
    const entity = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, $2) RETURNING id",
      [org, "Monthly Close Test Entity"],
    )).rows[0].id;
    const year = (await client.query(
      "INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on) VALUES ($1, 'FY-CLOSE-IT', '2026-01-01', '2026-12-31') RETURNING id",
      [entity],
    )).rows[0].id;
    const period = (await client.query(
      "INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on) VALUES ($1, $2, '2026-CLOSE-IT', '2026-10-01', '2026-10-31') RETURNING id",
      [entity, year],
    )).rows[0].id;

    const first = await client.query(
      `INSERT INTO accounting_period_closes (accounting_entity_id, accounting_period_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (accounting_entity_id, accounting_period_id) DO NOTHING
       RETURNING id`,
      [entity, period, user],
    );
    const second = await client.query(
      `INSERT INTO accounting_period_closes (accounting_entity_id, accounting_period_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (accounting_entity_id, accounting_period_id) DO NOTHING
       RETURNING id`,
      [entity, period, user],
    );

    assert.equal(first.rowCount, 1, "the first request creates the close");
    assert.equal(second.rowCount, 0, "the repeated request does not create a duplicate");
    const closes = await client.query(
      "SELECT id FROM accounting_period_closes WHERE accounting_entity_id = $1 AND accounting_period_id = $2",
      [entity, period],
    );
    assert.equal(closes.rowCount, 1);
    assert.equal(closes.rows[0].id, first.rows[0].id);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
