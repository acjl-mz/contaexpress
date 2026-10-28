import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const validTypes = new Set(["asset", "liability", "equity", "income", "expense", "memo"]);

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const result = await db.query(
      `SELECT id, code, name, account_type AS "accountType", parent_account_id AS "parentAccountId",
              is_postable AS "isPostable", is_active AS "isActive"
       FROM chart_of_accounts WHERE accounting_entity_id = $1
       ORDER BY code`,
      [entityId],
    );
    return NextResponse.json({ accounts: result.rows });
  } catch (error) {
    console.error("Falha ao carregar plano de contas:", error);
    return NextResponse.json({ error: "Não foi possível carregar o plano de contas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  try {
    const body = await request.json();
    const entityId = typeof body.entityId === "string" ? body.entityId : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const accountType = typeof body.accountType === "string" ? body.accountType : "";
    const parentAccountId = typeof body.parentAccountId === "string" && body.parentAccountId ? body.parentAccountId : null;
    const isPostable = body.isPostable !== false;
    if (!entityId || !/^[A-Za-z0-9._-]{1,30}$/.test(code) || name.length < 2 || name.length > 180 || !validTypes.has(accountType)) {
      return NextResponse.json({ error: "Verifique o código, nome e tipo da conta." }, { status: 400 });
    }
    if (!["superadmin", "client_manager", "accountant"].includes(user.role)) return NextResponse.json({ error: "Não tem permissão para alterar o plano de contas." }, { status: 403 });
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    if (parentAccountId) {
      const parent = await db.query("SELECT id FROM chart_of_accounts WHERE id = $1 AND accounting_entity_id = $2", [parentAccountId, entityId]);
      if (!parent.rowCount) return NextResponse.json({ error: "A conta-mãe não pertence a esta empresa." }, { status: 400 });
    }
    const result = await db.query(
      `INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type, parent_account_id, is_postable)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, name, account_type AS "accountType", parent_account_id AS "parentAccountId", is_postable AS "isPostable", is_active AS "isActive"`,
      [entityId, code, name, accountType, parentAccountId, isPostable],
    );
    await db.query(
      `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
       SELECT organisation_id, $1, $2, 'account.created', 'chart_of_account', $3, $4::jsonb
       FROM accounting_entities WHERE id = $1`,
      [entityId, user.id, result.rows[0].id, JSON.stringify({ code, name, accountType })],
    );
    return NextResponse.json({ account: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Falha ao criar conta:", error);
    return NextResponse.json({ error: "Não foi possível criar a conta. Confirme se o código já não existe." }, { status: 500 });
  }
}
