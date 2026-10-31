import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

async function requirePlatformAdmin() {
  const user = await getSession();
  if (!user) return { user: null, response: NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 }) };
  const grant = await db.query("SELECT 1 FROM platform_administrators WHERE user_id = $1", [user.id]);
  if (!grant.rowCount) return { user: null, response: NextResponse.json({ error: "Acesso reservado à administração da plataforma." }, { status: 403 }) };
  return { user, response: null };
}

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if (auth.response) return auth.response;
  try {
    const [organisations, metrics, administrators] = await Promise.all([
      db.query(`SELECT o.id, o.legal_name AS "legalName", o.display_name AS "displayName", o.status,
        o.created_at AS "createdAt",
        COUNT(DISTINCT e.id)::int AS "companyCount",
        COUNT(DISTINCT om.user_id)::int AS "userCount",
        MAX(e.created_at) AS "lastCompanyCreatedAt"
        FROM organisations o
        LEFT JOIN accounting_entities e ON e.organisation_id=o.id
        LEFT JOIN organisation_memberships om ON om.organisation_id=o.id
        WHERE NOT EXISTS (
          SELECT 1 FROM organisation_memberships root_membership
          JOIN platform_administrators root_admin ON root_admin.user_id=root_membership.user_id
          WHERE root_membership.organisation_id=o.id
        )
        GROUP BY o.id ORDER BY o.created_at DESC`),
      db.query(`SELECT COUNT(*)::int AS "organisationCount",
        COUNT(*) FILTER (WHERE status='active')::int AS "activeCount",
        COUNT(*) FILTER (WHERE status='suspended')::int AS "suspendedCount"
        FROM organisations o WHERE NOT EXISTS (
          SELECT 1 FROM organisation_memberships root_membership
          JOIN platform_administrators root_admin ON root_admin.user_id=root_membership.user_id
          WHERE root_membership.organisation_id=o.id
        )`),
      db.query(`SELECT u.id, u.full_name AS "fullName", u.email, pa.created_at AS "grantedAt"
        FROM platform_administrators pa JOIN app_users u ON u.id=pa.user_id
        WHERE u.status='active' ORDER BY pa.created_at ASC`),
    ]);
    return NextResponse.json({ organisations: organisations.rows, metrics: metrics.rows[0], administrators: administrators.rows });
  } catch (error) {
    console.error("Falha ao carregar administração da plataforma:", error);
    return NextResponse.json({ error: "Não foi possível carregar os dados da plataforma." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin();
  if (auth.response || !auth.user) return auth.response;
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }); }

  const legalName = clean(body.legalName, 180);
  const displayName = clean(body.displayName, 180) || legalName;
  const companyName = clean(body.companyName, 180) || legalName;
  const taxNumber = clean(body.taxNumber, 80) || null;
  const countryCode = clean(body.countryCode, 2).toUpperCase() || "MZ";
  const currency = clean(body.currency, 3).toUpperCase() || "MZN";
  const adminName = clean(body.adminName, 180);
  const adminEmail = clean(body.adminEmail, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (legalName.length < 2 || companyName.length < 2 || adminName.length < 2) return NextResponse.json({ error: "Preencha a organização, a empresa e o nome do administrador." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return NextResponse.json({ error: "Introduza um e-mail válido para o administrador." }, { status: 400 });
  if (password.length < 14 || password.length > 200) return NextResponse.json({ error: "A palavra-passe inicial deve ter pelo menos 14 caracteres." }, { status: 400 });
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "País ou moeda inválidos." }, { status: 400 });

  const passwordHash = await hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM app_users WHERE lower(email)=$1 LIMIT 1", [adminEmail]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Este e-mail já está associado a uma conta do ContaExpress." }, { status: 409 });
    }
    const org = await client.query(
      "INSERT INTO organisations (legal_name, display_name) VALUES ($1,$2) RETURNING id, legal_name AS \"legalName\", display_name AS \"displayName\", status, created_at AS \"createdAt\"",
      [legalName, displayName],
    );
    const user = await client.query(
      "INSERT INTO app_users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id,email,full_name",
      [adminEmail, adminName, passwordHash],
    );
    await client.query("INSERT INTO organisation_memberships (organisation_id,user_id,role) VALUES ($1,$2,'client_manager')", [org.rows[0].id, user.rows[0].id]);
    const entity = await client.query(
      `INSERT INTO accounting_entities (organisation_id,legal_name,tax_number,country_code,functional_currency)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,legal_name AS "legalName",tax_number AS "taxNumber",country_code AS "countryCode",functional_currency AS currency,status,created_at AS "createdAt"`,
      [org.rows[0].id, companyName, taxNumber, countryCode, currency],
    );
    await client.query(
      `INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
       VALUES ($1,$2,$3,'platform.organisation_created','organisation',$4,$5::jsonb)`,
      [org.rows[0].id, entity.rows[0].id, auth.user.id, org.rows[0].id, JSON.stringify({ legalName, companyName, adminEmail })],
    );
    await client.query(
      `INSERT INTO audit_events (organisation_id,actor_user_id,event_type,target_type,target_id,details)
       VALUES ($1,$2,'platform.initial_admin_created','app_user',$3,$4::jsonb)`,
      [org.rows[0].id, auth.user.id, user.rows[0].id, JSON.stringify({ email: adminEmail, role: "client_manager" })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ organisation: { ...org.rows[0], companyCount: 1, userCount: 1 }, company: entity.rows[0], administrator: { id: user.rows[0].id, fullName: user.rows[0].full_name, email: user.rows[0].email } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha ao criar organização:", error);
    return NextResponse.json({ error: "Não foi possível criar a organização e a conta inicial." }, { status: 500 });
  } finally { client.release(); }
}
