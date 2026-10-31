"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowLeft, Building2, CheckCircle2, CircleAlert, CirclePause, Globe2, LogOut, Plus, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";

type Organisation = { id:string; legalName:string; displayName:string; status:string; createdAt:string; companyCount:number; userCount:number };
type Admin = { id:string; fullName:string; email:string; grantedAt:string };
type Metrics = { organisationCount:number; activeCount:number; suspendedCount:number };

const emptyForm = { legalName:"", displayName:"", companyName:"", taxNumber:"", countryCode:"MZ", currency:"MZN", adminName:"", adminEmail:"", password:"" };

export default function PlatformAdminPage() {
  const router = useRouter();
  const [organisations,setOrganisations] = useState<Organisation[]>([]);
  const [admins,setAdmins] = useState<Admin[]>([]);
  const [metrics,setMetrics] = useState<Metrics>({organisationCount:0,activeCount:0,suspendedCount:0});
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [success,setSuccess] = useState("");
  const [query,setQuery] = useState("");
  const [showForm,setShowForm] = useState(false);
  const [form,setForm] = useState(emptyForm);
  const [busyId,setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/platform-admin/organisations",{cache:"no-store"});
      if(response.status===401){router.replace("/login");return;}
      if(response.status===403){router.replace("/");return;}
      const data = await response.json();
      if(!response.ok) throw new Error(data.error ?? "Não foi possível carregar a administração.");
      setOrganisations(data.organisations ?? []); setAdmins(data.administrators ?? []); setMetrics(data.metrics ?? {organisationCount:0,activeCount:0,suspendedCount:0});
    } catch(e){setError(e instanceof Error?e.message:"Ocorreu um erro.");}
    finally{setLoading(false);}
  },[router]);
  useEffect(()=>{void load();},[load]);

  async function createOrganisation(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError("");setSuccess("");
    try{
      const response=await fetch("/api/platform-admin/organisations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"Não foi possível criar a organização.");
      setSuccess(`Organização criada. A empresa ${data.company.legalName} e o acesso de ${data.administrator.email} já estão preparados.`);
      setForm(emptyForm);setShowForm(false);await load();
    }catch(e){setError(e instanceof Error?e.message:"Ocorreu um erro.");}
    finally{setSaving(false);}
  }

  async function changeStatus(org:Organisation){
    const next=org.status==="active"?"suspended":"active";
    if(!window.confirm(`${next==="suspended"?"Suspender":"Reactivar"} a organização “${org.displayName}”? ${next==="suspended"?"Os utilizadores deixarão de conseguir iniciar sessão nesta organização.":""}`))return;
    setBusyId(org.id);setError("");setSuccess("");
    try{
      const response=await fetch(`/api/platform-admin/organisations/${org.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:next})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Não foi possível actualizar.");
      setSuccess(`Estado de “${org.displayName}” actualizado para ${next==="active"?"activa":"suspensa"}.`);await load();
    }catch(e){setError(e instanceof Error?e.message:"Ocorreu um erro.");}
    finally{setBusyId("");}
  }

  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");router.refresh();}
  const filtered=useMemo(()=>organisations.filter(o=>`${o.legalName} ${o.displayName}`.toLowerCase().includes(query.toLowerCase())),[organisations,query]);

  return <main className="platform-admin-shell">
    <aside className="platform-admin-sidebar">
      <Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <div className="platform-admin-label">ADMINISTRAÇÃO CENTRAL</div>
      <div className="platform-admin-nav"><span className="platform-admin-nav-item active"><ShieldCheck size={17}/> Visão geral</span><a className="platform-admin-nav-item" href="#organisations"><Building2 size={17}/> Organizações</a><a className="platform-admin-nav-item" href="#administrators"><Users size={17}/> Administradores</a></div>
      <div className="platform-admin-side-bottom"><span className="platform-admin-secure"><ShieldCheck size={15}/> Acesso privilegiado</span><button onClick={logout}><LogOut size={16}/> Terminar sessão</button><small>ContaExpress · Administração da plataforma</small></div>
    </aside>
    <section className="platform-admin-main">
      <header className="platform-admin-topbar"><div><span>ContaExpress</span><span className="crumb-divider">/</span><strong>Super Admin</strong></div><Link href="/" className="platform-admin-back"><ArrowLeft size={15}/> Área de trabalho</Link></header>
      <div className="platform-admin-content">
        <div className="platform-admin-heading"><div><p className="eyebrow">CENTRO DE CONTROLO DA PLATAFORMA</p><h1>Super Admin</h1><p className="welcome-copy">Administre organizações, empresas e os primeiros acessos dos clientes do ContaExpress.</p></div><button className="primary-button" onClick={()=>{setShowForm(v=>!v);setError("");setSuccess("");}}><Plus size={17}/>{showForm?"Fechar formulário":"Adicionar empresa"}</button></div>
        {error&&<div className="platform-admin-alert error"><CircleAlert size={17}/>{error}</div>}
        {success&&<div className="platform-admin-alert success"><CheckCircle2 size={17}/>{success}</div>}
        <section className="platform-admin-metrics">
          <article><span className="platform-metric-icon"><Globe2 size={19}/></span><div><small>Organizações registadas</small><strong>{metrics.organisationCount}</strong><em>Total na plataforma</em></div></article>
          <article><span className="platform-metric-icon active"><CheckCircle2 size={19}/></span><div><small>Organizações activas</small><strong>{metrics.activeCount}</strong><em>Com acesso permitido</em></div></article>
          <article><span className="platform-metric-icon paused"><CirclePause size={19}/></span><div><small>Organizações suspensas</small><strong>{metrics.suspendedCount}</strong><em>Temporariamente bloqueadas</em></div></article>
          <article><span className="platform-metric-icon"><Users size={19}/></span><div><small>Administradores centrais</small><strong>{admins.length}</strong><em>Contas com privilégio global</em></div></article>
        </section>

        {showForm&&<form className="platform-admin-form panel" onSubmit={createOrganisation}>
          <div className="panel-heading"><div><p className="eyebrow">NOVA CONTA EMPRESARIAL</p><h2>Registar organização e primeiro acesso</h2></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)} aria-label="Fechar"><X size={17}/></button></div>
          <p className="platform-form-intro">Será criada uma organização independente, a primeira empresa contabilística e uma conta de gestor da organização.</p>
          <div className="platform-form-section"><strong>01 · Organização</strong><div className="platform-form-grid">
            <label>Denominação legal *<input required minLength={2} maxLength={180} value={form.legalName} onChange={e=>setForm({...form,legalName:e.target.value,displayName:form.displayName||e.target.value,companyName:form.companyName||e.target.value})} placeholder="Ex.: Empresa, Limitada"/></label>
            <label>Nome de apresentação<input maxLength={180} value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="Nome comercial"/></label>
          </div></div>
          <div className="platform-form-section"><strong>02 · Primeira empresa contabilística</strong><div className="platform-form-grid">
            <label>Nome da empresa *<input required minLength={2} maxLength={180} value={form.companyName} onChange={e=>setForm({...form,companyName:e.target.value})} placeholder="Entidade a gerir"/></label>
            <label>NUIT<input maxLength={80} value={form.taxNumber} onChange={e=>setForm({...form,taxNumber:e.target.value})} placeholder="Número de identificação tributária"/></label>
            <label>País<select value={form.countryCode} onChange={e=>setForm({...form,countryCode:e.target.value})}><option value="MZ">Moçambique</option><option value="ZA">África do Sul</option><option value="PT">Portugal</option></select></label>
            <label>Moeda funcional<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}><option value="MZN">MZN — Metical</option><option value="ZAR">ZAR — Rand</option><option value="USD">USD — Dólar</option><option value="EUR">EUR — Euro</option></select></label>
          </div></div>
          <div className="platform-form-section"><strong>03 · Administrador da organização</strong><div className="platform-form-grid">
            <label>Nome completo *<input required minLength={2} maxLength={180} value={form.adminName} onChange={e=>setForm({...form,adminName:e.target.value})} placeholder="Responsável da conta"/></label>
            <label>E-mail de acesso *<input required type="email" maxLength={254} value={form.adminEmail} onChange={e=>setForm({...form,adminEmail:e.target.value})} placeholder="admin@empresa.co.mz"/></label>
            <label className="platform-field-wide">Palavra-passe inicial *<input required type="password" minLength={14} maxLength={200} autoComplete="new-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Mínimo de 14 caracteres"/><small>Entregue esta palavra-passe ao responsável por um canal seguro. Recomende a alteração no primeiro acesso.</small></label>
          </div></div>
          <div className="platform-form-actions"><span><ShieldCheck size={15}/> A conta será isolada das restantes organizações.</span><button className="primary-button" type="submit" disabled={saving}>{saving?"A criar conta...":"Criar organização e acesso"} <Plus size={16}/></button></div>
        </form>}

        <section className="panel platform-org-panel" id="organisations">
          <div className="platform-table-heading"><div><p className="eyebrow">GESTÃO DE CLIENTES</p><h2>Organizações e empresas</h2><p>Contas empresariais registadas na plataforma.</p></div><div className="platform-table-actions"><div className="search-field"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar organização..." aria-label="Pesquisar organizações"/></div><button className="icon-button" onClick={()=>void load()} title="Actualizar" aria-label="Actualizar"><RefreshCw size={16}/></button></div></div>
          {loading?<div className="empty-state"><RefreshCw className="spin" size={22}/>A carregar organizações...</div>:filtered.length?<div className="platform-table-scroll"><table className="platform-org-table"><thead><tr><th>ORGANIZAÇÃO</th><th>EMPRESAS</th><th>UTILIZADORES</th><th>REGISTO</th><th>ESTADO</th><th>ACÇÕES</th></tr></thead><tbody>{filtered.map(org=><tr key={org.id}><td><strong>{org.displayName}</strong><small>{org.legalName}</small></td><td>{org.companyCount}</td><td>{org.userCount}</td><td>{new Date(org.createdAt).toLocaleDateString("pt-MZ")}</td><td><span className={`platform-status ${org.status}`}><i/>{org.status==="active"?"Activa":org.status==="suspended"?"Suspensa":"Arquivada"}</span></td><td>{org.status!=="archived"&&<button className="platform-action" disabled={busyId===org.id} onClick={()=>void changeStatus(org)}>{busyId===org.id?"A actualizar...":org.status==="active"?"Suspender":"Reactivar"}</button>}</td></tr>)}</tbody></table></div>:<div className="empty-state"><Building2 size={25}/><strong>{query?"Nenhuma organização encontrada":"Ainda não existem organizações de clientes"}</strong><p>{query?"Altere a pesquisa.":"Adicione a primeira empresa para começar a testar os módulos."}</p></div>}
          <div className="platform-panel-foot"><span><Activity size={14}/> Os dados são carregados directamente da base de dados.</span><span>{filtered.length} de {organisations.length} organizações</span></div>
        </section>

        <section className="panel platform-admin-list" id="administrators"><div className="platform-table-heading"><div><p className="eyebrow">SEGURANÇA GLOBAL</p><h2>Administradores da plataforma</h2><p>Utilizadores com concessão explícita na tabela de administradores centrais.</p></div></div><div className="platform-admin-users">{admins.map(a=><div key={a.id}><span className="platform-admin-avatar"><ShieldCheck size={17}/></span><span><strong>{a.fullName}</strong><small>{a.email}</small></span><em>Super Admin</em></div>)}{!admins.length&&<p className="empty-state">Nenhum administrador central encontrado.</p>}</div></section>
        <footer className="page-footer"><span>ContaExpress · Administração central</span><span>Controlo de acesso privilegiado e isolamento multiempresa</span></footer>
      </div>
    </section>
  </main>;
}
