import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createHash } from "node:crypto";

const { Client } = pg;

test("password reset tokens expire, are single-use and advance session version", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for PostgreSQL integration tests");
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const org = (await client.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ($1, $1) RETURNING id",
      [`Password reset integration ${Date.now()}`],
    )).rows[0].id;
    const user = (await client.query(
      "INSERT INTO app_users (email, full_name, status, password_hash) VALUES ($1, $2, 'active', 'test-hash') RETURNING id, session_version",
      [`password-reset-${Date.now()}@example.test`, "Password Reset Test"],
    )).rows[0];
    await client.query(
      "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'accountant')",
      [org, user.id],
    );
    const tokenHash = createHash("sha256").update("test-reset-token").digest("hex");
    const tokenId = (await client.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes') RETURNING id",
      [user.id, tokenHash],
    )).rows[0].id;
    const valid = await client.query(
      "SELECT id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
      [tokenHash],
    );
    assert.equal(valid.rowCount, 1, "fresh reset token must be valid");
    await client.query("UPDATE app_users SET session_version = session_version + 1 WHERE id = $1", [user.id]);
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [tokenId]);
    const after = await client.query("SELECT session_version FROM app_users WHERE id = $1", [user.id]);
    assert.equal(after.rows[0].session_version, user.session_version + 1, "password reset must advance session version");
    const reused = await client.query(
      "SELECT id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
      [tokenHash],
    );
    assert.equal(reused.rowCount, 0, "used reset token must not be reusable");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});
