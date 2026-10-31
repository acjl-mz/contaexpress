import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const grant = await db.query("SELECT 1 FROM platform_administrators WHERE user_id=$1", [user.id]);
  if (!grant.rowCount) return NextResponse.json({ error: "Acesso reservado à administração da plataforma." }, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  let body: { status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }); }
  const status = body.status;
  if (!["active", "suspended", "archived"].includes(String(status))) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE organisations SET status=$2,updated_at=now() WHERE id=$1
       RETURNING id,legal_name AS "legalName",display_name AS "displayName",status,created_at AS "createdAt"`,
      [id, status],
    );
    if (!updated.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Organização não encontrada." }, { status: 404 }); }
    await client.query(
      `INSERT INTO audit_events (organisation_id,actor_user_id,event_type,target_type,target_id,details)
       VALUES ($1,$2,'platform.organisation_status_changed','organisation',$3,$4::jsonb)`,
      [id, user.id, id, JSON.stringify({ status })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ organisation: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha ao actualizar organização:", error);
    return NextResponse.json({ error: "Não foi possível actualizar o estado da organização." }, { status: 500 });
  } finally { client.release(); }
}
