import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const defaultAccounts = [
  ["1", "Meios financeiros e activos", "asset", false],
  ["11", "Caixa", "asset", false],
  ["12", "Depósitos à ordem", "asset", false],
  ["2", "Inventários e terceiros", "asset", false],
  ["21", "Clientes", "asset", true],
  ["22", "Fornecedores", "liability", true],
  ["3", "Capital próprio", "equity", false],
  ["4", "Investimentos e imobilizado", "asset", false],
  ["5", "Capital, reservas e resultados", "equity", false],
  ["6", "Gastos e perdas", "expense", false],
  ["61", "Custo das mercadorias vendidas", "expense", true],
  ["62", "Fornecimentos e serviços de terceiros", "expense", true],
  ["63", "Gastos com o pessoal", "expense", true],
  ["64", "Impostos", "expense", true],
  ["7", "Rendimentos e ganhos", "income", false],
  ["71", "Vendas e prestações de serviços", "income", true],
  ["72", "Outros rendimentos", "income", true],
  ["8", "Resultados", "equity", false],
] as const;

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!["superadmin", "client_manager", "accountant"].includes(user.role)) return NextResponse.json({ error: "Não tem permissão para configurar a contabilidade." }, { status: 403 });
  try {
    const body = await request.json();
    const entityId = typeof body.entityId === "string" ? body.entityId : "";
    const year = Number(body.year ?? new Date().getFullYear());
    if (!entityId || !Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Indique a empresa e um exercício válido." }, { status: 400 });
    const access = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [user.id, entityId]);
    if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });

    const client = await db.connect();
    let resultData;
    try {
      await client.query("BEGIN");
      const fiscal = await client.query(
        `INSERT INTO fiscal_years (accounting_entity_id, label, starts_on, ends_on)
         VALUES ($1, $2, $3::date, $4::date)
         ON CONFLICT (accounting_entity_id, label) DO UPDATE SET label = EXCLUDED.label
         RETURNING id, label`,
        [entityId, String(year), `${year}-01-01`, `${year}-12-31`],
      );
      const fiscalId = fiscal.rows[0].id;
      for (let month = 1; month <= 12; month++) {
        const start = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
        const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
        const label = `${year}-${String(month).padStart(2, "0")}`;
        await client.query(
          `INSERT INTO accounting_periods (accounting_entity_id, fiscal_year_id, label, starts_on, ends_on)
           VALUES ($1, $2, $3, $4::date, $5::date)
           ON CONFLICT (fiscal_year_id, label) DO NOTHING`,
          [entityId, fiscalId, label, start, end],
        );
      }
      await client.query(
        `INSERT INTO accounting_journals (accounting_entity_id, code, name)
         VALUES ($1, 'GER', 'Diário geral')
         ON CONFLICT (accounting_entity_id, code) DO NOTHING`,
        [entityId],
      );
      const accountIds = new Map<string, string>();
      for (const [code, name, type, postable] of defaultAccounts) {
        const row = await client.query(
          `INSERT INTO chart_of_accounts (accounting_entity_id, code, name, account_type, is_postable)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (accounting_entity_id, code) DO UPDATE SET code = EXCLUDED.code
           RETURNING id, code`,
          [entityId, code, name, type, postable],
        );
        accountIds.set(code, row.rows[0].id);
      }
      const parents: Record<string, string> = { "11": "1", "12": "1", "21": "2", "22": "2", "61": "6", "62": "6", "63": "6", "64": "6", "71": "7", "72": "7" };
      for (const [child, parent] of Object.entries(parents)) {
        await client.query(
          "UPDATE chart_of_accounts SET parent_account_id = $1 WHERE id = $2 AND accounting_entity_id = $3",
          [accountIds.get(parent), accountIds.get(child), entityId],
        );
      }
      await client.query(
        `INSERT INTO audit_events (organisation_id, accounting_entity_id, actor_user_id, event_type, target_type, target_id, details)
         SELECT organisation_id, $1, $2, 'accounting.initialised', 'accounting_entity', $1, $3::jsonb
         FROM accounting_entities WHERE id = $1`,
        [entityId, user.id, JSON.stringify({ fiscalYear: year, accounts: defaultAccounts.length, periods: 12 })],
      );
      const periods = await client.query("SELECT id, label, starts_on AS \"startsOn\", ends_on AS \"endsOn\", status FROM accounting_periods WHERE fiscal_year_id = $1 ORDER BY starts_on", [fiscalId]);
      resultData = { fiscalYear: fiscal.rows[0], periods: periods.rows, accountsCreatedOrConfirmed: accountIds.size };
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json(resultData, { status: 201 });
  } catch (error) {
    console.error("Falha ao inicializar contabilidade:", error);
    return NextResponse.json({ error: "Não foi possível inicializar a contabilidade desta empresa." }, { status: 500 });
  }
}
