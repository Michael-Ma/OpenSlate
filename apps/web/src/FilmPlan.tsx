import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { StudioApi } from './api';
import { useProjectRefreshVersion } from './project-updates';
import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot, Shot } from './model';
import type { NarrationView } from './narration-model';
import { durationLabel } from './model';
import { Icon, IconButton, HelpTip, errorText } from './components';
import { filmProgress, nextFilmAction, readPlanDocument, sceneNarration } from './film-plan-model';

type Import = { id: string; name: string; text: string; sourceDigest: string; stale: boolean; running: boolean; draft: { preparedId: string; proposalDigest: string; project: ProjectSnapshot['project'] } | null };
interface Props {
  api: StudioApi; snapshot: ProjectSnapshot; review: ReviewSnapshot | null; director: DirectorStatus; disabled: boolean;
  renderShot(shot: Shot): ReactNode; narration: ReactNode; generation: ReactNode; approval: ReactNode;
  onDemo?: (() => void) | undefined; generationOpen: boolean; openGeneration(): void; closeGeneration(): void; onPreview(): void;
  onDiscuss(text?: string, shotIds?: string[]): void;
  action(path: string, body: unknown, label: string, key?: string): void;
}
export function FilmPlan({ api, snapshot, review, director, disabled, renderShot, narration, generation, approval, onDemo, generationOpen, openGeneration, closeGeneration, onPreview, onDiscuss, action }: Props) {
  const revision = useProjectRefreshVersion(), id = snapshot.project.id, base = `/api/projects/${encodeURIComponent(id)}/plan-imports`;
  const [pending, setPending] = useState<Import | null>(null), [loadError, setLoadError] = useState('');
  const [view, setView] = useState<NarrationView | null>(null);
  const [phase, setPhase] = useState<'plan' | 'frames' | 'clips'>('plan');
  const [closed, setClosed] = useState<string[]>([]), [showImport, setShowImport] = useState(false), [text, setText] = useState(''), [name, setName] = useState('Pasted brief.md'), [fileError, setFileError] = useState('');
  const [query, setQuery] = useState('');
  const narrationRef = useRef<HTMLDetailsElement>(null), fileRef = useRef<HTMLInputElement>(null), generationRef = useRef<HTMLDivElement>(null);
  const importKey = useRef({ text: '', name: '', key: '' });
  useEffect(() => {
    const controller = new AbortController();
    void api.request<{ pending: Import | null }>(base, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setPending(value.pending); setLoadError(''); if (value.pending) { setShowImport(false); importKey.current = { text: "", name: "", key: "" }; } } }).catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); });
    void api.request<NarrationView>(`/api/projects/${encodeURIComponent(id)}/narration`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setView(value); }).catch(() => { if (!controller.signal.aborted) setView(null); });
    return () => controller.abort();
  }, [api, base, id, revision, snapshot.project.headVersion]);
  useEffect(() => { if (generationOpen) generationRef.current?.scrollIntoView({ block: 'nearest' }); }, [generationOpen]);
  const project = pending?.draft && !pending.stale ? pending.draft.project : snapshot.project;
  const proposed = project !== snapshot.project;
  const progress = filmProgress(snapshot, review), next = nextFilmAction(snapshot, review);
  const openNarration = () => { if (narrationRef.current) { narrationRef.current.open = true; narrationRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
  const choosePhase = (nextPhase: 'plan' | 'frames' | 'clips') => { setPhase(nextPhase); setQuery(''); };
  const guide = () => {
    if (next.target === 'frames') choosePhase('frames');
    else if (next.target === 'final') onPreview();
    else if (next.target === 'generation') openGeneration();
    else onDiscuss(`Let's continue from the saved film plan. ${next.detail} Preserve supplied material and completed work; identify the next missing decision before proposing changes.`);
  };
  const importDocument = () => {
    if (!importKey.current.key || importKey.current.text !== text || importKey.current.name !== name) importKey.current = { text, name, key: crypto.randomUUID() };
    action(base, { name, text, expectedHeadVersion: snapshot.project.headVersion }, 'Material saved. The director is preparing a draft for your review.', importKey.current.key);
  };
  const scopeSnapshot = { ...snapshot, project };
  const linkedSegments = new Set(view?.canonical?.shotMappings.map(row => row.segmentId).filter(Boolean));
  const unassigned = view?.snapshot.segments.filter(row => !linkedSegments.has(row.entry.segmentId)) ?? [];
  return <div className="film-plan">
    <nav className="film-process" aria-label="Video creation steps">
      {([['plan', 'Plan', `${project.scenes.length} scenes · ${project.shots.length} shots`], ['frames', 'Keyframes', proposed ? 'After confirmation' : `${progress.frames}/${progress.shots} ready`], ['clips', 'Clips', proposed ? 'After confirmation' : `${progress.clips}/${progress.shots} ready`]] as const).map(([value, label, detail], index) => <button key={value} aria-current={phase === value ? 'step' : undefined} onClick={() => choosePhase(value)}><span className="step-number">{index + 1}</span><span><strong>{label}</strong><small>{detail}</small></span></button>)}
      <button onClick={onPreview}><span className="step-number">4</span><span><strong>Final</strong><small>{progress.final ? 'Ready to watch' : 'Preview & export'}</small></span></button>
    </nav>
    {loadError && <p className="inline-error" role="alert">Could not refresh import review: {loadError}</p>}
    <section className="film-overview">
      <div className="section-heading"><div><span className="eyebrow">{proposed ? 'PROPOSED FILM PLAN' : 'YOUR FILM'}</span><h2>{project.name}</h2></div><button className="button small" disabled={disabled || !!pending} onClick={() => setShowImport(value => !value)}><Icon name="plus" size={15} />Bring a brief</button></div>
      {project.brief ? <details className="film-brief" open={!project.scenes.length}><summary>Brief <span>{project.brief.replace(/\s+/g, ' ').slice(0, 100)}</span></summary><p>{project.brief}</p>{project.story && <><h3>Story & direction</h3><p>{project.story}</p></>}</details> : <p className="muted">Start with an idea in the conversation, or bring a brief, script or scene breakdown.</p>}
      {!project.brief && project.story && <p>{project.story}</p>}
    </section>
    {showImport && <section className="plan-import-form" aria-label="Bring supplied material"><div className="section-heading"><h3>Bring your existing material</h3><IconButton label="Close material input" onClick={() => setShowImport(false)} /></div><p className="field-help">Paste a brief, script or scene breakdown, or upload text. Review the interpretation before it changes your film.</p>
      <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" aria-label="Upload a brief or scene breakdown" disabled={disabled} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { const document = await readPlanDocument(file); setText(document.text); setName(document.name); setFileError(''); } catch (error) { setFileError(errorText(error)); } }} />
      <label htmlFor="plan-source">Source material <span className="field-help">Text / Markdown · up to 12,000 characters</span></label><textarea id="plan-source" rows={7} value={text} maxLength={12000} onChange={event => { setText(event.target.value); setName('Pasted brief.md'); }} placeholder="Paste what you already have…" disabled={disabled} />
      {fileError && <p role="alert" className="inline-error">{fileError}</p>}{director.mode !== 'native' && <p className="field-help">Choose Codex in Project settings to interpret supplied material.</p>}
      <button className="button primary" disabled={disabled || director.mode !== 'native' || !text.trim() || snapshot.control?.paused} onClick={importDocument}>Interpret material</button></section>}
    {pending && <section className="import-review" aria-label="Supplied material review"><div className="section-heading"><div><span className="eyebrow">SUPPLIED MATERIAL</span><h3>{pending.stale ? 'This draft needs a fresh interpretation' : pending.draft ? 'Review your imported plan' : 'Preparing your film plan'}</h3></div><span className="tag">{pending.name}</span></div>
      <p>{pending.stale ? 'The project or conversation changed. Discard this import and bring it into the current plan again.' : pending.draft ? 'The scenes below show the proposed interpretation. Optional suggestions stay in the conversation until you choose them.' : pending.running ? 'The director is reading your material. Your saved plan stays unchanged.' : 'Continue the discussion if the director needs clarification. You can discard and re-import revised material.'}</p>
      <details><summary>View source material</summary><pre>{pending.text}</pre></details>
      {pending.draft && <details><summary>Compare with saved plan</summary><p>{snapshot.project.brief || 'No saved brief yet.'}</p>{snapshot.project.scenes.map(scene => <div key={scene.id}><strong>{scene.purpose}</strong><ul>{snapshot.project.shots.filter(shot => shot.sceneId === scene.id).map(shot => <li key={shot.id}>{shot.purpose} · {durationLabel(shot.desiredFrames)}</li>)}</ul></div>)}</details>}
      <div className="inline-actions"><button className="button primary" disabled={disabled || !pending.draft || pending.stale || pending.running || director.status === 'running'} onClick={() => action(`${base}/${encodeURIComponent(pending.id)}/confirm`, { preparedId: pending.draft!.preparedId, proposalDigest: pending.draft!.proposalDigest }, 'Imported plan confirmed. No media generation was started.')}>Confirm film plan</button><button className="button quiet" disabled={disabled} onClick={() => action(`${base}/${encodeURIComponent(pending.id)}/discard`, {}, 'Proposed import discarded. Your saved film plan is unchanged.')}>Discard draft</button></div></section>}
    {!pending && <section className="film-next" aria-label="Next step"><div><span className="eyebrow">{director.status === 'running' ? 'DIRECTOR WORKING' : 'NEXT STEP'}</span><p>{director.status === 'running' ? 'Your direction is being developed. You can inspect the saved plan below.' : next.detail}</p></div><button className="button primary small" disabled={disabled || director.status === 'running'} onClick={guide}>{next.target === 'chat' ? 'Continue in chat' : next.label}</button></section>}
    <div ref={generationRef} hidden={!generationOpen} className="generation-workspace"><div className="section-heading"><h3>Generation & costs</h3><IconButton label="Close generation controls" onClick={closeGeneration} /></div>{pending ? <p>Confirm or discard the imported plan before preparing generation.</p> : generation}</div>
    {project.scenes.length > 0 && <div className="film-section-title"><h3>{phase === 'plan' ? 'Scenes & shots' : phase === 'frames' ? 'Review keyframes' : 'Review clips'} <HelpTip label="About film planning">The brief applies to the whole film. Each scene connects its purpose, narration and shots. Scenes can progress independently; changing one does not restart the film.</HelpTip></h3>{!pending && <button className="text-button" onClick={openGeneration}>Generation & costs</button>}</div>}
    {project.shots.length > 6 && <label className="film-search"><span className="sr-only">Find a shot</span><input placeholder="Find a shot…" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    {!project.scenes.length && <section className="film-empty"><Icon name="image" size={28} /><h3>Your story starts here.</h3><p>Share an idea, a finished brief, or any scenes you already have. We’ll build from that.</p><button className="button small" onClick={() => onDiscuss()}>Start in the conversation</button>{onDemo && <button className="button small" disabled={disabled} onClick={onDemo}>Create a 2-shot demo</button>}</section>}
    {project.scenes.map((scene, index) => {
      const all = project.shots.filter(shot => shot.sceneId === scene.id), shots = all.filter(shot => `${shot.purpose} ${shot.framing} ${shot.motion}`.toLowerCase().includes(query.toLowerCase()));
      if (query && !shots.length) return null;
      const lines = sceneNarration(scopeSnapshot, scene.id, proposed ? null : view);
      return <section className={`film-scene ${proposed ? 'proposed' : ''}`} key={scene.id}><button className="film-scene-heading" aria-expanded={!closed.includes(scene.id)} onClick={() => setClosed(ids => ids.includes(scene.id) ? ids.filter(id => id !== scene.id) : [...ids, scene.id])}><span className="scene-index">{String(index + 1).padStart(2, '0')}</span><span><strong>{scene.purpose}</strong><small>{all.length ? `${all.length} ${all.length === 1 ? 'shot' : 'shots'} · ${durationLabel(all.reduce((sum, shot) => sum + shot.desiredFrames, 0))}` : 'Shot choices to develop'}</small></span><Icon name={closed.includes(scene.id) ? 'plus' : 'chevron'} size={16} /></button>
        <div hidden={closed.includes(scene.id)} className="film-scene-content"><div className="scene-narration"><span className="tiny-label">NARRATION</span>{lines.length ? lines.map(line => <p key={line.id}>{line.text}<small>{line.label}</small></p>) : <p className="muted">{project.narration.script || view?.snapshot.segments.length ? 'No narration section linked to these shots yet.' : 'Not decided yet.'}</p>}<button className="text-button" onClick={openNarration}>Review narration</button></div>
        {!shots.length && <p className="scene-empty">The scene is saved. Develop its shots in the conversation.</p>}
        {phase === 'plan' || proposed ? <ol className="plan-shots">{shots.map(shot => <li key={shot.id}><span className="shot-index">{String(project.shots.indexOf(shot) + 1).padStart(2, '0')}</span><div><strong>{shot.purpose}</strong><p>{shot.framing}</p><small>{shot.motion}</small></div><span className="shot-duration">{durationLabel(shot.desiredFrames)}</span>{!proposed && <IconButton label={`Discuss shot ${project.shots.indexOf(shot) + 1}`} icon="chat" onClick={() => onDiscuss(undefined, [shot.id])} />}</li>)}</ol> : <div className="shot-grid">{shots.map(shot => <div key={shot.id}>{renderShot(shot)}{phase === 'clips' && !snapshot.plan?.nodes?.some(node => node.shotId === shot.id && node.kind === 'video' && snapshot.outputs.some(out => out.nodeId === node.id && out.artifact.kind === 'video')) && <p className="field-help">No current video take for this shot yet.</p>}</div>)}</div>}
        </div></section>;
    })}
    {query && !project.shots.some(shot => `${shot.purpose} ${shot.framing} ${shot.motion}`.toLowerCase().includes(query.toLowerCase())) && <p>No matching shots. <button className="text-button" onClick={() => setQuery('')}>Clear search</button></p>}
    {phase !== 'plan' && !pending && approval}
    <details ref={narrationRef} className="film-narration"><summary>Narration & recordings <span>{project.narration.source === 'undecided' ? 'Choose your audio direction' : project.narration.source}</span></summary>
      {project.narration.script && <details><summary>Full script</summary><p className="preserve-lines">{project.narration.script}</p></details>}{unassigned.length > 0 && <div className="unassigned-narration"><h4>Sections not linked to shots</h4>{unassigned.map(row => <p key={row.entry.segmentId}>{row.script.text || row.script.meaning}</p>)}</div>}
      {pending ? <p>Finish reviewing the imported plan before changing narration.</p> : narration}
    </details>
    {snapshot.plan && <details className="debug-panel"><summary>Plan & technical details</summary><pre>{snapshot.plan.canonicalSource}</pre></details>}
  </div>;
}
