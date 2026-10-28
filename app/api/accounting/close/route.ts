import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ITEMS = [
  ["documents", "Confirmar documentação do período", "Verificar facturas, recibos, extractos e documentos de suporte."],
  ["bookkeeping", "Registar documentos contabilísticos", "Confirmar que os documentos relevantes foram registados."],
  ["reconciliation", "Concluir reconciliações bancárias", "Comparar movimentos bancários com os registos contabilísticos."],
  ["ledger", "Rever diário e razão", "Verificar classificações, descrições e saldos das contas."],
  ["trial_balance", "Validar balancete de verificação", "Confirmar a igualdade entre débitos e créditos."],
  ["tax", "Rever obrigações fiscais do período", "Confirmar as obrigações aplicáveis e respectivos prazos."],
  ["payroll", "Rever salários e obrigações laborais", "Aplicável quando a empresa tem trabalhadores no período."],
  ["review", "Revisão final e aprovação", "Registar que a revisão interna foi efectuada."]
] as const;

async function access(userId: string, entityId: string) {
  const result = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [userId, entityId]);
  return Boolean(result.rows[0]?.allowed);
}

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  try {
    if (!await access(user.id, entityId)) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const result = await db.query(
      `SELECT p.id AS "periodId", p.label AS "periodLabel", p.starts_on AS "startsOn", p.ends_on AS "endsOn", p.status AS "periodStatus",
              c.id AS "closeId", c.status AS "closeStatus", c.notes, c.closed_at AS "closedAt",
              (SELECT count(*) FROM accounting_period_close_items i WHERE i.close_id = c.id AND i.is_required AND i.status = 'completed') AS "requiredCompleted",
              (SELECT count(*) FROM accounting_period_close_items i WHERE i.close_id = c.id AND i.is_required) AS "requiredTotal"
       FROM accounting_periods p
       LEFT JOIN accounting_period_closes c ON c.accounting_entity_id = p.accounting_entity_id AND c.accounting_period_id = p.id
       WHERE p.accounting_entity_id = $1
       ORDER BY p.starts_on DESC LIMIT 36`,
      [entityId],
    );
    return NextResponse.json({ periods: result.rows });
  } catch (error) {
    console.error("Falha ao listar fechos mensais:", error);
    return NextResponse.json({ error: "Não foi possível carregar os fechos mensais." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant", "finance_manager"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para preparar um fecho mensal." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
    const periodId = typeof body.periodId === "string" ? body.periodId.trim() : "";
    if (!entityId || !periodId) return NextResponse.json({ error: "Indique a empresa e o período." }, { status: 400 });
    if (!await access(user.id, entityId)) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const period = await client.query(
        "SELECT id, status FROM accounting_periods WHERE id = $1 AND accounting_entity_id = $2 FOR UPDATE",
        [periodId, entityId],
      );
      if (!period.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Período não encontrado nesta empresa." }, { status: 404 }); }
      const existing = await client.query(
        "SELECT id FROM accounting_period_closes WHERE accounting_entity_id = $1 AND accounting_period_id = $2 FOR UPDATE",
        [entityId, periodId],
      );
      let closeId = existing.rows[0]?.id;
      if (!closeId) {
        const created = await client.query(
          "INSERT INTO accounting_period_closes (accounting_entity_id, accounting_period_id, created_by) VALUES ($1, $2, $3) RETURNING id",
          [entityId, periodId, user.id],
        );
        closeId = created.rows[0].id;
        for (let i = 0; i < DEFAULT_ITEMS.length; i++) {
          const [key, title, description] = DEFAULT_ITEMS[i];
          await client.query(
            "INSERT INTO accounting_period_close_items (accounting_entity_id, close_id, title, description, sort_order) VALUES ($1, $2, $3, $4, $5)",
            [entityId, closeId, title, description, i],
          );
        }
        await client.query(
          `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
           SELECT organisation_id, $1, $2, 'accounting_period_close.created', 'accounting_period_close', $3, $4::jsonb
           FROM accounting_entities WHERE id = $1`,
          [entityId, user.id, closeId, JSON.stringify({ periodId })],
        );
      }
      await client.query("COMMIT");
      return NextResponse.json({ closeId, created: !existing.rowCount }, { status: existing.rowCount ? 200 : 201 });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error) {
    console.error("Falha ao preparar fecho mensal:", error);
    return NextResponse.json({ error: "Não foi possível preparar o fecho mensal." }, { status: 500 });
  }
}
