import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant"].includes(user.role)) return NextResponse.json({ error: "Não tem permissão para confirmar lançamentos." }, { status: 403 });
  const { id } = await context.params;
  try {
    const entityId = request.nextUrl.searchParams.get("entityId");
    if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const entry = await db.query("SELECT id FROM journal_entries WHERE id = $1 AND accounting_entity_id = $2", [id, entityId]);
    if (!entry.rowCount) return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });
    const result = await db.query("SELECT * FROM post_journal_entry($1, $2)", [id, user.id]);
    await db.query(
      `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
       SELECT organisation_id, $1, $2, 'journal_entry.posted', 'journal_entry', $3, $4::jsonb
       FROM accounting_entities WHERE id = $1`,
      [entityId, user.id, id, JSON.stringify({ entryNumber: result.rows[0].assigned_number })],
    );
    return NextResponse.json({ entry: { id, status: "posted", entryNumber: result.rows[0].assigned_number } });
  } catch (error) {
    console.error("Falha ao confirmar lançamento:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível confirmar o lançamento." }, { status: 400 });
  }
}
