import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant", "finance_manager"].includes(user.role)) {
    return NextResponse.json({ error: "Não tem permissão para encerrar o período." }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT c.id, c.accounting_entity_id, c.accounting_period_id, c.status AS "closeStatus",
                p.status AS "periodStatus", p.label AS "periodLabel"
         FROM accounting_period_closes c
         JOIN accounting_periods p ON p.id = c.accounting_period_id AND p.accounting_entity_id = c.accounting_entity_id
         WHERE c.id = $1 FOR UPDATE OF c, p`,
        [id],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Fecho mensal não encontrado." }, { status: 404 }); }
      const close = result.rows[0];
      const access = await client.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, close.accounting_entity_id]);
      if (!access.rows[0]?.allowed) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 }); }
      if (close.closeStatus === "closed" || close.periodStatus !== "open") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "O fecho ou o período contabilístico já está encerrado." }, { status: 409 });
      }
      const pending = await client.query(
        "SELECT count(*)::int AS count FROM accounting_period_close_items WHERE close_id = $1 AND is_required AND status <> 'completed'",
        [id],
      );
      if (pending.rows[0].count > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Existem itens obrigatórios por concluir.", blockers: { requiredItemsPending: pending.rows[0].count } }, { status: 409 });
      }
      const drafts = await client.query(
        "SELECT count(*)::int AS count FROM journal_entries WHERE accounting_entity_id = $1 AND period_id = $2 AND status = 'draft'",
        [close.accounting_entity_id, close.accounting_period_id],
      );
      if (drafts.rows[0].count > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Existem lançamentos em rascunho no período.", blockers: { draftEntries: drafts.rows[0].count } }, { status: 409 });
      }
      const totals = await client.query(
        `SELECT COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
                COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
         FROM journal_entries e
         JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
         WHERE e.accounting_entity_id = $1 AND e.period_id = $2 AND e.status IN ('posted', 'reversed')`,
        [close.accounting_entity_id, close.accounting_period_id],
      );
      const debit = Number(totals.rows[0].debit);
      const credit = Number(totals.rows[0].credit);
      if (Math.abs(debit - credit) > 0.005) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Os totais do período não estão equilibrados. Reveja o diário antes de encerrar.", blockers: { debit, credit, difference: Number((debit-credit).toFixed(2)) } }, { status: 409 });
      }
      await client.query("UPDATE accounting_period_closes SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1", [id, user.id]);
      await client.query("UPDATE accounting_periods SET status = 'closed' WHERE id = $1 AND accounting_entity_id = $2", [close.accounting_period_id, close.accounting_entity_id]);
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         SELECT organisation_id, $1, $2, 'accounting_period_close.finalized', 'accounting_period_close', $3, $4::jsonb
         FROM accounting_entities WHERE id = $1`,
        [close.accounting_entity_id, user.id, id, JSON.stringify({ periodId: close.accounting_period_id, periodLabel: close.periodLabel, debit, credit })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ success: true, periodLabel: close.periodLabel, totals: { debit, credit } });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error) {
    console.error("Falha ao encerrar período contabilístico:", error);
    return NextResponse.json({ error: "Não foi possível encerrar o período contabilístico." }, { status: 500 });
  }
}
