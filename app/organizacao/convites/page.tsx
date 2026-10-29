"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, MailPlus, RefreshCw, ShieldCheck, Users } from "lucide-react";

type Invitation = { id:string; email:string; role:string; createdAt:string; expiresAt:string; acceptedAt:string|null; revokedAt:string|null };
const roles = [
  {value:"accountant",label:"Contabilista"},
  {value:"tax_officer",label:"Técnico fiscal"},
  {value:"payroll_officer",label:"Técnico de salários"},
  {value:"finance_manager",label:"Gestor financeiro"},
  {value:"client_director",label:"Direcção da empresa"},
  {value:"auditor",label:"Auditor"},
  {value:"client_manager",label:"Gestor da organização"},
];
const roleLabel=(role:string)=>roles.find(item=>item.value===role)?.label??role;
export default function InvitationsPage(){
 const [email,setEmail]=useState(""); const [role,setRole]=useState("accountant");
 const [items,setItems]=useState<Invitation[]>([]); const [loading,setLoading]=useState(true);
 const [sending,setSending]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
 async function load(){setLoading(true);setError("");try{const r=await fetch("/api/organisation-invitations");const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível carregar os convites.");setItems(d.invitations??[]);}catch(e){setError(e instanceof Error?e.message:"Erro ao carregar convites.");}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSending(true);setError("");setNotice("");try{const r=await fetch("/api/organisation-invitations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,role})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Não foi possível enviar o convite.");setNotice(d.message??"Convite enviado.");setEmail("");await load();}catch(e){setError(e instanceof Error?e.message:"Erro ao enviar convite.");}finally{setSending(false);}}
 return <main className="companies-shell">
  <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link><Link className="security-back" href="/"><ArrowLeft size={15}/> Voltar ao espaço de trabalho</Link></header>
  <section className="companies-content">
   <p className="eyebrow">ADMINISTRAÇÃO DA ORGANIZAÇÃO</p><h1>Convites de utilizadores</h1><p className="auth-subtitle">Convide membros para a organização com um perfil de acesso definido. Os convites expiram após 48 horas.</p>
   <div className="invitation-layout">
    <section className="notice invitation-panel"><div className="invitation-panel-heading"><span className="notice-icon"><MailPlus size={18}/></span><div><strong>Novo convite</strong><p>O utilizador receberá um link seguro para definir a sua palavra-passe.</p></div></div>
     <form className="auth-form" onSubmit={submit}><label htmlFor="invite-email">E-mail do convidado</label><input id="invite-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="nome@empresa.co.mz"/><label htmlFor="invite-role">Perfil de acesso</label><select id="invite-role" value={role} onChange={e=>setRole(e.target.value)}>{roles.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select><p className="security-help">Por segurança, o convite não pode conceder acesso de superadministrador nem associar contas existentes.</p><button className="primary-button auth-submit" disabled={sending}>{sending?"A enviar…":"Enviar convite"} <MailPlus size={16}/></button></form>
     {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="security-success" role="status"><ShieldCheck size={17}/>{notice}</p>}
    </section>
    <section className="invitation-list"><div className="invitation-list-heading"><div><h2>Histórico de convites</h2><p>Últimos 100 registos da organização</p></div><button className="icon-button" onClick={()=>void load()} aria-label="Actualizar convites"><RefreshCw size={17}/></button></div>
     {loading?<p className="auth-subtitle">A carregar…</p>:items.length===0?<div className="invitation-empty"><Users size={24}/><strong>Ainda não existem convites</strong><p>Os convites enviados aparecerão aqui.</p></div>:<div className="invitation-table">{items.map(item=><article className="invitation-item" key={item.id}><div className="invitation-person"><span className="invitation-avatar">{item.email.slice(0,1).toUpperCase()}</span><div><strong>{item.email}</strong><small>{roleLabel(item.role)}</small></div></div><div className="invitation-status">{item.acceptedAt?<span className="status-chip accepted">Aceite</span>:item.revokedAt?<span className="status-chip revoked">Revogado</span>:new Date(item.expiresAt)<new Date()?<span className="status-chip revoked">Expirado</span>:<span className="status-chip pending">Pendente</span>}<small>Expira: {new Date(item.expiresAt).toLocaleString("pt-MZ")}</small></div></article>)}</div>}
    </section>
   </div>
  </section>
 </main>;
}
