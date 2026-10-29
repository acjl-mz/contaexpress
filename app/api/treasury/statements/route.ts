import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WRITE_ROLES = new Set(["superadmin", "client_manager", "accountant", "finance_manager"]);
const clean = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const allowed = async (userId: string, entityId: string) => {
  const result = await db.query("SELECT user_can_access_entity($1,$2) AS allowed", [userId, entityId]);
  return Boolean(result.rows[0]?.allowed);
};

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  const entityId = request.nextUrl.searchParams.get("entityId") ?? "";
  if (!entityId) return NextResponse.json({ error: "Seleccione uma empresa." }, { status: 400 });
  try {
    if (!await allowed(user.id, entityId)) return NextResponse.json({ error: "Não tem acesso a esta empresa." }, { status: 403 });
    const accounts = await db.query("SELECT id,name,account_type AS \"accountType\",currency FROM treasury_accounts WHERE accounting_entity_id=$1 AND is_active AND account_type='bank' ORDER BY name", [entityId]);
    const result = await db.query(`
      SELECT l.id, l.import_id AS "importId", i.file_name AS "fileName",
        l.line_number AS "lineNumber", l.treasury_account_id AS "accountId", a.name AS "accountName",
        l.line_date AS "transactionDate", l.description, l.direction, l.amount, l.reference,
        l.status, l.treasury_transaction_id AS "matchedTransactionId",
        l.matched_at AS "matchedAt", l.created_at AS "createdAt",
        t.transaction_date AS "matchedDate", t.description AS "matchedDescription",
        t.amount AS "matchedAmount",
        COALESCE(candidates.matches, '[]'::json) AS suggestions
      FROM bank_statement_lines l
      JOIN bank_statement_imports i ON i.id=l.import_id AND i.accounting_entity_id=l.accounting_entity_id
      JOIN treasury_accounts a ON a.id=l.treasury_account_id AND a.accounting_entity_id=l.accounting_entity_id
      LEFT JOIN treasury_transactions t ON t.id=l.treasury_transaction_id AND t.accounting_entity_id=l.accounting_entity_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'id',x.id,'transactionDate',x.transaction_date,'description',x.description,
          'amount',x.amount,'direction',x.direction,'reference',x.reference
        ) ORDER BY abs(x.transaction_date-l.line_date), x.created_at DESC) AS matches
        FROM (
          SELECT tx.id,tx.transaction_date,tx.description,tx.amount,tx.direction,tx.reference,tx.created_at
          FROM treasury_transactions tx
          WHERE tx.accounting_entity_id=l.accounting_entity_id
            AND tx.treasury_account_id=l.treasury_account_id
            AND tx.status='recorded' AND tx.direction=l.direction AND tx.amount=l.amount
            AND abs(tx.transaction_date-l.line_date)<=3
            AND (l.reference IS NULL OR tx.reference IS NULL OR tx.reference=l.reference)
          ORDER BY (tx.reference=l.reference) DESC NULLS LAST, abs(tx.transaction_date-l.line_date)
          LIMIT 5
        ) x
      ) candidates ON TRUE
      WHERE l.accounting_entity_id=$1
      ORDER BY CASE l.status WHEN 'unmatched' THEN 0 WHEN 'matched' THEN 1 ELSE 2 END,
        l.line_date DESC, l.created_at DESC LIMIT 1000
    `, [entityId]);
    const imports = await db.query(`
      SELECT i.id, i.file_name AS "fileName", i.treasury_account_id AS "accountId",
        a.name AS "accountName", i.row_count AS "lineCount", i.created_at AS "importedAt",
        COUNT(l.id)::int AS "totalLines", COUNT(l.id) FILTER (WHERE l.status='matched')::int AS "matchedLines"
      FROM bank_statement_imports i
      JOIN treasury_accounts a ON a.id=i.treasury_account_id AND a.accounting_entity_id=i.accounting_entity_id
      LEFT JOIN bank_statement_lines l ON l.import_id=i.id AND l.accounting_entity_id=i.accounting_entity_id AND l.status='matched'
      WHERE i.accounting_entity_id=$1
      GROUP BY i.id,a.name ORDER BY i.created_at DESC LIMIT 100
    `, [entityId]);
    return NextResponse.json({ accounts: accounts.rows, lines: result.rows, imports: imports.rows });
  } catch (error) {
    console.error("Falha ao consultar extractos bancários:", error);
    return NextResponse.json({ error: "Não foi possível consultar os extractos bancários." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Inicie sessão para continuar." }, { status: 401 });
  if (!WRITE_ROLES.has(user.role)) return NextResponse.json({ error: "Não tem permissão para importar extractos ou confirmar correspondências." }, { status: 403 });
  try {
    const body = await request.json();
    const entityId = clean(body.entityId, 80);
    const action = clean(body.action, 30);
    if (!entityId || !await allowed(user.id, entityId)) return NextResponse.json({ error: "Empresa inválida ou sem acesso." }, { status: entityId ? 403 : 400 });

    if (action === "match") {
      const lineId = clean(body.lineId, 80);
      const transactionId = clean(body.transactionId, 80);
      if (!lineId || !transactionId) return NextResponse.json({ error: "Seleccione a linha do extracto e o movimento interno." }, { status: 400 });
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const line = await client.query(`
          SELECT id,treasury_account_id AS "accountId",line_date AS "lineDate",direction,amount,reference,status
          FROM bank_statement_lines WHERE id=$1 AND accounting_entity_id=$2 FOR UPDATE
        `, [lineId, entityId]);
        if (!line.rowCount || line.rows[0].status !== "unmatched") {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "A linha não existe ou já foi tratada." }, { status: 409 });
        }
        const transaction = await client.query(`
          SELECT id,transaction_date AS "transactionDate",direction,amount,reference,status
          FROM treasury_transactions WHERE id=$1 AND accounting_entity_id=$2 AND treasury_account_id=$3 FOR UPDATE
        `, [transactionId, entityId, line.rows[0].accountId]);
        if (!transaction.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "O movimento não pertence à conta seleccionada." }, { status: 400 });
        }
        const l = line.rows[0], t = transaction.rows[0];
        const dateDiff = Math.abs(new Date(l.lineDate).getTime() - new Date(t.transactionDate).getTime()) / 86400000;
        if (t.status !== "recorded" || t.direction !== l.direction || Number(t.amount) !== Number(l.amount) || dateDiff > 3 ||
            (l.reference && t.reference && l.reference !== t.reference)) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Os valores, o sentido, a referência ou as datas não correspondem às regras de reconciliação." }, { status: 422 });
        }
        const duplicate = await client.query("SELECT id FROM bank_statement_lines WHERE accounting_entity_id=$1 AND treasury_transaction_id=$2", [entityId, transactionId]);
        if (duplicate.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Este movimento já está associado a outra linha de extracto." }, { status: 409 });
        }
        await client.query(`UPDATE bank_statement_lines SET status='matched',treasury_transaction_id=$1,matched_by=$2,matched_at=now()
          WHERE id=$3 AND accounting_entity_id=$4`, [transactionId, user.id, lineId, entityId]);
        await client.query(`UPDATE treasury_transactions SET status='reconciled',updated_at=now()
          WHERE id=$1 AND accounting_entity_id=$2 AND status='recorded'`, [transactionId, entityId]);
        await client.query(`
          INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
          SELECT organisation_id,$1,$2,'treasury.statement.line.matched','bank_statement_line',$3,$4::jsonb
          FROM accounting_entities WHERE id=$1
        `, [entityId,user.id,lineId,JSON.stringify({ transactionId, lineId })]);
        await client.query("COMMIT");
        return NextResponse.json({ matched: true, lineId, transactionId });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    if (action !== "import") return NextResponse.json({ error: "Acção inválida." }, { status: 400 });
    const accountId = clean(body.accountId, 80);
    const fileName = clean(body.fileName, 180) || "extracto.csv";
    const rows = body.rows;
    if (!accountId || !Array.isArray(rows) || rows.length < 1 || rows.length > 1000) {
      return NextResponse.json({ error: "Seleccione uma conta e importe entre 1 e 1.000 linhas." }, { status: 400 });
    }
    const account = await db.query("SELECT id FROM treasury_accounts WHERE id=$1 AND accounting_entity_id=$2 AND account_type='bank' AND is_active", [accountId,entityId]);
    if (!account.rowCount) return NextResponse.json({ error: "Seleccione uma conta bancária activa da empresa." }, { status: 400 });
    const parsed = rows.map((row: unknown) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const date = clean(item.date,10);
      const description = clean(item.description,240);
      const reference = clean(item.reference,120) || null;
      const amount = Number(item.amount);
      const direction = clean(item.direction,10) || (amount < 0 ? "outflow" : "inflow");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || description.length < 1 ||
          !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000_000_000 ||
          !["inflow","outflow"].includes(direction)) throw new Error("Cada linha precisa de data ISO, descrição, valor diferente de zero e sentido válido.");
      return { date, description, reference, amount: Math.abs(amount), direction };
    });
    if (parsed.some(row => rows.find((r: Record<string, unknown>) => clean(r.date,10) === row.date) === undefined)) {
      return NextResponse.json({ error: "Existem linhas inválidas no extracto." }, { status: 400 });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(`
        INSERT INTO bank_statement_imports (accounting_entity_id,treasury_account_id,file_name,row_count,imported_by)
        VALUES ($1,$2,$3,$4,$5) RETURNING id
      `, [entityId,accountId,fileName,parsed.length,user.id]);
      const importId = inserted.rows[0].id;
      for (const row of parsed) {
        await client.query(`
          INSERT INTO bank_statement_lines (accounting_entity_id,import_id,treasury_account_id,line_date,description,direction,amount,reference)
          VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8)
        `, [entityId,importId,accountId,row.date,row.description,row.direction,row.amount,row.reference]);
      }
      await client.query(`
        INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
        SELECT organisation_id,$1,$2,'treasury.statement.imported','bank_statement_import',$3,$4::jsonb
        FROM accounting_entities WHERE id=$1
      `, [entityId,user.id,importId,JSON.stringify({ fileName, rowCount: parsed.length, accountId })]);
      await client.query("COMMIT");
      return NextResponse.json({ importId, rowCount: parsed.length }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Falha ao importar/reconciliar extracto:", error);
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: message.includes("Cada linha") ? message : "Não foi possível importar ou reconciliar o extracto." }, { status: 500 });
  }
}
