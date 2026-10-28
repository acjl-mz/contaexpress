import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["pending", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CATEGORIES = new Set(["documents", "bookkeeping", "tax", "payroll", "reconciliation", "monthly_close", "other"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant", "finance_manager"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para alterar tarefas." }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const body = await request.json();
    const status = typeof body.status === "string" ? body.status : undefined;
    const priority = typeof body.priority === "string" ? body.priority : undefined;
    const category = typeof body.category === "string" ? body.category : undefined;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 180) : undefined;
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : undefined;
    const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() || null : undefined;
    const assignedTo = typeof body.assignedTo === "string" ? body.assignedTo.trim() || null : undefined;
    if (status !== undefined && !STATUSES.has(status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
    if (priority !== undefined && !PRIORITIES.has(priority)) return NextResponse.json({ error: "Prioridade inválida." }, { status: 400 });
    if (category !== undefined && !CATEGORIES.has(category)) return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
    if (title !== undefined && title.length < 2) return NextResponse.json({ error: "O título deve conter pelo menos 2 caracteres." }, { status: 400 });
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return NextResponse.json({ error: "Data limite inválida." }, { status: 400 });

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT * FROM accounting_tasks WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
      }
      const task = current.rows[0];
      const access = await client.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, task.accounting_entity_id]);
      if (!access.rows[0]?.allowed) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
      }
      const nextAssignee = assignedTo === undefined ? task.assigned_to : assignedTo;
      if (nextAssignee) {
        const membership = await client.query(
          `SELECT 1 FROM organisation_memberships om
           JOIN accounting_entities e ON e.organisation_id = om.organisation_id
           WHERE e.id = $1 AND om.user_id = $2
           UNION
           SELECT 1 FROM entity_memberships em WHERE em.accounting_entity_id = $1 AND em.user_id = $2 LIMIT 1`,
          [task.accounting_entity_id, nextAssignee],
        );
        if (!membership.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "O responsável não pertence à organização ou empresa." }, { status: 400 });
        }
      }
      const nextStatus = status ?? task.status;
      const result = await client.query(
        `UPDATE accounting_tasks SET
           title = COALESCE($2, title),
           description = CASE WHEN $3::boolean THEN $4::text ELSE description END,
           category = COALESCE($5, category),
           status = $6,
           priority = COALESCE($7, priority),
           due_date = CASE WHEN $8::boolean THEN $9::date ELSE due_date END,
           assigned_to = CASE WHEN $10::boolean THEN $11::uuid ELSE assigned_to END,
           completed_at = CASE WHEN $6 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END
         WHERE id = $1
         RETURNING id, title, description, category, status, priority, due_date AS "dueDate",
                   assigned_to AS "assignedTo", completed_at AS "completedAt", updated_at AS "updatedAt"`,
        [id, title ?? null, description !== undefined, description ?? null, category ?? null,
          nextStatus, priority ?? null, dueDate !== undefined, dueDate ?? null,
          assignedTo !== undefined, nextAssignee],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         SELECT organisation_id, $1, $2, 'accounting_task.updated', 'accounting_task', $3, $4::jsonb
         FROM accounting_entities WHERE id = $1`,
        [task.accounting_entity_id, user.id, id, JSON.stringify({ status: nextStatus, priority: priority ?? task.priority })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ task: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Falha ao actualizar tarefa:", error);
    return NextResponse.json({ error: "Não foi possível actualizar a tarefa." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para cancelar tarefas." }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const result = await db.query(
      "SELECT accounting_entity_id, status FROM accounting_tasks WHERE id = $1",
      [id],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    const task = result.rows[0];
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, task.accounting_entity_id]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE accounting_tasks SET status = 'cancelled', completed_at = NULL WHERE id = $1", [id]);
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         SELECT organisation_id, $1, $2, 'accounting_task.cancelled', 'accounting_task', $3, '{}'::jsonb
         FROM accounting_entities WHERE id = $1`,
        [task.accounting_entity_id, user.id, id],
      );
      await client.query("COMMIT");
      return NextResponse.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Falha ao cancelar tarefa:", error);
    return NextResponse.json({ error: "Não foi possível cancelar a tarefa." }, { status: 500 });
  }
}
