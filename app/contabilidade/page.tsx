"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, CircleAlert, RefreshCw, Settings2, Plus, Send, FileText, Building2, LogOut, RotateCcw } from "lucide-react";

type Company = { id: string; legalName: string; taxNumber: string | null; currency: string; status: string };
type Account = { id: string; code: string; name: string; accountType: string; parentAccountId: string | null; isPostable: boolean; isActive: boolean };
type Period = { id: string; label: string; startsOn: string; endsOn: string; status: string; fiscalYear: string };
type Journal = { id: string; code: string; name: string };
type Entry = { id: string; entryNumber: number | null; entryDate: string; description: string; status: string; sourceReference: string | null; journalCode: string; journalName: string; periodLabel: string; debit: string; credit: string };

const typeLabels: Record<string, string> = { asset: "Activo", liability: "Passivo", equity: "Capital próprio", income: "Rendimento", expense: "Gasto", memo: "Controlo" };
const money = (value: string | number) => new Intl.NumberFormat("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

export default function AccountingPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [entityId, setEntityId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [journalId, setJournalId] = useState("");
  const [debitAccount, setDebitAccount] = useState("");
  const [creditAccount, setCreditAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [sourceReference, setSourceReference] = useState("");

  const loadCompanies = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/companies");
      if (response.status === 401) { router.replace("/login"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar empresas.");
      setCompanies(data.companies ?? []);
      setEntityId(current => current || data.companies?.[0]?.id || "");
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao carregar empresas."); }
    finally { setLoading(false); }
  }, [router]);

  const loadAccounting = useCallback(async (id: string) => {
    if (!id) { setAccounts([]); setPeriods([]); setJournals([]); setEntries([]); return; }
    setError("");
    try {
      const responses = await Promise.all([
        fetch(`/api/accounting/accounts?entityId=${encodeURIComponent(id)}`),
        fetch(`/api/accounting/config?entityId=${encodeURIComponent(id)}`),
        fetch(`/api/accounting/entries?entityId=${encodeURIComponent(id)}`),
      ]);
      if (responses.some(response => response.status === 401)) { router.replace("/login"); return; }
      const [accountData, configData, entryData] = await Promise.all(responses.map(response => response.json()));
      const failed = [accountData, configData, entryData].find(data => data.error);
      if (failed) throw new Error(failed.error);
      setAccounts(accountData.accounts ?? []);
      setPeriods(configData.periods ?? []);
      setJournals(configData.journals ?? []);
      setEntries(entryData.entries ?? []);
      setPeriodId(current => current || configData.periods?.find((p: Period) => p.status === "open")?.id || "");
      setJournalId(current => current || configData.journals?.[0]?.id || "");
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível carregar a contabilidade."); }
  }, [router]);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);
  useEffect(() => { if (entityId) void loadAccounting(entityId); }, [entityId, loadAccounting]);

  async function initialise() {
    if (!entityId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/accounting/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, year: new Date().getFullYear() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível preparar a contabilidade.");
      setNotice(`Exercício ${data.fiscalYear.label} preparado com ${data.periods.length} períodos e ${data.accountsCreatedOrConfirmed} contas.`);
      setPeriodId(data.periods.find((p: Period) => p.status === "open")?.id ?? "");
      await loadAccounting(entityId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao inicializar."); }
    finally { setBusy(false); }
  }

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entityId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/accounting/entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId, periodId, journalId, entryDate, description, sourceReference,
          lines: [
            { accountId: debitAccount, debit: amount, credit: 0, description },
            { accountId: creditAccount, debit: 0, credit: amount, description },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível guardar o lançamento.");
      setNotice("Lançamento guardado em rascunho. Confirme-o depois de rever os dados.");
      setShowEntryForm(false); setDescription(""); setAmount(""); setSourceReference("");
      await loadAccounting(entityId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao criar lançamento."); }
    finally { setBusy(false); }
  }

  async function postEntry(id: string) {
    if (!entityId || !window.confirm("Confirmar este lançamento? Após a confirmação, as linhas deixam de poder ser editadas.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/accounting/entries/${id}/post?entityId=${encodeURIComponent(entityId)}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível confirmar o lançamento.");
      setNotice(`Lançamento ${data.entry.entryNumber} confirmado.`);
      await loadAccounting(entityId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao confirmar lançamento."); }
    finally { setBusy(false); }
  }

  async function reverseEntry(id: string, entryNumber: number | null) {
    if (!entityId) return;
    if (!window.confirm(`Vai criar um lançamento inverso para ${entryNumber ? `o lançamento n.º ${entryNumber}` : "este lançamento"}. O original será preservado e marcado como estornado. Continuar?`)) return;
    const now = new Date();
    const defaultDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const reversalDate = window.prompt("Data do estorno (AAAA-MM-DD), num período aberto:", defaultDate);
    if (!reversalDate) return;
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(reversalDate)) { setError("A data deve estar no formato AAAA-MM-DD."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/accounting/entries/${id}/reverse?entityId=${encodeURIComponent(entityId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reversalDate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível estornar o lançamento.");
      setNotice(`Estorno criado e confirmado com o número ${data.reversal.entryNumber}.`);
      await loadAccounting(entityId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao estornar lançamento."); }
    finally { setBusy(false); }
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }

  const activeAccounts = accounts.filter(account => account.isActive && account.isPostable);
  const hasSetup = periods.length > 0 && journals.length > 0 && accounts.length > 0;
  const openPeriods = periods.filter(period => period.status === "open");

  return <main className="companies-shell">
    <header className="companies-topbar">
      <Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <div className="companies-user"><Link href="/tarefas" className="secondary-button"><CalendarClock size={14}/> Tarefas</Link><Link href="/documentos" className="secondary-button"><FileText size={14}/> Documentos</Link><Link href="/empresas" className="secondary-button"><ArrowLeft size={14} /> Empresas</Link><button className="icon-button" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={17}/></button></div>
    </header>
    <section className="companies-content accounting-content">
      <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><strong>Contabilidade</strong></div>
      <div className="companies-title-row"><div><p className="eyebrow">NÚCLEO CONTABILÍSTICO</p><h1>Contabilidade</h1><p className="welcome-copy">Configure o exercício, consulte contas e registe lançamentos contabilísticos.</p></div><div className="accounting-header-actions"><a href="/contabilidade/relatorios" className="secondary-button"><FileText size={15}/> Relatórios</a><button className="secondary-button" onClick={() => entityId && void loadAccounting(entityId)} disabled={!entityId || busy}><RefreshCw size={15}/> Actualizar</button></div></div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
      {notice && <div className="inline-success" role="status"><CheckCircle2 size={18}/>{notice}</div>}
      <section className="panel accounting-company-panel">
        <div className="accounting-company-select"><label htmlFor="entitySelect">Empresa seleccionada</label><select id="entitySelect" value={entityId} onChange={e=>{setEntityId(e.target.value);setPeriodId("");setJournalId("");}} disabled={loading || !companies.length}><option value="">Seleccione uma empresa</option>{companies.map(company=><option key={company.id} value={company.id}>{company.legalName}</option>)}</select></div>
        <div className="accounting-company-meta"><span><Building2 size={16}/>{companies.find(company=>company.id===entityId)?.taxNumber || "NUIT não indicado"}</span><span><Settings2 size={16}/>{companies.find(company=>company.id===entityId)?.currency || "MZN"}</span></div>
        {entityId && !hasSetup && <button className="primary-button" onClick={initialise} disabled={busy}><Settings2 size={16}/>{busy ? "A preparar..." : "Preparar exercício e plano de contas"}</button>}
      </section>

      {!loading && !companies.length && <section className="panel empty-state"><span className="empty-icon"><Building2 size={25}/></span><strong>Não existem empresas acessíveis</strong><p>Registe uma empresa ou peça ao administrador que lhe atribua acesso.</p><a className="primary-button" href="/empresas">Abrir gestão de empresas</a></section>}

      {entityId && hasSetup && <>
        <div className="accounting-stats">
          <article className="metric-card"><div className="metric-top"><span>Contas no plano</span><span className="metric-icon"><BookOpen size={18}/></span></div><div className="metric-value">{accounts.length}</div><div className="metric-note">Contas configuradas para a empresa</div></article>
          <article className="metric-card"><div className="metric-top"><span>Lançamentos</span><span className="metric-icon"><FileText size={18}/></span></div><div className="metric-value">{entries.length}</div><div className="metric-note">Últimos 200 movimentos</div></article>
          <article className="metric-card"><div className="metric-top"><span>Rascunhos</span><span className="metric-icon"><Settings2 size={18}/></span></div><div className="metric-value">{entries.filter(entry=>entry.status==="draft").length}</div><div className="metric-note">Aguardam confirmação</div></article>
        </div>

        <section className="panel accounting-table-panel">
          <div className="company-table-toolbar"><div><h2>Plano de contas</h2><p>Modelo inicial de referência; confirme a adequação ao referencial aplicável à empresa.</p></div><span className="muted-count">{accounts.length} contas</span></div>
          <div className="company-table-scroll"><table className="company-table"><thead><tr><th>CÓDIGO</th><th>DESIGNAÇÃO</th><th>TIPO</th><th>MOVIMENTAÇÃO</th></tr></thead><tbody>{accounts.map(account=><tr key={account.id}><td><strong>{account.code}</strong></td><td>{account.name}</td><td>{typeLabels[account.accountType] ?? account.accountType}</td><td><span className={account.isPostable ? "company-status" : "state-badge"}>{account.isPostable ? "Permitida" : "Conta agregadora"}</span></td></tr>)}</tbody></table></div>
        </section>

        <section className="panel accounting-table-panel">
          <div className="company-table-toolbar"><div><h2>Diário geral</h2><p>Registos em rascunho e lançamentos confirmados.</p></div><button className="primary-button" onClick={()=>setShowEntryForm(value=>!value)} disabled={busy || !openPeriods.length || !journals.length || !activeAccounts.length}><Plus size={16}/>{showEntryForm ? "Fechar formulário" : "Novo lançamento"}</button></div>
          {showEntryForm && <form className="company-form" onSubmit={createEntry}>
            <div className="company-form-grid">
              <div className="form-field"><label htmlFor="entryDate">Data do lançamento *</label><input id="entryDate" type="date" value={entryDate} onChange={e=>setEntryDate(e.target.value)} required/></div>
              <div className="form-field"><label htmlFor="periodId">Período aberto *</label><select id="periodId" value={periodId} onChange={e=>setPeriodId(e.target.value)} required>{openPeriods.map(period=><option key={period.id} value={period.id}>{period.label}</option>)}</select></div>
              <div className="form-field"><label htmlFor="journalId">Diário *</label><select id="journalId" value={journalId} onChange={e=>setJournalId(e.target.value)} required>{journals.map(journal=><option key={journal.id} value={journal.id}>{journal.code} — {journal.name}</option>)}</select></div>
              <div className="form-field"><label htmlFor="sourceReference">Referência documental</label><input id="sourceReference" value={sourceReference} onChange={e=>setSourceReference(e.target.value)} maxLength={120} placeholder="Ex.: FT 001/2026"/></div>
              <div className="form-field wide"><label htmlFor="description">Descrição do lançamento *</label><input id="description" value={description} onChange={e=>setDescription(e.target.value)} required minLength={2} maxLength={500} placeholder="Descreva a operação contabilística"/></div>
              <div className="form-field"><label htmlFor="debitAccount">Conta a debitar *</label><select id="debitAccount" value={debitAccount} onChange={e=>setDebitAccount(e.target.value)} required><option value="">Seleccione a conta</option>{activeAccounts.map(account=><option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></div>
              <div className="form-field"><label htmlFor="creditAccount">Conta a creditar *</label><select id="creditAccount" value={creditAccount} onChange={e=>setCreditAccount(e.target.value)} required><option value="">Seleccione a conta</option>{activeAccounts.map(account=><option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></div>
              <div className="form-field"><label htmlFor="amount">Valor (MZN) *</label><input id="amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></div>
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={()=>setShowEntryForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy || !periodId || !journalId || !debitAccount || !creditAccount || debitAccount===creditAccount}>{busy ? "A guardar..." : "Guardar rascunho"}</button></div>
            <p className="accounting-form-note">O formulário cria um lançamento simples com duas linhas de igual valor. A confirmação definitiva só é permitida quando o período está aberto, as contas são movimentáveis e os débitos igualam os créditos.</p>
          </form>}
          <div className="company-table-scroll"><table className="company-table"><thead><tr><th>DATA / N.º</th><th>DESCRIÇÃO</th><th>DIÁRIO / PERÍODO</th><th>DÉBITO</th><th>CRÉDITO</th><th>ESTADO</th><th>ACÇÃO</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td><strong>{new Date(entry.entryDate).toLocaleDateString("pt-MZ")}</strong><small className="table-subline">{entry.entryNumber ? `N.º ${entry.entryNumber}` : "Sem número"}</small></td><td>{entry.description}{entry.sourceReference && <small className="table-subline">{entry.sourceReference}</small>}</td><td>{entry.journalCode}<small className="table-subline">{entry.periodLabel}</small></td><td>{money(entry.debit)}</td><td>{money(entry.credit)}</td><td><span className={entry.status==="posted" ? "company-status" : "state-badge"}>{entry.status==="posted" ? "Confirmado" : entry.status==="reversed" ? "Estornado" : "Rascunho"}</span></td><td>{entry.status==="draft" ? <button className="table-action-button" disabled={busy} onClick={()=>void postEntry(entry.id)}><Send size={14}/> Confirmar</button> : entry.status==="posted" ? <button className="table-action-button" disabled={busy} onClick={()=>void reverseEntry(entry.id, entry.entryNumber)}><RotateCcw size={14}/> Estornar</button> : "—"}</td></tr>)}</tbody></table></div>
          {!entries.length && <div className="empty-state compact-empty"><span className="empty-icon"><FileText size={22}/></span><strong>Ainda não existem lançamentos</strong><p>Crie um rascunho para começar a registar operações.</p></div>}
        </section>
      </>}
      <p className="companies-footnote">Os relatórios iniciais estão disponíveis na área de relatórios. O plano de contas é uma base técnica e não substitui a validação do referencial contabilístico aplicável.</p>
    </section>
  </main>;
}
