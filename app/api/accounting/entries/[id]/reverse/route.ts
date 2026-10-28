import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para estornar lançamentos." }, { status: 403 });
  }

  const { id } = await context.params;
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });

  let body: { reversalDate?: unknown } = {};
  try { body = await request.json(); } catch { /* Optional body is handled below. */ }
  const reversalDate = body.reversalDate;
  if (!isValidDate(reversalDate)) {
    return NextResponse.json({ error: "Indique uma data válida para o estorno, no formato AAAA-MM-DD." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const access = await client.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) {
      return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    }

    await client.query("BEGIN");
    const originalResult = await client.query(
      `SELECT id, accounting_entity_id, period_id, journal_id, entry_number, entry_date,
              description, source_reference, status
       FROM journal_entries
       WHERE id = $1 AND accounting_entity_id = $2
       FOR UPDATE`,
      [id, entityId],
    );
    if (!originalResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });
    }
    const original = originalResult.rows[0];
    if (original.status !== "posted") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: original.status === "reversed" ? "Este lançamento já foi estornado." : "Só é possível estornar lançamentos confirmados." }, { status: 409 });
    }

    const existing = await client.query(
      "SELECT id FROM journal_entries WHERE accounting_entity_id = $1 AND reverses_entry_id = $2",
      [entityId, id],
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Já existe um estorno para este lançamento." }, { status: 409 });
    }

    const period = await client.query(
      `SELECT id FROM accounting_periods
       WHERE accounting_entity_id = $1 AND status = 'open'
         AND starts_on <= $2::date AND ends_on >= $2::date
       FOR UPDATE`,
      [entityId, reversalDate],
    );
    if (!period.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A data do estorno não pertence a um período contabilístico aberto." }, { status: 400 });
    }

    const reversal = await client.query(
      `INSERT INTO journal_entries
         (accounting_entity_id, period_id, journal_id, entry_date, description, source_reference, created_by, reverses_entry_id)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
       RETURNING id`,
      [
        entityId, period.rows[0].id, original.journal_id, reversalDate,
        `Estorno do lançamento ${original.entry_number ?? id}: ${original.description}`.slice(0, 500),
        `ESTORNO:${original.entry_number ?? id}`, user.id, id,
      ],
    );
    const reversalId = reversal.rows[0].id;
    const lines = await client.query(
      `INSERT INTO journal_entry_lines
         (accounting_entity_id, entry_id, line_number, account_id, description, debit, credit)
       SELECT accounting_entity_id, $2, line_number, account_id,
              COALESCE(description, 'Estorno: ' || $3),
              credit, debit
       FROM journal_entry_lines
       WHERE accounting_entity_id = $1 AND entry_id = $4
       ORDER BY line_number
       RETURNING id`,
      [entityId, reversalId, original.description, id],
    );
    if (lines.rowCount < 2) throw new Error("O lançamento original não contém linhas suficientes para estorno.");

    const posted = await client.query("SELECT * FROM post_journal_entry($1, $2)", [reversalId, user.id]);
    await client.query(
      "UPDATE journal_entries SET status = 'reversed', updated_at = now() WHERE id = $1 AND accounting_entity_id = $2",
      [id, entityId],
    );
    await client.query(
      `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
       SELECT organisation_id, $1, $2, 'journal_entry.reversed', 'journal_entry', $3, $4::jsonb
       FROM accounting_entities WHERE id = $1`,
      [entityId, user.id, id, JSON.stringify({ reversalEntryId: reversalId, reversalEntryNumber: posted.rows[0].assigned_number, reversalDate })],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      entry: { id, status: "reversed" },
      reversal: { id: reversalId, status: "posted", entryNumber: posted.rows[0].assigned_number, entryDate: reversalDate },
    }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Falha ao estornar lançamento:", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("single_reversal") || message.includes("duplicate key")) {
      return NextResponse.json({ error: "Já existe um estorno para este lançamento." }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível concluir o estorno. Verifique o período, as permissões e as linhas do lançamento." }, { status: 400 });
  } finally {
    client.release();
  }
}
