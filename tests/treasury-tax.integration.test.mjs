import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

test("treasury and tax module schemas exist with tenant-scoped keys and safe status constraints", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for PostgreSQL integration tests");
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name = ANY($1::text[])`,
      [["treasury_accounts","treasury_transactions","tax_obligations","treasury_posting_mappings"]],
    );
    assert.deepEqual(new Set(tables.rows.map(r=>r.table_name)),new Set(["treasury_accounts","treasury_transactions","tax_obligations","treasury_posting_mappings"]));
    const constraints = await client.query(
      `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conrelid = ANY(ARRAY[
         'treasury_accounts'::regclass,'treasury_transactions'::regclass,'tax_obligations'::regclass
       ])`,
    );
    const all = constraints.rows.map(r=>r.definition).join("\n");
    assert.match(all,/accounting_entity_id/,"module data must be scoped to an accounting entity");
    assert.match(all,/amount >/,"treasury transactions must require a positive amount");
    assert.match(all,/inflow/,"treasury direction must be constrained");
    assert.match(all,/paid/,"tax obligation states must be constrained");
    assert.match(all,/tax_type/,"tax type must be constrained");
    const linkage = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury_transactions' AND column_name='journal_entry_id'");
    assert.equal(linkage.rowCount,1,"treasury movements must retain the linked journal entry");
    const uniqueSource = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='journal_entries_treasury_source_unique'");
    assert.equal(uniqueSource.rowCount,1,"treasury source reference must have a duplicate-prevention index");
  } finally {
    await client.end();
  }
});
