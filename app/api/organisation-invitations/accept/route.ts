import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }); }
  const token = typeof body.token === "string" ? body.token : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmation = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "O convite é inválido ou expirou." }, { status: 400 });
  if (fullName.length < 2 || fullName.length > 180) return NextResponse.json({ error: "Introduza o nome completo." }, { status: 400 });
  if (password.length < 14 || password.length > 200) return NextResponse.json({ error: "A palavra-passe deve ter entre 14 e 200 caracteres." }, { status: 400 });
  if (password !== confirmation) return NextResponse.json({ error: "A confirmação da palavra-passe não corresponde." }, { status: 400 });

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const passwordHash = await hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, organisation_id, email, role, invited_by_user_id
       FROM organisation_invitations
       WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()
       FOR UPDATE`, [tokenHash]);
    const invitation = found.rows[0];
    if (!invitation) { await client.query("ROLLBACK"); return NextResponse.json({ error: "O convite é inválido ou expirou." }, { status: 400 }); }
    const org = await client.query("SELECT id FROM organisations WHERE id=$1 AND status='active' FOR UPDATE", [invitation.organisation_id]);
    if (!org.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "A organização já não está disponível." }, { status: 400 }); }
    const existing = await client.query("SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1", [invitation.email]);
    if (existing.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Já existe uma conta com este e-mail. Contacte o administrador da organização." }, { status: 409 }); }
    const created = await client.query(
      "INSERT INTO app_users (email, full_name, password_hash, status) VALUES ($1,$2,$3,'active') RETURNING id",
      [invitation.email, fullName, passwordHash]);
    const userId = created.rows[0].id;
    await client.query("INSERT INTO organisation_memberships (organisation_id,user_id,role) VALUES ($1,$2,$3)", [invitation.organisation_id,userId,invitation.role]);
    await client.query("UPDATE organisation_invitations SET accepted_at=now() WHERE id=$1", [invitation.id]);
    await client.query(
      `INSERT INTO audit_events (organisation_id,actor_user_id,event_type,target_type,target_id,details)
       VALUES ($1,$2,'organisation.invitation_accepted','organisation_invitation',$3,$4::jsonb)`,
      [invitation.organisation_id,userId,invitation.id,JSON.stringify({email:invitation.email,role:invitation.role,invitedBy:invitation.invited_by_user_id})]);
    await client.query("COMMIT");
    return NextResponse.json({ message: "Convite aceite. Já pode iniciar sessão com o e-mail e a palavra-passe definidos." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    console.error("Falha ao aceitar convite:",error);
    return NextResponse.json({ error: "Não foi possível aceitar o convite." }, { status: 500 });
  } finally { client.release(); }
}
