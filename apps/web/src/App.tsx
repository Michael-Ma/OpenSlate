import { FilmPlan } from "./FilmPlan";
import { GenerationPermission } from "./GenerationPermission";
import { useProjectUpdates, ProjectUpdatesProvider } from "./project-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { APP_NAME } from "@openslate/core/public";
import { ApiError, StudioApi } from "./api";
import { takeStudioLaunchCode } from "./studio-launch";
import { Connect, Icon, IconButton, HelpTip, Lightbox, Preview, ShotCard, errorText } from "./components";
import { ProjectSettings } from "./ProjectSettings";
import { projectActivity } from "./project-activity";
import "./project-activity.css";
import { MediaPanel } from "./MediaPanel";
import { AssetLibrary } from "./AssetLibrary";
import { NarrationPanel } from "./NarrationPanel";
import { NewProjectProviderFields } from "./ProviderSettings";
import { RecoveryPanel, RecoveryReadOnly } from "./RecoveryPanel";
import { SpendingPanel } from "./SpendingPanel";
import { canUseDemo, projectCreationCommand } from "./provider-model";
import type { NewProjectCommand, ProviderSelection, ProviderView } from "./provider-model";
import { approvalPayload, canStopWork, continueStoppedWork, conversation, previewOutput, durationLabel, makeImageDiscussion, makeMessageCommand, makeQuestionReply, reviewIdentity, reviewMatchesProject } from "./model";
import type { DirectorStatus, MessageCommand, ProjectSnapshot, ProjectSummary, ReviewSnapshot, Shot } from "./model";

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const offlineDirector: DirectorStatus = { mode: "offline", status: "not_connected" };
function useProject(api: StudioApi, projectId: string, refreshKey: number, updateVersion: number) {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null); const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const [director, setDirector] = useState<DirectorStatus>(offlineDirector); const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting">("connecting"); const [error, setError] = useState("");
  const currentId = useRef(projectId), lastSignature = useRef("");
  const loadIdentity = `${projectId}:${refreshKey}:${updateVersion}`;
  const [loadedIdentity, setLoadedIdentity] = useState("");
  useEffect(() => {
    if (currentId.current !== projectId) { setSnapshot(null); setReview(null); setDirector(offlineDirector); lastSignature.current = ""; currentId.current = projectId; }
    if (!projectId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const [next, status] = await Promise.all([api.request<ProjectSnapshot>(projectPath(projectId), { signal: controller.signal }), api.request<DirectorStatus>(`${projectPath(projectId)}/director`, { signal: controller.signal })]);
        const signature = `${next.project.headVersion}:${next.project.activePlanId}:${next.cursor}`;
        if (signature !== lastSignature.current) { const nextReview = await api.request<ReviewSnapshot>(`${projectPath(projectId)}/review`, { signal: controller.signal }); if (controller.signal.aborted) return; setReview(nextReview); lastSignature.current = signature; }
        if (controller.signal.aborted) return;
        setSnapshot(next); setDirector(status); setLoadedIdentity(loadIdentity); setConnection("connected"); setError("");
      } catch (error) { if (controller.signal.aborted) return; setConnection("reconnecting"); setError(errorText(error)); }
    }
    void load(); return () => { controller.abort(); };
  }, [api, projectId, refreshKey, updateVersion]);
  return { snapshot: snapshot?.project.id === projectId ? snapshot : null, review: snapshot?.project.id === projectId ? review : null, director, connection: loadedIdentity === loadIdentity ? connection : "connecting" as const, error };
}
type PendingMessage = { command: MessageCommand; failed: boolean };
type Action = { projectId: string; path: string; body: unknown; key: string; label: string };
function Studio({ api, initialProjects, disconnect }: { api: StudioApi; initialProjects: ProjectSummary[]; disconnect: () => void | Promise<void> }) {
  const [recoveryReadOnly, setRecoveryReadOnly] = useState(true);
  const [projects, setProjects] = useState(initialProjects); const [projectId, setProjectId] = useState(initialProjects[0]?.id ?? "");
  const updates = useProjectUpdates(api, projectId);
  const [refreshKey, setRefreshKey] = useState(0); const { snapshot, review, director, connection, error: connectionError } = useProject(api, projectId, refreshKey, updates.revision);
  const [pendingCreation, setPendingCreation] = useState<NewProjectCommand | null>(null);
  const [spendingFocus, setSpendingFocus] = useState<{ projectId: string; candidateId: string; requestId: string } | null>(null);
  const [providerSelection, setProviderSelection] = useState<ProviderSelection | null>(null);
  const [demoProfiles, setDemoProfiles] = useState<{ projectId: string; allowed: boolean } | null>(null);
  const demoAvailable = demoProfiles?.projectId === projectId && demoProfiles.allowed;
  const [newName, setNewName] = useState(""); const [creating, setCreating] = useState(false); const [showNew, setShowNew] = useState(!initialProjects.length);
  const [showDirectorSettings, setShowDirectorSettings] = useState(false);
  const [selectedShots, setSelectedShots] = useState<string[]>([]); const [selectedReview, setSelectedReview] = useState<string[]>([]);
  const [displayed, setDisplayed] = useState<Record<string, string>>({}); const [reviewChanged, setReviewChanged] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [pending, setPending] = useState<Record<string, PendingMessage>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, Action>>({}); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(""); const [actionError, setActionError] = useState("");
  const [stops, setStops] = useState<Record<string, { key: string; failed: boolean; acknowledgedCursor?: number }>>({});
  const stopping = useRef(new Set<string>());
  const [tab, setTab] = useState<"storyboard" | "assets" | "preview">("storyboard");
  const [generationOpen, setGenerationOpen] = useState(false);
  const [draftContinuation, setDraftContinuation] = useState<{ projectId: string; requestId: string } | null>(null);
  const [mobileView, setMobileView] = useState("director");
  const [lightbox, setLightbox] = useState<{ url: string; shot: Shot; fixture: boolean | null } | null>(null);
  const selectionIdentity = useRef(""); const [replyQuestionId, setReplyQuestionId] = useState<string | null>(null);
  const lastReview = useRef(""); const chatEnd = useRef<HTMLDivElement>(null); const composer = useRef<HTMLTextAreaElement>(null);
  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);
  const identity = reviewIdentity(review); const draft = drafts[projectId] ?? ""; const pendingMessage = pending[projectId]; const pendingAction = pendingActions[projectId];
  const connected = connection === "connected" && (updates.connection === "connected" || updates.connection === "fallback"); const staleReview = !connected || !reviewMatchesProject(review, snapshot); const messages = conversation(snapshot);
  useEffect(() => { setGenerationOpen(false); setDraftContinuation(null); setSelectedShots([]); setSelectedReview([]); setDisplayed({}); setFeedback(""); setActionError(""); setReviewChanged(false); setLightbox(null); setReplyQuestionId(null); selectionIdentity.current = ""; lastReview.current = ""; }, [projectId]);
  useEffect(() => { if (lastReview.current && lastReview.current !== identity) { setLightbox(null); if (selectedReview.length) { setSelectedReview([]); setReviewChanged(true); } } lastReview.current = identity; }, [identity, selectedReview.length]);
  useEffect(() => { if (snapshot) setSelectedShots(ids => ids.filter(id => snapshot.project.shots.some(shot => shot.id === id))); }, [snapshot]);
  useEffect(() => {
    const stream = chatEnd.current?.parentElement;
    if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: "auto" });
  }, [messages.length, pendingMessage?.failed]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void api.request<{ profiles: ProviderView[] }>(`${projectPath(projectId)}/providers`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setDemoProfiles({ projectId, allowed: canUseDemo(value.profiles) }); })
      .catch(() => { if (!controller.signal.aborted) setDemoProfiles({ projectId, allowed: false }); });
    return () => controller.abort();
  }, [api, projectId, refreshKey]);
  async function reloadProjects() { const value = await api.request<{ projects: ProjectSummary[] }>("/api/projects"); setProjects(value.projects); }
  async function createProject(event: FormEvent) {
    event.preventDefault(); if (recoveryReadOnly || !newName.trim() || creating) return; setCreating(true); setActionError("");
    let command: NewProjectCommand;
    try { command = pendingCreation ?? projectCreationCommand(newName, crypto.randomUUID(), providerSelection); }
    catch (error) { setActionError(errorText(error)); setCreating(false); return; }
    setPendingCreation(command);
    try { const project = await api.request<ProjectSummary>("/api/projects", { method: "POST", body: command.body, key: command.key }); setPendingCreation(null); setProviderSelection(null); setProjects(all => [project, ...all.filter(item => item.id !== project.id)]); setProjectId(project.id); setNewName(""); setShowNew(false); setShowDirectorSettings(true); void reloadProjects().catch(() => {}); }
    catch (error) { if (error instanceof ApiError && !["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code)) setPendingCreation(null); setActionError(errorText(error)); } finally { setCreating(false); }
  }
  async function send() {
    if (recoveryReadOnly || !snapshot || busy || pendingAction || stops[projectId]) return; let command: MessageCommand;
    try { const question = snapshot.questions?.find(item => item.id === replyQuestionId);
      if (replyQuestionId && !question) throw new Error("That question is no longer available. Refresh to continue.");
      command = pendingMessage?.command ?? (question ? makeQuestionReply(projectId, question, draft, crypto.randomUUID()) : continueStoppedWork(makeMessageCommand(snapshot.project, draft, selectedShots, crypto.randomUUID(), director.mode === "native"), snapshot.control));
      if (!pendingMessage && !question && !snapshot.control?.paused && draftContinuation?.projectId === projectId && "scopeIds" in command.body) command = { ...command, body: { ...command.body, continuationRequestId: draftContinuation.requestId } };
    } catch (error) { setActionError(errorText(error)); return; }
    setBusy(true); setActionError(""); setPending(all => ({ ...all, [command.projectId]: { command, failed: false } }));
    try { await api.request(`${projectPath(command.projectId)}/messages`, { method: "POST", body: command.body, key: command.key }); setPending(all => { const next = { ...all }; delete next[command.projectId]; return next; }); setDrafts(all => ({ ...all, [command.projectId]: "" })); setReplyQuestionId(null); setDraftContinuation(null); setFeedback("Message saved."); refresh(); }
    catch (error) { if (!(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code)) setPending(all => ({ ...all, [command.projectId]: { command, failed: true } })); else { setPending(all => { const next = { ...all }; delete next[command.projectId]; return next; }); if (["QUESTION_STALE", "RESTORED_AUTHORITY_REQUIRES_NEW"].includes(error.code)) setReplyQuestionId(null); refresh(); } setActionError(errorText(error)); } finally { setBusy(false); }
  }
  async function stopWork() {
    if (recoveryReadOnly || stopping.current.has(projectId)) return;
    const target = projectId, key = stops[target]?.key ?? crypto.randomUUID();
    stopping.current.add(target); setStops(all => ({ ...all, [target]: { key, failed: false } })); setActionError("");
    try {
      const stopped = await api.request<{ cursor: number }>(`${projectPath(target)}/controls`, { method: "POST", body: { action: "stop" }, key });
      setStops(all => ({ ...all, [target]: { key, failed: false, acknowledgedCursor: stopped.cursor } }));
      setReplyQuestionId(null); setSelectedShots([]);
      setFeedback("Stopped. Saved work is kept. Send a new direction to continue; submitted provider jobs may still finish."); refresh();
    } catch (error) {
      if (error instanceof ApiError && !["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code)) setStops(all => { const next = { ...all }; delete next[target]; return next; });
      else setStops(all => ({ ...all, [target]: { key, failed: true } }));
      setActionError(errorText(error)); refresh();
    } finally { stopping.current.delete(target); }
  }
  async function runAction(action: Action) {
    if (recoveryReadOnly || busy) return; setBusy(true); setActionError(""); setFeedback("");
    try { await api.request(action.path, { method: "POST", body: action.body, key: action.key }); setPendingActions(all => { const next = { ...all }; delete next[action.projectId]; return next; }); setFeedback(action.label); if (action.path.endsWith("/approvals")) setSelectedReview([]); refresh(); void reloadProjects().catch(() => {}); }
    catch (error) {
      if (!(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code)) setPendingActions(all => ({ ...all, [action.projectId]: action }));
      else { setPendingActions(all => { const next = { ...all }; delete next[action.projectId]; return next; }); if (action.path.endsWith("/approvals")) { setSelectedReview([]); setReviewChanged(true); } }
      setActionError(errorText(error)); refresh();
    } finally { setBusy(false); }
  }
  function demo(action: "create" | "close_up" | "wide") { if (snapshot && demoAvailable) void runAction({ projectId, path: `${projectPath(projectId)}/demo`, body: { action, ...(action === "create" ? {} : { shotId: selectedShots[0] }) }, key: crypto.randomUUID(), label: "Demo request recorded. Follow its progress here." }); }
  function approve() { if (!review || staleReview || busy) return; try { const body = approvalPayload(review, selectedReview, displayed, selectionIdentity.current); void runAction({ projectId, path: `${projectPath(projectId)}/approvals`, body, key: crypto.randomUUID(), label: "Your selected keyframes were approved." }); } catch (error) { setActionError(errorText(error)); } }
  const onDisplayed = useCallback((id: string, sha: string) => { setDisplayed(all => all[id] === sha ? all : { ...all, [id]: sha }); if (!sha) setSelectedReview(ids => ids.filter(item => item !== id)); }, []);
  const toggleScope = (id: string) => { setDraftContinuation(null); setMobileView("director"); setSelectedShots(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]); composer.current?.focus(); };
  const disabled = recoveryReadOnly || busy || !!pendingAction || !!pendingMessage || !!stops[projectId];
  const selectedNames = snapshot?.project.shots.filter(shot => selectedShots.includes(shot.id)).map(shot => `Shot ${snapshot.project.shots.indexOf(shot) + 1}`) ?? [];
  const totalFrames = snapshot?.project.shots.reduce((total, shot) => total + shot.desiredFrames, 0) ?? 0;
  const pendingQuestions = snapshot?.questions?.filter(question => question.state === "pending") ?? [];
  const replyQuestion = pendingQuestions.find(question => question.id === replyQuestionId);
  useEffect(() => { if (snapshot?.control?.paused || snapshot?.questions?.find(q => q.id === replyQuestionId)?.canAnswer === false) setReplyQuestionId(null); }, [snapshot, replyQuestionId]);
  useEffect(() => { const ack = stops[projectId]?.acknowledgedCursor; if (ack !== undefined && snapshot && snapshot.cursor >= ack) setStops(all => { const next = { ...all }; delete next[projectId]; return next; }); }, [snapshot, stops, projectId]);
  const heldRequests = [...new Set(snapshot?.holds.filter(hold => hold.active).map(hold => hold.ownerId) ?? [])];
  const activity = projectActivity(snapshot, director, review, connected);



  return <ProjectUpdatesProvider value={updates.revision + refreshKey}><RecoveryReadOnly.Provider value={recoveryReadOnly}><div className="studio-shell">{showDirectorSettings && projectId && <ProjectSettings key={projectId} api={api} projectId={projectId} refreshKey={updates.revision + refreshKey} {...(snapshot ? { snapshot } : {})} close={() => setShowDirectorSettings(false)} changed={refresh} onContinue={() => { setShowDirectorSettings(false); requestAnimationFrame(() => composer.current?.focus()); }} />}<div className="studio-main" id="workspace"><header className="workspace-header"><a href="#workspace" className="brand"><span className="brand-mark"><Icon name="slate" /></span>{APP_NAME}</a><div className="project-switcher"><label className="sr-only" htmlFor="project-switch">Current project</label><select id="project-switch" value={projectId} disabled={busy} onChange={event => setProjectId(event.target.value)}>{!projectId && <option value="">Your next film</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button className="icon-button" aria-label="Create a project" title="Create a project" disabled={recoveryReadOnly || busy} onClick={() => setShowNew(value => !value)}><Icon name="plus" size={18} /></button></div><div className="header-actions"><span className={`connection ${connected ? "online" : ""}`} role="status"><span className="status-dot" />{connected ? updates.connection === "fallback" ? "Periodic updates" : "Live updates" : "Connecting…"}</span><IconButton icon="settings" label="Project settings" disabled={!projectId} onClick={() => setShowDirectorSettings(true)} /><IconButton icon="logout" label="Disconnect studio" onClick={() => void Promise.resolve(disconnect()).catch(error => setActionError(errorText(error)))} /></div></header>
    {showNew && <section className="create-project-panel"><div className="section-heading"><h2>Start a new film</h2><button className="icon-button" aria-label="Close new project" title="Close new project" onClick={() => setShowNew(false)}><Icon name="close" /></button></div><form className="new-project-form" onSubmit={event => void createProject(event)}><label htmlFor="project-name">Project name</label><input id="project-name" value={newName} onChange={event => setNewName(event.target.value)} maxLength={160} placeholder="Name your film" disabled={!!pendingCreation} autoFocus /><NewProjectProviderFields api={api} selection={providerSelection} changed={setProviderSelection} disabled={recoveryReadOnly || creating || !!pendingCreation} /><button disabled={recoveryReadOnly || creating || !newName.trim()} className="button primary">{creating ? "Creating…" : pendingCreation ? "Retry same project" : "Create project"}</button></form></section>}
    <div className="mobile-workspace-switch" aria-label="Workspace panel"><button aria-pressed={mobileView === "director"} onClick={() => setMobileView("director")}>Director</button><button aria-pressed={mobileView === "workspace"} onClick={() => setMobileView("workspace")}>Workspace</button></div>
    <RecoveryPanel api={api} refreshKey={refreshKey} onState={setRecoveryReadOnly} onChanged={refresh} />
    {(connectionError || actionError) && <div className="notice error" role="alert"><span>{actionError || connectionError}</span><IconButton icon="refresh" label="Refresh workspace" onClick={refresh} /></div>}{pendingAction && <div className="notice warning"><span>This action wasn’t confirmed. Retry the same request to check its outcome.</span><button disabled={recoveryReadOnly || busy} onClick={() => void runAction(pendingAction)}>Retry action</button></div>}{feedback && <div className="sr-only" role="status">{feedback}</div>}
    {!projectId ? <main className="empty-studio"><span className="empty-symbol"><Icon name="slate" size={40} /></span><span className="eyebrow">YOUR FIRST SLATE</span><h2>Make room for an idea.</h2><p>Create a project to start a conversation and shape your first storyboard.</p><button className="button primary" disabled={recoveryReadOnly} onClick={() => setShowNew(true)}><Icon name="plus" size={16} />New project</button></main>
    : <main className={`workspace-grid panel-${mobileView}`}><section className="conversation-panel" aria-labelledby="conversation-title"><div className="panel-title"><div><Icon name="chat" size={18} /><h2 id="conversation-title">Director</h2></div><span className="tag subtle">{director.mode === "fake" ? "Demo director" : director.mode === "native" ? "Codex director" : "Director offline"}</span></div><div className="conversation-stream" aria-live="polite" aria-relevant="additions text"><div className="conversation-intro"><span className="small-mark"><Icon name="slate" size={20} /></span><h3>Let’s shape the story.</h3><p>Talk through your idea here. Select a shot to focus the conversation on that part of the film.</p></div>
    {director.mode === "fake" && <div className="demo-disclosure"><span className="tiny-label">DEMO MODE</span><p>{demoAvailable ? "This director uses canned guidance and fixture media. Ordinary chat does not change the video; use the demo edit buttons below." : "This director uses canned guidance. Set up Codex to plan with this project’s saved models."} Paid generation requires a ready provider and your exact spending allowance. Video also requires approval of its keyframe and motion plan.</p></div>}{director.mode === "offline" && <div className="demo-disclosure"><p>Your messages are saved. A live director isn’t connected.</p></div>}
    {messages.map(message => <article key={message.id} className={`message ${message.role}`}><div className="message-byline">{message.role === "assistant" ? "OpenSlate" : "You"}</div><p>{message.text}</p>{message.state === "failed" && <small>Response needs attention</small>}</article>)}{pendingMessage && <article className="message user pending"><div className="message-byline">You <span>{pendingMessage.failed ? "Not confirmed" : "Sending…"}</span></div><p>{pendingMessage.command.body.text}</p>{pendingMessage.failed && <button className="text-button" disabled={recoveryReadOnly || busy} onClick={() => void send()}>Retry this message</button>}</article>}{director.status === "running" && <div className="director-working" role="status"><span className="working-dots"><i /><i /><i /></span>Working on your request</div>}{director.message && director.status === "error" && <div className="inline-error">{director.message}</div>}<div ref={chatEnd} /></div>
    <div className="current-decision">    {projectId && <section className={`project-activity ${activity.tone}`} aria-label="Project activity"><div className="project-activity-copy"><span className="status-dot" /><div><strong role="status">{activity.label}</strong> <HelpTip label="About current activity">{activity.detail}</HelpTip></div></div></section>}
{!snapshot?.control?.paused && heldRequests.length > 0 && <details className="pending-edits"><summary>{heldRequests.length} unfinished edit{heldRequests.length === 1 ? "" : "s"}</summary><p className="field-help">Continue a saved edit to finish its changes. Other results are kept.</p>{heldRequests.map((requestId, index) => {
 const scopes = [...new Set(snapshot?.holds.filter(hold => hold.active && hold.ownerId === requestId).map(hold => hold.scopeId))];
 const names = scopes.map(id => id === projectId ? "Whole film" : snapshot?.project.shots.some(shot => shot.id === id) ? `Shot ${1 + snapshot.project.shots.findIndex(shot => shot.id === id)}` : "Saved scope").join(", ");
 return <div className="pending-edit" key={requestId}><span><strong>Edit {index + 1} · {names}</strong><small>{snapshot?.messages.find(message => message.requestId === requestId || message.id === requestId)?.text.slice(0, 100) || "Saved request"}</small></span>{director.mode === "native" && <button className="button small" disabled={disabled || !connected} onClick={() => void runAction({ projectId, path: `${projectPath(projectId)}/messages`, body: { text: "Continue this earlier edit using its saved scope and current project state.", scopeIds: scopes, continuationRequestId: requestId, editing: true }, key: crypto.randomUUID(), label: "The earlier edit was explicitly continued." })}>Continue</button>}</div>;
})}</details>}
{pendingQuestions.map(question => <section key={question.id} className={`question-card ${replyQuestionId === question.id ? "selected" : ""}`} aria-label="OpenSlate question"><span className="tiny-label">{question.canAnswer === false ? "SAVED QUESTION" : "YOUR INPUT NEEDED"}</span>{question.questions.map(item => <div key={item.id}><h3>{item.header}</h3><p>{item.question}</p>{item.options.length > 0 && <ul>{item.options.map(option => <li key={option.label}><strong>{option.label}</strong> — {option.description}</li>)}</ul>}</div>)}{question.canAnswer === false ? <p>This question is saved for reference. Use a fresh conversation to continue when the project is ready.</p> : <button className="button small" disabled={disabled} onClick={() => { setReplyQuestionId(question.id); composer.current?.focus(); }}>{replyQuestionId === question.id ? "Replying below" : "Answer this question"}</button>}</section>)}</div><div className="composer-area">{replyQuestion && <div className="scope-chip"><span>Replying to: {replyQuestion.questions.map(item => item.header).join(", ")}</span><button onClick={() => setReplyQuestionId(null)} aria-label="Cancel question reply" title="Cancel question reply"><Icon name="close" size={13} /></button></div>}{!replyQuestion && selectedShots.length > 0 && <div className="scope-chip"><Icon name="image" size={14} /><span>{selectedNames.join(", ")}</span><button onClick={() => setSelectedShots([])} aria-label="Clear shot selection" title="Clear shot selection"><Icon name="close" size={13} /></button></div>}{director.mode === "fake" && demoAvailable && !replyQuestion && selectedShots.length === 1 && <div className="quick-actions"><span>Try an edit</span><button disabled={disabled || !connected} onClick={() => demo("close_up")}>Close-up</button><button disabled={disabled || !connected} onClick={() => demo("wide")}>Wide shot</button></div>}{draftContinuation?.projectId === projectId && <div className="scope-chip"><span>Continuing the saved edit</span><IconButton label="Clear saved edit continuation" onClick={() => setDraftContinuation(null)} /></div>}<form onSubmit={event => { event.preventDefault(); void send(); }} className="composer"><label className="sr-only" htmlFor="message-draft">Message OpenSlate</label><textarea ref={composer} id="message-draft" value={draft} onChange={event => setDrafts(all => ({ ...all, [projectId]: event.target.value }))} placeholder={replyQuestion ? "Your answer to the selected question…" : selectedShots.length ? `What should change in ${selectedNames.join(", ").toLowerCase()}?` : "Tell me about the film you have in mind…"} maxLength={16000} disabled={!!pendingMessage} rows={3} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }} /><div className="composer-bottom"><HelpTip label="Conversation scope">{selectedShots.length ? `Editing ${selectedNames.join(", ")}. Clear the selection to discuss the whole film.` : "Discuss the whole film, or choose Discuss on a shot to focus an edit. Press Command or Control + Enter to send."}</HelpTip><div className="composer-actions">{(canStopWork(snapshot, director) || !!stops[projectId] || (!!pendingMessage && !snapshot?.control?.paused)) && <button type="button" className="stop-button" disabled={recoveryReadOnly || (!!stops[projectId] && !stops[projectId]?.failed)} onClick={() => void stopWork()} aria-label={stops[projectId]?.failed ? "Retry stop" : "Stop conversation and generation"} title="Stop the conversation and new generation. Submitted provider jobs may still finish."><span aria-hidden="true">■</span><span className="sr-only">{stops[projectId]?.failed ? "Retry stop" : stops[projectId] ? "Stopping…" : "Stop"}</span></button>}<button className="send-button" disabled={disabled || !draft.trim() || !snapshot} aria-label="Send message" title="Send message"><Icon name="arrow" size={18} /></button></div></div></form></div></section>
    <section className="review-workspace" aria-label="Production workspace"><div className="workspace-toolbar"><div className="tabs" aria-label="Workspace views">{([['storyboard','Film plan'],['assets','Assets'],['preview','Preview']] as const).map(([value,label]) => <button key={value} className={(tab === value) ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>{tab !== "storyboard" && <span className="film-meta">{snapshot?.project.shots.length ?? 0} shots · {durationLabel(totalFrames)}</span>}</div>
    {tab === "preview" && snapshot && <><Preview api={api} snapshot={snapshot} />{!previewOutput(snapshot) && <div className="empty-storyboard"><h3>Your cut will appear here.</h3><p>Approved shots and accepted narration become an assembled preview. You can keep refining the film through conversation.</p></div>}</>}
    {snapshot?.control?.paused && <div className="notice warning"><span>{recoveryReadOnly ? "Execution is paused for recovery review." : "Stopped. Send a new direction in the conversation to continue from saved work. Previously submitted jobs may still finish at their provider."}</span></div>}{reviewChanged && <div className="notice warning"><span>The storyboard changed. Review the updated frames and select them again.</span><IconButton onClick={() => setReviewChanged(false)} label="Dismiss notice" icon="close" /></div>}
    {!snapshot ? <div className="loading-state"><span className="loading-ring" />Loading your workspace…</div> : <div hidden={tab !== "storyboard"}><FilmPlan key={projectId} api={api} snapshot={snapshot} review={review} director={director} disabled={disabled || !connected}
      generationOpen={generationOpen} openGeneration={() => setGenerationOpen(true)} closeGeneration={() => setGenerationOpen(false)} onPreview={() => setTab("preview")}
      onDiscuss={(text, ids) => { setDraftContinuation(text && heldRequests.length === 1 ? { projectId, requestId: heldRequests[0]! } : null); setMobileView("director"); if (ids) setSelectedShots(ids); else if (text) setSelectedShots([]); if (text) setDrafts(all => ({ ...all, [projectId]: text })); composer.current?.focus(); }}
      action={(path, body, label, key) => void runAction({ projectId, path, body, label, key: key ?? crypto.randomUUID() })}
      onDemo={director.mode === "fake" && demoAvailable ? () => demo("create") : undefined}
      generation={<><GenerationPermission key={projectId} snapshot={snapshot} disabled={disabled || !connected} authorize={body => void runAction({ projectId, path: `${projectPath(projectId)}/generation-permission`, body, key: crypto.randomUUID(), label: "Permission saved. Review generation costs when the plan is ready." })} /><SpendingPanel api={api} snapshot={snapshot} onChanged={refresh} {...(spendingFocus?.projectId === projectId ? { focus: spendingFocus } : {})} /></>}
      narration={<NarrationPanel api={api} projectId={projectId} headVersion={snapshot.project.headVersion} shots={snapshot.project.shots} directorMode={director.mode} onChanged={refresh} onReviewSpending={candidateId => { setGenerationOpen(true); setTab("storyboard"); setSpendingFocus({ projectId, candidateId, requestId: crypto.randomUUID() }); }} {...(director.mode === "native" ? { onContinue: (requestId: string) => { void runAction({ projectId, path: `${projectPath(projectId)}/messages`, body: { text: "Continue this edit from the saved narration review. Read the accepted canonical cues and supplied assets, explain any remaining gaps, and update only the affected planning work.", scopeIds: [projectId], continuationRequestId: requestId, editing: true }, key: crypto.randomUUID(), label: "Narration planning continued in the conversation." }); } } : {})} />}
      renderShot={shot => { const index = snapshot.project.shots.indexOf(shot), member = review?.members.find(member => member.shotId === shot.id); return <ShotCard key={shot.id} api={api} projectId={projectId} shot={shot} index={index} member={member} chosen={!!member && selectedReview.includes(member.videoNodeId)} scoped={selectedShots.includes(shot.id)} stale={staleReview || disabled} onChoose={() => { selectionIdentity.current = identity; if (member) setSelectedReview(ids => ids.includes(member.videoNodeId) ? ids.filter(id => id !== member.videoNodeId) : [...ids, member.videoNodeId]); setReviewChanged(false); }} onScope={() => toggleScope(shot.id)} onDisplayed={onDisplayed} onEnlarge={(url, shot, fixture) => setLightbox({ url, shot, fixture })} take={snapshot.outputs.find(output => output.nodeId === member?.videoNodeId && output.artifact.kind === "video")} />; }}
      approval={<>{reviewChanged && <p className="notice" role="status">The plan changed. Review the current frames before selecting them again.</p>}{selectedReview.length ? <div className="approval-bar"><strong>{selectedReview.length} frames selected</strong><HelpTip label="What frame approval allows">Approval covers these exact images and motion plans. Paid video still requires its separate spending allowance.</HelpTip><button className="button primary" disabled={disabled || staleReview} onClick={approve}><Icon name="check" size={17} />Approve frames</button></div> : null}</>}
    /></div>}
    {snapshot && <div hidden={tab !== "assets"}><AssetLibrary key={projectId} api={api} snapshot={snapshot} onChanged={refresh} disabled={disabled || !connected || !director.imageAttachmentsAvailable} onDiscuss={director.mode === "native" ? artifact => { const command = makeImageDiscussion(projectId, artifact, crypto.randomUUID()); setMobileView("director"); void runAction({ projectId, path: `${projectPath(projectId)}/messages`, body: command.body, key: command.key, label: "Image attached to this discussion." }); } : undefined} /></div>}
    {snapshot && <div hidden={tab !== "preview"}><MediaPanel key={projectId} api={api} snapshot={snapshot} mode="render" onChanged={refresh} /></div>}
</section></main>}
    </div>{lightbox && <Lightbox value={lightbox} onClose={() => setLightbox(null)} />}</div></RecoveryReadOnly.Provider></ProjectUpdatesProvider>;
}
export default function App() {
  const [session, setSession] = useState<{ api: StudioApi; projects: ProjectSummary[] } | null>(null);
  useEffect(() => () => session?.api.close(), [session]);
  async function connect() {
    const api = await StudioApi.connect(takeStudioLaunchCode(window.location, window.history));
    try {
      const response = await api.request<{ projects: ProjectSummary[] }>("/api/projects");
      api.onSessionExpired = () => { api.close(); setSession(null); };
      setSession({ api, projects: response.projects });
    } catch (error) { api.close(); throw error; }
  }
  useEffect(() => {
    // Launchers can reuse an existing window; a fragment change does not remount React.
    const reconnect = () => {
      if (window.location.hash.startsWith("#connect=")) void connect().catch(() => setSession(null));
    };
    window.addEventListener("hashchange", reconnect);
    return () => window.removeEventListener("hashchange", reconnect);
  }, []);
  async function disconnect() {
    if (!session) return;
    await session.api.request("/api/session/logout", { method: "POST" });
    session.api.close(); setSession(null);
  }
  return session ? <Studio api={session.api} initialProjects={session.projects} disconnect={disconnect} /> : <Connect onConnect={connect} />;
}
