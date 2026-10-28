"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, CircleAlert, LogOut, Plus, RefreshCw, Search } from "lucide-react";

type Company = { id: string; legalName: string; taxNumber: string | null; countryCode: string; currency: string; status: string; createdAt: string };
type CurrentUser = { id: string; email: string; fullName: string; role: string };

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [countryCode, setCountryCode] = useState("MZ");
  const [currency, setCurrency] = useState("MZN");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [meResponse, companyResponse] = await Promise.all([fetch("/api/auth/me"), fetch("/api/companies")]);
      if (meResponse.status === 401 || companyResponse.status === 401) { router.replace("/login"); return; }
      const me = await meResponse.json();
      const data = await companyResponse.json();
      if (!companyResponse.ok) throw new Error(data.error ?? "Falha ao carregar empresas.");
      setUser(me.user);
      setCompanies(data.companies ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalName, taxNumber, countryCode, currency }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível registar a empresa.");
      setCompanies(current => [data.company, ...current]);
      setLegalName(""); setTaxNumber(""); setCountryCode("MZ"); setCurrency("MZN"); setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally { setSaving(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login"); router.refresh();
  }

  const filtered = companies.filter(c => `${c.legalName} ${c.taxNumber ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="companies-shell">
    <header className="companies-topbar">
      <a className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></a>
      <div className="companies-user"><span>{user?.fullName ?? "A carregar..."}</span><button className="icon-button" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={17}/></button></div>
    </header>
    <section className="companies-content">
      <div className="breadcrumb"><a href="/">Espaço de trabalho</a><ChevronRight size={15}/><strong>Empresas</strong></div>
      <div className="companies-title-row"><div><p className="eyebrow">CADASTRO E ORGANIZAÇÃO</p><h1>Empresas</h1><p className="welcome-copy">Gira as entidades contabilísticas associadas à sua organização.</p></div><button className="primary-button" onClick={()=>setShowForm(v=>!v)}><Plus size={17}/>{showForm ? "Cancelar" : "Registar empresa"}</button></div>

      {error && <div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}

      {showForm && <form className="company-form panel" onSubmit={createCompany}>
        <div className="panel-heading"><div><p className="eyebrow">NOVA ENTIDADE</p><h2>Dados da empresa</h2></div></div>
        <div className="company-form-grid">
          <div className="form-field wide"><label htmlFor="legalName">Denominação social *</label><input id="legalName" value={legalName} onChange={e=>setLegalName(e.target.value)} required minLength={2} maxLength={180} placeholder="Ex.: Empresa, Limitada"/></div>
          <div className="form-field"><label htmlFor="taxNumber">NUIT (opcional)</label><input id="taxNumber" value={taxNumber} onChange={e=>setTaxNumber(e.target.value)} maxLength={80} placeholder="Número de identificação fiscal"/></div>
          <div className="form-field"><label htmlFor="countryCode">País</label><select id="countryCode" value={countryCode} onChange={e=>setCountryCode(e.target.value)}><option value="MZ">Moçambique</option><option value="ZA">África do Sul</option><option value="PT">Portugal</option><option value="OTHER">Outro (definir código manualmente depois)</option></select></div>
          <div className="form-field"><label htmlFor="currency">Moeda funcional</label><select id="currency" value={currency} onChange={e=>setCurrency(e.target.value)}><option value="MZN">MZN — Metical</option><option value="ZAR">ZAR — Rand</option><option value="USD">USD — Dólar americano</option><option value="EUR">EUR — Euro</option></select></div>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={()=>setShowForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "A guardar..." : "Guardar empresa"}</button></div>
      </form>}

      <section className="panel company-table-panel">
        <div className="company-table-toolbar"><div><h2>Entidades registadas</h2><p>{companies.length} {companies.length===1 ? "empresa" : "empresas"} na organização</p></div><div className="table-actions"><div className="search-field"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar empresas..." aria-label="Pesquisar empresas"/></div><button className="icon-button" onClick={()=>void load()} aria-label="Actualizar lista" title="Actualizar"><RefreshCw size={16}/></button></div></div>
        {loading ? <div className="empty-state"><RefreshCw size={22} className="spin"/><strong>A carregar empresas...</strong></div> : filtered.length ? <div className="company-table-scroll"><table className="company-table"><thead><tr><th>EMPRESA</th><th>NUIT</th><th>PAÍS</th><th>MOEDA</th><th>ESTADO</th></tr></thead><tbody>{filtered.map(company=><tr key={company.id}><td><div className="company-name-cell"><span className="company-row-icon"><Building2 size={18}/></span><span><strong>{company.legalName}</strong><small>Registada em {new Date(company.createdAt).toLocaleDateString("pt-MZ")}</small></span></div></td><td>{company.taxNumber || "—"}</td><td>{company.countryCode}</td><td>{company.currency}</td><td><span className="company-status"><span/>{company.status === "active" ? "Activa" : company.status}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Building2 size={25}/></span><strong>{query ? "Nenhuma empresa encontrada" : "Ainda não existem empresas"}</strong><p>{query ? "Experimente outro termo de pesquisa." : "Registe a primeira entidade para começar a organizar a operação contabilística."}</p>{!query && <button className="primary-button" onClick={()=>setShowForm(true)}><Plus size={16}/> Registar primeira empresa</button>}</div>}
      </section>
      <p className="companies-footnote">Os dados são guardados na base de dados configurada para esta instalação. O acesso e as permissões são validados no servidor.</p>
    </section>
  </main>;
}
