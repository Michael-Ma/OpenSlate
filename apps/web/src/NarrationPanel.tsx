import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { draftOf, narrationError, narrationReviewState, narrationTimingIssues, preparationCurrent, sampleSeconds, secondsToSamples } from "./narration-model";
import type { NarrationDraft, NarrationPreparation, NarrationSegment, NarrationView, Recording } from "./narration-model";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import "./narration.css";

interface Props { api: StudioApi; projectId: string; headVersion: number; shots: Array<{ id: string; purpose?: string }>; directorMode?: string; onChanged(): void; onContinue?(requestId: string): void }
type CompletionEffect = { kind: "prepare" | "apply" | "add" | "upload" } | { kind: "writing" | "trim" | "placement" | "restore"; segmentId: string };
interface CommandMetadata { label: string; effect?: CompletionEffect }
const commandMetadata = (command: PendingCommand | null) => command?.metadata as CommandMetadata | undefined;
const ambiguous = (error: unknown) => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code);
const message = (error: unknown) => error instanceof ApiError ? narrationError(error.code, error.message) : error instanceof Error ? error.message : "The request could not be completed.";

export function NarrationPanel(props: Props) { return <NarrationWorkspace key={props.projectId} {...props} />; }
function NarrationWorkspace({ api, projectId, headVersion, shots, directorMode, onChanged, onContinue }: Props) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const registry = pendingCommandsFor(api, "narration");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]), useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const busy = slot.running, pending = slot.command;
  const [view, setView] = useState<NarrationView | null>(null), [error, setError] = useState(""), [loadError, setLoadError] = useState(""), [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<NarrationPreparation | null>(null);
  const [adding, setAdding] = useState(false), [newDraft, setNewDraft] = useState<NarrationDraft>(() => draftOf());
  const [mappings, setMappings] = useState<Record<string, string>>({}), [librarySelection, setLibrarySelection] = useState("");
  const [unsaved, setUnsaved] = useState<Record<string, NarrationDraft>>({});
  const [unsavedTiming, setUnsavedTiming] = useState<Record<string, boolean>>({});
  const [uploadOrigin, setUploadOrigin] = useState<"uploaded" | "generated">("uploaded");
  const mounted = useRef(true), loadOrdinal = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    const ordinal = ++loadOrdinal.current;
    try { const next = await api.request<NarrationView>(base); if (!mounted.current || ordinal !== loadOrdinal.current) return;
      setView(next); setLoadError("");
    } catch (cause) { if (mounted.current) setLoadError(message(cause)); }
  }
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => clearInterval(timer); }, [api, projectId]);
  useEffect(() => { void load(); }, [headVersion]);
  const observed = useRef({ registry, version: 0 });
  const changed = useRef(onChanged); changed.current = onChanged;
  useEffect(() => {
    if (observed.current.registry !== registry) observed.current = { registry, version: 0 };
    if (slot.settledVersion <= observed.current.version) return;
    observed.current.version = slot.settledVersion;
    if (slot.lastSuccess) {
      const metadata = commandMetadata(slot.settledCommand), effect = metadata?.effect;
      setNotice(metadata?.label ?? "Saved narration updated."); setError("");
      const saved = slot.result as Partial<NarrationView["snapshot"]> | null;
      if (saved?.state && saved.segments && saved.readiness) setView(current => current && saved.state!.version >= current.snapshot.state.version ? { ...current, snapshot: saved as NarrationView["snapshot"] } : current);
      if (effect?.kind === "prepare") {
        setPrepared(slot.result as NarrationPreparation);
        const request = slot.settledCommand?.body as { shotMappings: Array<{ shotId: string; segmentId: string | null }> };
        setMappings(Object.fromEntries(request.shotMappings.map(mapping => [mapping.shotId, mapping.segmentId ?? ""])));
      }
      if (effect?.kind === "apply") setPrepared(null);
      if (effect?.kind === "add") { setNewDraft(draftOf()); setAdding(false); }
      if (effect?.kind === "writing" || effect?.kind === "restore") setUnsaved(all => { const next = { ...all }; delete next[effect.segmentId]; return next; });
      if (effect?.kind === "upload") { setLibrarySelection((slot.result as Recording).id); if (fileInput.current) fileInput.current.value = ""; }
    } else if (slot.error) setError(message(slot.error));
    changed.current(); void load();
  }, [registry, slot.settledVersion]);
  function execute(command: PendingCommand) {
    setError(""); setNotice("");
    void registry.run(projectId, command, saved => saved.file ? api.upload(saved.path, saved.file, saved.key)
      : api.request(saved.path, { method: "POST", body: saved.body, key: saved.key, timeoutMs: 180000 }), ambiguous);
  }
  const locked = busy || !!pending, active = view?.session?.state === "active", disabled = locked || !active;
  const command = (suffix: string, body: unknown, label: string, effect?: CompletionEffect) => void execute({ path: `${base}${suffix}`, body, key: crypto.randomUUID(), metadata: { label, ...(effect ? { effect } : {}) } });
  const edit = (suffix: string, fields: Record<string, unknown>, label: string, effect?: CompletionEffect) => {
    if (!view?.session || disabled) return;
    command(suffix, { sessionId: view.session.id, expectedVersion: view.snapshot.state.version, ...fields }, label, effect);
  };
  const recordings = view?.audioLibrary ?? [], selectedRecording = recordings.find(item => item.id === librarySelection);
  const timingIssues = narrationTimingIssues(view?.snapshot.segments ?? []);
  const reviewState = narrationReviewState(view, prepared, { writing: Object.keys(unsaved).length > 0,
    timing: view?.snapshot.segments.some(row => unsavedTiming[row.entry.segmentId]) ?? false, newSection: newDraft });
  const currentPreparation = preparationCurrent(prepared, view);
  const alreadyCommitted = view?.canonical?.narrationVersion === view?.snapshot.state.version;
  function prepare() {
    if (!view?.session || disabled || !reviewState.canReview) return;
    command("/prepare", { sessionId: view.session.id, expectedHeadVersion: view.headVersion, expectedNarrationVersion: view.snapshot.state.version,
      shotMappings: shots.filter(shot => Object.hasOwn(mappings, shot.id)).map(shot => ({ shotId: shot.id, segmentId: mappings[shot.id] || null })) }, "Narration changes are ready for your review.", { kind: "prepare" });
  }
  function apply() {
    if (!view?.session || !prepared || disabled || !reviewState.canApply) return;
    command("/apply", { sessionId: view.session.id, preparedId: prepared.id }, "Narration applied. A matching plan is still needed before production resumes.", { kind: "apply" });
  }
  return <section className="narration-panel" aria-labelledby="narration-title">
    <header className="narration-heading"><div><span className="eyebrow">VOICE & STORY</span><h2 id="narration-title">Shape the narration</h2><p>Start with notes or a finished script. Bring a recording, then review what is said and where it belongs.</p></div><button className="text-button" disabled={busy} onClick={() => void load()}>Refresh saved work</button></header>
    <div className="narration-status" role="status"><span className={`narration-dot ${active ? "active" : ""}`} />{active ? "Narration session open · your edits stay together" : view?.session ? "This session needs an explicit continuation" : "Start a narration session to make changes"}
      {!active && view && <button className="button primary" disabled={locked} onClick={() => command("/sessions", view.session ? { continuationSessionId: view.session.id } : {}, "Narration session opened.")}>{view.session ? "Continue narration" : "Start narration"}</button>}
    </div>
    {(error || loadError) && <div className="narration-feedback error" role="alert">{error || loadError}</div>}{notice && <div className="narration-feedback" role="status">{notice}</div>}
    {pending && busy && <p role="status">Your saved narration request is still running. Switching projects will not start it again.</p>}
    {pending && !busy && <div className="narration-feedback"><p>The response was uncertain. Retry the same saved request to check its result.</p><button className="button primary" onClick={() => void execute(pending)}>Retry exact request</button></div>}
    {!view ? <p className="narration-empty">Loading your saved narration…</p> : <>
      <div className="narration-steps"><span>01 · Write</span><span>02 · Listen & time</span><span>03 · Review changes</span></div>
      <div className="narration-section-header"><h3>Your sections <span>{view.snapshot.segments.length}</span></h3><button className="button" disabled={disabled} onClick={() => setAdding(value => !value)}>{adding ? "Close new section" : "+ Add a section"}</button></div>
      {!view.snapshot.segments.length && !adding && <div className="narration-empty"><strong>A story starts with a few words.</strong><p>Add rough notes, an outline, or the words you want spoken. Nothing is filled in or accepted for you.</p></div>}
      {adding && <div className="narration-card new"><h3>New narration section</h3><DraftFields draft={newDraft} update={setNewDraft} disabled={disabled} prefix="new-narration" /><div className="narration-actions"><button className="button primary" disabled={disabled} onClick={() => edit("/segments", { patch: { add: [newDraft] } }, "Section saved.", { kind: "add" })}>Save section</button><span>Notes and outlines can be refined before approval.</span></div></div>}
      {view.snapshot.segments.map((row, index) => <SegmentCard key={row.entry.segmentId} row={row} index={index} recordings={recordings} disabled={disabled} api={api} projectId={projectId} completion={slot} edit={edit} report={setError} retainTimingDirty={value => setUnsavedTiming(all => { if (!!all[row.entry.segmentId] === value) return all; const next = { ...all }; if (value) next[row.entry.segmentId] = true; else delete next[row.entry.segmentId]; return next; })} retainDraft={value => setUnsaved(all => { const next = { ...all }; if (value) next[row.entry.segmentId] = value; else delete next[row.entry.segmentId]; return next; })} />)}
      {Object.entries(unsaved).filter(([id]) => !view.snapshot.segments.some(row => row.entry.segmentId === id)).map(([id, draft]) => <div className="narration-card new" key={id}><h3>Your unsaved writing is still here</h3><p>This section was removed from the saved narration while you were editing.</p><blockquote>{draft.text}</blockquote><button className="button" disabled={disabled} onClick={() => edit("/segments", { patch: { add: [draft] } }, "Writing restored as a new section.", { kind: "restore", segmentId: id })}>Restore as a new section</button><button className="text-button" disabled={locked} onClick={() => setUnsaved(all => { const next = { ...all }; delete next[id]; return next; })}>Discard this unsaved writing</button></div>)}
      <section className="narration-recordings" aria-labelledby="recordings-title"><div><span className="eyebrow">YOUR RECORDINGS</span><h3 id="recordings-title">Upload and listen</h3><p>Audio files stay on this computer. Speech generation is not connected yet; you can also upload a recording made elsewhere.</p></div>
        {view.capabilities?.audioImport === false && <p role="status">Writing and script review are available. Recording import and playback need FFmpeg and ffprobe installed on this computer.</p>}
        <div className="narration-upload-row"><label>Recording source<select value={uploadOrigin} disabled={disabled || view.capabilities?.audioImport === false} onChange={event => setUploadOrigin(event.target.value as typeof uploadOrigin)}><option value="uploaded">My recording</option><option value="generated">Generated elsewhere</option></select></label><input ref={fileInput} type="file" accept="audio/*" aria-label="Choose a narration recording" disabled={disabled || view.capabilities?.audioImport === false} onChange={event => { const file = event.target.files?.[0]; if (!file || !view.session || view.capabilities?.audioImport === false) return;
          void execute({ path: `${base}/audio?sessionId=${encodeURIComponent(view.session.id)}&declaredOrigin=${uploadOrigin}`, file, key: crypto.randomUUID(), metadata: { label: "Recording uploaded. Listen, then attach it to a section.", effect: { kind: "upload" } } }); }} /></div>
        {recordings.length > 0 && <div className="narration-library"><label>Saved recordings<select value={librarySelection} onChange={event => setLibrarySelection(event.target.value)}><option value="">Choose a recording to listen</option>{recordings.map((audio, index) => <option key={audio.id} value={audio.id}>{recordingLabel(audio, index)}</option>)}</select></label>{selectedRecording && <RecordingPlayer api={api} projectId={projectId} recording={selectedRecording} />}</div>}
        {view.coverage.audioLibrary.nextOffset !== null && <p className="field-help">Showing the {recordings.length} newest recordings out of {view.coverage.audioLibrary.total}. Older attached recordings remain available in their sections.</p>}
      </section>
      <section className="narration-commit" aria-labelledby="narration-commit-title"><span className="eyebrow">REVIEW CHANGES</span><h3 id="narration-commit-title">Connect narration to your shots</h3><p>A section sets its shot's narration and duration. Choose links deliberately; one changed section does not rewrite your other shots.</p>
        {!!shots.length && <div className="narration-mappings">{shots.map((shot, index) => <label key={shot.id}><span>Shot {index + 1} · {shot.purpose || "Untitled shot"}</span><select value={mappings[shot.id] ?? "__unchanged"} disabled={disabled} onChange={event => { setMappings(values => { const next = { ...values }; if (event.target.value === "__unchanged") delete next[shot.id]; else next[shot.id] = event.target.value; return next; }); setPrepared(null); }}><option value="__unchanged">Keep existing link</option><option value="">No narration · detach explicitly</option>{view.snapshot.segments.map((row, i) => <option key={row.entry.segmentId} value={row.entry.segmentId}>Section {i + 1} · {row.script.text.slice(0, 50) || "Untitled"}</option>)}</select></label>)}</div>}
        {timingIssues.map(issue => <p className="narration-feedback error" key={issue}>{issue}</p>)}
        {reviewState.unsavedChanges && <div className="narration-feedback" role="status"><p>Save or revert your unsaved writing, new section or timing before reviewing or applying narration. Review uses the saved, accepted version.</p>{reviewState.newSectionChanged && <><button className="text-button" disabled={locked} onClick={() => setAdding(true)}>Reopen new section</button><button className="text-button" disabled={locked} onClick={() => { setNewDraft(draftOf()); setAdding(false); }}>Discard new section draft</button></>}</div>}
        {!reviewState.savedReady && <p className="field-help">Each section needs an accepted saved script, attached recording and saved timing before you can review the complete narration.</p>}
        <button className="button" disabled={disabled || !reviewState.canReview} onClick={prepare}>{alreadyCommitted ? "Review narration changes" : "Review before applying"}</button>
        {prepared && <div className="narration-proposal"><h4>{currentPreparation ? reviewState.unsavedChanges ? "Save or revert your changes first" : "Ready for your decision" : "This preview is out of date"}</h4>{currentPreparation ? <><p>{prepared.projection.segments.length} accepted section{prepared.projection.segments.length === 1 ? "" : "s"}. No video will be generated by applying these changes.</p>{!prepared.shotImpact.length && <p>No shot links will change. Choose links above if this narration should set shot timing.</p>}<ul>{prepared.shotImpact.map(impact => <li key={impact.shotId}>Shot {shots.findIndex(shot => shot.id === impact.shotId) + 1}: {impact.visual === "replan" ? "video prompt needs review because narration meaning or duration changed" : "video intent can stay as it is"}.</li>)}</ul><button className="button primary" disabled={disabled || !reviewState.canApply} onClick={apply}>Apply this narration</button></> : <p>Your saved work changed. Review a fresh preview before applying.</p>}</div>}
        {view.canonical && <div className="narration-hold-note"><strong>Narration is saved in the project.</strong><p>Editing holds stay in place until a matching plan is applied. Ask the director to update the affected plan using the accepted narration.</p>{onContinue && view.session && directorMode === "native" && <button className="button" disabled={locked} onClick={() => onContinue(view.session!.requestId)}>Continue with the director</button>}{directorMode !== "native" && <p className="field-help">The demo director cannot plan narration changes. A connected director is needed for that next step.</p>}</div>}
      </section>
    </>}
  </section>;
}

function DraftFields({ draft, update, disabled, prefix }: { draft: NarrationDraft; update(value: NarrationDraft): void; disabled: boolean; prefix: string }) {
  return <div className="narration-draft-fields"><label htmlFor={`${prefix}-text`}>Words or notes<textarea id={`${prefix}-text`} rows={4} value={draft.text} maxLength={16000} disabled={disabled} onChange={event => update({ ...draft, text: event.target.value })} placeholder="What should the audience hear?" /></label><div className="narration-field-row"><label>How finished is it?<select value={draft.textKind} disabled={disabled} onChange={event => update({ ...draft, textKind: event.target.value as NarrationDraft["textKind"] })}><option value="notes">Notes</option><option value="outline">Outline</option><option value="draft">Finished draft</option></select></label><label>Recording source<select value={draft.source.kind} disabled={disabled} onChange={event => update({ ...draft, source: event.target.value === "generated" ? { kind: "generated", voice: null, profileRevisionId: null } : { kind: event.target.value as "uploaded" | "undecided" } })}><option value="undecided">Choose later</option><option value="uploaded">My recording</option><option value="generated">Generated elsewhere</option></select></label><label>Language<input value={draft.language} maxLength={64} disabled={disabled} onChange={event => update({ ...draft, language: event.target.value })} /></label></div><label htmlFor={`${prefix}-meaning`}>What should this section communicate?<input id={`${prefix}-meaning`} value={draft.meaning} maxLength={4000} disabled={disabled} onChange={event => update({ ...draft, meaning: event.target.value })} placeholder="The main idea the visuals should support" /></label></div>;
}
const recordingLabel = (audio: Recording, index: number) => `Recording ${index + 1} · ${(audio.media.probe.audio?.durationSeconds ?? 0).toFixed(1)}s · ${audio.declaredOrigin === "generated" ? "made elsewhere" : "uploaded"}`;
function RecordingPlayer({ api, projectId, recording }: { api: StudioApi; projectId: string; recording: Recording }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const owned = useRef(""), controller = useRef<AbortController | null>(null);
  useEffect(() => { setUrl(""); setError(""); setBusy(false); return () => { controller.current?.abort(); if (owned.current) URL.revokeObjectURL(owned.current); owned.current = ""; }; }, [recording.id, recording.media.sha256]);
  async function load() { controller.current?.abort(); const request = new AbortController(); controller.current = request; setBusy(true); setError("");
    try { const result = await api.narrationAudio(projectId, recording.id, recording.media.sha256, request.signal); if (request.signal.aborted) { URL.revokeObjectURL(result); return; } if (owned.current) URL.revokeObjectURL(owned.current); owned.current = result; setUrl(result); }
    catch (cause) { if (!request.signal.aborted) setError(message(cause)); } finally { if (!request.signal.aborted) setBusy(false); } }
  return <div className="narration-player">{url ? <audio controls src={url} aria-label="Listen to the saved narration recording" /> : <button className="button" disabled={busy} onClick={() => void load()}>{busy ? "Checking recording…" : "Listen to recording"}</button>}{error && <p role="alert">{error}</p>}</div>;
}

function SegmentCard({ row, index, recordings, disabled, api, projectId, completion, edit, report, retainDraft, retainTimingDirty }: { row: NarrationSegment; index: number; recordings: Recording[]; disabled: boolean; api: StudioApi; projectId: string; completion: PendingCommandSnapshot; edit(suffix: string, fields: Record<string, unknown>, label: string, effect?: CompletionEffect): void; report(error: string): void; retainDraft(value: NarrationDraft | null): void; retainTimingDirty(value: boolean): void }) {
  const [expanded, setExpanded] = useState(index === 0);
  const [draft, setDraft] = useState(() => draftOf(row.script)), [dirty, setDirty] = useState(false), [baseRevision, setBaseRevision] = useState(row.script.id);
  const [selected, setSelected] = useState(row.audio?.id ?? ""), [timing, setTiming] = useState({ start: sampleSeconds(row.cue?.startSample ?? 0), end: sampleSeconds(row.cue?.endSample ?? row.audio?.media.probe.audio?.samples ?? 0), at: sampleSeconds(row.entry.atSample) }), [trimDirty, setTrimDirty] = useState(false), [placementDirty, setPlacementDirty] = useState(false);
  const trimSubject = `${row.audio?.id ?? ""}:${row.cue?.id ?? ""}`;
  const [baseTrim, setBaseTrim] = useState(trimSubject), [basePosition, setBasePosition] = useState(row.entry.atSample);
  useEffect(() => { retainTimingDirty(trimDirty || placementDirty); }, [trimDirty, placementDirty]);
  const observedCompletion = useRef(completion.settledVersion);
  useEffect(() => {
    if (completion.settledVersion <= observedCompletion.current) return;
    observedCompletion.current = completion.settledVersion;
    if (!completion.lastSuccess) return;
    const effect = commandMetadata(completion.settledCommand)?.effect;
    if (!effect || !("segmentId" in effect) || effect.segmentId !== row.entry.segmentId) return;
    if (effect.kind === "writing") setDirty(false);
    if (effect.kind === "trim") setTrimDirty(false);
    if (effect.kind === "placement") setPlacementDirty(false);
  }, [completion.settledVersion, row.entry.segmentId]);
  const trimChangedElsewhere = trimDirty && baseTrim !== trimSubject, positionChangedElsewhere = placementDirty && basePosition !== row.entry.atSample;
  useEffect(() => { if (!dirty) { setDraft(draftOf(row.script)); setBaseRevision(row.script.id); } }, [row.script.id, dirty]);
  useEffect(() => { setSelected(row.audio?.id ?? ""); }, [row.audio?.id]);
  useEffect(() => { if (!trimDirty) { setBaseTrim(trimSubject); setTiming(value => ({ ...value, start: sampleSeconds(row.cue?.startSample ?? 0), end: sampleSeconds(row.cue?.endSample ?? row.audio?.media.probe.audio?.samples ?? 0) })); } }, [row.cue?.id, row.audio?.id, trimDirty]);
  useEffect(() => { if (!placementDirty) { setBasePosition(row.entry.atSample); setTiming(value => ({ ...value, at: sampleSeconds(row.entry.atSample) })); } }, [row.entry.atSample, placementDirty]);
  const changedElsewhere = dirty && baseRevision !== row.script.id;
  const available = [...recordings]; if (row.audio && !available.some(audio => audio.id === row.audio!.id)) available.push(row.audio);
  function saveCue() { try { const startSample = secondsToSamples(timing.start), endSample = secondsToSamples(timing.end); if (endSample <= startSample) throw new Error("The end must be after the start."); edit("/cues", { segmentId: row.entry.segmentId, startSample, endSample }, "Source timing saved.", { kind: "trim", segmentId: row.entry.segmentId }); } catch (error) { report(message(error)); } }
  function savePlacement() { try { edit("/placements", { placements: [{ segmentId: row.entry.segmentId, atSample: secondsToSamples(timing.at) }] }, "Narration placement saved.", { kind: "placement", segmentId: row.entry.segmentId }); } catch (error) { report(message(error)); } }
  return <details className="narration-card" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary><span className="narration-section-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{row.script.text.slice(0, 75) || "Untitled narration section"}</strong><span>{row.accepted.script ? "Script accepted" : row.script.textKind === "draft" ? "Draft to review" : "Writing in progress"} · {row.accepted.audio ? "Recording accepted" : row.audio ? "Recording attached" : "No recording"} · {row.accepted.timing ? "Timing accepted" : "Timing to review"}</span></div></summary>
    <div className="narration-card-body"><DraftFields draft={draft} update={value => { setDraft(value); setDirty(true); retainDraft(value); }} disabled={disabled} prefix={`narration-${row.entry.segmentId}`} />
      {dirty && !changedElsewhere && <button className="text-button" disabled={disabled} onClick={() => { setDraft(draftOf(row.script)); setBaseRevision(row.script.id); setDirty(false); retainDraft(null); }}>Revert unsaved writing</button>}
      {(trimDirty || placementDirty) && <button className="text-button" disabled={disabled} onClick={() => { setTrimDirty(false); setPlacementDirty(false); }}>Revert unsaved timing</button>}
      {changedElsewhere && <div className="narration-feedback"><p>A newer script was saved. Your typed text has been kept.</p><blockquote>{row.script.text}</blockquote><button className="text-button" disabled={disabled} onClick={() => { setDraft(draftOf(row.script)); setBaseRevision(row.script.id); setDirty(false); retainDraft(null); }}>Use saved version</button><button className="text-button" disabled={disabled} onClick={() => setBaseRevision(row.script.id)}>Keep my edits over this version</button></div>}
      <div className="narration-actions"><button className="button" disabled={disabled || !dirty || changedElsewhere} onClick={() => edit("/segments", { patch: { update: [{ segmentId: row.entry.segmentId, draft }] } }, "Section saved.", { kind: "writing", segmentId: row.entry.segmentId })}>Save writing</button><button className="button" disabled={disabled || dirty || row.accepted.script || row.script.textKind !== "draft" || !row.script.text.trim() || !row.script.meaning.trim()} onClick={() => edit("/acceptances", { kind: "script", targets: [row.script.id] }, "Saved script accepted.")}>{row.accepted.script ? "✓ Script accepted" : "Accept saved script"}</button></div>
      <div className="narration-recording-binding"><label>Attach a saved recording<select value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}><option value="">Choose a recording</option>{available.map((audio, i) => <option key={audio.id} value={audio.id}>{recordingLabel(audio, i)}</option>)}</select></label><button className="button" disabled={disabled || dirty || !selected || selected === row.audio?.id} onClick={() => edit("/bindings", { segmentId: row.entry.segmentId, audioId: selected }, "Recording attached.")}>Attach recording</button></div>
      {row.audio && <><RecordingPlayer api={api} projectId={projectId} recording={row.audio} /><button className="button" disabled={disabled || dirty || selected !== row.audio.id || row.accepted.audio} onClick={() => edit("/audio-acceptances", { targets: [{ segmentRevisionId: row.script.id, audioId: row.audio!.id }] }, "Attached recording accepted.")}>{row.accepted.audio ? "✓ Recording accepted" : "Accept attached recording"}</button>
        <div className="narration-time-fields">{trimChangedElsewhere && <div className="narration-feedback"><p>The saved recording or range changed. Your typed values are still here.</p><button className="text-button" disabled={disabled} onClick={() => setTrimDirty(false)}>Reload saved range</button><button className="text-button" disabled={disabled} onClick={() => setBaseTrim(trimSubject)}>Keep my typed range</button></div>}{positionChangedElsewhere && <div className="narration-feedback"><p>The saved position changed to {sampleSeconds(row.entry.atSample)}s.</p><button className="text-button" disabled={disabled} onClick={() => setPlacementDirty(false)}>Use saved position</button><button className="text-button" disabled={disabled} onClick={() => setBasePosition(row.entry.atSample)}>Keep my typed position</button></div>}<p>Choose the range in the recording, then where this section begins in the video. All values are seconds.</p><div className="narration-field-row">{([["start", "Recording start"], ["end", "Recording end"], ["at", "Video position"]] as const).map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" value={timing[field]} disabled={disabled} onChange={event => { setTiming(value => ({ ...value, [field]: event.target.value })); if (field === "at") setPlacementDirty(true); else setTrimDirty(true); }} /></label>)}</div><div className="narration-actions"><button className="button" disabled={disabled || dirty || trimChangedElsewhere || !!row.cue && !trimDirty} onClick={saveCue}>Save recording range</button><button className="button" disabled={disabled || dirty || !placementDirty || positionChangedElsewhere} onClick={savePlacement}>Save video position</button><button className="button" disabled={disabled || dirty || trimDirty || placementDirty || !row.cue || !row.accepted.script || !row.accepted.audio || row.accepted.timing} onClick={() => edit("/acceptances", { kind: "timing", targets: [row.cue!.id] }, "Saved timing accepted.")}>{row.accepted.timing ? "✓ Timing accepted" : "Accept saved timing"}</button></div></div></>}
      <details className="narration-remove"><summary>Remove this section</summary><p>Accepted history remains saved. Any linked shot will need a new narration choice.</p><button className="text-button" disabled={disabled} onClick={() => edit("/segments", { patch: { remove: [row.entry.segmentId] } }, "Section removed. Review its shot links before applying narration.")}>Remove section</button></details>
    </div>
  </details>;
}
