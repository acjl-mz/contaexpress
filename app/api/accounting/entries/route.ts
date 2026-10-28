import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type InputLine = { accountId?: unknown; description?: unknown; debit?: unknown; credit?: unknown };

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const result = await db.query(
      `SELECT e.id, e.entry_number AS "entryNumber", e.entry_date AS "entryDate",
              e.description, e.status, e.source_reference AS "sourceReference",
              j.code AS "journalCode", j.name AS "journalName", p.label AS "periodLabel",
              COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
              COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
       FROM journal_entries e
       JOIN accounting_journals j ON j.id = e.journal_id AND j.accounting_entity_id = e.accounting_entity_id
       JOIN accounting_periods p ON p.id = e.period_id AND p.accounting_entity_id = e.accounting_entity_id
       LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
       WHERE e.accounting_entity_id = $1
       GROUP BY e.id, j.code, j.name, p.label
       ORDER BY e.entry_date DESC, e.created_at DESC
       LIMIT 200`,
      [entityId],
    );
    return NextResponse.json({ entries: result.rows });
  } catch (error) {
    console.error("Falha ao listar lançamentos:", error);
    return NextResponse.json({ error: "Não foi possível carregar os lançamentos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant"].includes(user.role)) return NextResponse.json({ error: "Não tem permissão para criar lançamentos." }, { status: 403 });
  const client = await db.connect();
  try {
    const body = await request.json();
    const entityId = typeof body.entityId === "string" ? body.entityId : "";
    const periodId = typeof body.periodId === "string" ? body.periodId : "";
    const journalId = typeof body.journalId === "string" ? body.journalId : "";
    const entryDate = typeof body.entryDate === "string" ? body.entryDate : "";
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
    const sourceReference = typeof body.sourceReference === "string" ? body.sourceReference.trim().slice(0, 120) || null : null;
    const lines = Array.isArray(body.lines) ? body.lines as InputLine[] : [];
    if (!entityId || !periodId || !journalId || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || !description || lines.length < 2 || lines.length > 100) {
      return NextResponse.json({ error: "Preencha empresa, período, diário, data, descrição e pelo menos duas linhas." }, { status: 400 });
    }
    const access = await client.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    await client.query("BEGIN");
    const period = await client.query(
      "SELECT id, starts_on, ends_on, status FROM accounting_periods WHERE id = $1 AND accounting_entity_id = $2",
      [periodId, entityId],
    );
    if (!period.rowCount || period.rows[0].status !== "open" || entryDate < String(period.rows[0].starts_on).slice(0, 10) || entryDate > String(period.rows[0].ends_on).slice(0, 10)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A data não pertence a um período contabilístico aberto." }, { status: 400 });
    }
    const journal = await client.query("SELECT id FROM accounting_journals WHERE id = $1 AND accounting_entity_id = $2 AND is_active = TRUE", [journalId, entityId]);
    if (!journal.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "O diário não existe ou está inactivo." }, { status: 400 });
    }
    const entry = await client.query(
      `INSERT INTO journal_entries (accounting_entity_id, period_id, journal_id, entry_date, description, source_reference, created_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7) RETURNING id`,
      [entityId, periodId, journalId, entryDate, description, sourceReference, user.id],
    );
    let lineNumber = 0;
    for (const line of lines) {
      const accountId = typeof line.accountId === "string" ? line.accountId : "";
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const lineDescription = typeof line.description === "string" ? line.description.trim().slice(0, 250) : null;
      if (!accountId || !Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0) || Math.max(debit, credit) > 999999999999999999) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Uma das linhas contém conta ou valores inválidos." }, { status: 400 });
      }
      const account = await client.query("SELECT id FROM chart_of_accounts WHERE id = $1 AND accounting_entity_id = $2 AND is_active = TRUE AND is_postable = TRUE", [accountId, entityId]);
      if (!account.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Uma das contas não pertence à empresa ou não permite movimentos." }, { status: 400 });
      }
      lineNumber++;
      await client.query(
        `INSERT INTO journal_entry_lines (accounting_entity_id, entry_id, line_number, account_id, description, debit, credit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [entityId, entry.rows[0].id, lineNumber, accountId, lineDescription, debit.toFixed(2), credit.toFixed(2)],
      );
    }
    await client.query(
      `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
       SELECT organisation_id, $1, $2, 'journal_entry.draft_created', 'journal_entry', $3, $4::jsonb
       FROM accounting_entities WHERE id = $1`,
      [entityId, user.id, entry.rows[0].id, JSON.stringify({ entryDate, lineCount: lines.length })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ entry: { id: entry.rows[0].id, status: "draft" } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha ao criar lançamento:", error);
    return NextResponse.json({ error: "Não foi possível guardar o lançamento contabilístico." }, { status: 500 });
  } finally {
    client.release();
  }
}
