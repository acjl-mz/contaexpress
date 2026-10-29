import {NextRequest,NextResponse} from "next/server";
import {getSession} from "@/lib/auth";
import {db} from "@/lib/db";
export const runtime="nodejs";
const ROLES=new Set(["superadmin","client_manager","accountant","finance_manager"]);
export async function POST(request:NextRequest){
 const u=await getSession();if(!u)return NextResponse.json({error:"Inicie sessão."},{status:401});if(!ROLES.has(u.role))return NextResponse.json({error:"Sem permissão."},{status:403});
 const b=await request.json().catch(()=>null);const e=String(b?.entityId||""),id=String(b?.documentId||""),account=String(b?.treasuryAccountId||""),date=String(b?.transactionDate||""),amount=Number(b?.amount);
 if(!e||!id||!account||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(amount)||amount<=0)return NextResponse.json({error:"Indique documento, conta de tesouraria, data e valor positivo."},{status:400});
 const c=await db.connect();
 try{
  await c.query("BEGIN");const a=await c.query("SELECT user_can_access_entity($1,$2) allowed",[u.id,e]);if(!a.rows[0]?.allowed){await c.query("ROLLBACK");return NextResponse.json({error:"Sem acesso."},{status:403});}
  const d=await c.query("SELECT id,document_type,total_amount,status FROM commercial_documents WHERE id=$1 AND accounting_entity_id=$2 FOR UPDATE",[id,e]);
  if(!d.rowCount||["voided","draft"].includes(d.rows[0].status)){await c.query("ROLLBACK");return NextResponse.json({error:"Documento não encontrado ou ainda não está pronto para receber pagamentos."},{status:409});}
  const paid=await c.query("SELECT COALESCE(SUM(amount),0)::numeric(20,2) amount FROM commercial_document_payments WHERE accounting_entity_id=$1 AND document_id=$2",[e,id]);
  const outstanding=Number(d.rows[0].total_amount)-Number(paid.rows[0].amount);
  if(amount>outstanding+0.001){await c.query("ROLLBACK");return NextResponse.json({error:"O pagamento excede o saldo em aberto.",outstanding},{status:409});}
  const acc=await c.query("SELECT id FROM treasury_accounts WHERE id=$1 AND accounting_entity_id=$2 AND is_active FOR UPDATE",[account,e]);if(!acc.rowCount){await c.query("ROLLBACK");return NextResponse.json({error:"Conta de tesouraria inválida."},{status:400});}
  const incoming=d.rows[0].document_type==="sales_invoice",direction=incoming?"inflow":"outflow",category=incoming?"customer_receipt":"supplier_payment";
  const tx=await c.query(`INSERT INTO treasury_transactions(accounting_entity_id,treasury_account_id,transaction_date,direction,category,description,amount,reference,counterparty,created_by)
   VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
   [e,account,date,direction,category,(incoming?"Recebimento de cliente ":"Pagamento a fornecedor ")+id.slice(0,8),amount,"commercial_document:"+id,null,u.id]);
  await c.query("INSERT INTO commercial_document_payments(accounting_entity_id,document_id,treasury_transaction_id,amount,created_by) VALUES($1,$2,$3,$4,$5)",[e,id,tx.rows[0].id,amount,u.id]);
  const newPaid=Number((Number(paid.rows[0].amount)+amount).toFixed(2)),status=newPaid+0.001>=Number(d.rows[0].total_amount)?"paid":"partially_paid";
  await c.query("UPDATE commercial_documents SET status=$1,updated_at=now() WHERE id=$2 AND accounting_entity_id=$3",[status,id,e]);
  await c.query(`INSERT INTO audit_events(organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
   SELECT organisation_id,$1,$2,'commercial.document.payment_recorded','commercial_document',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
   [e,u.id,id,JSON.stringify({amount,treasuryTransactionId:tx.rows[0].id,status})]);
  await c.query("COMMIT");return NextResponse.json({payment:{treasuryTransactionId:tx.rows[0].id,amount},outstanding:Number((outstanding-amount).toFixed(2)),status,notice:"Pagamento registado na Tesouraria. Configure o mapeamento correspondente e prepare o rascunho contabilístico do movimento."},{status:201});
 }catch(err){await c.query("ROLLBACK").catch(()=>undefined);console.error(err);return NextResponse.json({error:"Não foi possível registar o pagamento."},{status:500});}finally{c.release();}
}