import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["documents", "bookkeeping", "tax", "payroll", "reconciliation", "monthly_close", "other"]);
const STATUSES = new Set(["pending", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function canAccess(userId: string, entityId: string) {
  const result = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [userId, entityId]);
  return Boolean(result.rows[0]?.allowed);
}

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  try {
    if (!await canAccess(user.id, entityId)) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const status = request.nextUrl.searchParams.get("status");
    const category = request.nextUrl.searchParams.get("category");
    if (status && !STATUSES.has(status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
    if (category && !CATEGORIES.has(category)) return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
    const result = await db.query(
      `SELECT t.id, t.title, t.description, t.category, t.status, t.priority,
              t.due_date AS "dueDate", t.assigned_to AS "assignedTo",
              assignee.full_name AS "assigneeName", t.created_by AS "createdBy",
              creator.full_name AS "creatorName", t.completed_at AS "completedAt",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
       FROM accounting_tasks t
       LEFT JOIN app_users assignee ON assignee.id = t.assigned_to
       JOIN app_users creator ON creator.id = t.created_by
       WHERE t.accounting_entity_id = $1
         AND ($2::text IS NULL OR t.status = $2)
         AND ($3::text IS NULL OR t.category = $3)
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT 500`,
      [entityId, status, category],
    );
    return NextResponse.json({ tasks: result.rows });
  } catch (error) {
    console.error("Falha ao listar tarefas:", error);
    return NextResponse.json({ error: "Não foi possível carregar as tarefas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant", "finance_manager"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para criar tarefas." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const entityId = clean(body.entityId, 80);
    const title = clean(body.title, 180);
    const description = clean(body.description, 2000) || null;
    const category = clean(body.category, 30) || "other";
    const priority = clean(body.priority, 20) || "normal";
    const dueDate = clean(body.dueDate, 10) || null;
    const assignedTo = clean(body.assignedTo, 80) || null;
    if (!entityId || title.length < 2) return NextResponse.json({ error: "Indique a empresa e um título com pelo menos 2 caracteres." }, { status: 400 });
    if (!CATEGORIES.has(category) || !PRIORITIES.has(priority)) return NextResponse.json({ error: "Categoria ou prioridade inválida." }, { status: 400 });
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return NextResponse.json({ error: "A data limite deve estar no formato AAAA-MM-DD." }, { status: 400 });
    if (assignedTo) {
      const roleCheck = await db.query(
        `SELECT 1 FROM organisation_memberships om
         JOIN accounting_entities e ON e.organisation_id = om.organisation_id
         WHERE e.id = $1 AND om.user_id = $2
         UNION
         SELECT 1 FROM entity_memberships em
         WHERE em.accounting_entity_id = $1 AND em.user_id = $2 LIMIT 1`,
        [entityId, assignedTo],
      );
      if (!roleCheck.rowCount) return NextResponse.json({ error: "O responsável não pertence à organização ou empresa." }, { status: 400 });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const access = await client.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
      if (!access.rows[0]?.allowed) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
      }
      const result = await client.query(
        `INSERT INTO accounting_tasks (accounting_entity_id, title, description, category, priority, due_date, assigned_to, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
         RETURNING id, title, description, category, status, priority, due_date AS "dueDate",
                   assigned_to AS "assignedTo", created_by AS "createdBy", created_at AS "createdAt"`,
        [entityId, title, description, category, priority, dueDate, assignedTo, user.id],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         SELECT organisation_id, $1, $2, 'accounting_task.created', 'accounting_task', $3, $4::jsonb
         FROM accounting_entities WHERE id = $1`,
        [entityId, user.id, result.rows[0].id, JSON.stringify({ title, category, priority, dueDate, assignedTo })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ task: result.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Falha ao criar tarefa:", error);
    return NextResponse.json({ error: "Não foi possível criar a tarefa." }, { status: 500 });
  }
}
