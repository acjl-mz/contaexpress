"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileBarChart2, RefreshCw, LogOut, CircleAlert, Scale, Printer, FileDown } from "lucide-react";

type Company = { id: string; legalName: string; currency?: string };
type Account = { id: string; code: string; name: string; accountType: string };
type ReportData = {
 report: string; from?: string|null; to?: string|null; asOf?: string|null;
 accounts?: Array<Record<string, string|number>>;
 journalLines?: Array<Record<string,string|number|null>>;
 lines?: Array<Record<string,string|number|null>>;
 account?: {code:string;name:string;accountType:string};
 totals?: Record<string,number>;
 openingBalance?: number; accumulatedResult?: number;
};
const labels:Record<string,string>={"trial-balance":"Balancete de verificação","balance-sheet":"Balanço","income-statement":"Demonstração de resultados",journal:"Diário geral",ledger:"Razão por conta"};
const typeLabels:Record<string,string>={asset:"Activo",liability:"Passivo",equity:"Capital próprio",income:"Rendimentos",expense:"Gastos",memo:"Controlo"};
const money=(v:unknown)=>new Intl.NumberFormat("pt-MZ",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const dateText=(v:unknown)=>v?new Date(String(v).slice(0,10)+"T12:00:00").toLocaleDateString("pt-MZ"):"—";
function csvCell(value:unknown){const s=String(value??"");return '"'+s.replace(/"/g,'""')+'"';}

export default function ReportsPage(){
 const router=useRouter();
 const [companies,setCompanies]=useState<Company[]>([]);
 const [entityId,setEntityId]=useState("");
 const [report,setReport]=useState("trial-balance");
 const [from,setFrom]=useState(new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10));
 const [to,setTo]=useState(new Date().toISOString().slice(0,10));
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [accountId,setAccountId]=useState("");
 const [data,setData]=useState<ReportData|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const company=companies.find(c=>c.id===entityId);
 const loadCompanies=useCallback(async()=>{
  try{const r=await fetch("/api/companies");if(r.status===401){router.replace("/login");return;}const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível carregar empresas.");setCompanies(d.companies??[]);setEntityId(v=>v||d.companies?.[0]?.id||"");}
  catch(e){setError(e instanceof Error?e.message:"Erro ao carregar empresas.");}finally{setLoading(false);}
 },[router]);
 useEffect(()=>{void loadCompanies();},[loadCompanies]);
 useEffect(()=>{if(!entityId){setAccounts([]);return;}void (async()=>{try{const r=await fetch("/api/accounting/accounts?entityId="+encodeURIComponent(entityId));const d=await r.json();if(r.ok){setAccounts(d.accounts??[]);setAccountId(v=>d.accounts?.some((a:Account)=>a.id===v)?v:d.accounts?.[0]?.id??"");}}catch{setError("Não foi possível carregar o plano de contas.");}})();},[entityId]);
 const loadReport=useCallback(async()=>{
  if(!entityId)return;
  setBusy(true);setError("");setNotice("");
  try{const p=new URLSearchParams({entityId,report});if(from)p.set("from",from);if(to)p.set("to",to);if(report==="ledger"&&accountId)p.set("accountId",accountId);
   const r=await fetch("/api/accounting/reports?"+p.toString());if(r.status===401){router.replace("/login");return;}const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível gerar o relatório.");setData(d);setNotice("Relatório actualizado.");}
  catch(e){setError(e instanceof Error?e.message:"Erro ao gerar relatório.");setData(null);}finally{setBusy(false);}
 },[entityId,report,from,to,accountId,router]);
 useEffect(()=>{if(entityId&&!(report==="ledger"&&!accountId))void loadReport();},[entityId,report,accountId,loadReport]);
 const rows=useMemo(()=>data?.accounts??data?.journalLines??data?.lines??[],[data]);
 function exportPdf(){
  if(!data||!entityId)return;
  const p=new URLSearchParams({entityId,report});if(from)p.set("from",from);if(to)p.set("to",to);if(report==="ledger"&&accountId)p.set("accountId",accountId);
  const a=document.createElement("a");a.href="/api/accounting/reports/pdf?"+p.toString();a.download=(report+"-"+(to||"periodo")+".pdf");document.body.appendChild(a);a.click();a.remove();
 }
 function exportCsv(){
  if(!data)return;
  const fields=rows.length?Object.keys(rows[0]):Object.keys(data.totals??{});
  const csv=[fields.map(csvCell).join(","),...rows.map(row=>fields.map(k=>csvCell(row[k])).join(","))].join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=(report+"-"+(to||"periodo")+".csv");a.click();URL.revokeObjectURL(url);
 }
 async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");router.refresh();}
 return <main className="companies-shell">
  <header className="companies-topbar"><Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link><div className="companies-user"><Link href="/contabilidade" className="secondary-button"><ArrowLeft size={14}/> Contabilidade</Link><button className="icon-button" onClick={logout} aria-label="Terminar sessão"><LogOut size={17}/></button></div></header>
  <section className="companies-content accounting-content">
   <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><strong>Relatórios financeiros</strong></div>
   <div className="companies-title-row"><div><p className="eyebrow">INFORMAÇÃO PARA DECISÃO</p><h1>Relatórios financeiros</h1><p className="welcome-copy">Consulte o balancete, balanço, demonstração de resultados, diário e razão a partir dos lançamentos confirmados.</p></div><button className="secondary-button" onClick={()=>void loadReport()} disabled={busy||!entityId}><RefreshCw size={15}/> Actualizar</button></div>
   {loading&&<div className="panel report-loading" role="status"><RefreshCw size={18} className="report-loading-icon"/> A carregar empresas e permissões…</div>}
   {error&&<div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
   {notice&&<div className="notice" role="status"><span className="notice-icon"><FileBarChart2 size={19}/></span><div><strong>{notice}</strong><p>Os dados apresentados correspondem aos filtros seleccionados.</p></div></div>}
   <section className="panel report-filters">
    <div className="form-field"><label htmlFor="reportCompany">Empresa</label><select id="reportCompany" value={entityId} onChange={e=>setEntityId(e.target.value)}><option value="">Seleccione uma empresa</option>{companies.map(c=><option key={c.id} value={c.id}>{c.legalName}</option>)}</select></div>
    <div className="form-field"><label htmlFor="reportType">Relatório</label><select id="reportType" value={report} onChange={e=>setReport(e.target.value)}>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
    <div className="form-field"><label htmlFor="reportFrom">{report==="balance-sheet"?"Posição à data — início (opcional)":"Data inicial"}</label><input id="reportFrom" type="date" value={from} onChange={e=>setFrom(e.target.value)} disabled={report==="balance-sheet"}/></div>
    <div className="form-field"><label htmlFor="reportTo">{report==="balance-sheet"?"Posição até":"Data final"}</label><input id="reportTo" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
    {report==="ledger"&&<div className="form-field report-account-field"><label htmlFor="reportAccount">Conta</label><select id="reportAccount" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Seleccione uma conta</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></div>}
    <div className="report-filter-actions"><button className="primary-button" disabled={busy||!entityId||(report==="ledger"&&!accountId)} onClick={()=>void loadReport()}>{busy?<RefreshCw size={15}/>:<FileBarChart2 size={15}/>} Gerar relatório</button></div>
   </section>
   {data&&<section className="panel report-results">
    <div className="report-heading"><div><p className="eyebrow">{company?.legalName??"EMPRESA"}</p><h2>{labels[report]}</h2><p>{report==="balance-sheet"?"Posição financeira até "+dateText(data.asOf):dateText(data.from??from)+" — "+dateText(data.to??to)}</p></div><div className="report-export-actions"><button className="secondary-button" onClick={()=>window.print()}><Printer size={15}/> Imprimir / Guardar PDF</button><button className="secondary-button" onClick={exportCsv}><Download size={15}/> Exportar CSV</button><button className="secondary-button" onClick={exportPdf} disabled={!data||busy}><FileDown size={15}/> Exportar PDF</button></div></div>
    {data.totals&&<div className="report-metrics">
     {report==="balance-sheet"?<><Metric label="Total do activo" value={data.totals.assets}/><Metric label="Total do passivo" value={data.totals.liabilities}/><Metric label="Capital próprio" value={data.totals.equity}/><Metric label="Resultado acumulado" value={data.totals.accumulatedResult}/><Metric label="Diferença de balanço" value={data.totals.difference}/></>:
      report==="income-statement"?<><Metric label="Rendimentos" value={data.totals.income}/><Metric label="Gastos" value={data.totals.expenses}/><Metric label="Resultado líquido" value={data.totals.netResult}/></>:
      <><Metric label="Total de débitos" value={data.totals.debit}/><Metric label="Total de créditos" value={data.totals.credit}/>{data.totals.debitBalance!==undefined&&<Metric label="Saldo devedor" value={data.totals.debitBalance} />}{data.totals.creditBalance!==undefined&&<Metric label="Saldo credor" value={data.totals.creditBalance}/>}</>}
    </div>}
    {report==="balance-sheet"&&<div className={"report-balance-check "+(Math.abs(data.totals?.difference??0)<0.01?"balanced":"unbalanced")}><Scale size={17}/>{Math.abs(data.totals?.difference??0)<0.01?"Balanço equilibrado com os dados contabilísticos disponíveis.":"O balanço apresenta uma diferença. Verifique o plano de contas e os lançamentos."}</div>}
    {rows.length===0?<div className="empty-state"><FileBarChart2 size={25}/><strong>Sem movimentos para apresentar</strong><p>Experimente outro intervalo ou confirme se existem lançamentos contabilísticos.</p></div>:<div className="report-table-wrap"><table className="report-table"><thead><tr>{report==="balance-sheet"||report==="trial-balance"?<><th>Código</th><th>Conta</th><th>Tipo</th>{report==="balance-sheet"?<th className="numeric">Saldo</th>:<><th className="numeric">Débitos</th><th className="numeric">Créditos</th><th className="numeric">Saldo devedor</th><th className="numeric">Saldo credor</th></>}</>:report==="income-statement"?<><th>Código</th><th>Conta</th><th>Tipo</th><th className="numeric">Valor</th></>:report==="ledger"?<><th>Data</th><th>N.º</th><th>Descrição</th><th className="numeric">Débito</th><th className="numeric">Crédito</th><th className="numeric">Saldo</th></>:<><th>Data</th><th>Diário</th><th>N.º</th><th>Conta</th><th>Descrição</th><th className="numeric">Débito</th><th className="numeric">Crédito</th></>}</tr></thead><tbody>{rows.map((row,i)=><tr key={String(row.accountId??(row.entryId ? String(row.entryId)+":"+String(row.lineNumber??i) : i))}>{report==="balance-sheet"||report==="trial-balance"?<><td>{row.code}</td><td>{row.name}</td><td>{typeLabels[String(row.accountType)]??row.accountType}</td>{report==="balance-sheet"?<td className="numeric">{money(row.balance)}</td>:<><td className="numeric">{money(row.debit)}</td><td className="numeric">{money(row.credit)}</td><td className="numeric">{money(row.debitBalance)}</td><td className="numeric">{money(row.creditBalance)}</td></>}</>:report==="income-statement"?<><td>{row.code}</td><td>{row.name}</td><td>{typeLabels[String(row.accountType)]??row.accountType}</td><td className="numeric">{money(row.amount)}</td></>:report==="ledger"?<><td>{dateText(row.entryDate)}</td><td>{row.entryNumber??"—"}</td><td>{row.description??row.entryDescription??"—"}</td><td className="numeric">{money(row.debit)}</td><td className="numeric">{money(row.credit)}</td><td className="numeric">{money(row.runningBalance)}</td></>:<><td>{dateText(row.entryDate)}</td><td>{row.journalCode??"—"}</td><td>{row.entryNumber??"—"}</td><td>{row.accountCode} — {row.accountName}</td><td>{row.lineDescription??row.entryDescription??"—"}</td><td className="numeric">{money(row.debit)}</td><td className="numeric">{money(row.credit)}</td></>}</tr>)}</tbody></table></div>}
    <p className="companies-footnote">Relatório gerado a partir dos lançamentos confirmados. A classificação e a apresentação final devem ser revistas pelo responsável contabilístico antes de uso externo ou submissão oficial.</p>
   </section>}
  </section>
 </main>;
}
function Metric({label,value}:{label:string;value:number|undefined}){return <div className="report-metric"><span>{label}</span><strong>{money(value)}</strong><small>MZN</small></div>}
