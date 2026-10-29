"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível processar o pedido.");
      setMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
    <p className="eyebrow">RECUPERAÇÃO DE ACESSO</p>
    <h1>Vamos recuperar o acesso.</h1>
    <p className="auth-subtitle">Introduza o e-mail associado à sua conta. Se estiver registado, receberá um link válido por 30 minutos.</p>
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">E-mail</label>
      <div className="field-wrap"><Mail size={17}/><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="nome@empresa.co.mz"/></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "A processar..." : "Enviar instruções"}</button>
    </form>
    <p className="auth-footnote"><Link href="/login"><ArrowLeft size={14} style={{display:"inline",verticalAlign:"middle"}}/> Voltar ao início de sessão</Link></p>
  </section></main>;
}
