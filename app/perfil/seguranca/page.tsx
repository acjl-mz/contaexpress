"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";

export default function AccountSecurityPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me").then(async response => {
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error("Não foi possível validar a sessão.");
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : "Não foi possível validar a sessão.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível alterar a palavra-passe.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(data.message ?? "Palavra-passe alterada.");
      if (data.reauthenticate) router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro ao alterar a palavra-passe.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card security-card">
      <Link className="brand auth-brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <Link className="security-back" href="/"><ArrowLeft size={15}/> Voltar ao espaço de trabalho</Link>
      <p className="eyebrow">SEGURANÇA DA CONTA</p>
      <h1>Alterar palavra-passe.</h1>
      <p className="auth-subtitle">Confirme a palavra-passe actual e defina uma nova credencial para proteger o acesso à conta.</p>

      <div className="notice security-notice">
        <div className="notice-icon"><ShieldCheck size={18}/></div>
        <div><strong>Protecção das sessões</strong><p>Após a alteração, as sessões antigas e os links de recuperação pendentes deixam de ser válidos. Este navegador continuará ligado.</p></div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="security-success" role="status"><CheckCircle2 size={17}/>{notice}</p>}
      {loading ? <p className="auth-subtitle">A validar sessão…</p> : <form className="auth-form" onSubmit={submit}>
        <label htmlFor="currentPassword">Palavra-passe actual</label>
        <div className="field-wrap"><LockKeyhole size={17}/><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={200} value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /></div>

        <label htmlFor="newPassword">Nova palavra-passe</label>
        <div className="field-wrap"><LockKeyhole size={17}/><input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={200} value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></div>
        <p className="security-help">Use entre 14 e 200 caracteres. Evite palavras-passe reutilizadas.</p>

        <label htmlFor="confirmPassword">Confirmar nova palavra-passe</label>
        <div className="field-wrap"><LockKeyhole size={17}/><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={14} maxLength={200} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} /></div>

        <button className="primary-button auth-submit" type="submit" disabled={saving || loading}>{saving ? "A actualizar…" : "Actualizar palavra-passe"} <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }}/></button>
      </form>}
      <p className="auth-footnote">Se não reconhecer uma actividade na sua conta, contacte o administrador da instalação.</p>
    </section>
  </main>;
}
