import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));
}

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const entityId = params.get("entityId");
  const report = params.get("report") ?? "trial-balance";
  const from = params.get("from");
  const to = params.get("to");
  const accountId = params.get("accountId");
  if (!entityId) return NextResponse.json({ error: "Indique a empresa." }, { status: 400 });
  if (!["trial-balance", "ledger"].includes(report)) return NextResponse.json({ error: "Tipo de relatório inválido." }, { status: 400 });
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    return NextResponse.json({ error: "O intervalo de datas é inválido." }, { status: 400 });
  }
  if (report === "ledger" && !accountId) return NextResponse.json({ error: "Seleccione uma conta para consultar o razão." }, { status: 400 });

  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });

    if (report === "ledger") {
      const account = await db.query(
        `SELECT id, code, name, account_type AS "accountType"
         FROM chart_of_accounts WHERE id = $1 AND accounting_entity_id = $2`,
        [accountId, entityId],
      );
      if (!account.rowCount) return NextResponse.json({ error: "A conta não pertence à empresa seleccionada." }, { status: 404 });
      const result = await db.query(
        `SELECT e.id AS "entryId", e.entry_number AS "entryNumber", e.entry_date AS "entryDate",
                e.description AS "entryDescription", e.source_reference AS "sourceReference",
                j.code AS "journalCode", l.line_number AS "lineNumber",
                COALESCE(l.description, e.description) AS description,
                l.debit::numeric(20,2) AS debit, l.credit::numeric(20,2) AS credit
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
         JOIN accounting_journals j ON j.id = e.journal_id AND j.accounting_entity_id = e.accounting_entity_id
         WHERE l.accounting_entity_id = $1 AND l.account_id = $2 AND e.status = 'posted'
           AND ($3::date IS NULL OR e.entry_date >= $3::date)
           AND ($4::date IS NULL OR e.entry_date <= $4::date)
         ORDER BY e.entry_date, e.entry_number, l.line_number`,
        [entityId, accountId, from, to],
      );
      let running = 0;
      const lines = result.rows.map((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        running += debit - credit;
        return { ...line, runningBalance: Number(running.toFixed(2)) };
      });
      return NextResponse.json({ report, account: account.rows[0], from, to, lines, totals: {
        debit: Number(lines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(2)),
        credit: Number(lines.reduce((sum, line) => sum + Number(line.credit), 0).toFixed(2)),
        closingBalance: Number(running.toFixed(2)),
      } });
    }

    const result = await db.query(
      `SELECT a.id AS "accountId", a.code, a.name, a.account_type AS "accountType",
              COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
              COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines l ON l.accounting_entity_id = a.accounting_entity_id AND l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
         AND e.status = 'posted'
         AND ($2::date IS NULL OR e.entry_date >= $2::date)
         AND ($3::date IS NULL OR e.entry_date <= $3::date)
       WHERE a.accounting_entity_id = $1
       GROUP BY a.id, a.code, a.name, a.account_type
       ORDER BY a.code`,
      [entityId, from, to],
    );
    const accounts = result.rows.map((row) => ({
      ...row,
      debit: Number(row.debit),
      credit: Number(row.credit),
      debitBalance: Number(Math.max(Number(row.debit) - Number(row.credit), 0).toFixed(2)),
      creditBalance: Number(Math.max(Number(row.credit) - Number(row.debit), 0).toFixed(2)),
    })).filter((row) => row.debit !== 0 || row.credit !== 0);
    return NextResponse.json({
      report, from, to, accounts,
      totals: {
        debit: Number(accounts.reduce((sum, row) => sum + row.debit, 0).toFixed(2)),
        credit: Number(accounts.reduce((sum, row) => sum + row.credit, 0).toFixed(2)),
        debitBalance: Number(accounts.reduce((sum, row) => sum + row.debitBalance, 0).toFixed(2)),
        creditBalance: Number(accounts.reduce((sum, row) => sum + row.creditBalance, 0).toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Falha ao gerar relatório contabilístico:", error);
    return NextResponse.json({ error: "Não foi possível gerar o relatório contabilístico." }, { status: 500 });
  }
}
