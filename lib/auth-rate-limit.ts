import { createHmac } from "node:crypto";
import { db } from "@/lib/db";

const WINDOW_MINUTES = 15;
const EMAIL_FAILURE_LIMIT = 8;
const IP_FAILURE_LIMIT = 30;

function digest(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET deve ter pelo menos 32 caracteres.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export type LoginAttemptContext = { email: string; ip: string };

export async function isLoginRateLimited(context: LoginAttemptContext) {
  const emailHash = digest(`email:${context.email.toLowerCase()}`);
  const ipHash = digest(`ip:${context.ip}`);
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE identifier_type = 'email' AND identifier_hash = $1) AS email_failures,
       COUNT(*) FILTER (WHERE identifier_type = 'ip' AND identifier_hash = $2) AS ip_failures
     FROM auth_login_attempts
     WHERE succeeded = FALSE
       AND attempted_at > now() - ($3::text || ' minutes')::interval
       AND ((identifier_type = 'email' AND identifier_hash = $1)
         OR (identifier_type = 'ip' AND identifier_hash = $2))`,
    [emailHash, ipHash, WINDOW_MINUTES],
  );
  return Number(result.rows[0]?.email_failures ?? 0) >= EMAIL_FAILURE_LIMIT ||
    Number(result.rows[0]?.ip_failures ?? 0) >= IP_FAILURE_LIMIT;
}

export async function recordLoginAttempt(context: LoginAttemptContext, succeeded: boolean) {
  const emailHash = digest(`email:${context.email.toLowerCase()}`);
  const ipHash = digest(`ip:${context.ip}`);
  await db.query(
    `INSERT INTO auth_login_attempts (identifier_type, identifier_hash, succeeded)
     VALUES ('email', $1, $3), ('ip', $2, $3)`,
    [emailHash, ipHash, succeeded],
  );
  // Keep the table bounded without retaining stale attempt metadata indefinitely.
  await db.query("DELETE FROM auth_login_attempts WHERE attempted_at < now() - interval '30 days'");
}
