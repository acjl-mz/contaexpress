import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";

const metrics = [
  { label: "Empresas registadas", value: "—", note: "Aguardam configuração", icon: Building2 },
  { label: "Períodos em processamento", value: "—", note: "Sem dados de operação", icon: CalendarClock },
  { label: "Pendências documentais", value: "—", note: "Aguardam registos", icon: FileText },
  { label: "Obrigações próximas", value: "—", note: "Calendário por configurar", icon: ShieldCheck },
];

const modules = [
  { name: "Empresas", detail: "Clientes e entidades contabilísticas", icon: Building2, state: "Fundação" },
  { name: "Contabilidade", detail: "Plano de contas, diários e lançamentos", icon: BookOpen, state: "MVP" },
  { name: "Documentos", detail: "Arquivo e suporte contabilístico", icon: FileText, state: "Planeado" },
  { name: "Tesouraria", detail: "Caixa, bancos e movimentos", icon: Wallet, state: "Planeado" },
];

export default function HomePage() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="ContaExpress início">
          <span className="brand-mark">C<span>.</span></span>
          <span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span>
        </a>
        <div className="workspace-label">ESPAÇO DE TRABALHO</div>
        <nav className="nav-list" aria-label="Navegação principal">
          <Link className="nav-item active" href="/"><LayoutDashboard size={18} /> Visão geral</Link>
          <a className="nav-item" href="/empresas"><Building2 size={18} /> Empresas <span className="nav-soon">Base</span></Link>
          <a className="nav-item" href="/contabilidade"><BookOpen size={18} /> Contabilidade <span className="nav-soon">MVP</span></a>
          <a className="nav-item" href="#documentos"><FileText size={18} /> Documentos</a>
          <a className="nav-item" href="#tesouraria"><Wallet size={18} /> Tesouraria</a>
          <a className="nav-item" href="#fiscalidade"><ShieldCheck size={18} /> Fiscalidade</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status"><span className="status-dot" /><div><strong>Instalação local</strong><small>Ambiente de desenvolvimento</small></div></div>
          <div className="sidebar-foot">ContaExpress · v0.1.0</div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">Espaço de trabalho <ChevronRight size={15} /> <strong>Visão geral</strong></div>
          <div className="topbar-actions"><span className="environment-pill"><span /> Fase de fundação</span><button className="icon-button" aria-label="Notificações"><Bell size={18} /></button><div className="avatar" aria-label="Utilizador">CE</div></div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div><p className="eyebrow">PAINEL DE CONTROLO</p><h1>Gestão clara. Contas sob controlo.</h1><p className="welcome-copy">O ponto de partida para organizar empresas, operações contabilísticas e obrigações num só lugar.</p></div>
            <a className="primary-button" href="/empresas"><Plus size={17} /> Gerir empresas</a>
          </section>

          <section className="notice" aria-label="Estado da implementação">
            <div className="notice-icon"><ShieldCheck size={20} /></div>
            <div><strong>Fundação do ContaExpress</strong><p>O acesso seguro e o registo de empresas estão a ser implementados. Os indicadores ainda não representam dados contabilísticos reais.</p></div>
            <span className="notice-tag">MVP em construção</span>
          </section>

          <section className="metrics-grid" aria-label="Indicadores gerais">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return <article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><span className="metric-icon"><Icon size={18} /></span></div><div className="metric-value">{metric.value}</div><div className="metric-note">{metric.note}</div></article>;
            })}
          </section>

          <div className="content-grid">
            <section className="panel modules-panel">
              <div className="panel-heading"><div><p className="eyebrow">ESTRUTURA DO PRODUTO</p><h2>Módulos do sistema</h2></div><span className="muted-count">04 áreas</span></div>
              <div className="module-list" id="empresas">
                {modules.map((module) => {
                  const Icon = module.icon;
                  return <a className="module-row" key={module.name} href={module.name === "Contabilidade" ? "/contabilidade" : "#"} style={module.name === "Contabilidade" ? { cursor: "pointer" } : undefined}><span className="module-icon"><Icon size={20} /></span><div className="module-info"><strong>{module.name}</strong><span>{module.detail}</span></div><span className={module.state === "Fundação" || module.state === "MVP" ? "state-badge in-progress" : "state-badge"}>{module.state}</span><ChevronRight className="module-chevron" size={17} /></a>;
                })}
              </div>
              <div className="panel-footer"><span>Os módulos serão activados por etapas.</span><span className="footer-link">Ver roteiro <ArrowUpRight size={15} /></span></div>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Próximos passos</h2></div><span className="activity-icon"><CircleDollarSign size={19} /></span></div>
              <div className="checklist">
                <div className="check-item"><span className="check-number done"><CheckCircle2 size={16} /></span><div><strong>Estrutura do projecto</strong><p>Configuração inicial e documentação</p></div></div>
                <div className="check-item"><span className="check-number">02</span><div><strong>Empresas e utilizadores</strong><p>Registo, associação e permissões</p></div></div>
                <div className="check-item"><span className="check-number">03</span><div><strong>Núcleo contabilístico</strong><p>Plano de contas e lançamentos</p></div></div>
                <div className="check-item"><span className="check-number">04</span><div><strong>Relatórios e validação</strong><p>Balancetes, auditoria e testes</p></div></div>
              </div>
              <div className="next-step"><div><span>PRIORIDADE ACTUAL</span><strong>Preparar o módulo de empresas</strong></div><ArrowDownRight size={19} /></div>
            </section>
          </div>
          <footer className="page-footer"><span>ContaExpress <span className="footer-separator">·</span> Plataforma proprietária ALINVEST</span><span>Desenvolvido para operação local <span className="footer-separator">·</span> Moçambique</span></footer>
        </div>
      </section>
    </main>
  );
}
