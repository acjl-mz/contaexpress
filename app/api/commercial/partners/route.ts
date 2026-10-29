import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
export const runtime="nodejs";
const ROLES=new Set(["superadmin","client_manager","accountant","finance_manager"]);
export async function GET(request:NextRequest){
 const user=await getSession(); if(!user)return NextResponse.json({error:"Inicie sessão."},{status:401});
 const entityId=request.nextUrl.searchParams.get("entityId"); if(!entityId)return NextResponse.json({error:"Indique a empresa."},{status:400});
 try{
  const a=await db.query("SELECT user_can_access_entity($1,$2) allowed",[user.id,entityId]); if(!a.rows[0]?.allowed)return NextResponse.json({error:"Sem acesso à empresa."},{status:403});
  const type=request.nextUrl.searchParams.get("type");
  const r=await db.query(`SELECT id,partner_type AS "partnerType",legal_name AS "legalName",tax_number AS "taxNumber",email,phone,address,payment_terms_days AS "paymentTermsDays",is_active AS "isActive"
   FROM commercial_partners WHERE accounting_entity_id=$1 AND ($2::text IS NULL OR partner_type=$2 OR partner_type='both') ORDER BY legal_name LIMIT 500`,[entityId,type]);
  return NextResponse.json({partners:r.rows});
 }catch(e){console.error(e);return NextResponse.json({error:"Não foi possível consultar clientes e fornecedores."},{status:500});}
}
export async function POST(request:NextRequest){
 const user=await getSession(); if(!user)return NextResponse.json({error:"Inicie sessão."},{status:401});
 if(!ROLES.has(user.role))return NextResponse.json({error:"Sem permissão."},{status:403});
 try{
  const b=await request.json(), entityId=String(b.entityId||""), partnerType=String(b.partnerType||""), legalName=String(b.legalName||"").trim();
  if(!entityId||!["customer","supplier","both"].includes(partnerType)||legalName.length<2||legalName.length>180)return NextResponse.json({error:"Indique empresa, tipo e denominação válidos."},{status:400});
  const a=await db.query("SELECT user_can_access_entity($1,$2) allowed",[user.id,entityId]);if(!a.rows[0]?.allowed)return NextResponse.json({error:"Sem acesso à empresa."},{status:403});
  const terms=Number(b.paymentTermsDays??0);if(!Number.isInteger(terms)||terms<0||terms>365)return NextResponse.json({error:"Prazo de pagamento inválido."},{status:400});
  const r=await db.query(`INSERT INTO commercial_partners(accounting_entity_id,partner_type,legal_name,tax_number,email,phone,address,payment_terms_days,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
   RETURNING id,partner_type AS "partnerType",legal_name AS "legalName",tax_number AS "taxNumber",email,phone,address,payment_terms_days AS "paymentTermsDays",is_active AS "isActive"`,
   [entityId,partnerType,legalName,String(b.taxNumber||"").trim()||null,String(b.email||"").trim()||null,String(b.phone||"").trim()||null,String(b.address||"").trim()||null,terms,user.id]);
  await db.query(`INSERT INTO audit_events(organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details)
   SELECT organisation_id,$1,$2,'commercial.partner.created','commercial_partner',$3,$4::jsonb FROM accounting_entities WHERE id=$1`,
   [entityId,user.id,r.rows[0].id,JSON.stringify({partnerType,legalName})]);
  return NextResponse.json({partner:r.rows[0]},{status:201});
 }catch(e){console.error(e);return NextResponse.json({error:"Não foi possível registar o cliente/fornecedor."},{status:500});}
}