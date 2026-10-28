import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { Activity, ArrowDown, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Command, FolderKanban, LayoutGrid, ListTodo, LogOut, MessageCircle, Plus, Search, Send, Settings2, Sparkles, Users, X } from 'lucide-react';
import './styles.css';

const API = '/api';
const idOf = (value) => value?._id || value?.id || value || '';
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
const dateLabel = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No due date';
const timeLabel = (value) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('taskflow_token') || '');
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [modal, setModal] = useState('');
  const [taskDraft, setTaskDraft] = useState({ title: '', description: '', priority: 'medium', assigneeId: '', dueDate: '' });
  const [commentDraft, setCommentDraft] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [draggedTask, setDraggedTask] = useState('');

  const activeProject = projects.find((project) => idOf(project) === activeProjectId) || projects[0];
  const visibleTasks = useMemo(() => tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase())), [tasks, search]);

  const api = async (route, options = {}) => {
    const response = await fetch(`${API}${route}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Request failed.');
    return body;
  };

  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 3200); };

  useEffect(() => {
    if (!token) return;
    api('/me').then(({ user: current }) => setUser(current)).catch(() => {
      localStorage.removeItem('taskflow_token'); setToken(''); setUser(null);
    });
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    api('/projects').then(({ projects: found }) => {
      setProjects(found);
      setActiveProjectId((current) => current || idOf(found[0]));
    }).catch((error) => notify(error.message));
  }, [token, user]);

  useEffect(() => {
    if (!token || !activeProjectId) { setTasks([]); return; }
    api(`/projects/${activeProjectId}/tasks`).then(({ tasks: found }) => setTasks(found)).catch((error) => notify(error.message));
  }, [token, activeProjectId]);

  useEffect(() => {
    if (!token || !user || !activeProjectId) return;
    const socket = io({ auth: { token } });
    socket.emit('project:join', activeProjectId);
    const isSelf = (payload) => idOf(payload.actorId) === idOf(user);
    socket.on('task:created', (payload) => { setTasks((current) => [payload.task, ...current.filter((task) => idOf(task) !== idOf(payload.task))]); if (!isSelf(payload)) notify('A teammate added a task'); });
    socket.on('task:updated', (payload) => { setTasks((current) => current.map((task) => idOf(task) === idOf(payload.task) ? payload.task : task)); if (!isSelf(payload)) notify('A task was updated'); });
    socket.on('comment:created', (payload) => { if (idOf(selectedTask) === idOf(payload.taskId)) setComments((current) => current.some((comment) => idOf(comment) === idOf(payload.comment)) ? current : [...current, payload.comment]); if (!isSelf(payload)) notify('New comment on a task'); });
    socket.on('project:updated', (payload) => { setProjects((current) => current.map((project) => idOf(project) === idOf(payload.project) ? payload.project : project)); if (!isSelf(payload)) notify('Project members changed'); });
    socket.on('connect_error', () => {});
    return () => { socket.emit('project:leave', activeProjectId); socket.disconnect(); };
  }, [token, user, activeProjectId, selectedTask]);

  useEffect(() => {
    if (!selectedTask) { setComments([]); return; }
    api(`/tasks/${idOf(selectedTask)}/comments`).then(({ comments: found }) => setComments(found)).catch((error) => notify(error.message));
  }, [selectedTask]);

  const authenticate = async (mode, fields) => {
    setAuthBusy(true);
    try {
      const { token: newToken, user: current } = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(fields) });
      localStorage.setItem('taskflow_token', newToken); setToken(newToken); setUser(current);
    } catch (error) { notify(error.message); }
    finally { setAuthBusy(false); }
  };

  const signOut = () => { localStorage.removeItem('taskflow_token'); setToken(''); setUser(null); setProjects([]); setTasks([]); setActiveProjectId(''); };

  const createProject = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { project } = await api('/projects', { method: 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description') }) });
      setProjects((current) => [project, ...current]); setActiveProjectId(idOf(project)); setModal(''); notify('Project created');
    } catch (error) { notify(error.message); }
  };

  const addTask = async (event) => {
    event.preventDefault(); if (!taskDraft.title.trim() || !activeProject) return;
    try {
      const { task } = await api(`/projects/${activeProjectId}/tasks`, { method: 'POST', body: JSON.stringify(taskDraft) });
      setTasks((current) => [task, ...current]); setTaskDraft({ title: '', description: '', priority: 'medium', assigneeId: '', dueDate: '' }); setModal(''); notify('Task added to your board');
    } catch (error) { notify(error.message); }
  };

  const updateTask = async (task, patch) => {
    try {
      const { task: updated } = await api(`/tasks/${idOf(task)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setTasks((current) => current.map((item) => idOf(item) === idOf(updated) ? updated : item));
      if (selectedTask && idOf(selectedTask) === idOf(updated)) setSelectedTask(updated);
    } catch (error) { notify(error.message); }
  };

  const addComment = async (event) => {
    event.preventDefault(); if (!commentDraft.trim() || !selectedTask) return;
    try {
      const { comment } = await api(`/tasks/${idOf(selectedTask)}/comments`, { method: 'POST', body: JSON.stringify({ body: commentDraft }) });
      setComments((current) => [...current, comment]); setCommentDraft('');
    } catch (error) { notify(error.message); }
  };

  const inviteMember = async (event) => {
    event.preventDefault();
    try {
      const { project } = await api(`/projects/${activeProjectId}/members`, { method: 'POST', body: JSON.stringify({ email: inviteEmail }) });
      setProjects((current) => current.map((item) => idOf(item) === idOf(project) ? project : item)); setInviteEmail(''); notify('Teammate added to this project');
    } catch (error) { notify(error.message); }
  };

  if (!token || !user) return <AuthScreen onSubmit={authenticate} busy={authBusy} toast={toast} />;

  const columns = [
    { id: 'todo', title: 'To do', hint: 'Ready when you are', color: 'slate' },
    { id: 'in-progress', title: 'In progress', hint: 'Work in motion', color: 'blue' },
    { id: 'done', title: 'Done', hint: 'Nicely shipped', color: 'green' },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><LayoutGrid size={17} /></div><span>taskflow</span><span className="brand-beta">workspace</span></div>
      <div className="workspace-picker"><div className="workspace-avatar">T</div><div className="workspace-copy"><strong>Team workspace</strong><span>Free plan</span></div><ChevronDown size={15} /></div>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-item active"><LayoutGrid size={17} /> Overview <span className="nav-dot" /></button>
      <button className="nav-item" onClick={() => notify('You’re viewing your project boards')}><FolderKanban size={17} /> Projects</button>
      <button className="nav-item" onClick={() => notify('Your assigned tasks are shown on each board')}><ListTodo size={17} /> My tasks <span className="nav-count">{tasks.filter((task) => idOf(task.assignee) === idOf(user) && task.status !== 'done').length}</span></button>
      <button className="nav-item" onClick={() => notify('Recent workspace activity appears here')}><Activity size={17} /> Activity</button>
      <div className="sidebar-section-head"><div className="nav-label">YOUR PROJECTS</div><button className="icon-button tiny" aria-label="Create project" onClick={() => setModal('project')}><Plus size={15} /></button></div>
      <div className="project-list">{projects.map((project, index) => <button key={idOf(project)} className={`project-nav ${idOf(project) === activeProjectId ? 'selected' : ''}`} onClick={() => setActiveProjectId(idOf(project))}><span className={`project-bullet hue-${index % 5}`} />{project.name}<span className="project-task-count">{idOf(project) === activeProjectId ? tasks.length : '·'}</span></button>)}{!projects.length && <p className="empty-side">Create a project to get started.</p>}</div>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Need a hand?</strong><span>We’re happy to help.</span></div><ArrowUpRight size={14} /></div><div className="profile-row"><div className="avatar avatar-small">{initials(user.name)}</div><div className="profile-copy"><strong>{user.name}</strong><span>{user.email}</span></div><button className="icon-button" aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeProject?.name || 'Overview'}</strong><ChevronDown size={14} /></div><div className="topbar-actions"><label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks..." /><kbd>⌘ K</kbd></label><button className="icon-button notification-button" onClick={() => notify('You’re all caught up')} aria-label="Notifications"><Bell size={17} /><i /></button><div className="avatar avatar-small user-avatar">{initials(user.name)}</div></div></header>
      {activeProject ? <div className="content-wrap">
        <div className="welcome-line"><div><div className="eyebrow"><Sparkles size={13} /> WEDNESDAY, OCTOBER 28</div><h1>Good to see you, {user.name.split(' ')[0]} <span>✦</span></h1><p>Here’s what’s happening with your team today.</p></div><button className="button button-primary" onClick={() => setModal('task')}><Plus size={16} /> New task</button></div>
        <section className="stats-row"><Stat icon={<FolderKanban size={16} />} label="Active projects" value={projects.length} note="Across your workspace" tone="violet" /><Stat icon={<ListTodo size={16} />} label="Open tasks" value={tasks.filter((task) => task.status !== 'done').length} note="Ready for progress" tone="blue" /><Stat icon={<Check size={16} />} label="Completed" value={tasks.filter((task) => task.status === 'done').length} note="Nice work, team" tone="green" /><Stat icon={<Users size={16} />} label="People" value={activeProject.members?.length || 1} note="On this project" tone="amber" /></section>
        <section className="board-heading"><div><div className="eyebrow">PROJECT BOARD</div><h2>{activeProject.name}<span className="board-private"><Users size={13} /> Shared</span></h2><p>{activeProject.description || 'Plan work, share context, and keep everyone moving.'}</p></div><div className="board-tools"><div className="avatar-stack">{(activeProject.members || []).slice(0, 4).map((member) => <div key={idOf(member)} className="avatar avatar-stack-item" title={member.name}>{initials(member.name)}</div>)}</div><button className="button button-outline" onClick={() => setModal('members')}><Users size={15} /> Share</button><button className="icon-button bordered" title="Board options" onClick={() => notify('Board options')}><Settings2 size={16} /></button></div></section>
        <div className="board-grid">{columns.map((column) => {
          const cards = visibleTasks.filter((task) => task.status === column.id);
          return <section key={column.id} className={`board-column column-${column.color}`} onDragOver={(event) => event.preventDefault()} onDrop={() => { const task = tasks.find((item) => idOf(item) === draggedTask); if (task && task.status !== column.id) updateTask(task, { status: column.id }); setDraggedTask(''); }}>
            <div className="column-head"><div className={`column-indicator ${column.color}`} /><h3>{column.title}</h3><span className="column-count">{cards.length}</span><button className="icon-button tiny column-more" aria-label="Add task" onClick={() => { setTaskDraft((draft) => ({ ...draft, status: column.id })); setModal('task'); }}><Plus size={16} /></button></div><p className="column-hint">{column.hint}</p>
            <div className="card-list">{cards.map((task) => <TaskCard key={idOf(task)} task={task} onOpen={() => setSelectedTask(task)} onDragStart={() => setDraggedTask(idOf(task))} />)}<button className="add-task-row" onClick={() => { setTaskDraft({ title: '', description: '', priority: 'medium', assigneeId: '', dueDate: '', status: column.id }); setModal('task'); }}><Plus size={15} /> Add a task</button></div>
          </section>;
        })}</div>
        {!tasks.length && <div className="board-empty"><div className="empty-illustration"><Sparkles size={22} /></div><strong>Your board is ready for its first task</strong><span>Add tasks, assign teammates, and keep the work moving.</span><button className="button button-primary" onClick={() => setModal('task')}><Plus size={15} /> Create your first task</button></div>}
        <div className="board-footer"><span><span className="live-pulse" /> Changes sync live with your team</span><button onClick={() => setModal('members')}><Users size={14} /> {activeProject.members?.length || 1} member{(activeProject.members?.length || 1) === 1 ? '' : 's'}</button></div>
      </div> : <div className="welcome-empty"><div className="empty-illustration"><FolderKanban size={23} /></div><h1>Your workspace starts here</h1><p>Create a project board and invite your team to start planning together.</p><button className="button button-primary" onClick={() => setModal('project')}><Plus size={16} /> Create a project</button></div>}
    </main>

    {modal === 'project' && <Modal title="Create a project" subtitle="Give your team a shared place to plan and ship." onClose={() => setModal('')}><form onSubmit={createProject} className="form-stack"><Field label="Project name"><input name="name" placeholder="e.g. Website refresh" required autoFocus maxLength={100} /></Field><Field label="Description"><textarea name="description" placeholder="What are you working on together?" rows="3" maxLength={1000} /></Field><div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModal('')}>Cancel</button><button className="button button-primary"><Plus size={15} /> Create project</button></div></form></Modal>}
    {modal === 'task' && <Modal title="Create a task" subtitle={`Add work to ${activeProject?.name || 'your project board'}.`} onClose={() => setModal('')}><form onSubmit={addTask} className="form-stack"><Field label="Task title"><input value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} placeholder="What needs to get done?" required autoFocus maxLength={180} /></Field><Field label="Description"><textarea value={taskDraft.description} onChange={(event) => setTaskDraft({ ...taskDraft, description: event.target.value })} placeholder="Add a little more context..." rows="3" maxLength={3000} /></Field><div className="form-two"><Field label="Priority"><select value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field><Field label="Due date"><input type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })} /></Field></div><Field label="Assignee"><select value={taskDraft.assigneeId} onChange={(event) => setTaskDraft({ ...taskDraft, assigneeId: event.target.value })}><option value="">Unassigned</option>{(activeProject?.members || []).map((member) => <option key={idOf(member)} value={idOf(member)}>{member.name}</option>)}</select></Field><div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModal('')}>Cancel</button><button className="button button-primary"><Plus size={15} /> Add task</button></div></form></Modal>}
    {modal === 'members' && <Modal title="Project members" subtitle="Invite people to collaborate on this board." onClose={() => setModal('')}><div className="member-list">{(activeProject?.members || []).map((member) => <div className="member-row" key={idOf(member)}><div className="avatar avatar-small">{initials(member.name)}</div><div className="member-details"><strong>{member.name}</strong><span>{member.email}</span></div>{idOf(activeProject.owner) === idOf(member) && <span className="owner-badge">Owner</span>}</div>)}</div>{idOf(activeProject?.owner) === idOf(user) ? <form onSubmit={inviteMember} className="invite-form"><Field label="Invite by email"><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" required /></Field><button className="button button-primary"><Plus size={15} /> Add member</button><p>Teammates need to create an account before you can add them.</p></form> : <p className="invite-note">Ask the project owner to invite additional teammates.</p>}</Modal>}
    {selectedTask && <TaskDetail task={selectedTask} members={activeProject?.members || []} comments={comments} user={user} commentDraft={commentDraft} setCommentDraft={setCommentDraft} onComment={addComment} onClose={() => setSelectedTask(null)} onUpdate={updateTask} />}
    {toast && <div className="toast"><div className="toast-check"><Check size={13} /></div>{toast}</div>}
  </div>;
}

function AuthScreen({ onSubmit, busy, toast }) {
  const [mode, setMode] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  return <div className="auth-shell"><div className="auth-decoration decor-one" /><div className="auth-decoration decor-two" /><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><LayoutGrid size={17} /></div><span>taskflow</span></div><div className="auth-kicker"><Sparkles size={14} /> YOUR TEAM, IN SYNC</div><h1>{mode === 'login' ? 'Welcome back' : 'Make room for good work'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Sign in to pick up right where your team left off.' : 'Create an account and bring your projects together.'}</p><form className="form-stack auth-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const fields = { email: form.get('email'), password: form.get('password') }; if (mode === 'register') fields.name = form.get('name'); onSubmit(mode, fields); }}>
    {mode === 'register' && <Field label="Your name"><input name="name" placeholder="Alex Morgan" required autoComplete="name" /></Field>}<Field label="Email address"><input type="email" name="email" placeholder="you@company.com" required autoComplete="email" /></Field><Field label="Password"><div className="password-field"><input type={showPassword ? 'text' : 'password'} name="password" placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} required minLength={mode === 'register' ? 8 : undefined} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></Field><button className="button button-primary auth-submit" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowUpRight size={16} /></button></form><div className="auth-switch">{mode === 'login' ? 'New to Taskflow?' : 'Already have an account?'} <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div><div className="auth-foot"><span><span className="secure-dot" /> Your workspace stays private</span><span>Made for teams that care</span></div></div><div className="auth-side-note"><div className="side-quote-mark">“</div><p>Great work happens when everyone knows what matters next.</p><div className="quote-byline"><div className="avatar avatar-small">TF</div><span><strong>Team Taskflow</strong><small>Built for getting things done</small></span></div></div>{toast && <div className="toast auth-toast"><div className="toast-check"><Check size={13} /></div>{toast}</div>}</div>;
}

function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Modal({ title, subtitle, onClose, children }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal"><button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button><div className="modal-mark"><Sparkles size={17} /></div><h2>{title}</h2><p className="modal-subtitle">{subtitle}</p>{children}</section></div>; }
function Stat({ icon, label, value, note, tone }) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-data"><span>{label}</span><strong>{value}</strong><small>{note}</small></div><ArrowUpRight className="stat-arrow" size={16} /></div>; }
function TaskCard({ task, onOpen, onDragStart }) {
  const priority = task.priority || 'medium';
  return <article className="task-card" draggable onDragStart={onDragStart} onClick={onOpen}><div className="task-card-top"><span className={`priority priority-${priority}`}>{priority === 'high' ? <ArrowUpRight size={11} /> : priority === 'low' ? <ArrowDown size={11} /> : <span className="priority-dash" />}{priority}</span><button className="card-menu" onClick={(event) => { event.stopPropagation(); onOpen(); }} aria-label="Task details">···</button></div><h4>{task.title}</h4>{task.description && <p className="task-description">{task.description}</p>}<div className="task-card-footer"><div className="task-meta"><span className="task-date"><CalendarDays size={12} />{dateLabel(task.dueDate)}</span><span className="comment-count"><MessageCircle size={12} />Discuss</span></div>{task.assignee ? <div className="avatar avatar-tiny" title={task.assignee.name}>{initials(task.assignee.name)}</div> : <div className="avatar avatar-tiny unassigned">?</div>}</div></article>;
}
function TaskDetail({ task, members, comments, user, commentDraft, setCommentDraft, onComment, onClose, onUpdate }) {
  return <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="task-detail"><div className="detail-top"><div className="detail-path"><span>Task</span><span>/</span><span>{task.status === 'done' ? 'Done' : task.status === 'in-progress' ? 'In progress' : 'To do'}</span></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="detail-content"><span className={`priority priority-${task.priority || 'medium'}`}>{task.priority || 'medium'} priority</span><h2>{task.title}</h2><p className="detail-description">{task.description || 'No description yet. Add context so everyone knows what success looks like.'}</p><div className="detail-properties"><div><span>Status</span><select value={task.status} onChange={(event) => onUpdate(task, { status: event.target.value })}><option value="todo">To do</option><option value="in-progress">In progress</option><option value="done">Done</option></select></div><div><span>Assignee</span><select value={idOf(task.assignee)} onChange={(event) => onUpdate(task, { assigneeId: event.target.value })}><option value="">Unassigned</option>{members.map((member) => <option key={idOf(member)} value={idOf(member)}>{member.name}</option>)}</select></div><div><span>Due date</span><div className="property-value"><CalendarDays size={14} />{dateLabel(task.dueDate)}</div></div><div><span>Created by</span><div className="property-value"><div className="avatar avatar-tiny">{initials(task.createdBy?.name)}</div>{task.createdBy?.name || 'Team member'}</div></div></div><div className="discussion"><div className="discussion-heading"><h3>Discussion</h3><span>{comments.length}</span></div><div className="comment-list">{comments.length ? comments.map((comment) => <div className="comment-item" key={idOf(comment)}><div className="avatar avatar-tiny">{initials(comment.author?.name)}</div><div className="comment-body"><div><strong>{comment.author?.name || 'Teammate'}</strong><time>{timeLabel(comment.createdAt)}</time></div><p>{comment.body}</p></div></div>) : <div className="no-comments"><MessageCircle size={17} /><span>Start the conversation. Share an update or ask a question.</span></div>}</div></div></div><form className="comment-compose" onSubmit={onComment}><div className="avatar avatar-tiny">{initials(user.name)}</div><div className="compose-field"><textarea rows="2" value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Write a comment…" maxLength={2000} /><div className="compose-bottom"><span>Be kind, keep it useful.</span><button className="send-button" disabled={!commentDraft.trim()} aria-label="Send comment"><Send size={15} /></button></div></div></form></aside></div>;
}

createRoot(document.getElementById('root')).render(<App />);

