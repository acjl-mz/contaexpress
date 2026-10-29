import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WRITE_ROLES = new Set(["superadmin","client_manager","accountant"]);
const allowed = async (userId:string,entityId:string) => {
  const r=await db.query("SELECT user_can_access_entity($1,$2) AS allowed",[userId,entityId]);
  return Boolean(r.rows[0]?.allowed);
};

export async function POST(request:NextRequest) {
  const user=await getSession();
  if(!user)return NextResponse.json({error:"Inicie sessão para continuar."},{status:401});
  if(!WRITE_ROLES.has(user.role))return NextResponse.json({error:"Só um utilizador autorizado da contabilidade pode preparar lançamentos."},{status:403});
  const body=await request.json().catch(()=>null);
  const entityId=typeof body?.entityId==="string"?body.entityId:"";
  const transactionId=typeof body?.transactionId==="string"?body.transactionId:"";
  if(!entityId||!transactionId)return NextResponse.json({error:"Indique a empresa e o movimento de tesouraria."},{status:400});
  try {
    if(!await allowed(user.id,entityId))return NextResponse.json({error:"Não tem acesso a esta empresa."},{status:403});
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      const tx=await client.query(`SELECT id,treasury_account_id AS "treasuryAccountId",transaction_date AS "transactionDate",
        direction,category,description,amount,reference,status,journal_entry_id AS "journalEntryId"
        FROM treasury_transactions WHERE id=$1 AND accounting_entity_id=$2 FOR UPDATE`,[transactionId,entityId]);
      if(!tx.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Movimento de tesouraria não encontrado."},{status:404});}
      const movement=tx.rows[0];
      if(movement.journalEntryId){
        const existing=await client.query(`SELECT id,status,entry_number AS "entryNumber" FROM journal_entries WHERE id=$1 AND accounting_entity_id=$2`,[movement.journalEntryId,entityId]);
        await client.query("COMMIT");
        return NextResponse.json({entry:existing.rows[0],alreadyPrepared:true});
      }
      if(movement.status==="voided"){await client.query("ROLLBACK");return NextResponse.json({error:"Um movimento anulado não pode gerar lançamento."},{status:400});}
      const mapping=await client.query(`SELECT ledger_account_id AS "ledgerAccountId",counterpart_account_id AS "counterpartAccountId"
        FROM treasury_posting_mappings WHERE accounting_entity_id=$1 AND treasury_account_id=$2 AND direction=$3 AND category=$4`,
        [entityId,movement.treasuryAccountId,movement.direction,movement.category]);
      if(!mapping.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Não existe mapeamento contabilístico para esta conta, direcção e categoria. Configure-o antes de continuar."},{status:409});}
      const period=await client.query(`SELECT id FROM accounting_periods WHERE accounting_entity_id=$1 AND $2::date BETWEEN starts_on AND ends_on AND status='open' ORDER BY starts_on LIMIT 1 FOR UPDATE`,[entityId,movement.transactionDate]);
      if(!period.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Não existe período contabilístico aberto para a data deste movimento."},{status:409});}
      const journal=await client.query("SELECT id FROM accounting_journals WHERE accounting_entity_id=$1 AND code='GER' AND is_active=TRUE",[entityId]);
      if(!journal.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"O diário geral não está configurado. Inicialize a contabilidade primeiro."},{status:409});}
      const sourceReference="treasury_transaction:"+transactionId;
      const entry=await client.query(`INSERT INTO journal_entries
        (accounting_entity_id,period_id,journal_id,entry_date,description,source_reference,created_by)
        VALUES ($1,$2,$3,$4::date,$5,$6,$7)
        ON CONFLICT DO NOTHING
        RETURNING id,status,entry_number AS "entryNumber"`,
        [entityId,period.rows[0].id,journal.rows[0].id,movement.transactionDate,("Tesouraria: "+movement.description).slice(0,500),sourceReference,user.id]);
      let entryRow=entry.rows[0];
      if(!entryRow){
        const existing=await client.query("SELECT id,status,entry_number AS \"entryNumber\" FROM journal_entries WHERE accounting_entity_id=$1 AND source_reference=$2",[entityId,sourceReference]);
        if(!existing.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Não foi possível criar o lançamento."},{status:409});}
        entryRow=existing.rows[0];
      } else {
        const debitAccount=movement.direction==="inflow"?mapping.rows[0].ledgerAccountId:mapping.rows[0].counterpartAccountId;
        const creditAccount=movement.direction==="inflow"?mapping.rows[0].counterpartAccountId:mapping.rows[0].ledgerAccountId;
        await client.query(`INSERT INTO journal_entry_lines
          (accounting_entity_id,entry_id,line_number,account_id,description,debit,credit)
          VALUES ($1,$2,1,$3,$4,$5,0),($1,$2,2,$6,$4,0,$5)`,
          [entityId,entryRow.id,debitAccount,movement.description,String(movement.amount),creditAccount]);
      }
      await client.query("UPDATE treasury_transactions SET journal_entry_id=$1,updated_at=now() WHERE id=$2 AND accounting_entity_id=$3 AND journal_entry_id IS NULL",[entryRow.id,transactionId,entityId]);
      await client.query(`INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
        SELECT organisation_id,$1,$2,'treasury.transaction.journal_draft_created','journal_entry',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
        [entityId,user.id,entryRow.id,JSON.stringify({transactionId,sourceReference,direction:movement.direction,category:movement.category,amount:movement.amount})]);
      await client.query("COMMIT");
      return NextResponse.json({entry:entryRow,status:"draft",message:"Rascunho contabilístico criado. Reveja e confirme no diário geral."},{status:201});
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{client.release();}
  }catch(error){console.error("Falha ao preparar lançamento da tesouraria:",error);return NextResponse.json({error:"Não foi possível preparar o lançamento contabilístico."},{status:500});}
}
