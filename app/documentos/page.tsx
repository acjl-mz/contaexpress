"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileText, FolderOpen, LogOut, RefreshCw, ShieldCheck, UploadCloud, CircleAlert, CheckCircle2 } from "lucide-react";

type Company = { id: string; legalName: string; taxNumber: string | null; currency: string };
type DocumentRecord = { id: string; filename: string; mimeType: string; fileSizeBytes: number; sha256: string; journalEntryId: string | null; entryNumber: number | null; description: string | null; createdAt: string; uploadedBy: string };

const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(2)} MB`;
const dateLabel = (value: string) => new Date(value).toLocaleString("pt-MZ", { dateStyle: "medium", timeStyle: "short" });

export default function DocumentsPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [entityId, setEntityId] = useState("");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [entryId, setEntryId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  const loadDocuments = useCallback(async (id: string) => {
    if (!id) { setDocuments([]); return; }
    const response = await fetch(`/api/accounting/documents?entityId=${encodeURIComponent(id)}`);
    if (response.status === 401) { router.replace("/login"); return; }
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os documentos.");
    setDocuments(json.documents ?? []);
  }, [router]);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);
  useEffect(() => { void loadDocuments(entityId).catch(err => setError(err instanceof Error ? err.message : "Erro ao carregar documentos.")); }, [entityId, loadDocuments]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entityId || !file) { setError("Seleccione a empresa e o ficheiro a arquivar."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData();
      form.set("entityId", entityId);
      form.set("file", file);
      if (entryId.trim()) form.set("journalEntryId", entryId.trim());
      if (description.trim()) form.set("description", description.trim());
      const response = await fetch("/api/accounting/documents", { method: "POST", body: form });
      const json = await response.json();
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok) throw new Error(json.error ?? "Não foi possível arquivar o documento.");
      setNotice("Documento arquivado com sucesso.");
      setFile(null); setEntryId(""); setDescription("");
      const input = document.getElementById("documentFile") as HTMLInputElement | null;
      if (input) input.value = "";
      await loadDocuments(entityId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao arquivar documento."); }
    finally { setBusy(false); }
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }

  return <main className="companies-shell">
    <header className="companies-topbar">
      <Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <div className="companies-user"><Link href="/contabilidade" className="secondary-button"><ArrowLeft size={14}/> Contabilidade</Link><button className="icon-button" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={17}/></button></div>
    </header>
    <section className="companies-content accounting-content">
      <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><Link href="/contabilidade">Contabilidade</Link><span>›</span><strong>Documentos</strong></div>
      <div className="companies-title-row"><div><p className="eyebrow">ARQUIVO DOCUMENTAL</p><h1>Documentos contabilísticos</h1><p className="welcome-copy">Arquive comprovativos e associe-os aos lançamentos para facilitar a consulta e a revisão contabilística.</p></div><button className="secondary-button" onClick={()=>void loadDocuments(entityId).catch(err=>setError(err instanceof Error?err.message:"Erro ao actualizar."))} disabled={!entityId || busy}><RefreshCw size={15}/> Actualizar</button></div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
      {notice && <div className="notice" role="status"><span className="notice-icon"><CheckCircle2 size={19}/></span><div><strong>{notice}</strong><p>O documento está disponível no arquivo da empresa seleccionada.</p></div></div>}
      <div className="accounting-document-layout">
        <section className="panel accounting-document-upload">
          <div className="panel-heading"><div><p className="eyebrow">NOVO ARQUIVO</p><h2>Adicionar documento</h2></div><span className="metric-icon"><UploadCloud size={19}/></span></div>
          <form onSubmit={uploadDocument} className="document-upload-form">
            <div className="form-field"><label htmlFor="documentEntity">Empresa *</label><select id="documentEntity" value={entityId} onChange={e=>setEntityId(e.target.value)} disabled={loading || !companies.length} required><option value="">Seleccione uma empresa</option>{companies.map(company=><option key={company.id} value={company.id}>{company.legalName}</option>)}</select></div>
            <div className="form-field"><label htmlFor="documentFile">Ficheiro *</label><input id="documentFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.docx,application/pdf,image/jpeg,image/png,text/csv" onChange={e=>setFile(e.target.files?.[0] ?? null)} required/><small>PDF, JPG, PNG, CSV, XLSX ou DOCX. Máximo de 8 MB.</small></div>
            <div className="form-field"><label htmlFor="documentEntry">ID do lançamento (opcional)</label><input id="documentEntry" value={entryId} onChange={e=>setEntryId(e.target.value)} placeholder="Cole o ID do lançamento contabilístico"/><small>O lançamento tem de pertencer à empresa seleccionada.</small></div>
            <div className="form-field"><label htmlFor="documentDescription">Observações (opcional)</label><textarea id="documentDescription" value={description} onChange={e=>setDescription(e.target.value)} rows={3} maxLength={500} placeholder="Ex.: factura do fornecedor, recibo ou comprovativo bancário."/></div>
            <button className="primary-button" type="submit" disabled={busy || !entityId || !file}><UploadCloud size={16}/>{busy ? "A arquivar..." : "Arquivar documento"}</button>
          </form>
          <div className="document-security-note"><ShieldCheck size={17}/><span>O acesso exige sessão válida e autorização para a empresa. Os ficheiros são privados e não têm links públicos.</span></div>
        </section>
        <section className="panel accounting-document-list">
          <div className="panel-heading"><div><p className="eyebrow">ARQUIVO DA EMPRESA</p><h2>Documentos guardados</h2></div><span className="muted-count">{documents.length} ficheiros</span></div>
          {!entityId && !loading ? <div className="empty-state"><span className="empty-icon"><FolderOpen size={23}/></span><strong>Sem empresa seleccionada</strong><p>Registe ou seleccione uma empresa para consultar o arquivo.</p></div>
          : documents.length === 0 ? <div className="empty-state"><span className="empty-icon"><FolderOpen size={23}/></span><strong>Nenhum documento arquivado</strong><p>Os documentos adicionados para esta empresa aparecerão aqui.</p></div>
          : <div className="document-list">{documents.map(item=><article className="document-row" key={item.id}><span className="document-file-icon"><FileText size={20}/></span><div className="document-info"><strong title={item.filename}>{item.filename}</strong><span>{sizeLabel(item.fileSizeBytes)} · {item.mimeType}</span>{item.description && <p>{item.description}</p>}<small>{dateLabel(item.createdAt)} · {item.uploadedBy || "Utilizador"}</small>{item.entryNumber !== null && <small>Lançamento n.º {item.entryNumber}</small>}</div><a className="icon-button document-download" href={`/api/accounting/documents/${encodeURIComponent(item.id)}?entityId=${encodeURIComponent(entityId)}`} aria-label={`Descarregar ${item.filename}`} title="Descarregar"><Download size={16}/></a></article>)}</div>}
          <div className="panel-footer"><span>São apresentados até 250 documentos mais recentes.</span><span className="footer-link"><ShieldCheck size={14}/> Acesso controlado</span></div>
        </section>
      </div>
      <p className="companies-footnote">O arquivo guarda metadados, conteúdo e hash SHA-256 para apoiar a rastreabilidade. A associação documental não substitui a validação do documento fiscal original.</p>
    </section>
  </main>;
}
