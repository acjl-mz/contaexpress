import { NextRequest,NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
export const runtime="nodejs";
const ROLES=new Set(["superadmin","client_manager","accountant","finance_manager"]);
export async function GET(request:NextRequest){
 const u=await getSession();if(!u)return NextResponse.json({error:"Inicie sessão."},{status:401});
 const e=request.nextUrl.searchParams.get("entityId");if(!e)return NextResponse.json({error:"Indique a empresa."},{status:400});
 try{
  const a=await db.query("SELECT user_can_access_entity($1,$2) allowed",[u.id,e]);if(!a.rows[0]?.allowed)return NextResponse.json({error:"Sem acesso."},{status:403});
  const r=await db.query(`SELECT d.id,d.document_type AS "documentType",d.document_number AS "documentNumber",d.document_date AS "documentDate",d.due_date AS "dueDate",d.net_amount AS "netAmount",d.tax_amount AS "taxAmount",d.total_amount AS "totalAmount",d.status,d.journal_entry_id AS "journalEntryId",p.legal_name AS "partnerName",COALESCE((SELECT SUM(x.amount) FROM commercial_document_payments x WHERE x.accounting_entity_id=d.accounting_entity_id AND x.document_id=d.id),0)::numeric(20,2) AS "paidAmount"
   FROM commercial_documents d JOIN commercial_partners p ON p.id=d.partner_id AND p.accounting_entity_id=d.accounting_entity_id
   WHERE d.accounting_entity_id=$1 ORDER BY d.document_date DESC,d.created_at DESC LIMIT 500`,[e]);
  return NextResponse.json({documents:r.rows});
 }catch(err){console.error(err);return NextResponse.json({error:"Não foi possível consultar documentos comerciais."},{status:500});}
}
export async function POST(request:NextRequest){
 const u=await getSession();if(!u)return NextResponse.json({error:"Inicie sessão."},{status:401});if(!ROLES.has(u.role))return NextResponse.json({error:"Sem permissão."},{status:403});
 const b=await request.json().catch(()=>null);if(!b)return NextResponse.json({error:"Pedido inválido."},{status:400});
 const e=String(b.entityId||""),partnerId=String(b.partnerId||""),type=String(b.documentType||""),number=String(b.documentNumber||"").trim(),date=String(b.documentDate||""),description=String(b.description||"").trim();
 const lines=Array.isArray(b.lines)?b.lines:[];
 if(!e||!partnerId||!["sales_invoice","supplier_bill"].includes(type)||!number||number.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(date)||description.length<2||!lines.length||lines.length>100)return NextResponse.json({error:"Preencha os dados do documento e pelo menos uma linha."},{status:400});
 const parsed=[];let net=0,tax=0;
 for(const x of lines){const label=String(x.description||"").trim(),qty=Number(x.quantity),price=Number(x.unitPrice),n=Number(x.netAmount),t=Number(x.taxAmount||0);
  if(!label||label.length>240||!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0||!Number.isFinite(n)||n<0||!Number.isFinite(t)||t<0||Math.abs(n-Math.round(qty*price*100)/100)>0.02)return NextResponse.json({error:"Verifique quantidades, preços e valores das linhas."},{status:400});
  parsed.push({label,qty,price,n,t});net+=n;tax+=t;
 }
 net=Number(net.toFixed(2));tax=Number(tax.toFixed(2));const total=Number((net+tax).toFixed(2));
 if(total<=0||!Number.isFinite(total))return NextResponse.json({error:"O total do documento deve ser positivo."},{status:400});
 const client=await db.connect();
 try{
  await client.query("BEGIN");
  const access=await client.query("SELECT user_can_access_entity($1,$2) allowed",[u.id,e]);if(!access.rows[0]?.allowed){await client.query("ROLLBACK");return NextResponse.json({error:"Sem acesso à empresa."},{status:403});}
  const p=await client.query("SELECT partner_type FROM commercial_partners WHERE id=$1 AND accounting_entity_id=$2 AND is_active FOR UPDATE",[partnerId,e]);
  if(!p.rowCount||!(p.rows[0].partner_type==="both"||p.rows[0].partner_type===(type==="sales_invoice"?"customer":"supplier"))){await client.query("ROLLBACK");return NextResponse.json({error:"Cliente/fornecedor inválido para este documento."},{status:400});}
  const mapping=await client.query("SELECT * FROM commercial_account_mappings WHERE accounting_entity_id=$1",[e]);
  if(!mapping.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Configure primeiro as contas de clientes, fornecedores, vendas e compras."},{status:409});}
  const m=mapping.rows[0],receivable=type==="sales_invoice",control=receivable?m.receivable_account_id:m.payable_account_id,operating=receivable?m.sales_account_id:m.purchase_account_id,taxAccount=receivable?m.output_tax_account_id:m.input_tax_account_id;
  if(tax>0&&!taxAccount){await client.query("ROLLBACK");return NextResponse.json({error:"Configure a conta de imposto correspondente antes de registar documentos com imposto."},{status:409});}
  const period=await client.query("SELECT id FROM accounting_periods WHERE accounting_entity_id=$1 AND $2::date BETWEEN starts_on AND ends_on AND status='open' ORDER BY starts_on LIMIT 1 FOR UPDATE",[e,date]);
  const journal=await client.query("SELECT id FROM accounting_journals WHERE accounting_entity_id=$1 AND code='GER' AND is_active",[e]);
  if(!period.rowCount||!journal.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Inicialize a contabilidade e confirme que existe período aberto e diário geral para a data."},{status:409});}
  const due=String(b.dueDate||"")||null;if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due)){await client.query("ROLLBACK");return NextResponse.json({error:"Data de vencimento inválida."},{status:400});}
  const d=await client.query(`INSERT INTO commercial_documents(accounting_entity_id,partner_id,document_type,document_number,document_date,due_date,currency,net_amount,tax_amount,total_amount,tax_type,tax_reference,description,status,created_by)
   VALUES($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13,'accounting_draft',$14)
   RETURNING id,document_number AS "documentNumber",total_amount AS "totalAmount",status`,
   [e,partnerId,type,number,date,due,b.currency||"MZN",net,tax,total,String(b.taxType||"").trim()||null,String(b.taxReference||"").trim()||null,description,u.id]);
  for(let i=0;i<parsed.length;i++){const x=parsed[i];await client.query(`INSERT INTO commercial_document_lines(accounting_entity_id,document_id,line_number,description,quantity,unit_price,net_amount,tax_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[e,d.rows[0].id,i+1,x.label,x.qty,x.price,x.n,x.t]);}
  const entry=await client.query(`INSERT INTO journal_entries(accounting_entity_id,period_id,journal_id,entry_date,description,source_reference,created_by)
   VALUES($1,$2,$3,$4::date,$5,$6,$7) RETURNING id`,[e,period.rows[0].id,journal.rows[0].id,date,(type==="sales_invoice"?"Factura de cliente: ":"Factura de fornecedor: ")+number,"commercial_document:"+d.rows[0].id,u.id]);
  const journalLines=receivable?[
   [control,total,0],[operating,0,net],...(tax>0?[[taxAccount,0,tax]]:[])
  ]:[
   [operating,net,0],...(tax>0?[[taxAccount,tax,0]]:[]),[control,0,total]
  ];
  for(let i=0;i<journalLines.length;i++){const x=journalLines[i];await client.query("INSERT INTO journal_entry_lines(accounting_entity_id,entry_id,line_number,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6,$7)",[e,entry.rows[0].id,i+1,x[0],description,x[1],x[2]]);}
  await client.query("UPDATE commercial_documents SET journal_entry_id=$1 WHERE id=$2 AND accounting_entity_id=$3",[entry.rows[0].id,d.rows[0].id,e]);
  await client.query(`INSERT INTO audit_events(organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
   SELECT organisation_id,$1,$2,'commercial.document.accounting_draft_created','commercial_document',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
   [e,u.id,d.rows[0].id,JSON.stringify({type,number,total,journalEntryId:entry.rows[0].id})]);
  await client.query("COMMIT");return NextResponse.json({document:d.rows[0],journalEntry:{id:entry.rows[0].id,status:"draft"},notice:"Documento registado e rascunho contabilístico criado. Reveja e confirme o lançamento no diário geral."},{status:201});
 }catch(err){await client.query("ROLLBACK").catch(()=>undefined);console.error(err);return NextResponse.json({error:"Não foi possível registar o documento comercial."},{status:500});}finally{client.release();}
}