"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, FileBarChart2, RefreshCw, CircleAlert, LogOut } from "lucide-react";

type Company = { id: string; legalName: string; taxNumber: string | null; currency: string };
type Account = { id: string; code: string; name: string; accountType: string };
type TrialRow = { accountId: string; code: string; name: string; accountType: string; debit: number; credit: number; debitBalance: number; creditBalance: number };
type LedgerRow = { entryId: string; entryNumber: number | null; entryDate: string; entryDescription: string; sourceReference: string | null; journalCode: string; lineNumber: number; description: string; debit: number; credit: number; runningBalance: number };
type JournalLine = { entryId: string; entryNumber: number | null; entryDate: string; entryDescription: string; sourceReference: string | null; status: string; reversesEntryId: string | null; journalCode: string; journalName: string; lineNumber: number; lineDescription: string | null; accountCode: string; accountName: string; debit: number; credit: number };
type ReportData = { report: string; accounts?: TrialRow[]; lines?: LedgerRow[]; journalLines?: JournalLine[]; openingBalance?: number; totals?: Record<string, number>; account?: Account; error?: string };

const fmt = (n: number | string | undefined) => new Intl.NumberFormat("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const dateFmt = (value: string) => new Date(value).toLocaleDateString("pt-MZ");
const types: Record<string, string> = { asset: "Activo", liability: "Passivo", equity: "Capital próprio", income: "Rendimento", expense: "Gasto", memo: "Controlo" };
const statuses: Record<string, string> = { posted: "Confirmado", reversed: "Estornado" };

export default function AccountingReportsPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entityId, setEntityId] = useState("");
  const [reportType, setReportType] = useState("trial-balance");
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/companies");
      if (response.status === 401) { router.replace("/login"); return; }
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar empresas.");
      setCompanies(json.companies ?? []);
      setEntityId(current => current || json.companies?.[0]?.id || "");
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao carregar empresas."); }
    finally { setLoading(false); }
  }, [router]);

  const loadAccounts = useCallback(async (id: string) => {
    if (!id) { setAccounts([]); setAccountId(""); return; }
    const response = await fetch(`/api/accounting/accounts?entityId=${encodeURIComponent(id)}`);
    if (response.status === 401) { router.replace("/login"); return; }
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar o plano de contas.");
    setAccounts(json.accounts ?? []);
    setAccountId(current => json.accounts?.some((account: Account) => account.id === current) ? current : json.accounts?.[0]?.id ?? "");
  }, [router]);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);
  useEffect(() => { void loadAccounts(entityId).catch(err => setError(err instanceof Error ? err.message : "Erro ao carregar contas.")); }, [entityId, loadAccounts]);

  async function generate() {
    if (!entityId) return;
    if (reportType === "ledger" && !accountId) { setError("Seleccione uma conta para consultar o razão."); return; }
    setBusy(true); setError(""); setData(null);
    try {
      const params = new URLSearchParams({ entityId, report: reportType });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (reportType === "ledger") params.set("accountId", accountId);
      const response = await fetch(`/api/accounting/reports?${params.toString()}`);
      const json = await response.json();
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok) throw new Error(json.error ?? "Não foi possível gerar o relatório.");
      setData(json);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao gerar relatório."); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    if (!data) return;
    let rows: (string | number)[][];
    if (reportType === "ledger") {
      rows = [["Data", "N.º", "Diário", "Descrição", "Referência", "Débito", "Crédito", "Saldo acumulado"],
        ...(data.lines ?? []).map(row => [dateFmt(row.entryDate), row.entryNumber ?? "", row.journalCode, row.description, row.sourceReference ?? "", row.debit, row.credit, row.runningBalance])];
    } else if (reportType === "journal") {
      rows = [["Data", "N.º", "Estado", "Diário", "Conta", "Descrição do lançamento", "Descrição da linha", "Referência", "Débito", "Crédito"],
        ...(data.journalLines ?? []).map(row => [dateFmt(row.entryDate), row.entryNumber ?? "", statuses[row.status] ?? row.status, row.journalCode, `${row.accountCode} — ${row.accountName}`, row.entryDescription, row.lineDescription ?? "", row.sourceReference ?? "", row.debit, row.credit])];
    } else {
      rows = [["Código", "Conta", "Tipo", "Débito", "Crédito", "Saldo devedor", "Saldo credor"],
        ...(data.accounts ?? []).map(row => [row.code, row.name, types[row.accountType] ?? row.accountType, row.debit, row.credit, row.debitBalance, row.creditBalance])];
    }
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportType === "ledger" ? "razao-contabil.csv" : reportType === "journal" ? "diario-geral.csv" : "balancete-verificacao.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
  const reportTitle = reportType === "ledger" ? "Razão por conta" : reportType === "journal" ? "Diário geral" : "Balancete de verificação";

  return <main className="companies-shell">
    <header className="companies-topbar">
      <Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <div className="companies-user"><Link href="/contabilidade" className="secondary-button"><ArrowLeft size={14}/> Contabilidade</Link><button className="icon-button" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={17}/></button></div>
    </header>
    <section className="companies-content accounting-content">
      <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><Link href="/contabilidade">Contabilidade</Link><span>›</span><strong>Relatórios</strong></div>
      <div className="companies-title-row"><div><p className="eyebrow">ANÁLISE CONTABILÍSTICA</p><h1>Relatórios</h1><p className="welcome-copy">Consulte o diário geral, movimentos por conta e saldos contabilísticos.</p></div><button className="secondary-button" onClick={()=>void generate()} disabled={!entityId || busy}><RefreshCw size={15}/> Actualizar</button></div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
      <section className="panel accounting-report-filters">
        <div className="company-form-grid">
          <div className="form-field"><label htmlFor="reportEntity">Empresa *</label><select id="reportEntity" value={entityId} onChange={e=>{setEntityId(e.target.value);setData(null);}} disabled={loading || !companies.length}><option value="">Seleccione uma empresa</option>{companies.map(c=><option key={c.id} value={c.id}>{c.legalName}</option>)}</select></div>
          <div className="form-field"><label htmlFor="reportType">Relatório *</label><select id="reportType" value={reportType} onChange={e=>{setReportType(e.target.value);setData(null);}}><option value="trial-balance">Balancete de verificação</option><option value="ledger">Razão por conta</option><option value="journal">Diário geral detalhado</option></select></div>
          <div className="form-field"><label htmlFor="reportFrom">Data inicial</label><input id="reportFrom" type="date" value={from} max={to || undefined} onChange={e=>{setFrom(e.target.value);setData(null);}}/></div>
          <div className="form-field"><label htmlFor="reportTo">Data final</label><input id="reportTo" type="date" value={to} min={from || undefined} onChange={e=>{setTo(e.target.value);setData(null);}}/></div>
          {reportType === "ledger" && <div className="form-field wide"><label htmlFor="reportAccount">Conta *</label><select id="reportAccount" value={accountId} onChange={e=>{setAccountId(e.target.value);setData(null);}}><option value="">Seleccione uma conta</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></div>}
        </div>
        <div className="form-actions"><button className="primary-button" onClick={()=>void generate()} disabled={!entityId || busy || (reportType==="ledger" && !accountId)}><FileBarChart2 size={16}/>{busy ? "A gerar..." : "Gerar relatório"}</button></div>
      </section>
      {data && <section className="panel accounting-table-panel">
        <div className="company-table-toolbar"><div><h2>{reportTitle}</h2><p>{companies.find(c=>c.id===entityId)?.legalName}{from || to ? ` · ${from ? dateFmt(from) : "Início"} a ${to ? dateFmt(to) : "Hoje"}` : " · Todo o período disponível"}</p></div><button className="secondary-button" onClick={exportCsv}><Download size={15}/> Exportar CSV</button></div>
        <div className="company-table-scroll">
          {reportType === "trial-balance" ? <table className="company-table"><thead><tr><th>CÓDIGO</th><th>CONTA</th><th>TIPO</th><th>DÉBITO</th><th>CRÉDITO</th><th>SALDO DEVEDOR</th><th>SALDO CREDOR</th></tr></thead><tbody>{(data.accounts ?? []).map(row=><tr key={row.accountId}><td><strong>{row.code}</strong></td><td>{row.name}</td><td>{types[row.accountType] ?? row.accountType}</td><td>{fmt(row.debit)}</td><td>{fmt(row.credit)}</td><td>{fmt(row.debitBalance)}</td><td>{fmt(row.creditBalance)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>TOTAL</th><th>{fmt(data.totals?.debit)}</th><th>{fmt(data.totals?.credit)}</th><th>{fmt(data.totals?.debitBalance)}</th><th>{fmt(data.totals?.creditBalance)}</th></tr></tfoot></table>
          : reportType === "ledger" ? <><p className="accounting-form-note">Saldo de abertura: {fmt(data.openingBalance)} MZN. Os movimentos apresentados incluem lançamentos confirmados e estornos formais.</p><table className="company-table"><thead><tr><th>DATA / N.º</th><th>DIÁRIO</th><th>DESCRIÇÃO</th><th>DÉBITO</th><th>CRÉDITO</th><th>SALDO ACUMULADO</th></tr></thead><tbody>{(data.lines ?? []).map((row,i)=><tr key={row.entryId + "-" + row.lineNumber + "-" + i}><td><strong>{dateFmt(row.entryDate)}</strong><small className="table-subline">{row.entryNumber ? `N.º ${row.entryNumber}` : "—"}</small></td><td>{row.journalCode}</td><td>{row.description}{row.sourceReference && <small className="table-subline">{row.sourceReference}</small>}</td><td>{fmt(row.debit)}</td><td>{fmt(row.credit)}</td><td>{fmt(row.runningBalance)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>TOTAL DO PERÍODO</th><th>{fmt(data.totals?.debit)}</th><th>{fmt(data.totals?.credit)}</th><th>{fmt(data.totals?.closingBalance)}</th></tr></tfoot></table></>
          : <table className="company-table"><thead><tr><th>DATA / N.º</th><th>ESTADO</th><th>DIÁRIO</th><th>CONTA</th><th>DESCRIÇÃO</th><th>DÉBITO</th><th>CRÉDITO</th></tr></thead><tbody>{(data.journalLines ?? []).map((row,i)=><tr key={row.entryId + "-" + row.lineNumber + "-" + i}><td><strong>{dateFmt(row.entryDate)}</strong><small className="table-subline">{row.entryNumber ? `N.º ${row.entryNumber}` : "—"}</small></td><td>{statuses[row.status] ?? row.status}{row.reversesEntryId && <small className="table-subline">Estorno vinculado</small>}</td><td>{row.journalCode}</td><td><strong>{row.accountCode}</strong><small className="table-subline">{row.accountName}</small></td><td>{row.entryDescription}{row.lineDescription && <small className="table-subline">{row.lineDescription}</small>}{row.sourceReference && <small className="table-subline">{row.sourceReference}</small>}</td><td>{fmt(row.debit)}</td><td>{fmt(row.credit)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>TOTAL</th><th>{fmt(data.totals?.debit)}</th><th>{fmt(data.totals?.credit)}</th></tr></tfoot></table>}
        </div>
        {reportType==="trial-balance" && <p className="accounting-form-note">O balancete inclui movimentos confirmados e estornos formais. Verifique o equilíbrio dos totais antes de utilizar o relatório para fecho ou declaração.</p>}
        {reportType==="ledger" && !(data.lines?.length) && <div className="empty-state compact-empty"><span className="empty-icon"><FileBarChart2 size={22}/></span><strong>Sem movimentos no intervalo</strong><p>Esta conta não tem movimentos confirmados nas datas seleccionadas.</p></div>}
        {reportType==="journal" && !(data.journalLines?.length) && <div className="empty-state compact-empty"><span className="empty-icon"><FileBarChart2 size={22}/></span><strong>Sem lançamentos no intervalo</strong><p>Não existem lançamentos confirmados nas datas seleccionadas.</p></div>}
      </section>}
      {!data && !loading && <section className="panel empty-state"><span className="empty-icon"><FileBarChart2 size={25}/></span><strong>Pronto para gerar relatórios</strong><p>Escolha a empresa, o tipo de relatório e, se necessário, o intervalo de datas.</p></section>}
      <p className="companies-footnote">Os relatórios são auxiliares de análise. A sua utilização para fecho contabilístico ou cumprimento fiscal depende da validação dos dados e do referencial aplicável.</p>
    </section>
  </main>;
}
