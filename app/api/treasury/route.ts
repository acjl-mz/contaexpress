import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WRITE_ROLES = new Set(["superadmin", "client_manager", "accountant", "finance_manager"]);
const TYPES = new Set(["cash", "bank", "mobile_money"]);
const CATEGORIES = new Set(["customer_receipt", "supplier_payment", "salary", "tax", "fee", "transfer", "other"]);
const clean = (v: unknown, max = 240) => typeof v === "string" ? v.trim().slice(0, max) : "";
const allowed = async (userId: string, entityId: string) => {
  const r = await db.query("SELECT user_can_access_entity($1, $2) AS allowed", [userId, entityId]);
  return Boolean(r.rows[0]?.allowed);
};

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId") ?? "";
  if (!entityId) return NextResponse.json({ error: "Seleccione uma empresa." }, { status: 400 });
  try {
    if (!await allowed(user.id, entityId)) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const [accounts, transactions, totals] = await Promise.all([
      db.query(`SELECT id, name, account_type AS "accountType", institution, account_reference AS "accountReference",
        currency, opening_balance AS "openingBalance", is_active AS "isActive"
        FROM treasury_accounts WHERE accounting_entity_id=$1 ORDER BY is_active DESC, name LIMIT 200`, [entityId]),
      db.query(`SELECT t.id, t.treasury_account_id AS "accountId", a.name AS "accountName",
        t.transaction_date AS "transactionDate", t.direction, t.category, t.description, t.amount,
        t.reference, t.counterparty, t.status, t.journal_entry_id AS "journalEntryId", t.created_at AS "createdAt"
        FROM treasury_transactions t JOIN treasury_accounts a ON a.id=t.treasury_account_id AND a.accounting_entity_id=t.accounting_entity_id
        WHERE t.accounting_entity_id=$1 AND t.status <> 'voided'
        ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 500`, [entityId]),
      db.query(`SELECT COALESCE(SUM(CASE WHEN direction='inflow' AND status <> 'voided' THEN amount
        WHEN direction='outflow' AND status <> 'voided' THEN -amount ELSE 0 END),0)::numeric(20,2) AS "netMovement"
        FROM treasury_transactions WHERE accounting_entity_id=$1`, [entityId]),
    ]);
    return NextResponse.json({ accounts: accounts.rows, transactions: transactions.rows, netMovement: totals.rows[0]?.netMovement ?? "0.00" });
  } catch (error) {
    console.error("Falha ao consultar tesouraria:", error);
    return NextResponse.json({ error: "Não foi possível carregar a tesouraria." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!WRITE_ROLES.has(user.role)) return NextResponse.json({ error: "Não tem permissão para registar movimentos de tesouraria." }, { status: 403 });
  try {
    const body = await request.json();
    const entityId = clean(body.entityId, 80);
    if (!entityId || !await allowed(user.id, entityId)) return NextResponse.json({ error: "Empresa inválida ou sem acesso." }, { status: entityId ? 403 : 400 });
    const kind = clean(body.kind, 20);
    if (kind === "account") {
      const name = clean(body.name, 120);
      const accountType = clean(body.accountType, 30);
      const currency = clean(body.currency, 3).toUpperCase() || "MZN";
      const openingBalance = Number(body.openingBalance ?? 0);
      const entityCurrency = await db.query("SELECT functional_currency FROM accounting_entities WHERE id=$1", [entityId]);
      if (!entityCurrency.rowCount || currency !== entityCurrency.rows[0].functional_currency) return NextResponse.json({ error: "A moeda da conta deve corresponder à moeda funcional da empresa." }, { status: 400 });
      if (name.length < 2 || !TYPES.has(accountType) || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(openingBalance) || Math.abs(openingBalance) > 1_000_000_000_000) {
        return NextResponse.json({ error: "Verifique o nome, tipo, moeda e saldo inicial." }, { status: 400 });
      }
      const result = await db.query(`INSERT INTO treasury_accounts
        (accounting_entity_id,name,account_type,institution,account_reference,currency,opening_balance,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id,name,account_type AS "accountType",institution,account_reference AS "accountReference",currency,opening_balance AS "openingBalance",is_active AS "isActive"`,
      [entityId,name,accountType,clean(body.institution,120)||null,clean(body.accountReference,120)||null,currency,openingBalance,user.id]);
      await db.query(`INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
        SELECT organisation_id,$1,$2,'treasury.account.created','treasury_account',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
      [entityId,user.id,result.rows[0].id,JSON.stringify({name,accountType,currency})]);
      return NextResponse.json({ account: result.rows[0] }, { status: 201 });
    }
    const accountId = clean(body.accountId, 80);
    const date = clean(body.transactionDate, 10);
    const direction = clean(body.direction, 20);
    const category = clean(body.category, 40);
    const description = clean(body.description, 240);
    const amount = Number(body.amount);
    if (!accountId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !["inflow","outflow"].includes(direction) || !CATEGORIES.has(category) || description.length < 2 || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
      return NextResponse.json({ error: "Preencha correctamente a data, conta, tipo de movimento, categoria, descrição e valor positivo." }, { status: 400 });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query("SELECT id FROM treasury_accounts WHERE id=$1 AND accounting_entity_id=$2 AND is_active FOR UPDATE", [accountId,entityId]);
      if (!account.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "A conta de tesouraria não existe ou está inactiva." }, { status: 400 }); }
      const result = await client.query(`INSERT INTO treasury_transactions
        (accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,reference,counterparty,created_by)
        VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,transaction_date AS "transactionDate",direction,category,description,amount,reference,counterparty,status`,
      [entityId,accountId,date,direction,category,description,amount,clean(body.reference,120)||null,clean(body.counterparty,180)||null,user.id]);
      await client.query(`INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
        SELECT organisation_id,$1,$2,'treasury.transaction.created','treasury_transaction',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
      [entityId,user.id,result.rows[0].id,JSON.stringify({accountId,direction,category,amount,date})]);
      await client.query("COMMIT");
      return NextResponse.json({ transaction: result.rows[0] }, { status: 201 });
    } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
    finally { client.release(); }
  } catch (error) {
    console.error("Falha ao registar tesouraria:", error);
    return NextResponse.json({ error: "Não foi possível registar o movimento." }, { status: 500 });
  }
}

export async function PATCH() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  return NextResponse.json({ error: "A reconciliação directa foi desactivada. Importe o extracto bancário e confirme a correspondência em Tesouraria > Reconciliação assistida." }, { status: 410 });
}
