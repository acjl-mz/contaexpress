import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const { id } = await context.params;
  try {
    const closeResult = await db.query("SELECT accounting_entity_id FROM accounting_period_closes WHERE id = $1", [id]);
    if (!closeResult.rowCount) return NextResponse.json({ error: "Fecho mensal não encontrado." }, { status: 404 });
    const entityId = closeResult.rows[0].accounting_entity_id;
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const result = await db.query(
      `SELECT id, title, description, is_required AS "isRequired", status, sort_order AS "sortOrder",
              completed_by AS "completedBy", completed_at AS "completedAt"
       FROM accounting_period_close_items WHERE close_id = $1 ORDER BY sort_order, created_at`,
      [id],
    );
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    console.error("Falha ao carregar checklist:", error);
    return NextResponse.json({ error: "Não foi possível carregar a checklist." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant", "finance_manager"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para actualizar a checklist." }, { status: 403 });
  }
  const { id, itemId } = await context.params;
  try {
    const body = await request.json();
    const status = body.status;
    if (!["pending", "completed", "not_applicable"].includes(status)) return NextResponse.json({ error: "Estado da tarefa inválido." }, { status: 400 });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const closeResult = await client.query("SELECT accounting_entity_id, status FROM accounting_period_closes WHERE id = $1 FOR UPDATE", [id]);
      if (!closeResult.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Fecho mensal não encontrado." }, { status: 404 }); }
      const close = closeResult.rows[0];
      const access = await client.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, close.accounting_entity_id]);
      if (!access.rows[0]?.allowed) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 }); }
      if (close.status === "closed") { await client.query("ROLLBACK"); return NextResponse.json({ error: "Este fecho já foi encerrado." }, { status: 409 }); }
      const existingItem = await client.query("SELECT is_required FROM accounting_period_close_items WHERE id = $1 AND close_id = $2 FOR UPDATE", [itemId, id]);
      if (!existingItem.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Item da checklist não encontrado." }, { status: 404 }); }
      if (existingItem.rows[0].is_required && status !== "completed" && status !== "pending") { await client.query("ROLLBACK"); return NextResponse.json({ error: "Um requisito obrigatório só pode ser concluído ou ficar pendente." }, { status: 400 }); }
      const result = await client.query(
        `UPDATE accounting_period_close_items
         SET status = $3, completed_by = CASE WHEN $3 = 'completed' THEN $4::uuid ELSE NULL END,
             completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE NULL END
         WHERE id = $1 AND close_id = $2
         RETURNING id, title, status, completed_by AS "completedBy", completed_at AS "completedAt"`,
        [itemId, id, status, user.id],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Item da checklist não encontrado." }, { status: 404 }); }
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         SELECT organisation_id, $1, $2, 'accounting_period_close_item.updated', 'accounting_period_close_item', $3, $4::jsonb
         FROM accounting_entities WHERE id = $1`,
        [close.accounting_entity_id, user.id, itemId, JSON.stringify({ closeId: id, status })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ item: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error) {
    console.error("Falha ao actualizar checklist de fecho:", error);
    return NextResponse.json({ error: "Não foi possível actualizar a checklist." }, { status: 500 });
  }
}
