"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarCheck, CheckCircle2, CircleAlert, ClipboardCheck, LogOut, RefreshCw, ShieldCheck } from "lucide-react";

type Company = { id: string; legalName: string };
type Period = { periodId: string; periodLabel: string; startsOn: string; endsOn: string; periodStatus: string; closeId: string | null; closeStatus: string | null; closedAt: string | null; requiredCompleted: number | null; requiredTotal: number | null };
type Item = { id: string; title: string; description: string | null; isRequired: boolean; status: "pending" | "completed" | "not_applicable"; sortOrder: number };

const dateLabel=(value:string)=>new Date(value+"T12:00:00").toLocaleDateString("pt-MZ",{day:"2-digit",month:"short",year:"numeric"});
const statusLabel=(status:string)=>status==="open"?"Aberto":status==="closed"?"Encerrado":status;

export default function FechoMensalPage(){
 const router=useRouter();
 const [companies,setCompanies]=useState<Company[]>([]);
 const [entityId,setEntityId]=useState("");
 const [periods,setPeriods]=useState<Period[]>([]);
 const [selected,setSelected]=useState<Period|null>(null);
 const [items,setItems]=useState<Item[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");

 const loadCompanies=useCallback(async()=>{
  try{
   const r=await fetch("/api/companies");
   if(r.status===401){router.replace("/login");return;}
   const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível carregar empresas.");
   setCompanies(d.companies??[]);setEntityId(v=>v||d.companies?.[0]?.id||"");
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar empresas.");}
 },[router]);
 const loadPeriods=useCallback(async(id:string)=>{
  if(!id){setPeriods([]);setSelected(null);setItems([]);setLoading(false);return;}
  setLoading(true);setError("");
  try{
   const r=await fetch("/api/accounting/close?entityId="+encodeURIComponent(id));
   if(r.status===401){router.replace("/login");return;}
   const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível carregar os períodos.");
   setPeriods(d.periods??[]);
   setSelected(current=>current&&d.periods?.find((p:Period)=>p.periodId===current.periodId)||null);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar períodos.");}
  finally{setLoading(false);}
 },[router]);
 const loadItems=useCallback(async(closeId:string)=>{
  try{
   const r=await fetch("/api/accounting/close/"+encodeURIComponent(closeId)+"/items");
   if(r.status===401){router.replace("/login");return;}
   const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível carregar a checklist.");
   setItems(d.items??[]);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar checklist.");}
 },[router]);
 useEffect(()=>{void loadCompanies();},[loadCompanies]);
 useEffect(()=>{void loadPeriods(entityId);},[entityId,loadPeriods]);
 useEffect(()=>{if(selected?.closeId)void loadItems(selected.closeId);else setItems([]);},[selected?.closeId,loadItems]);

 async function prepare(period:Period){
  setBusy(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/accounting/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entityId,periodId:period.periodId})});
   const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível preparar o fecho.");
   await loadPeriods(entityId);
   const updated={...period,closeId:d.closeId,closeStatus:"open"};
   setSelected(updated);await loadItems(d.closeId);setNotice(d.created?"Checklist mensal preparada.":"Checklist mensal carregada.");
  }catch(e){setError(e instanceof Error?e.message:"Erro ao preparar fecho.");}
  finally{setBusy(false);}
 }
 async function changeItem(item:Item,status:Item["status"]){
  if(!selected?.closeId)return;
  setError("");setNotice("");
  try{
   const r=await fetch("/api/accounting/close/"+encodeURIComponent(selected.closeId)+"/items/"+encodeURIComponent(item.id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
   const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível actualizar o item.");
   setItems(old=>old.map(x=>x.id===item.id?{...x,...d.item}:x));setNotice("Checklist actualizada.");
  }catch(e){setError(e instanceof Error?e.message:"Erro ao actualizar checklist.");}
 }
 async function finalize(){
  if(!selected?.closeId)return;
  if(!window.confirm("O encerramento bloqueia novos lançamentos neste período. Confirma que a revisão foi concluída e pretende encerrar?"))return;
  setBusy(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/accounting/close/"+encodeURIComponent(selected.closeId)+"/finalize",{method:"POST"});
   const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível encerrar o período.");
   setNotice("Período encerrado. Débitos e créditos: "+Number(d.totals.debit).toLocaleString("pt-MZ",{minimumFractionDigits:2})+" MZN.");
   setSelected(null);await loadPeriods(entityId);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao encerrar período.");}
  finally{setBusy(false);}
 }
 async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");router.refresh();}
 const completed=items.filter(i=>i.status==="completed"||(i.status==="not_applicable"&&!i.isRequired)).length;
 const requiredPending=items.filter(i=>i.isRequired&&i.status!=="completed").length;

 return <main className="companies-shell">
  <header className="companies-topbar"><Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link><div className="companies-user"><Link href="/contabilidade" className="secondary-button"><ArrowLeft size={14}/> Contabilidade</Link><Link href="/tarefas" className="secondary-button"><ClipboardCheck size={14}/> Tarefas</Link><button className="icon-button" onClick={logout} aria-label="Terminar sessão"><LogOut size={17}/></button></div></header>
  <section className="companies-content accounting-content">
   <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><Link href="/contabilidade">Contabilidade</Link><span>›</span><strong>Fecho mensal</strong></div>
   <div className="companies-title-row"><div><p className="eyebrow">CONTROLO DE ENCERRAMENTO</p><h1>Fecho mensal</h1><p className="welcome-copy">Prepare a checklist de cada período, acompanhe os requisitos e encerre apenas quando os controlos obrigatórios forem satisfeitos.</p></div><button className="secondary-button" disabled={!entityId||loading} onClick={()=>void loadPeriods(entityId)}><RefreshCw size={15}/> Actualizar</button></div>
   {error&&<div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
   {notice&&<div className="notice" role="status"><span className="notice-icon"><CheckCircle2 size={19}/></span><div><strong>{notice}</strong><p>O estado do fecho foi actualizado.</p></div></div>}
   <section className="panel task-toolbar"><div className="form-field task-company-field"><label htmlFor="closeCompany">Empresa</label><select id="closeCompany" value={entityId} onChange={e=>{setEntityId(e.target.value);setSelected(null);}}><option value="">Seleccione uma empresa</option>{companies.map(c=><option key={c.id} value={c.id}>{c.legalName}</option>)}</select></div></section>
   <div className="close-layout">
    <section className="panel close-period-panel"><div className="panel-heading"><div><p className="eyebrow">PERÍODOS CONTABILÍSTICOS</p><h2>Seleccionar período</h2></div></div>
     {loading?<div className="empty-state"><RefreshCw size={22}/><strong>A carregar períodos...</strong></div>:periods.length===0?<div className="empty-state"><CalendarCheck size={24}/><strong>Sem períodos configurados</strong><p>Prepare primeiro o exercício e os períodos na área de contabilidade.</p><Link href="/contabilidade" className="secondary-button">Abrir contabilidade</Link></div>:<div className="close-period-list">{periods.map(period=><button key={period.periodId} className={"close-period-option"+(selected?.periodId===period.periodId?" selected":"")} onClick={()=>{setSelected(period);setNotice("");setError("");}}><span className="close-period-icon"><CalendarCheck size={17}/></span><span className="close-period-copy"><strong>{period.periodLabel}</strong><small>{dateLabel(period.startsOn)} – {dateLabel(period.endsOn)}</small></span><span className={"task-status-pill "+(period.closeStatus??period.periodStatus)}>{statusLabel(period.closeStatus??period.periodStatus)}</span></button>)}</div>}
    </section>
    <section className="panel close-checklist-panel">
     {!selected?<div className="empty-state close-empty"><span className="empty-icon"><ClipboardCheck size={25}/></span><strong>Seleccione um período</strong><p>Abra um período para consultar ou preparar a respectiva checklist de fecho.</p></div>:<>
      <div className="panel-heading"><div><p className="eyebrow">CHECKLIST DE ENCERRAMENTO</p><h2>{selected.periodLabel}</h2><p className="close-subtitle">{selected.closeId?"Checklist de controlo mensal":"Ainda não existe uma checklist para este período."}</p></div></div>
      {!selected.closeId?<div className="empty-state"><button className="primary-button" disabled={busy||selected.periodStatus!=="open"} onClick={()=>void prepare(selected)}><ClipboardCheck size={16}/>{busy?"A preparar...":"Preparar checklist"}</button></div>:<>
       <div className="close-progress"><div className="close-progress-label"><span>Progresso da checklist</span><strong>{items.length?Math.round(completed/items.length*100):0}%</strong></div><div className="close-progress-track"><span style={{width:(items.length?completed/items.length*100:0)+"%"}}/></div><small>{completed} de {items.length} itens concluídos · {requiredPending} requisitos obrigatórios pendentes</small></div>
       <div className="close-checklist">{items.map(item=><article key={item.id} className={"close-check-item "+(item.status==="completed"?"done":"")}><span className="close-check-symbol">{item.status==="completed"?<CheckCircle2 size={18}/>:<ClipboardCheck size={18}/>}</span><div className="close-check-copy"><strong>{item.title}{item.isRequired&&<span className="required-mark">Obrigatório</span>}</strong><p>{item.description}</p></div><select aria-label={"Estado: "+item.title} value={item.status} disabled={selected.closeStatus==="closed"} onChange={e=>void changeItem(item,e.target.value as Item["status"])}><option value="pending">Pendente</option><option value="completed">Concluído</option>{!item.isRequired&&<option value="not_applicable">Não aplicável</option>}</select></article>)}</div>
       {selected.closeStatus!=="closed"&&selected.periodStatus==="open"?<div className="close-finalize"><div className="close-warning"><ShieldCheck size={18}/><span>O encerramento bloqueia novos lançamentos no período. Confirme os documentos e saldos antes de continuar.</span></div><button className="primary-button" disabled={busy||requiredPending>0} onClick={()=>void finalize()}>{busy?"A verificar...":"Validar e encerrar período"}</button></div>:<div className="close-locked"><CheckCircle2 size={18}/> Este período encontra-se encerrado.</div>}
      </>}
     </>}
    </section>
   </div>
   <p className="companies-footnote">A checklist é um controlo operacional. A sua conclusão não substitui a revisão profissional nem a confirmação das obrigações legais aplicáveis à empresa.</p>
  </section>
 </main>;
}
