import bcrypt from "bcryptjs";

const { hash } = bcrypt;
import pg from "pg";

const { Pool } = pg;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const fullName = process.env.ADMIN_NAME?.trim();
const password = process.env.ADMIN_PASSWORD;
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL.");
if (!email || !fullName || !password) throw new Error("Configure ADMIN_EMAIL, ADMIN_NAME e ADMIN_PASSWORD.");
if (password.length < 14) throw new Error("ADMIN_PASSWORD deve ter pelo menos 14 caracteres.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ADMIN_EMAIL inválido.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query("SELECT id FROM app_users WHERE lower(email) = $1", [email]);
  if (existing.rowCount) throw new Error("Já existe um utilizador com este e-mail. O script não altera contas existentes.");
  const passwordHash = await hash(password, 12);
  const orgName = process.env.ADMIN_ORGANISATION?.trim() || "ContaExpress — Administração";
  const org = await client.query(
    "INSERT INTO organisations (legal_name, display_name) VALUES ($1, $1) RETURNING id",
    [orgName],
  );
  const user = await client.query(
    "INSERT INTO app_users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id",
    [email, fullName, passwordHash],
  );
  await client.query(
    "INSERT INTO organisation_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'superadmin')",
    [org.rows[0].id, user.rows[0].id],
  );
  await client.query(
    "INSERT INTO audit_events (organisation_id, actor_user_id, event_type, target_type, target_id, details) VALUES ($1, $2, 'admin.bootstrap', 'app_user', $2, $3::jsonb)",
    [org.rows[0].id, user.rows[0].id, JSON.stringify({ email, setup: "one-time-script" })],
  );
  await client.query("COMMIT");
  console.log("Administrador criado com sucesso. Guarde as credenciais num gestor de palavras-passe.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
