"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink, FileCheck2, Plus, RefreshCw, ShieldCheck } from "lucide-react";

type TaxRule = {
  id: string;
  ruleKey: string;
  version: number;
  taxType: string;
  title: string;
  description: string | null;
  calculationMethod: string;
  parameters: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo: string | null;
  legalReference: string;
  sourceUrl: string;
  sourceVerifiedOn: string | null;
  status: "draft" | "in_review" | "approved" | "active" | "retired";
  createdBy: string;
  reviewedBy: string | null;
  approvedBy: string | null;
};

const statusLabels: Record<TaxRule["status"], string> = {
  draft: "Rascunho",
  in_review: "Em revisão",
  approved: "Aprovada",
  active: "Activa",
  retired: "Retirada",
};
const taxTypes = ["IVA", "IRPS", "IRPC", "ISPC", "INSS", "IRRM", "OTHER"];
const methods = [
  { value: "manual", label: "Apuramento manual" },
  { value: "percentage_of_base", label: "Percentagem sobre a base" },
  { value: "fixed_amount", label: "Valor fixo" },
  { value: "progressive_brackets", label: "Escalões progressivos" },
];
const today = () => new Date().toISOString().slice(0, 10);

export default function TaxRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [role, setRole] = useState("");
  const [canManageRules, setCanManageRules] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [reviewRuleId, setReviewRuleId] = useState("");
  const [sourceVerifiedOn, setSourceVerifiedOn] = useState(today());
  const [reviewNotes, setReviewNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [ruleKey, setRuleKey] = useState("");
  const [taxType, setTaxType] = useState("IVA");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [calculationMethod, setCalculationMethod] = useState("manual");
  const [parameters, setParameters] = useState("{}");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [legalReference, setLegalReference] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourcePublishedOn, setSourcePublishedOn] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const meResponse = await fetch("/api/auth/me");
      if (meResponse.status === 401) {
        router.replace("/login");
        return;
      }
      const me = await meResponse.json();
      if (!meResponse.ok) throw new Error(me.error ?? "Não foi possível validar a sessão.");
      setRole(me.user?.role ?? "");
      const response = await fetch("/api/tax/rules");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar as regras fiscais.");
      setRules(data.rules ?? []);
      setCanManageRules(Boolean(data.permissions?.canManage));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar o registo fiscal.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let parsedParameters: unknown;
      try { parsedParameters = JSON.parse(parameters); }
      catch { throw new Error("Os parâmetros devem conter JSON válido."); }

      const response = await fetch("/api/tax/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleKey, taxType, title, description, calculationMethod, parameters: parsedParameters,
          effectiveFrom, effectiveTo: effectiveTo || null, legalReference, sourceUrl, sourcePublishedOn: sourcePublishedOn || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível criar a regra.");
      setNotice("Rascunho criado. Esta versão não será usada em cálculos até passar pela revisão e activação.");
      setShowCreate(false);
      setRuleKey(""); setTitle(""); setDescription(""); setLegalReference(""); setSourceUrl("");
      setParameters("{}"); setEffectiveTo(""); setSourcePublishedOn("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar a regra fiscal.");
    } finally {
      setSaving(false);
    }
  }

  async function transition(rule: TaxRule, action: "submit_review" | "approve" | "activate" | "retire") {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = { action };
      if (action === "approve") {
        body.sourceVerifiedOn = sourceVerifiedOn;
        body.reviewNotes = reviewNotes;
      }
      const response = await fetch("/api/tax/rules/" + encodeURIComponent(rule.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível actualizar o estado da regra.");
      setNotice("Versão " + rule.ruleKey + " v" + rule.version + ": " + statusLabels[data.rule.status as TaxRule["status"]] + ".");
      setReviewRuleId("");
      setReviewNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no workflow de revisão.");
    } finally {
      setSaving(false);
    }
  }

  const canReview = canManageRules && (role === "superadmin" || role === "tax_officer");
  const canActivate = canManageRules && role === "superadmin";

  return <main className="companies-shell">
    <header className="companies-topbar">
      <Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <Link className="secondary-button" href="/fiscalidade"><ArrowLeft size={15}/> Fiscalidade</Link>
    </header>
    <section className="companies-content">
      <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><Link href="/fiscalidade">Fiscalidade</Link><span>›</span><strong>Regras fiscais</strong></div>
      <div className="companies-title-row">
        <div><p className="eyebrow">REGISTO NORMATIVO E VERSIONAMENTO</p><h1>Regras fiscais</h1><p className="welcome-copy">Registe a fonte legal, a vigência e o método de cálculo. Nenhuma taxa é pré-carregada ou activada automaticamente.</p></div>
        {canManageRules && <button className="primary-button" onClick={() => setShowCreate(v => !v)}><Plus size={16}/>{showCreate ? "Fechar formulário" : "Nova versão"}</button>}
      </div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={17}/>{error}</div>}
      {notice && <div className="notice"><CheckCircle2 size={18}/>{notice}</div>}
      {!loading && !canManageRules && <div className="notice"><div className="notice-icon"><ShieldCheck size={20}/></div><div><strong>Registo global em modo de consulta</strong><p>Gerir, rever ou activar regras exige autorização explícita de administração da plataforma. A função de superadministrador de uma empresa, por si só, não concede esse acesso.</p></div><span className="notice-tag">Consulta</span></div>}
      <div className="notice"><div className="notice-icon"><ShieldCheck size={20}/></div><div><strong>Controlo de utilização</strong><p>Uma regra só pode ser usada numa simulação após validação da fonte, revisão por outra pessoa, aprovação e activação. A simulação não cria lançamentos nem declarações fiscais.</p></div><span className="notice-tag">Sem taxas por defeito</span></div>

      {showCreate && canManageRules && <form className="company-form panel" onSubmit={createRule}>
        <div className="panel-heading"><div><p className="eyebrow">NOVA VERSÃO EM RASCUNHO</p><h2>Dados da regra</h2></div></div>
        <div className="company-form-grid">
          <div className="form-field"><label htmlFor="ruleKey">Chave estável *</label><input id="ruleKey" required minLength={3} maxLength={80} pattern="[a-z][a-z0-9._-]{2,79}" value={ruleKey} onChange={e=>setRuleKey(e.target.value.toLowerCase())} placeholder="ex.: iva.regime-geral"/></div>
          <div className="form-field"><label htmlFor="taxType">Imposto *</label><select id="taxType" value={taxType} onChange={e=>setTaxType(e.target.value)}>{taxTypes.map(t=><option key={t} value={t}>{t==="OTHER"?"Outro":t}</option>)}</select></div>
          <div className="form-field wide"><label htmlFor="ruleTitle">Título da regra *</label><input id="ruleTitle" required minLength={3} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Título que identifica o tratamento normativo"/></div>
          <div className="form-field wide"><label htmlFor="ruleDescription">Descrição</label><textarea id="ruleDescription" rows={2} maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Âmbito e notas de interpretação, sem substituir a referência legal."/></div>
          <div className="form-field"><label htmlFor="method">Método de cálculo *</label><select id="method" value={calculationMethod} onChange={e=>setCalculationMethod(e.target.value)}>{methods.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
          <div className="form-field"><label htmlFor="parameters">Parâmetros JSON *</label><textarea id="parameters" required rows={4} value={parameters} onChange={e=>setParameters(e.target.value)} placeholder={'Manual: {}\nPercentagem: {"ratePercent": 16, "roundingScale": 2}\nEscalões: {"brackets":[{"upTo":100,"ratePercent":10},{"upTo":null,"ratePercent":20}]}'} /></div>
          <div className="form-field"><label htmlFor="effectiveFrom">Vigência desde *</label><input id="effectiveFrom" required type="date" value={effectiveFrom} onChange={e=>setEffectiveFrom(e.target.value)}/></div>
          <div className="form-field"><label htmlFor="effectiveTo">Vigência até</label><input id="effectiveTo" type="date" value={effectiveTo} onChange={e=>setEffectiveTo(e.target.value)}/></div>
          <div className="form-field wide"><label htmlFor="legalReference">Referência normativa *</label><input id="legalReference" required minLength={6} maxLength={300} value={legalReference} onChange={e=>setLegalReference(e.target.value)} placeholder="Diploma, artigo, número e data"/></div>
          <div className="form-field wide"><label htmlFor="sourceUrl">URL HTTPS da fonte *</label><input id="sourceUrl" required type="url" pattern="https://.*" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://..."/></div>
          <div className="form-field"><label htmlFor="sourcePublishedOn">Data de publicação da fonte</label><input id="sourcePublishedOn" type="date" value={sourcePublishedOn} onChange={e=>setSourcePublishedOn(e.target.value)}/></div>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={()=>setShowCreate(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving?"A guardar…":"Guardar rascunho"}</button></div>
      </form>}

      {reviewRuleId && <section className="panel company-form">
        <div className="panel-heading"><div><p className="eyebrow">APROVAÇÃO INDEPENDENTE</p><h2>Registar validação da fonte</h2></div></div>
        <div className="company-form-grid">
          <div className="form-field"><label htmlFor="sourceVerifiedOn">Data de verificação *</label><input id="sourceVerifiedOn" type="date" max={today()} required value={sourceVerifiedOn} onChange={e=>setSourceVerifiedOn(e.target.value)}/></div>
          <div className="form-field"><label htmlFor="reviewNotes">Notas de revisão (mín. 30 caracteres) *</label><textarea id="reviewNotes" rows={3} minLength={30} maxLength={3000} required value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} placeholder="Indique fonte consultada, artigos conferidos, vigência e casos de referência."/></div>
        </div>
        <div className="form-actions"><button className="secondary-button" onClick={()=>setReviewRuleId("")}>Cancelar</button><button className="primary-button" disabled={saving || reviewNotes.trim().length<30} onClick={()=>{const selected=rules.find(r=>r.id===reviewRuleId);if(selected)void transition(selected,"approve");}}>Confirmar aprovação</button></div>
      </section>}

      <section className="panel company-table-panel">
        <div className="company-table-toolbar"><div><h2>Versões registadas</h2><p>Histórico por chave, versão, fonte e estado de workflow.</p></div><div className="table-actions"><span className="muted-count">{rules.length} versões</span><button className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Actualizar</button></div></div>
        {loading ? <p className="empty-state">A carregar registo fiscal…</p> : rules.length === 0 ? <p className="empty-state">Ainda não existem regras. Crie um rascunho com a respectiva referência normativa; não introduza taxas sem verificação da fonte oficial.</p> :
        <div className="table-wrap"><table><thead><tr><th>Regra / versão</th><th>Imposto e método</th><th>Vigência</th><th>Estado</th><th>Fonte normativa</th><th>Workflow</th></tr></thead><tbody>
          {rules.map(rule=><tr key={rule.id}>
            <td><strong>{rule.title}</strong><small>{rule.ruleKey} · v{rule.version}</small></td>
            <td>{rule.taxType}<small>{methods.find(m=>m.value===rule.calculationMethod)?.label ?? rule.calculationMethod}</small></td>
            <td>{rule.effectiveFrom?.slice(0,10)}<small>{rule.effectiveTo ? "até "+rule.effectiveTo.slice(0,10) : "sem data final"}</small></td>
            <td><span className={"state-badge " + (rule.status === "active" ? "in-progress" : "")}>{statusLabels[rule.status]}</span></td>
            <td><a href={rule.sourceUrl} target="_blank" rel="noreferrer" className="footer-link">{rule.legalReference.slice(0,38)} <ExternalLink size={13}/></a><small>{rule.sourceVerifiedOn ? "Fonte verificada em "+rule.sourceVerifiedOn.slice(0,10) : "Ainda não verificada"}</small></td>
            <td><div className="table-actions">
              {canReview && rule.status === "draft" && <button className="secondary-button" disabled={saving} onClick={()=>void transition(rule,"submit_review")}>Submeter</button>}
              {canReview && rule.status === "in_review" && <button className="secondary-button" disabled={saving} onClick={()=>{setReviewRuleId(rule.id);setReviewNotes("");setSourceVerifiedOn(today());}}>Rever</button>}
              {canActivate && rule.status === "approved" && <button className="primary-button" disabled={saving} onClick={()=>void transition(rule,"activate")}>Activar</button>}
              {canActivate && rule.status === "active" && <button className="secondary-button" disabled={saving} onClick={()=>void transition(rule,"retire")}>Retirar</button>}
              {!((canReview && (rule.status==="draft"||rule.status==="in_review"))||(canActivate&&(rule.status==="approved"||rule.status==="active"))) && <span className="muted-count">Sem acção</span>}
            </div></td>
          </tr>)}
        </tbody></table></div>}
      </section>
      <p className="companies-footnote"><FileCheck2 size={13} style={{display:"inline",verticalAlign:"middle",marginRight:5}}/> A activação não certifica automaticamente a conformidade fiscal. Antes de usar regras reais, valide a fonte oficial, a vigência e os resultados com um profissional qualificado.</p>
    </section>
  </main>;
}
