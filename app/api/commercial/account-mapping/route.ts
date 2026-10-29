import {NextRequest,NextResponse} from "next/server";
import {getSession} from "@/lib/auth";
import {db} from "@/lib/db";
export const runtime="nodejs";
const ROLES=new Set(["superadmin","client_manager","accountant"]);
export async function GET(request:NextRequest){
 const u=await getSession();if(!u)return NextResponse.json({error:"Inicie sessão."},{status:401});
 const e=request.nextUrl.searchParams.get("entityId");if(!e)return NextResponse.json({error:"Indique a empresa."},{status:400});
 try{const a=await db.query("SELECT user_can_access_entity($1,$2) allowed",[u.id,e]);if(!a.rows[0]?.allowed)return NextResponse.json({error:"Sem acesso."},{status:403});
 const [accounts,mapping]=await Promise.all([
  db.query("SELECT id,code,name,account_type AS \"accountType\" FROM chart_of_accounts WHERE accounting_entity_id=$1 AND is_active AND is_postable ORDER BY code",[e]),
  db.query(`SELECT receivable_account_id AS "receivableAccountId",payable_account_id AS "payableAccountId",sales_account_id AS "salesAccountId",purchase_account_id AS "purchaseAccountId",output_tax_account_id AS "outputTaxAccountId",input_tax_account_id AS "inputTaxAccountId" FROM commercial_account_mappings WHERE accounting_entity_id=$1`,[e])]);
 return NextResponse.json({accounts:accounts.rows,mapping:mapping.rows[0]??null});
 }catch(err){console.error(err);return NextResponse.json({error:"Não foi possível consultar a configuração comercial."},{status:500});}
}
export async function PUT(request:NextRequest){
 const u=await getSession();if(!u)return NextResponse.json({error:"Inicie sessão."},{status:401});if(!ROLES.has(u.role))return NextResponse.json({error:"Sem permissão para configurar contas comerciais."},{status:403});
 const b=await request.json().catch(()=>null);const e=String(b?.entityId||"");
 const keys=["receivableAccountId","payableAccountId","salesAccountId","purchaseAccountId","outputTaxAccountId","inputTaxAccountId"] as const;
 const ids=keys.map(k=>b?.[k]?String(b[k]):null);
 if(!e||keys.slice(0,4).some((k,i)=>!ids[i]))return NextResponse.json({error:"As contas de clientes, fornecedores, vendas e compras são obrigatórias."},{status:400});
 try{
 const a=await db.query("SELECT user_can_access_entity($1,$2) allowed",[u.id,e]);if(!a.rows[0]?.allowed)return NextResponse.json({error:"Sem acesso."},{status:403});
 const required=ids.filter(Boolean) as string[];const valid=await db.query("SELECT id,account_type FROM chart_of_accounts WHERE accounting_entity_id=$1 AND id=ANY($2::uuid[]) AND is_active AND is_postable",[e,required]);
 if(valid.rowCount!==new Set(required).size)return NextResponse.json({error:"Uma ou mais contas não pertencem à empresa ou não permitem movimentos."},{status:400});
 const type=(id:string|null)=>valid.rows.find((r:{id:string;account_type:string})=>r.id===id)?.account_type;
 if(type(ids[0])!=="asset"||type(ids[1])!=="liability"||type(ids[2])!=="income"||type(ids[3])!=="expense")return NextResponse.json({error:"Classifique clientes como activo, fornecedores como passivo, vendas como rendimento e compras como gasto."},{status:400});
 for(const i of [4,5])if(ids[i]&&type(ids[i])!=="liability"&&type(ids[i])!=="asset")return NextResponse.json({error:"As contas de imposto devem ser contas de activo ou passivo."},{status:400});
 const r=await db.query(`INSERT INTO commercial_account_mappings(accounting_entity_id,receivable_account_id,payable_account_id,sales_account_id,purchase_account_id,output_tax_account_id,input_tax_account_id,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(accounting_entity_id) DO UPDATE SET receivable_account_id=EXCLUDED.receivable_account_id,payable_account_id=EXCLUDED.payable_account_id,sales_account_id=EXCLUDED.sales_account_id,purchase_account_id=EXCLUDED.purchase_account_id,output_tax_account_id=EXCLUDED.output_tax_account_id,input_tax_account_id=EXCLUDED.input_tax_account_id,updated_by=EXCLUDED.updated_by,updated_at=now()
 RETURNING accounting_entity_id AS "entityId",receivable_account_id AS "receivableAccountId",payable_account_id AS "payableAccountId",sales_account_id AS "salesAccountId",purchase_account_id AS "purchaseAccountId",output_tax_account_id AS "outputTaxAccountId",input_tax_account_id AS "inputTaxAccountId"`,[e,...ids,u.id]);
 await db.query(`INSERT INTO audit_events(organisation_id,accounting_entity_id,actor_user_id,event_type,target_type,target_id,details) SELECT organisation_id,$1,$2,'commercial.account_mapping.updated','commercial_account_mapping',$1,$3::jsonb FROM accounting_entities WHERE id=$1`,[e,u.id,JSON.stringify(r.rows[0])]);
 return NextResponse.json({mapping:r.rows[0]});
 }catch(err){console.error(err);return NextResponse.json({error:"Não foi possível guardar o mapeamento contabilístico."},{status:500});}
}