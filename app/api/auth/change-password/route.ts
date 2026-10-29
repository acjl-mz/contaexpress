import { compare, hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession, getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "A sessão expirou. Inicie sessão novamente." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!currentPassword || currentPassword.length > 200) {
    return NextResponse.json({ error: "Introduza a palavra-passe actual." }, { status: 400 });
  }
  if (newPassword.length < 14 || newPassword.length > 200) {
    return NextResponse.json({ error: "A nova palavra-passe deve ter entre 14 e 200 caracteres." }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "A confirmação não corresponde à nova palavra-passe." }, { status: 400 });
  }

  const client = await db.connect();
  let nextSessionVersion: number;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, password_hash, session_version FROM app_users WHERE id=$1 AND status='active' FOR UPDATE",
      [user.id],
    );
    const current = result.rows[0];
    if (!current || typeof current.password_hash !== "string") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A conta não está disponível para alteração da palavra-passe." }, { status: 401 });
    }
    if (Number(current.session_version) !== Number(user.sessionVersion ?? 0)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A sessão já foi invalidada. Inicie sessão novamente." }, { status: 401 });
    }

    const validCurrentPassword = await compare(currentPassword, current.password_hash);
    if (!validCurrentPassword) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A palavra-passe actual está incorrecta." }, { status: 400 });
    }

    if (await compare(newPassword, current.password_hash)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A nova palavra-passe deve ser diferente da actual." }, { status: 400 });
    }

    const passwordHash = await hash(newPassword, 12);
    const updated = await client.query(
      "UPDATE app_users SET password_hash=$1, session_version=session_version+1, updated_at=now() WHERE id=$2 RETURNING session_version",
      [passwordHash, user.id],
    );
    nextSessionVersion = Number(updated.rows[0].session_version);

    // A password change invalidates outstanding reset links as well as all older sessions.
    await client.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [user.id],
    );
    await client.query(
      `INSERT INTO audit_events (organisation_id,actor_user_id,event_type,target_type,target_id,details)
       VALUES ($1,$2,'auth.password_changed','app_user',$3,$4::jsonb)`,
      [user.organisationId, user.id, user.id, JSON.stringify({ sessionVersion: nextSessionVersion })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha na alteração autenticada da palavra-passe:", error);
    return NextResponse.json({ error: "Não foi possível alterar a palavra-passe." }, { status: 500 });
  } finally {
    client.release();
  }

  try {
    // Keep this browser signed in with the new session version; every older token is now invalid.
    await createSession({ ...user, sessionVersion: nextSessionVersion });
  } catch (error) {
    console.error("Palavra-passe alterada, mas não foi possível renovar a sessão:", error);
    return NextResponse.json({
      message: "Palavra-passe alterada. Por segurança, inicie sessão novamente com a nova palavra-passe.",
      reauthenticate: true,
    }, { status: 200 });
  }

  return NextResponse.json({ message: "Palavra-passe alterada. As outras sessões foram invalidadas." });
}
