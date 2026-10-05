import { InlineField } from './StoryboardControls';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { StudioApi } from './api';
import { useProjectRefreshVersion } from './project-updates';
import type { DirectorStatus, ProjectSnapshot, Shot } from './model';
import { durationLabel } from './model';
import { Icon, IconButton, errorText } from './components';
import { readPlanDocument, selectedSceneShot } from './film-plan-model';
import { UiButton, UiTextArea } from './ui';
import './film-plan.css';

type Import = { id: string; name: string; text: string; sourceDigest: string; stale: boolean; running: boolean; draft: { preparedId: string; proposalDigest: string; project: ProjectSnapshot['project'] } | null };
interface Props {
  api: StudioApi; snapshot: ProjectSnapshot; director: DirectorStatus; disabled: boolean;
  active?: boolean;
  renderShot(shot: Shot, focus?: { selected: boolean; onSelect(): void; compact: boolean }): ReactNode; generation: ReactNode;
  onDemo?: (() => void) | undefined; generationOpen: boolean; openGeneration(): void; closeGeneration(): void;
  onDiscuss(text?: string, shotIds?: string[]): void;
  action(path: string, body: unknown, label: string, key?: string): void;
}
export function FilmPlan({ api, snapshot, director, disabled, renderShot, generation, onDemo, generationOpen, openGeneration, closeGeneration, onDiscuss, action, active = true }: Props) {
  const edit = (body: Record<string, unknown>) => action(`/api/projects/${encodeURIComponent(snapshot.project.id)}/storyboard`, { expectedHeadVersion: snapshot.project.headVersion, ...body }, 'Storyboard saved.');
  const revision = useProjectRefreshVersion(), id = snapshot.project.id, base = `/api/projects/${encodeURIComponent(id)}/plan-imports`;
  const [pending, setPending] = useState<Import | null>(null), [loadError, setLoadError] = useState('');
  const [showImport, setShowImport] = useState(false), [text, setText] = useState(''), [name, setName] = useState('Pasted brief.md'), [fileError, setFileError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedByScene, setSelectedByScene] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null), generationRef = useRef<HTMLDivElement>(null);
  const importKey = useRef({ text: '', name: '', key: '' });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void api.request<{ pending: Import | null }>(base, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setPending(value.pending); setLoadError(''); if (value.pending) { setShowImport(false); importKey.current = { text: "", name: "", key: "" }; } } }).catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); });
    return () => controller.abort();
  }, [api, base, id, revision, snapshot.project.headVersion, active]);
  useEffect(() => { if (active && generationOpen) generationRef.current?.scrollIntoView({ block: 'nearest' }); }, [generationOpen, active]);
  const project = pending?.draft && !pending.stale ? pending.draft.project : snapshot.project;
  const proposed = project !== snapshot.project;
  const importDocument = () => {
    if (!importKey.current.key || importKey.current.text !== text || importKey.current.name !== name) importKey.current = { text, name, key: crypto.randomUUID() };
    action(base, { name, text, expectedHeadVersion: snapshot.project.headVersion }, 'Material saved. The director is preparing a draft for your review.', importKey.current.key);
  };
  return <div className="film-plan">
    {loadError && <p className="inline-error" role="alert">Could not refresh import review: {loadError}</p>}
    <section className="board-treatment"><div className="section-heading"><h2 className="board-treatment-heading">{project.name}</h2><div className="inline-actions"><IconButton icon="folder" label="Bring a brief" disabled={disabled || !!pending} onClick={() => setShowImport(v => !v)} /><IconButton icon="settings" label="Generation and costs" onClick={openGeneration} />{snapshot.latestStoryboardEdit && snapshot.latestStoryboardEdit.headVersion === snapshot.project.headVersion && <IconButton icon="refresh" label="Undo last storyboard edit" disabled={disabled} onClick={() => edit({ kind: 'undo', commandId: snapshot.latestStoryboardEdit!.id })} />}</div></div>
      <small className="film-summary">{project.scenes.length} scenes · {project.shots.length} shots · {durationLabel(project.shots.reduce((n,s) => n + s.desiredFrames, 0))}</small>
      <details className="film-direction" key={`${id}-${!!(project.brief.trim() || project.story.trim())}`} open={project.brief.trim() || project.story.trim() ? undefined : true}><summary>Film direction</summary><InlineField className="board-treatment-brief" value={project.brief} label="Treatment brief" version={snapshot.project.headVersion} multiline disabled={disabled || !!pending} save={(value, expectedHeadVersion) => edit({ kind: 'treatment', field: 'brief', value, expectedHeadVersion })} /><InlineField value={project.story} label="Treatment direction" version={snapshot.project.headVersion} multiline disabled={disabled || !!pending} save={(value, expectedHeadVersion) => edit({ kind: 'treatment', field: 'story', value, expectedHeadVersion })} /></details>
    </section>
    {showImport && <section className="plan-import-form" aria-label="Bring supplied material"><div className="section-heading"><h3>Bring your existing material</h3><IconButton label="Close material input" onClick={() => setShowImport(false)} /></div><p className="field-help">Paste a brief, script or scene breakdown, or upload text. Review the interpretation before it changes your film.</p>
      <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" aria-label="Upload a brief or scene breakdown" disabled={disabled} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { const document = await readPlanDocument(file); setText(document.text); setName(document.name); setFileError(''); } catch (error) { setFileError(errorText(error)); } }} />
      <label htmlFor="plan-source">Source material <span className="field-help">Text / Markdown · up to 12,000 characters</span></label><UiTextArea id="plan-source" rows={7} value={text} maxLength={12000} onChange={event => { setText(event.target.value); setName('Pasted brief.md'); }} placeholder="Paste what you already have…" disabled={disabled} />
      {fileError && <p role="alert" className="inline-error">{fileError}</p>}{director.mode !== 'native' && <p className="field-help">Choose Codex in Project settings to interpret supplied material.</p>}
      <UiButton variant="primary" disabled={disabled || director.mode !== 'native' || !text.trim() || snapshot.control?.paused} onClick={importDocument}>Interpret material</UiButton></section>}
    {pending && <section className="import-review" aria-label="Supplied material review"><div className="section-heading"><div><span className="eyebrow">SUPPLIED MATERIAL</span><h3>{pending.stale ? 'This draft needs a fresh interpretation' : pending.draft ? 'Review your imported plan' : 'Preparing your film plan'}</h3></div><span className="tag">{pending.name}</span></div>
      <p>{pending.stale ? 'The project or conversation changed. Discard this import and bring it into the current plan again.' : pending.draft ? 'The scenes below show the proposed interpretation. Optional suggestions stay in the conversation until you choose them.' : pending.running ? 'The director is reading your material. Your saved plan stays unchanged.' : 'Continue the discussion if the director needs clarification. You can discard and re-import revised material.'}</p>
      <details><summary>View source material</summary><pre>{pending.text}</pre></details>
      {pending.draft && <details><summary>Compare with saved plan</summary><p>{snapshot.project.brief || 'No saved brief yet.'}</p>{snapshot.project.scenes.map(scene => <div key={scene.id}><strong>{scene.purpose}</strong><ul>{snapshot.project.shots.filter(shot => shot.sceneId === scene.id).map(shot => <li key={shot.id}>{shot.purpose} · {durationLabel(shot.desiredFrames)}</li>)}</ul></div>)}</details>}
      <div className="inline-actions"><UiButton variant="primary" disabled={disabled || !pending.draft || pending.stale || pending.running || director.status === 'running'} onClick={() => action(`${base}/${encodeURIComponent(pending.id)}/confirm`, { preparedId: pending.draft!.preparedId, proposalDigest: pending.draft!.proposalDigest }, 'Imported plan confirmed. No media generation was started.')}>Confirm film plan</UiButton><UiButton variant="secondary" disabled={disabled} onClick={() => action(`${base}/${encodeURIComponent(pending.id)}/discard`, {}, 'Proposed import discarded. Your saved film plan is unchanged.')}>Discard draft</UiButton></div></section>}
    <div ref={generationRef} hidden={!generationOpen} className="generation-workspace"><div className="section-heading"><h3>Generation & costs</h3><IconButton label="Close generation controls" onClick={closeGeneration} /></div>{pending ? <p>Confirm or discard the imported plan before preparing generation.</p> : generation}</div>
    {project.shots.length > 6 && <label className="film-search"><span className="sr-only">Find a shot</span><input placeholder="Find a shot…" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    {!project.scenes.length && <section className="film-empty"><Icon name="image" size={28} /><h3>Your story starts here.</h3><p>Share an idea, a finished brief, or any scenes you already have. We’ll build from that.</p><UiButton variant="primary" onClick={() => onDiscuss()}>Start in the conversation</UiButton>{onDemo && <UiButton disabled={disabled} onClick={onDemo}>Create a 2-shot demo</UiButton>}</section>}
    {project.scenes.map((scene, index) => {
      const all = project.shots.filter(shot => shot.sceneId === scene.id), shots = all.filter(shot => `${shot.purpose} ${shot.framing} ${shot.motion}`.toLowerCase().includes(query.toLowerCase()));
      if (query && !shots.length) return null;
      const selectedId = selectedSceneShot(shots, scene.id, selectedByScene[scene.id]);
      const main = shots.find(shot => shot.id === selectedId), supporting = shots.filter(shot => shot.id !== selectedId);
      const focusedShot = (shot: Shot, compact: boolean) => <div id={`board-shot-card-${shot.id}`} className={compact ? 'board-shot-support' : 'board-shot-focus'} key={shot.id}>{renderShot(shot, { selected: !compact, onSelect: () => {
        setSelectedByScene(previous => ({ ...previous, [scene.id]: shot.id }));
        requestAnimationFrame(() => document.getElementById(`board-shot-card-${shot.id}`)?.querySelector<HTMLButtonElement>('.board-select')?.focus());
      }, compact })}</div>;
      return <section className="board-scene" key={scene.id} aria-label={`Scene ${index + 1}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/openslate-shot'); if (id && !disabled && !pending) edit({ kind: 'moveShot', id, sceneId: scene.id }); }}><div className="board-scene-head"><div className="board-scene-copy"><h3>Scene {String(index + 1).padStart(2,'0')}</h3><InlineField multiline value={scene.purpose} label={`Scene ${index + 1} direction`} version={snapshot.project.headVersion} disabled={disabled || !!pending} save={(value, expectedHeadVersion) => edit({ kind: 'scene', id: scene.id, value, expectedHeadVersion })} /></div><small>{all.length} shots · {durationLabel(all.reduce((n,s) => n + s.desiredFrames, 0))}</small><IconButton icon="plus" label={`Add shot to scene ${index + 1}`} disabled={disabled || !!pending} onClick={() => edit({ kind: 'addShot', sceneId: scene.id })} /></div>
      <div className={`board-shots ${proposed ? 'board-proposed-shots' : `board-focus-layout${supporting.length ? '' : ' single-shot'}`}`}>
        {proposed ? shots.map(shot => <article className="board-shot proposed" key={shot.id}><div className="board-shot-body"><h4>Shot {index + 1}.{all.indexOf(shot) + 1}</h4><p>{shot.purpose}</p><p>{shot.framing}</p><small>{shot.motion}</small></div></article>)
          : <>{main && focusedShot(main, false)}{supporting.length > 0 && <div className="board-supporting-shots" aria-label={`Other shots in scene ${index + 1}`}>{supporting.map(shot => focusedShot(shot, true))}</div>}</>}
      </div></section>;
    })}
    {!pending && <UiButton className="board-add-scene" disabled={disabled} onClick={() => edit({ kind: 'addScene' })}><Icon name="plus" size={16} /> Add scene</UiButton>}
    {query && !project.shots.some(shot => `${shot.purpose} ${shot.framing} ${shot.motion}`.toLowerCase().includes(query.toLowerCase())) && <p>No matching shots. <UiButton variant="ghost" onClick={() => setQuery('')}>Clear search</UiButton></p>}
    {snapshot.plan && <details className="debug-panel"><summary>Plan & technical details</summary><pre>{snapshot.plan.canonicalSource}</pre></details>}
  </div>;
}
