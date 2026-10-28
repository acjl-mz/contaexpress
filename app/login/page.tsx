"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível iniciar sessão.");
      router.replace("/empresas");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <Link className="brand auth-brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <p className="eyebrow">ÁREA RESERVADA</p>
      <h1>Bem-vindo de volta.</h1>
      <p className="auth-subtitle">Inicie sessão para gerir as suas empresas e operações.</p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="email">E-mail</label>
        <div className="field-wrap"><Mail size={17}/><input id="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="nome@empresa.co.mz"/></div>
        <label htmlFor="password">Palavra-passe</label>
        <div className="field-wrap"><LockKeyhole size={17}/><input id="password" type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Introduza a sua palavra-passe"/></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "A validar..." : "Iniciar sessão"} <ArrowRight size={17}/></button>
      </form>
      <p className="auth-footnote">O acesso é restrito a utilizadores autorizados. Se ainda não tem credenciais, contacte o administrador do sistema.</p>
    </section>
  </main>;
}
