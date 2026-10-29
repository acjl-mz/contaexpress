import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

test("entity access isolates organisations and permits explicit entity memberships", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for PostgreSQL integration tests");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const orgA = (await client.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ('Tenant A Test', 'Tenant A') RETURNING id",
    )).rows[0].id;
    const orgB = (await client.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ('Tenant B Test', 'Tenant B') RETURNING id",
    )).rows[0].id;

    const userA = (await client.query(
      "INSERT INTO app_users (email, full_name) VALUES ($1, 'User A') RETURNING id",
      [`ci-tenant-a-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`],
    )).rows[0].id;
    const userB = (await client.query(
      "INSERT INTO app_users (email, full_name) VALUES ($1, 'User B') RETURNING id",
      [`ci-tenant-b-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`],
    )).rows[0].id;

    await client.query(
      "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant'), ($3, $4, 'accountant')",
      [orgA, userA, orgB, userB],
    );
    const entityA = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, 'Entity A') RETURNING id",
      [orgA],
    )).rows[0].id;
    const entityB = (await client.query(
      "INSERT INTO accounting_entities (organisation_id, legal_name) VALUES ($1, 'Entity B') RETURNING id",
      [orgB],
    )).rows[0].id;

    const access = async (userId, entityId) => {
      const result = await client.query(
        "SELECT user_can_access_entity($1, $2) AS allowed",
        [userId, entityId],
      );
      return result.rows[0].allowed;
    };

    assert.equal(await access(userA, entityA), true, "a member can access their own organisation entity");
    assert.equal(await access(userB, entityB), true, "a member can access their own organisation entity");
    assert.equal(await access(userA, entityB), false, "tenant A must not access tenant B");
    assert.equal(await access(userB, entityA), false, "tenant B must not access tenant A");

    await client.query(
      "INSERT INTO entity_memberships (accounting_entity_id, user_id, role) VALUES ($1, $2, 'auditor')",
      [entityB, userA],
    );
    assert.equal(await access(userA, entityB), true, "an explicit entity membership grants access only to that entity");

    const visibleForA = await client.query(
      "SELECT id FROM accounting_entities WHERE id = ANY($1::uuid[]) AND user_can_access_entity($2, id) ORDER BY id",
      [[entityA, entityB], userA],
    );
    assert.deepEqual(visibleForA.rows.map(row => row.id).sort(), [entityA, entityB].sort());

    await client.query(
      "DELETE FROM entity_memberships WHERE accounting_entity_id = $1 AND user_id = $2",
      [entityB, userA],
    );
    assert.equal(await access(userA, entityB), false, "revoking explicit membership removes access");
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
