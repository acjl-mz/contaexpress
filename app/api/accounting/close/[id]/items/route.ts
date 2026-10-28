import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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
