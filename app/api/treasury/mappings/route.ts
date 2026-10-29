import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WRITE_ROLES = new Set(["superadmin", "client_manager", "accountant"]);
const CATEGORIES = new Set(["customer_receipt","supplier_payment","salary","tax","fee","transfer","other"]);
const DIRECTIONS = new Set(["inflow","outflow"]);
const allowed = async (userId:string,entityId:string) => {
  const r=await db.query("SELECT user_can_access_entity($1,$2) AS allowed",[userId,entityId]);
  return Boolean(r.rows[0]?.allowed);
};

export async function GET(request:NextRequest) {
  const user=await getSession();
  if(!user)return NextResponse.json({error:"Inicie sessão para continuar."},{status:401});
  const entityId=request.nextUrl.searchParams.get("entityId")??"";
  if(!entityId)return NextResponse.json({error:"Seleccione uma empresa."},{status:400});
  try {
    if(!await allowed(user.id,entityId))return NextResponse.json({error:"Não tem acesso a esta empresa."},{status:403});
    const [accounts,mappingsResult]=await Promise.all([
      db.query(`SELECT id,code,name,account_type AS "accountType" FROM chart_of_accounts
        WHERE accounting_entity_id=$1 AND is_active=TRUE AND is_postable=TRUE ORDER BY code`,[entityId]),
      db.query(`SELECT m.id,m.treasury_account_id AS "treasuryAccountId",m.direction,m.category,
        m.ledger_account_id AS "ledgerAccountId",m.counterpart_account_id AS "counterpartAccountId",
        t.name AS "treasuryAccountName",a.code AS "ledgerAccountCode",a.name AS "ledgerAccountName",
        c.code AS "counterpartAccountCode",c.name AS "counterpartAccountName"
        FROM treasury_posting_mappings m
        JOIN treasury_accounts t ON t.id=m.treasury_account_id AND t.accounting_entity_id=m.accounting_entity_id
        JOIN chart_of_accounts a ON a.id=m.ledger_account_id AND a.accounting_entity_id=m.accounting_entity_id
        JOIN chart_of_accounts c ON c.id=m.counterpart_account_id AND c.accounting_entity_id=m.accounting_entity_id
        WHERE m.accounting_entity_id=$1 ORDER BY t.name,m.category,m.direction`,[entityId])
    ]);
    return NextResponse.json({accounts:accounts.rows,mappings:mappingsResult.rows});
  }catch(error){console.error("Falha ao consultar mapeamentos de tesouraria:",error);return NextResponse.json({error:"Não foi possível carregar os mapeamentos contabilísticos."},{status:500});}
}

export async function POST(request:NextRequest) {
  const user=await getSession();
  if(!user)return NextResponse.json({error:"Inicie sessão para continuar."},{status:401});
  if(!WRITE_ROLES.has(user.role))return NextResponse.json({error:"Não tem permissão para configurar mapeamentos contabilísticos."},{status:403});
  try {
    const body=await request.json();
    const entityId=typeof body.entityId==="string"?body.entityId:"";
    const treasuryAccountId=typeof body.treasuryAccountId==="string"?body.treasuryAccountId:"";
    const direction=typeof body.direction==="string"?body.direction:"";
    const category=typeof body.category==="string"?body.category:"";
    const ledgerAccountId=typeof body.ledgerAccountId==="string"?body.ledgerAccountId:"";
    const counterpartAccountId=typeof body.counterpartAccountId==="string"?body.counterpartAccountId:"";
    if(!entityId||!treasuryAccountId||!DIRECTIONS.has(direction)||!CATEGORIES.has(category)||!ledgerAccountId||!counterpartAccountId||ledgerAccountId===counterpartAccountId)
      return NextResponse.json({error:"Preencha a conta de tesouraria, direcção, categoria e as duas contas contabilísticas."},{status:400});
    if(!await allowed(user.id,entityId))return NextResponse.json({error:"Não tem acesso a esta empresa."},{status:403});
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      const treasury=await client.query("SELECT id FROM treasury_accounts WHERE id=$1 AND accounting_entity_id=$2 AND is_active FOR UPDATE",[treasuryAccountId,entityId]);
      if(!treasury.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"A conta de tesouraria não existe ou está inactiva."},{status:400});}
      const ledger=await client.query("SELECT id,account_type FROM chart_of_accounts WHERE id=ANY($1::uuid[]) AND accounting_entity_id=$2 AND is_active AND is_postable",[ [ledgerAccountId,counterpartAccountId],entityId]);
      if(ledger.rowCount!==2){await client.query("ROLLBACK");return NextResponse.json({error:"As duas contas devem pertencer à empresa e permitir movimentos."},{status:400});}
      if(!ledger.rows.some((row:{id:string;account_type:string})=>row.id===ledgerAccountId&&row.account_type==="asset")){await client.query("ROLLBACK");return NextResponse.json({error:"A conta contabilística associada à tesouraria deve ser uma conta de activo."},{status:400});}
      const result=await client.query(`INSERT INTO treasury_posting_mappings
        (accounting_entity_id,treasury_account_id,direction,category,ledger_account_id,counterpart_account_id,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (accounting_entity_id,treasury_account_id,direction,category)
        DO UPDATE SET ledger_account_id=EXCLUDED.ledger_account_id,counterpart_account_id=EXCLUDED.counterpart_account_id,updated_at=now()
        RETURNING id,treasury_account_id AS "treasuryAccountId",direction,category,ledger_account_id AS "ledgerAccountId",counterpart_account_id AS "counterpartAccountId"`,
        [entityId,treasuryAccountId,direction,category,ledgerAccountId,counterpartAccountId,user.id]);
      await client.query(`INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
        SELECT organisation_id,$1,$2,'treasury.accounting_mapping.saved','treasury_posting_mapping',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
        [entityId,user.id,result.rows[0].id,JSON.stringify({treasuryAccountId,direction,category,ledgerAccountId,counterpartAccountId})]);
      await client.query("COMMIT");
      return NextResponse.json({mapping:result.rows[0]},{status:201});
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{client.release();}
  }catch(error){console.error("Falha ao guardar mapeamento de tesouraria:",error);return NextResponse.json({error:"Não foi possível guardar o mapeamento contabilístico."},{status:500});}
}
