import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: "O link de recuperação é inválido ou expirou." }, { status: 400 });
  }
  if (password.length < 14 || password.length > 200) {
    return NextResponse.json({ error: "A palavra-passe deve ter entre 14 e 200 caracteres." }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const passwordHash = await hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [tokenHash],
    );
    const reset = result.rows[0];
    if (!reset) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "O link de recuperação é inválido ou expirou." }, { status: 400 });
    }

    await client.query(
      "UPDATE app_users SET password_hash = $1, session_version = session_version + 1, updated_at = now() WHERE id = $2 AND status = 'active'",
      [passwordHash, reset.user_id],
    );
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [reset.user_id]);
    await client.query("COMMIT");
    return NextResponse.json({ message: "Palavra-passe alterada. Inicie sessão com a nova palavra-passe." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha na redefinição da palavra-passe:", error);
    return NextResponse.json({ error: "Não foi possível alterar a palavra-passe." }, { status: 500 });
  } finally {
    client.release();
  }
}
