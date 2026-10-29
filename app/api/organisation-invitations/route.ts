import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const ALLOWED_ROLES = new Set(["client_manager", "accountant", "tax_officer", "payroll_officer", "finance_manager", "client_director", "auditor"]);

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager"].includes(user.role)) return NextResponse.json({ error: "Não tem permissão para gerir convites." }, { status: 403 });
  const result = await db.query(
    `SELECT id, email, role, created_at AS "createdAt", expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt"
     FROM organisation_invitations WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [user.organisationId],
  );
  return NextResponse.json({ invitations: result.rows });
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager"].includes(user.role)) return NextResponse.json({ error: "Não tem permissão para convidar utilizadores." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: "Introduza um e-mail válido." }, { status: 400 });
  if (!ALLOWED_ROLES.has(role)) return NextResponse.json({ error: "O perfil seleccionado não pode ser atribuído por convite." }, { status: 400 });
  if (role === "client_manager" && user.role !== "superadmin") return NextResponse.json({ error: "Apenas o superadministrador pode convidar gestores da organização." }, { status: 403 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !baseUrl) return NextResponse.json({ error: "O envio de convites não está configurado. Defina RESEND_API_KEY, RESEND_FROM_EMAIL e APP_BASE_URL." }, { status: 503 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query("SELECT id FROM organisations WHERE id=$1 AND status='active' FOR UPDATE", [user.organisationId]);
    if (!org.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Organização indisponível." }, { status: 404 }); }
    const existing = await client.query("SELECT id FROM app_users WHERE lower(email)=$1 AND status='active' LIMIT 1", [email]);
    if (existing.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Este e-mail já pertence a uma conta. A associação de utilizadores existentes ainda não está disponível por convite." }, { status: 409 }); }
    await client.query("UPDATE organisation_invitations SET revoked_at=now() WHERE organisation_id=$1 AND lower(email)=$2 AND accepted_at IS NULL AND revoked_at IS NULL", [user.organisationId, email]);
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const inserted = await client.query(
      `INSERT INTO organisation_invitations (organisation_id,email,role,token_hash,invited_by_user_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,now()+interval '48 hours')
       RETURNING id, email, role, created_at AS "createdAt", expires_at AS "expiresAt"`,
      [user.organisationId, email, role, tokenHash, user.id],
    );
    await client.query(
      `INSERT INTO audit_events (organisation_id,actor_user_id,event_type,target_type,target_id,details)
       VALUES ($1,$2,'organisation.invitation_created','organisation_invitation',$3,$4::jsonb)`,
      [user.organisationId, user.id, inserted.rows[0].id, JSON.stringify({ email, role })],
    );
    await client.query("COMMIT");

    const link = new URL("/aceitar-convite", baseUrl);
    link.searchParams.set("token", token);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: [email], subject: "Convite para o ContaExpress",
        text: `Foi convidado para integrar uma organização no ContaExpress com o perfil ${role}. O convite expira em 48 horas. Para aceitar e definir a palavra-passe, abra: ${link.toString()}\n\nSe não esperava este convite, ignore esta mensagem.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await db.query("UPDATE organisation_invitations SET revoked_at=now() WHERE id=$1 AND accepted_at IS NULL", [inserted.rows[0].id]);
      await db.query(
        `INSERT INTO audit_events (organisation_id,actor_user_id,event_type,target_type,target_id,details)
         VALUES ($1,$2,'organisation.invitation_delivery_failed','organisation_invitation',$3,$4::jsonb)`,
        [user.organisationId, user.id, inserted.rows[0].id, JSON.stringify({ status: response.status })],
      );
      return NextResponse.json({ error: "Não foi possível enviar o convite. O convite foi invalidado; tente novamente." }, { status: 502 });
    }
    return NextResponse.json({ invitation: inserted.rows[0], message: "Convite enviado. Expira em 48 horas." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha ao criar convite:", error);
    return NextResponse.json({ error: "Não foi possível criar o convite." }, { status: 500 });
  } finally { client.release(); }
}
