import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WRITE_ROLES = new Set(["superadmin", "client_manager", "accountant", "tax_officer", "finance_manager"]);
const TYPES = new Set(["IVA","IRPS","IRPC","ISPC","INSS","IRRM","OTHER"]);
const STATUSES = new Set(["pending","prepared","submitted","paid","not_applicable"]);
const clean = (v: unknown, max=1500) => typeof v === "string" ? v.trim().slice(0,max) : "";
const allowed = async (userId:string,entityId:string) => {
  const r=await db.query("SELECT user_can_access_entity($1,$2) AS allowed",[userId,entityId]); return Boolean(r.rows[0]?.allowed);
};
export async function GET(request:NextRequest) {
  const user=await getSession();
  if(!user)return NextResponse.json({error:"Inicie sessão para continuar."},{status:401});
  const entityId=request.nextUrl.searchParams.get("entityId")??"";
  if(!entityId)return NextResponse.json({error:"Seleccione uma empresa."},{status:400});
  try {
    if(!await allowed(user.id,entityId))return NextResponse.json({error:"Não tem acesso a esta empresa."},{status:403});
    const result=await db.query(`SELECT id,tax_type AS "taxType",period_label AS "periodLabel",due_date AS "dueDate",
      amount_due AS "amountDue",amount_paid AS "amountPaid",status,submitted_at AS "submittedAt",paid_at AS "paidAt",
      reference,notes,created_at AS "createdAt"
      FROM tax_obligations WHERE accounting_entity_id=$1 ORDER BY due_date ASC LIMIT 500`,[entityId]);
    return NextResponse.json({obligations:result.rows});
  } catch(error){console.error("Falha ao consultar obrigações fiscais:",error);return NextResponse.json({error:"Não foi possível carregar as obrigações fiscais."},{status:500});}
}
export async function POST(request:NextRequest) {
  const user=await getSession();
  if(!user)return NextResponse.json({error:"Inicie sessão para continuar."},{status:401});
  if(!WRITE_ROLES.has(user.role))return NextResponse.json({error:"Não tem permissão para gerir obrigações fiscais."},{status:403});
  try {
    const body=await request.json(), entityId=clean(body.entityId,80), taxType=clean(body.taxType,20), periodLabel=clean(body.periodLabel,80), dueDate=clean(body.dueDate,10);
    const amountDue=body.amountDue===""||body.amountDue===null||body.amountDue===undefined?null:Number(body.amountDue);
    if(!entityId||!await allowed(user.id,entityId))return NextResponse.json({error:"Empresa inválida ou sem acesso."},{status:entityId?403:400});
    if(!TYPES.has(taxType)||periodLabel.length<2||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||(amountDue!==null&&(!Number.isFinite(amountDue)||amountDue<0||amountDue>1_000_000_000_000)))return NextResponse.json({error:"Verifique o imposto, período, prazo e valor previsto."},{status:400});
    const result=await db.query(`INSERT INTO tax_obligations (accounting_entity_id,tax_type,period_label,due_date,amount_due,notes,created_by)
      VALUES ($1,$2,$3,$4::date,$5,$6,$7)
      RETURNING id,tax_type AS "taxType",period_label AS "periodLabel",due_date AS "dueDate",amount_due AS "amountDue",
      amount_paid AS "amountPaid",status,submitted_at AS "submittedAt",paid_at AS "paidAt",reference,notes`,
    [entityId,taxType,periodLabel,dueDate,amountDue,clean(body.notes)||null,user.id]);
    await db.query(`INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
      SELECT organisation_id,$1,$2,'tax.obligation.created','tax_obligation',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
    [entityId,user.id,result.rows[0].id,JSON.stringify({taxType,periodLabel,dueDate,amountDue})]);
    return NextResponse.json({obligation:result.rows[0]},{status:201});
  }catch(error){console.error("Falha ao criar obrigação fiscal:",error);return NextResponse.json({error:"Não foi possível registar a obrigação fiscal."},{status:500});}
}
export async function PATCH(request:NextRequest) {
  const user=await getSession();
  if(!user)return NextResponse.json({error:"Inicie sessão para continuar."},{status:401});
  if(!WRITE_ROLES.has(user.role))return NextResponse.json({error:"Não tem permissão para actualizar obrigações fiscais."},{status:403});
  try {
    const body=await request.json(), entityId=clean(body.entityId,80), id=clean(body.id,80), status=clean(body.status,30);
    const amountPaid=body.amountPaid===""||body.amountPaid===null||body.amountPaid===undefined?null:Number(body.amountPaid);
    const reference=clean(body.reference,120)||null;
    if(!entityId||!id||!await allowed(user.id,entityId))return NextResponse.json({error:"Empresa ou obrigação inválida."},{status:403});
    if(!STATUSES.has(status)||(amountPaid!==null&&(!Number.isFinite(amountPaid)||amountPaid<0||amountPaid>1_000_000_000_000)))return NextResponse.json({error:"Estado ou valor pago inválido."},{status:400});
    const result=await db.query(`UPDATE tax_obligations SET status=$3,amount_paid=$4,reference=COALESCE($5,reference),
      submitted_at=CASE WHEN $3='submitted' THEN COALESCE(submitted_at,CURRENT_DATE) ELSE submitted_at END,
      paid_at=CASE WHEN $3='paid' THEN COALESCE(paid_at,CURRENT_DATE) ELSE paid_at END,updated_at=now()
      WHERE id=$1 AND accounting_entity_id=$2 RETURNING id,tax_type AS "taxType",period_label AS "periodLabel",
      due_date AS "dueDate",amount_due AS "amountDue",amount_paid AS "amountPaid",status,submitted_at AS "submittedAt",paid_at AS "paidAt",reference,notes`,
    [id,entityId,status,amountPaid,reference]);
    if(!result.rowCount)return NextResponse.json({error:"Obrigação fiscal não encontrada."},{status:404});
    await db.query(`INSERT INTO audit_events (organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
      SELECT organisation_id,$1,$2,'tax.obligation.updated','tax_obligation',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
    [entityId,user.id,id,JSON.stringify({status,amountPaid,reference})]);
    return NextResponse.json({obligation:result.rows[0]});
  }catch(error){console.error("Falha ao actualizar obrigação fiscal:",error);return NextResponse.json({error:"Não foi possível actualizar a obrigação fiscal."},{status:500});}
}
