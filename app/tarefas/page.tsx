"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, CircleAlert, ClipboardList, Clock3, LogOut, Plus, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Company = { id: string; legalName: string };
type Task = { id: string; title: string; description: string | null; category: string; status: string; priority: string; dueDate: string | null; assigneeName: string | null; creatorName: string; createdAt: string; completedAt: string | null };
const categories = [{value:"documents",label:"Documentos"},{value:"bookkeeping",label:"Contabilidade"},{value:"tax",label:"Fiscalidade"},{value:"payroll",label:"Salários"},{value:"reconciliation",label:"Reconciliação"},{value:"monthly_close",label:"Fecho mensal"},{value:"other",label:"Outros"}];
const statuses = [{value:"pending",label:"Pendente"},{value:"in_progress",label:"Em curso"},{value:"blocked",label:"Bloqueada"},{value:"completed",label:"Concluída"},{value:"cancelled",label:"Cancelada"}];
const priorities = [{value:"low",label:"Baixa"},{value:"normal",label:"Normal"},{value:"high",label:"Alta"},{value:"urgent",label:"Urgente"}];
const statusLabel = (value:string) => statuses.find(x=>x.value===value)?.label ?? value;
const categoryLabel = (value:string) => categories.find(x=>x.value===value)?.label ?? value;
const priorityLabel = (value:string) => priorities.find(x=>x.value===value)?.label ?? value;
const dateLabel = (value:string) => new Date(value+"T12:00:00").toLocaleDateString("pt-MZ",{day:"2-digit",month:"short",year:"numeric"});

export default function TasksPage() {
  const router = useRouter();
  const [companies,setCompanies] = useState<Company[]>([]);
  const [entityId,setEntityId] = useState("");
  const [tasks,setTasks] = useState<Task[]>([]);
  const [filter,setFilter] = useState("all");
  const [showForm,setShowForm] = useState(false);
  const [title,setTitle] = useState("");
  const [description,setDescription] = useState("");
  const [category,setCategory] = useState("monthly_close");
  const [priority,setPriority] = useState("normal");
  const [dueDate,setDueDate] = useState("");
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");

  const loadCompanies = useCallback(async()=>{
    try {
      const response=await fetch("/api/companies");
      if(response.status===401){router.replace("/login");return;}
      const data=await response.json();
      if(!response.ok) throw new Error(data.error??"Não foi possível carregar empresas.");
      setCompanies(data.companies??[]);
      setEntityId(current=>current||data.companies?.[0]?.id||"");
    } catch(e){setError(e instanceof Error?e.message:"Erro ao carregar empresas.");}
  },[router]);

  const loadTasks = useCallback(async(id:string)=>{
    if(!id){setTasks([]);setLoading(false);return;}
    setLoading(true);
    try{
      const response=await fetch("/api/accounting/tasks?entityId="+encodeURIComponent(id));
      if(response.status===401){router.replace("/login");return;}
      const data=await response.json();
      if(!response.ok) throw new Error(data.error??"Não foi possível carregar tarefas.");
      setTasks(data.tasks??[]);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar tarefas.");}
    finally{setLoading(false);}
  },[router]);

  useEffect(()=>{void loadCompanies();},[loadCompanies]);
  useEffect(()=>{void loadTasks(entityId);},[entityId,loadTasks]);

  async function createTask(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!entityId)return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/accounting/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entityId,title,description,category,priority,dueDate})});
      const data=await response.json();
      if(response.status===401){router.replace("/login");return;}
      if(!response.ok)throw new Error(data.error??"Não foi possível criar tarefa.");
      setTitle("");setDescription("");setCategory("monthly_close");setPriority("normal");setDueDate("");setShowForm(false);
      setNotice("Tarefa criada com sucesso.");
      await loadTasks(entityId);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao criar tarefa.");}
    finally{setBusy(false);}
  }

  async function changeStatus(task:Task,status:string){
    setError("");setNotice("");
    try{
      const response=await fetch("/api/accounting/tasks/"+encodeURIComponent(task.id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
      const data=await response.json();
      if(response.status===401){router.replace("/login");return;}
      if(!response.ok)throw new Error(data.error??"Não foi possível actualizar a tarefa.");
      setNotice("Estado da tarefa actualizado.");
      await loadTasks(entityId);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao actualizar tarefa.");}
  }

  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");router.refresh();}
  const visible=tasks.filter(t=>filter==="all"||t.status===filter);
  const pending=tasks.filter(t=>["pending","in_progress","blocked"].includes(t.status)).length;
  const overdue=tasks.filter(t=>t.dueDate&&t.dueDate<new Date().toISOString().slice(0,10)&&!["completed","cancelled"].includes(t.status)).length;
  const completed=tasks.filter(t=>t.status==="completed").length;

  return <main className="companies-shell">
    <header className="companies-topbar">
      <Link className="brand" href="/"><span className="brand-mark">C<span>.</span></span><span className="brand-copy"><strong>ContaExpress</strong><small>GESTÃO CONTABILÍSTICA</small></span></Link>
      <div className="companies-user"><Link href="/contabilidade" className="secondary-button"><ArrowLeft size={14}/> Contabilidade</Link><button className="icon-button" onClick={logout} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={17}/></button></div>
    </header>
    <section className="companies-content accounting-content">
      <div className="breadcrumb"><Link href="/">Espaço de trabalho</Link><span>›</span><Link href="/contabilidade">Contabilidade</Link><span>›</span><strong>Tarefas e fecho mensal</strong></div>
      <div className="companies-title-row"><div><p className="eyebrow">ACOMPANHAMENTO OPERACIONAL</p><h1>Tarefas e fecho mensal</h1><p className="welcome-copy">Organize pendências por empresa, acompanhe os prazos e registe a conclusão de cada actividade contabilística.</p></div><button className="primary-button" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/>{showForm?"Cancelar":"Nova tarefa"}</button></div>
      {error&&<div className="inline-error" role="alert"><CircleAlert size={18}/>{error}</div>}
      {notice&&<div className="notice" role="status"><span className="notice-icon"><CheckCircle2 size={19}/></span><div><strong>{notice}</strong><p>A lista foi actualizada com o estado mais recente.</p></div></div>}
      <section className="task-toolbar panel"><div className="form-field task-company-field"><label htmlFor="taskCompany">Empresa</label><select id="taskCompany" value={entityId} onChange={e=>setEntityId(e.target.value)} disabled={!companies.length}><option value="">Seleccione uma empresa</option>{companies.map(c=><option key={c.id} value={c.id}>{c.legalName}</option>)}</select></div><button className="secondary-button" onClick={()=>void loadTasks(entityId)} disabled={!entityId||loading}><RefreshCw size={15}/> Actualizar</button></section>
      <div className="task-metrics-grid">
        <article className="metric-card"><div className="metric-top">Pendentes <span className="metric-icon"><ClipboardList size={17}/></span></div><div className="metric-value">{pending}</div><div className="metric-note">Por resolver ou em curso</div></article>
        <article className="metric-card"><div className="metric-top">Atrasadas <span className="metric-icon task-overdue-icon"><Clock3 size={17}/></span></div><div className="metric-value">{overdue}</div><div className="metric-note">Prazo ultrapassado</div></article>
        <article className="metric-card"><div className="metric-top">Concluídas <span className="metric-icon"><CheckCircle2 size={17}/></span></div><div className="metric-value">{completed}</div><div className="metric-note">Actividades concluídas</div></article>
      </div>
      {showForm&&<form className="panel task-create-form" onSubmit={createTask}><div className="panel-heading"><div><p className="eyebrow">NOVA ACTIVIDADE</p><h2>Registar tarefa</h2></div></div><div className="task-form-grid">
        <div className="form-field task-field-wide"><label htmlFor="taskTitle">Título *</label><input id="taskTitle" value={title} onChange={e=>setTitle(e.target.value)} required minLength={2} maxLength={180} placeholder="Ex.: Confirmar extractos bancários de Outubro"/></div>
        <div className="form-field"><label htmlFor="taskCategory">Categoria</label><select id="taskCategory" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
        <div className="form-field"><label htmlFor="taskPriority">Prioridade</label><select id="taskPriority" value={priority} onChange={e=>setPriority(e.target.value)}>{priorities.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
        <div className="form-field"><label htmlFor="taskDueDate">Data limite</label><input id="taskDueDate" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
        <div className="form-field task-field-wide"><label htmlFor="taskDescription">Descrição / observações</label><textarea id="taskDescription" value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Documentos necessários, dependências ou instruções."/></div>
      </div><div className="form-actions"><button type="button" className="secondary-button" onClick={()=>setShowForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy||!entityId}>{busy?"A guardar...":"Guardar tarefa"}</button></div></form>}
      <section className="panel task-list-panel"><div className="panel-heading task-list-heading"><div><p className="eyebrow">LISTA DE ACTIVIDADES</p><h2>Plano de trabalho</h2></div><span className="muted-count">{visible.length} tarefas</span></div>
        <div className="task-filters">{[{value:"all",label:"Todas"},{value:"pending",label:"Pendentes"},{value:"in_progress",label:"Em curso"},{value:"blocked",label:"Bloqueadas"},{value:"completed",label:"Concluídas"},{value:"cancelled",label:"Canceladas"}].map(x=><button key={x.value} className={filter===x.value?"task-filter active":"task-filter"} onClick={()=>setFilter(x.value)}>{x.label}</button>)}</div>
        {loading?<div className="empty-state"><RefreshCw size={22} className="spin"/><strong>A carregar tarefas...</strong></div>:visible.length===0?<div className="empty-state"><span className="empty-icon"><ClipboardList size={24}/></span><strong>{filter==="all"?"Ainda não existem tarefas":"Não existem tarefas neste estado"}</strong><p>Crie a primeira actividade para começar a acompanhar o trabalho da empresa.</p>{filter==="all"&&<button className="primary-button" onClick={()=>setShowForm(true)}><Plus size={15}/> Criar primeira tarefa</button>}</div>:<div className="task-list">{visible.map(task=><article className="task-row" key={task.id}><span className={"task-status-symbol "+task.status}>{task.status==="completed"?<CheckCircle2 size={18}/>:task.status==="cancelled"?<XCircle size={18}/>:<ClipboardList size={18}/>}</span><div className="task-details"><div className="task-title-line"><strong>{task.title}</strong><span className={"task-priority "+task.priority}>{priorityLabel(task.priority)}</span></div>{task.description&&<p>{task.description}</p>}<div className="task-meta"><span>{categoryLabel(task.category)}</span>{task.dueDate&&<span className={task.dueDate<new Date().toISOString().slice(0,10)&&!["completed","cancelled"].includes(task.status)?"task-date overdue":"task-date"}><CalendarDays size={13}/>{dateLabel(task.dueDate)}</span>}<span>{task.assigneeName?"Responsável: "+task.assigneeName:"Criada por "+(task.creatorName||"utilizador")}</span></div></div><div className="task-row-actions"><span className={"task-status-pill "+task.status}>{statusLabel(task.status)}</span>{!["completed","cancelled"].includes(task.status)&&<select aria-label={"Alterar estado de "+task.title} value={task.status} onChange={e=>void changeStatus(task,e.target.value)}><option value="pending">Pendente</option><option value="in_progress">Em curso</option><option value="blocked">Bloqueada</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select>}</div></article>)}</div>}
        <div className="panel-footer"><span>O estado e as alterações ficam registados para rastreabilidade.</span><span className="footer-link"><ShieldCheck size={14}/> Acesso controlado</span></div>
      </section>
      <p className="companies-footnote">Este módulo organiza tarefas operacionais. A conclusão de uma tarefa não representa, por si só, validação fiscal ou contabilística do trabalho realizado.</p>
    </section>
  </main>;
}
