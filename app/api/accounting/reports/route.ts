import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
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
  if (!["trial-balance", "ledger", "journal", "balance-sheet", "income-statement"].includes(report)) return NextResponse.json({ error: "Tipo de relatório inválido." }, { status: 400 });
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    return NextResponse.json({ error: "O intervalo de datas é inválido." }, { status: 400 });
  }
  if (report === "ledger" && !accountId) return NextResponse.json({ error: "Seleccione uma conta para consultar o razão." }, { status: 400 });

  try {
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });

    if (report === "journal") {
      const result = await db.query(
        `SELECT e.id AS "entryId", e.entry_number AS "entryNumber", e.entry_date AS "entryDate",
                e.description AS "entryDescription", e.source_reference AS "sourceReference",
                e.status, e.reverses_entry_id AS "reversesEntryId",
                j.code AS "journalCode", j.name AS "journalName",
                l.line_number AS "lineNumber", l.description AS "lineDescription",
                a.code AS "accountCode", a.name AS "accountName",
                l.debit::numeric(20,2) AS debit, l.credit::numeric(20,2) AS credit
         FROM journal_entries e
         JOIN accounting_journals j ON j.id = e.journal_id AND j.accounting_entity_id = e.accounting_entity_id
         JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
         JOIN chart_of_accounts a ON a.id = l.account_id AND a.accounting_entity_id = l.accounting_entity_id
         WHERE e.accounting_entity_id = $1 AND e.status IN ('posted', 'reversed')
           AND ($2::date IS NULL OR e.entry_date >= $2::date)
           AND ($3::date IS NULL OR e.entry_date <= $3::date)
         ORDER BY e.entry_date, e.entry_number, l.line_number`,
        [entityId, from, to],
      );
      const lines = result.rows.map(row => ({ ...row, debit: Number(row.debit), credit: Number(row.credit) }));
      return NextResponse.json({
        report, from, to, journalLines: lines,
        totals: {
          debit: Number(lines.reduce((sum, row) => sum + row.debit, 0).toFixed(2)),
          credit: Number(lines.reduce((sum, row) => sum + row.credit, 0).toFixed(2)),
        },
      });
    }

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
         WHERE l.accounting_entity_id = $1 AND l.account_id = $2 AND e.status IN ('posted', 'reversed')
           AND ($3::date IS NULL OR e.entry_date >= $3::date)
           AND ($4::date IS NULL OR e.entry_date <= $4::date)
         ORDER BY e.entry_date, e.entry_number, l.line_number`,
        [entityId, accountId, from, to],
      );
      let running = 0;
      if (from) {
        const opening = await db.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0)::numeric(20,2) AS balance
           FROM journal_entry_lines l
           JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
           WHERE l.accounting_entity_id = $1 AND l.account_id = $2
             AND e.status IN ('posted', 'reversed') AND e.entry_date < $3::date`,
          [entityId, accountId, from],
        );
        running = Number(opening.rows[0]?.balance ?? 0);
      }
      const openingBalance = Number(running.toFixed(2));
      const lines = result.rows.map((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        running += debit - credit;
        return { ...line, runningBalance: Number(running.toFixed(2)) };
      });
      return NextResponse.json({ report, account: account.rows[0], from, to, openingBalance, lines, totals: {
        debit: Number(lines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(2)),
        credit: Number(lines.reduce((sum, line) => sum + Number(line.credit), 0).toFixed(2)),
        closingBalance: Number(running.toFixed(2)),
      } });
    }

    if (report === "balance-sheet") {
      const result = await db.query(
        `SELECT a.id AS "accountId", a.code, a.name, a.account_type AS "accountType",
                COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
                COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
         FROM chart_of_accounts a
         LEFT JOIN journal_entries e ON e.accounting_entity_id = a.accounting_entity_id
           AND e.status IN ('posted', 'reversed') AND ($2::date IS NULL OR e.entry_date <= $2::date)
         LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
           AND l.account_id = a.id
         WHERE a.accounting_entity_id = $1 AND a.account_type IN ('asset', 'liability', 'equity')
         GROUP BY a.id, a.code, a.name, a.account_type
         ORDER BY a.code`,
        [entityId, to],
      );
      const accounts = result.rows.map((row) => {
        const debit = Number(row.debit);
        const credit = Number(row.credit);
        const balance = row.accountType === "asset" ? debit - credit : credit - debit;
        return { ...row, debit, credit, balance: Number(balance.toFixed(2)) };
      }).filter((row) => Math.abs(row.balance) > 0.005);
      const earnings = await db.query(
        `SELECT COALESCE(SUM(CASE WHEN a.account_type = 'income' THEN l.credit - l.debit
                                  WHEN a.account_type = 'expense' THEN l.debit - l.credit ELSE 0 END), 0)::numeric(20,2) AS result
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.accounting_entity_id = l.accounting_entity_id
         JOIN chart_of_accounts a ON a.id = l.account_id AND a.accounting_entity_id = l.accounting_entity_id
         WHERE l.accounting_entity_id = $1 AND e.status IN ('posted', 'reversed')
           AND a.account_type IN ('income', 'expense') AND ($2::date IS NULL OR e.entry_date <= $2::date)`,
        [entityId, to],
      );
      const assets = Number(accounts.filter(a => a.accountType === "asset").reduce((sum, a) => sum + a.balance, 0).toFixed(2));
      const liabilities = Number(accounts.filter(a => a.accountType === "liability").reduce((sum, a) => sum + a.balance, 0).toFixed(2));
      const equity = Number(accounts.filter(a => a.accountType === "equity").reduce((sum, a) => sum + a.balance, 0).toFixed(2));
      const accumulatedResult = Number(earnings.rows[0]?.result ?? 0);
      return NextResponse.json({
        report, asOf: to, accounts, accumulatedResult,
        totals: { assets, liabilities, equity, accumulatedResult,
          liabilitiesAndEquity: Number((liabilities + equity + accumulatedResult).toFixed(2)),
          difference: Number((assets - liabilities - equity - accumulatedResult).toFixed(2)) },
      });
    }

    if (report === "income-statement") {
      const result = await db.query(
        `SELECT a.id AS "accountId", a.code, a.name, a.account_type AS "accountType",
                COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
                COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
         FROM chart_of_accounts a
         LEFT JOIN journal_entries e ON e.accounting_entity_id = a.accounting_entity_id
           AND e.status IN ('posted', 'reversed')
           AND ($2::date IS NULL OR e.entry_date >= $2::date)
           AND ($3::date IS NULL OR e.entry_date <= $3::date)
         LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
           AND l.account_id = a.id
         WHERE a.accounting_entity_id = $1 AND a.account_type IN ('income', 'expense')
         GROUP BY a.id, a.code, a.name, a.account_type
         ORDER BY a.code`,
        [entityId, from, to],
      );
      const accounts = result.rows.map((row) => {
        const debit = Number(row.debit);
        const credit = Number(row.credit);
        const amount = row.accountType === "income" ? credit - debit : debit - credit;
        return { ...row, debit, credit, amount: Number(amount.toFixed(2)) };
      }).filter((row) => Math.abs(row.amount) > 0.005);
      const income = Number(accounts.filter(a => a.accountType === "income").reduce((sum, a) => sum + a.amount, 0).toFixed(2));
      const expenses = Number(accounts.filter(a => a.accountType === "expense").reduce((sum, a) => sum + a.amount, 0).toFixed(2));
      return NextResponse.json({ report, from, to, accounts, totals: { income, expenses, netResult: Number((income-expenses).toFixed(2)) } });
    }

    const result = await db.query(
      `SELECT a.id AS "accountId", a.code, a.name, a.account_type AS "accountType",
              COALESCE(SUM(l.debit), 0)::numeric(20,2) AS debit,
              COALESCE(SUM(l.credit), 0)::numeric(20,2) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entries e ON e.accounting_entity_id = a.accounting_entity_id
         AND e.status IN ('posted', 'reversed')
         AND ($2::date IS NULL OR e.entry_date >= $2::date)
         AND ($3::date IS NULL OR e.entry_date <= $3::date)
       LEFT JOIN journal_entry_lines l ON l.entry_id = e.id AND l.accounting_entity_id = e.accounting_entity_id
         AND l.account_id = a.id
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
