"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setToken(new URLSearchParams(window.location.search).get("token") || ""); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    if (password !== confirmation) { setError("As palavras-passe não coincidem."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível alterar a palavra-passe.");
      setMessage(data.message); setPassword(""); setConfirmation("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
    <p className="eyebrow">NOVA PALAVRA-PASSE</p>
    <h1>Defina uma nova palavra-passe.</h1>
    <p className="auth-subtitle">Use pelo menos 14 caracteres. O link de recuperação é válido por 30 minutos e só pode ser utilizado uma vez.</p>
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="password">Nova palavra-passe</label>
      <div className="field-wrap"><LockKeyhole size={17}/><input id="password" type="password" autoComplete="new-password" minLength={14} maxLength={200} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo de 14 caracteres"/></div>
      <label htmlFor="confirmation">Confirmar palavra-passe</label>
      <div className="field-wrap"><LockKeyhole size={17}/><input id="confirmation" type="password" autoComplete="new-password" minLength={14} maxLength={200} required value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="Repita a palavra-passe"/></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy || !token}>{busy ? "A actualizar..." : "Alterar palavra-passe"}</button>
      {!token && <p className="form-error" role="alert">O link não contém um token. Solicite um novo link de recuperação.</p>}
    </form>
    <p className="auth-footnote"><Link href="/login"><ArrowLeft size={14} style={{display:"inline",verticalAlign:"middle"}}/> Voltar ao início de sessão</Link></p>
  </section></main>;
}
