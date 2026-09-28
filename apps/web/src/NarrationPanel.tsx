import { IconButton } from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { appendGeneratedRecordings, draftOf, isGeneratedRecording, narrationContinuation, narrationError, narrationReviewState, narrationTimingIssues, preparationCurrent, recordingBinding, recordingLabel, sampleSeconds, secondsToSamples } from "./narration-model";
import type { GeneratedRecordingPage, NarrationDraft, NarrationPreparation, NarrationSegment, NarrationView, Recording } from "./narration-model";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import { TranscriptReviewPanel } from "./TranscriptReviewPanel";
import { transcriptActionNotice } from "./transcript-review-model";
import { NarrationSpeechPanel } from "./NarrationSpeechPanel";
import { OwnedTranscriptionPanel } from "./OwnedTranscriptionPanel";
import "./narration.css";

interface Props { api: StudioApi; projectId: string; headVersion: number; shots: Array<{ id: string; purpose?: string; narration?: { mode: string; text: string; voice: string } }>; directorMode?: string; onChanged(): void; onContinue?(requestId: string): void; onReviewSpending?(candidateId: string): void }
type CompletionEffect = { kind: "prepare" | "apply" | "add" | "upload" } | { kind: "writing" | "trim" | "placement" | "restore" | "transcript_words" | "transcript_timing"; segmentId: string };
interface CommandMetadata { label: string; effect?: CompletionEffect }
const commandMetadata = (command: PendingCommand | null) => command?.metadata as CommandMetadata | undefined;
const ambiguous = (error: unknown) => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code);
const message = (error: unknown) => error instanceof ApiError ? narrationError(error.code, error.message) : error instanceof Error ? error.message : "The request could not be completed.";

export function NarrationPanel(props: Props) { return <NarrationWorkspace key={props.projectId} {...props} />; }
function NarrationWorkspace({ api, projectId, headVersion, shots, directorMode, onChanged, onContinue, onReviewSpending }: Props) {
  const projectUpdate = useProjectRefreshVersion();
  const recoveryReadOnly = useRecoveryReadOnly();
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const registry = pendingCommandsFor(api, "narration");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]), useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const busy = slot.running, pending = slot.command;
  const [view, setView] = useState<NarrationView | null>(null), [error, setError] = useState(""), [loadError, setLoadError] = useState(""), [notice, setNotice] = useState("");
  const [generated, setGenerated] = useState<GeneratedRecordingPage | null>(null), [generatedError, setGeneratedError] = useState(""), [loadingMore, setLoadingMore] = useState(false);
  const [prepared, setPrepared] = useState<NarrationPreparation | null>(null);
  const [adding, setAdding] = useState(shots.length === 1 && !!shots[0]?.narration?.text), [newDraft, setNewDraft] = useState<NarrationDraft>(() => { const intent = shots.length === 1 ? shots[0]?.narration : undefined; return intent ? { text: intent.text, textKind: 'draft', language: 'en', meaning: shots[0]!.purpose ?? "", source: intent.mode === 'generated' ? { kind: 'generated', voice: null, profileRevisionId: null } : { kind: 'uploaded' } } : draftOf(); });
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
    try { const next = await api.request<GeneratedRecordingPage>(`${base}/generated-recordings`); if (!mounted.current || ordinal !== loadOrdinal.current) return;
      setGenerated(current => current?.coverage.dataDigest === next.coverage.dataDigest ? current : next); setGeneratedError("");
    } catch (cause) { if (mounted.current && ordinal === loadOrdinal.current) setGeneratedError(message(cause)); }
  }
  async function loadMoreGenerated() {
    if (!generated || generated.coverage.nextOffset === null || loadingMore) return;
    const prior = generated; setLoadingMore(true); setGeneratedError("");
    try { const next = await api.request<GeneratedRecordingPage>(`${base}/generated-recordings?offset=${prior.coverage.nextOffset}&expectedDigest=${prior.coverage.dataDigest}`);
      if (!mounted.current) return;
      const merged = appendGeneratedRecordings(prior, next);
      setGenerated(current => current?.coverage.dataDigest === prior.coverage.dataDigest && current.coverage.nextOffset === prior.coverage.nextOffset ? merged : current);
    } catch (cause) { if (mounted.current) setGeneratedError(message(cause)); }
    finally { if (mounted.current) setLoadingMore(false); }
  }
  useEffect(() => { void load(); }, [api, projectId, headVersion, projectUpdate]);
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
      if ((effect?.kind === "transcript_words" || effect?.kind === "transcript_timing") && saved?.state) {
        const original = slot.settledCommand!.body as { expectedVersion: number };
        setNotice(transcriptActionNotice(effect.kind === "transcript_words" ? "words" : "timing", original.expectedVersion, saved.state.version));
      }
      // Generated service records contain private provenance; the GET projects their bounded review identities.
      if (saved?.state && saved.segments && saved.readiness && !saved.segments.some(row => row.audio && isGeneratedRecording(row.audio))) setView(current => current && saved.state!.version >= current.snapshot.state.version ? { ...current, snapshot: saved as NarrationView["snapshot"] } : current);
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
    if (recoveryReadOnly) return;
    setError(""); setNotice("");
    void registry.run(projectId, command, saved => saved.file ? api.upload(saved.path, saved.file, saved.key)
      : api.request(saved.path, { method: "POST", body: saved.body, key: saved.key, timeoutMs: 180000 }), ambiguous);
  }
  const locked = recoveryReadOnly || busy || !!pending, active = view?.session?.state === "active", disabled = locked || !active;
  const command = (suffix: string, body: unknown, label: string, effect?: CompletionEffect) => void execute({ path: `${base}${suffix}`, body, key: crypto.randomUUID(), metadata: { label, ...(effect ? { effect } : {}) } });
  const edit = (suffix: string, fields: Record<string, unknown>, label: string, effect?: CompletionEffect) => {
    if (!view?.session || disabled) return;
    command(suffix, { sessionId: view.session.id, expectedVersion: view.snapshot.state.version, ...fields }, label, effect);
  };
  const recordings = [...(view?.audioLibrary ?? []), ...(generated?.recordings ?? []).filter(audio => !view?.audioLibrary.some(saved => saved.id === audio.id))], selectedRecording = recordings.find(item => item.id === librarySelection);
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
    <header className="narration-heading"><div><span className="eyebrow">VOICE & STORY</span><h2 id="narration-title">Shape the narration</h2><p>Start with notes or a finished script. Choose an existing generated take or bring a recording, then review what is said and where it belongs.</p></div><IconButton icon="refresh" label="Refresh saved work" disabled={busy} onClick={() => void load()} /></header>
    <div className="narration-status" role="status"><span className={`narration-dot ${active ? "active" : ""}`} />{active ? "Narration session open · your edits stay together" : view?.session ? "This session needs an explicit continuation" : "Start a narration session to make changes"}
      {!active && view && <button className="button primary" disabled={locked} onClick={() => command("/sessions", narrationContinuation(view), "Narration session opened.")}>{view.continuationRequest ? "Continue this edit in narration" : view.session ? "Continue narration" : "Start narration"}</button>}
    </div>
    {!active && view?.continuationRequest && <p className="field-help">Continue your current edit: “{view.continuationRequest.text}”</p>}
    {(error || loadError) && <div className="narration-feedback error" role="alert">{error || loadError}</div>}{notice && <div className="narration-feedback" role="status">{notice}</div>}
    {pending && busy && <p role="status">Your saved narration request is still running. Switching projects will not start it again.</p>}
    {pending && !busy && <div className="narration-feedback"><p>The response was uncertain. Retry the same saved request to check its result.</p><button className="button primary" disabled={recoveryReadOnly} onClick={() => void execute(pending)}>Retry exact request</button></div>}
    {!view ? <p className="narration-empty">Loading your saved narration…</p> : <>
      {shots.length === 1 && <p className="field-help">Audio for {shots[0]!.purpose}. Other shot links are preserved. {shots[0]!.narration?.voice === "personal" && "Personal voice enrollment is not connected. Do not generate a stock voice as a substitute."}</p>}<div className="narration-steps"><span>01 · Write</span><span>02 · Listen & time</span><span>03 · Review changes</span></div>
      <div className="narration-section-header"><h3>Your sections <span>{view.snapshot.segments.length}</span></h3><IconButton label={adding ? "Close new section" : "Add a section"} icon={adding ? "close" : "plus"} disabled={disabled} onClick={() => setAdding(value => !value)} /></div>
      {!view.snapshot.segments.length && !adding && <div className="narration-empty"><strong>Start with words or a recording.</strong><p>Add a section for notes or a script, or upload a recording below and review its transcript first. Nothing is filled in or accepted for you.</p></div>}
      {adding && <div className="narration-card new"><h3>New narration section</h3><DraftFields draft={newDraft} update={setNewDraft} disabled={disabled} prefix="new-narration" /><div className="narration-actions"><button className="button primary" disabled={disabled} onClick={() => edit("/segments", { patch: { add: [newDraft] } }, "Section saved.", { kind: "add" })}>Save section</button><span>Notes and outlines can be refined before approval.</span></div></div>}
      {view.snapshot.segments.map((row, index) => <SegmentCard key={row.entry.segmentId} row={row} index={index} recordings={recordings} disabled={disabled} api={api} projectId={projectId} completion={slot} edit={edit} report={setError} retainTimingDirty={value => setUnsavedTiming(all => { if (!!all[row.entry.segmentId] === value) return all; const next = { ...all }; if (value) next[row.entry.segmentId] = true; else delete next[row.entry.segmentId]; return next; })} retainDraft={value => setUnsaved(all => { const next = { ...all }; if (value) next[row.entry.segmentId] = value; else delete next[row.entry.segmentId]; return next; })} />)}
      {Object.entries(unsaved).filter(([id]) => !view.snapshot.segments.some(row => row.entry.segmentId === id)).map(([id, draft]) => <div className="narration-card new" key={id}><h3>Your unsaved writing is still here</h3><p>This section was removed from the saved narration while you were editing.</p><blockquote>{draft.text}</blockquote><button className="button" disabled={disabled} onClick={() => edit("/segments", { patch: { add: [draft] } }, "Writing restored as a new section.", { kind: "restore", segmentId: id })}>Restore as a new section</button><button className="text-button" disabled={locked} onClick={() => setUnsaved(all => { const next = { ...all }; delete next[id]; return next; })}>Discard this unsaved writing</button></div>)}
      <section className="narration-recordings" aria-labelledby="recordings-title"><div><span className="eyebrow">YOUR RECORDINGS</span><h3 id="recordings-title">Choose and listen</h3><p>Choose an existing take or upload a recording. Listen before attaching it.</p><p className="field-help">New speech generation starts with a separately reviewed speech plan. Attaching a saved take does not generate or accept anything.</p></div>
        {view.capabilities?.audioImport === false && <p role="status">Writing and script review are available. Recording import needs configured local media tools. Existing generated takes can be previewed through their saved artifacts.</p>}
        <div className="narration-upload-row"><label>Recording source<select value={uploadOrigin} disabled={disabled || view.capabilities?.audioImport === false} onChange={event => setUploadOrigin(event.target.value as typeof uploadOrigin)}><option value="uploaded">My recording</option><option value="generated">Generated elsewhere</option></select></label><input ref={fileInput} type="file" accept="audio/*" aria-label="Choose a narration recording" disabled={disabled || view.capabilities?.audioImport === false} onChange={event => { const file = event.target.files?.[0]; if (!file || !view.session || view.capabilities?.audioImport === false) return;
          void execute({ path: `${base}/audio?sessionId=${encodeURIComponent(view.session.id)}&declaredOrigin=${uploadOrigin}`, file, key: crypto.randomUUID(), metadata: { label: "Recording uploaded. Listen, transcribe it, or attach it to a section.", effect: { kind: "upload" } } }); }} /></div>
        {recordings.length > 0 && <div className="narration-library"><label>Saved recordings<select value={librarySelection} onChange={event => setLibrarySelection(event.target.value)}><option value="">Choose a recording to listen</option>{recordings.map((audio, index) => <option key={audio.id} value={audio.id}>{recordingLabel(audio, index)}</option>)}</select></label>{selectedRecording && <RecordingPlayer api={api} projectId={projectId} recording={selectedRecording} />}</div>}
        {view.coverage.audioLibrary.nextOffset !== null && <p className="field-help">Showing the {view.audioLibrary.length} newest saved recordings out of {view.coverage.audioLibrary.total}. Older attached recordings remain available in their sections.</p>}
        {generatedError && <p className="narration-feedback error" role="alert">{generatedError}</p>}
        {generated && <p className="field-help">{generated.recordings.length} completed OpenSlate recording{generated.recordings.length === 1 ? "" : "s"} listed. Preview a take, attach it to a section, then review its audio and timing.</p>}
        {generated?.coverage.nextOffset !== null && generated && <button className="button" disabled={loadingMore} onClick={() => void loadMoreGenerated()}>{loadingMore ? "Loading recordings…" : "Load older generated recordings"}</button>}
        {shots.length === 1 && shots[0]?.narration?.voice === "personal" ? <p role="status">Personal voice generation is awaiting a connected voice provider. Choose Provider voice on the shot to use a stock voice.</p> : <NarrationSpeechPanel api={api} projectId={projectId} view={view} disabled={disabled} completion={slot} execute={execute} {...(onReviewSpending ? { onReviewSpending } : {})} />}
        <OwnedTranscriptionPanel api={api} projectId={projectId} view={view} recording={selectedRecording ?? null} disabled={disabled} completion={slot} execute={execute} {...(onReviewSpending ? { onReviewSpending } : {})} />
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
  return <div className="narration-draft-fields"><label htmlFor={`${prefix}-text`}>Words or notes<textarea id={`${prefix}-text`} rows={4} value={draft.text} maxLength={16000} disabled={disabled} onChange={event => update({ ...draft, text: event.target.value })} placeholder="What should the audience hear?" /></label><div className="narration-field-row"><label>How finished is it?<select value={draft.textKind} disabled={disabled} onChange={event => update({ ...draft, textKind: event.target.value as NarrationDraft["textKind"] })}><option value="notes">Notes</option><option value="outline">Outline</option><option value="draft">Finished draft</option></select></label><label>Recording source<select value={draft.source.kind} disabled={disabled} onChange={event => update({ ...draft, source: event.target.value === "generated" ? { kind: "generated", voice: null, profileRevisionId: null } : { kind: event.target.value as "uploaded" | "undecided" } })}><option value="undecided">Choose later</option><option value="uploaded">My recording</option><option value="generated">Generated audio</option></select></label><label>Language<input value={draft.language} maxLength={64} disabled={disabled} onChange={event => update({ ...draft, language: event.target.value })} /></label></div><label htmlFor={`${prefix}-meaning`}>What should this section communicate?<input id={`${prefix}-meaning`} value={draft.meaning} maxLength={4000} disabled={disabled} onChange={event => update({ ...draft, meaning: event.target.value })} placeholder="The main idea the visuals should support" /></label></div>;
}
function RecordingPlayer({ api, projectId, recording }: { api: StudioApi; projectId: string; recording: Recording }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const owned = useRef(""), controller = useRef<AbortController | null>(null);
  useEffect(() => { setUrl(""); setError(""); setBusy(false); return () => { controller.current?.abort(); if (owned.current) URL.revokeObjectURL(owned.current); owned.current = ""; }; }, [recording.id, recording.media.sha256]);
  async function load() { controller.current?.abort(); const request = new AbortController(); controller.current = request; setBusy(true); setError("");
    try { const result = isGeneratedRecording(recording)
      ? await api.artifact(projectId, { artifactId: recording.id, sha256: recording.media.sha256, kind: "audio" }, request.signal)
      : await api.narrationAudio(projectId, recording.id, recording.media.sha256, request.signal);
      if (request.signal.aborted) { URL.revokeObjectURL(result); return; } if (owned.current) URL.revokeObjectURL(owned.current); owned.current = result; setUrl(result); }
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
  const selectedAudio = available.find(audio => audio.id === selected);
  function attach() { if (!selectedAudio) return; try { const selection = recordingBinding(row, selectedAudio); edit(selection.suffix, selection.fields, "Recording attached. Review the saved audio and timing separately."); } catch (cause) { report(message(cause)); } }
  function saveCue() { try { const startSample = secondsToSamples(timing.start), endSample = secondsToSamples(timing.end); if (endSample <= startSample) throw new Error("The end must be after the start."); edit("/cues", { segmentId: row.entry.segmentId, startSample, endSample }, "Source timing saved.", { kind: "trim", segmentId: row.entry.segmentId }); } catch (error) { report(message(error)); } }
  function savePlacement() { try { edit("/placements", { placements: [{ segmentId: row.entry.segmentId, atSample: secondsToSamples(timing.at) }] }, "Narration placement saved.", { kind: "placement", segmentId: row.entry.segmentId }); } catch (error) { report(message(error)); } }
  return <details className="narration-card" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary><span className="narration-section-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{row.script.text.slice(0, 75) || "Untitled narration section"}</strong><span>{row.accepted.script ? "Script accepted" : row.script.textKind === "draft" ? "Draft to review" : "Writing in progress"} · {row.accepted.audio ? "Recording accepted" : row.audio ? "Recording attached" : "No recording"} · {row.accepted.timing ? "Timing accepted" : "Timing to review"}</span></div></summary>
    <div className="narration-card-body"><DraftFields draft={draft} update={value => { setDraft(value); setDirty(true); retainDraft(value); }} disabled={disabled} prefix={`narration-${row.entry.segmentId}`} />
      {dirty && !changedElsewhere && <button className="text-button" disabled={disabled} onClick={() => { setDraft(draftOf(row.script)); setBaseRevision(row.script.id); setDirty(false); retainDraft(null); }}>Revert unsaved writing</button>}
      {(trimDirty || placementDirty) && <button className="text-button" disabled={disabled} onClick={() => { setTrimDirty(false); setPlacementDirty(false); }}>Revert unsaved timing</button>}
      {changedElsewhere && <div className="narration-feedback"><p>A newer script was saved. Your typed text has been kept.</p><blockquote>{row.script.text}</blockquote><button className="text-button" disabled={disabled} onClick={() => { setDraft(draftOf(row.script)); setBaseRevision(row.script.id); setDirty(false); retainDraft(null); }}>Use saved version</button><button className="text-button" disabled={disabled} onClick={() => setBaseRevision(row.script.id)}>Keep my edits over this version</button></div>}
      <div className="narration-actions"><button className="button" disabled={disabled || !dirty || changedElsewhere} onClick={() => edit("/segments", { patch: { update: [{ segmentId: row.entry.segmentId, draft }] } }, "Section saved.", { kind: "writing", segmentId: row.entry.segmentId })}>Save writing</button><button className="button" disabled={disabled || dirty || row.accepted.script || row.script.textKind !== "draft" || !row.script.text.trim() || !row.script.meaning.trim()} onClick={() => edit("/acceptances", { kind: "script", targets: [row.script.id] }, "Saved script accepted.")}>{row.accepted.script ? "✓ Script accepted" : "Accept saved script"}</button></div>
      <div className="narration-recording-binding"><label>Attach a saved recording<select value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}><option value="">Choose a recording</option>{available.map((audio, i) => <option key={audio.id} value={audio.id}>{recordingLabel(audio, i)}</option>)}</select></label><button className="button" disabled={disabled || dirty || !selectedAudio || selected === row.audio?.id} onClick={attach}>Attach recording</button></div>
      {selectedAudio && selectedAudio.id !== row.audio?.id && <><p className="field-help">Preview the selected recording before attaching. It may differ from the saved script; acceptance stays separate.</p><RecordingPlayer key={`preview:${selectedAudio.id}`} api={api} projectId={projectId} recording={selectedAudio} /></>}
      {row.audio && <><RecordingPlayer api={api} projectId={projectId} recording={row.audio} /><button className="button" disabled={disabled || dirty || selected !== row.audio.id || row.accepted.audio} onClick={() => edit("/audio-acceptances", { targets: [{ segmentRevisionId: row.script.id, audioId: row.audio!.id }] }, "Attached recording accepted.")}>{row.accepted.audio ? "✓ Recording accepted" : "Accept attached recording"}</button>
        <TranscriptReviewPanel api={api} projectId={projectId} row={row} disabled={disabled || dirty || trimDirty || placementDirty || selected !== row.audio.id} useSelection={(action, fields) => edit(`/transcript-${action}`, fields, "Narration selection saved.", { kind: action === "words" ? "transcript_words" : "transcript_timing", segmentId: row.entry.segmentId })} />
        <div className="narration-time-fields">{trimChangedElsewhere && <div className="narration-feedback"><p>The saved recording or range changed. Your typed values are still here.</p><button className="text-button" disabled={disabled} onClick={() => setTrimDirty(false)}>Reload saved range</button><button className="text-button" disabled={disabled} onClick={() => setBaseTrim(trimSubject)}>Keep my typed range</button></div>}{positionChangedElsewhere && <div className="narration-feedback"><p>The saved position changed to {sampleSeconds(row.entry.atSample)}s.</p><button className="text-button" disabled={disabled} onClick={() => setPlacementDirty(false)}>Use saved position</button><button className="text-button" disabled={disabled} onClick={() => setBasePosition(row.entry.atSample)}>Keep my typed position</button></div>}<p>Choose the range in the recording, then where this section begins in the video. All values are seconds.</p><div className="narration-field-row">{([["start", "Recording start"], ["end", "Recording end"], ["at", "Video position"]] as const).map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" value={timing[field]} disabled={disabled} onChange={event => { setTiming(value => ({ ...value, [field]: event.target.value })); if (field === "at") setPlacementDirty(true); else setTrimDirty(true); }} /></label>)}</div><div className="narration-actions"><button className="button" disabled={disabled || dirty || trimChangedElsewhere || !!row.cue && !trimDirty} onClick={saveCue}>Save recording range</button><button className="button" disabled={disabled || dirty || !placementDirty || positionChangedElsewhere} onClick={savePlacement}>Save video position</button><button className="button" disabled={disabled || dirty || trimDirty || placementDirty || !row.cue || !row.accepted.script || !row.accepted.audio || row.accepted.timing} onClick={() => edit("/acceptances", { kind: "timing", targets: [row.cue!.id] }, "Saved timing accepted.")}>{row.accepted.timing ? "✓ Timing accepted" : "Accept saved timing"}</button></div></div></>}
      <details className="narration-remove"><summary>Remove this section</summary><p>Accepted history remains saved. Any linked shot will need a new narration choice.</p><button className="text-button" disabled={disabled} onClick={() => edit("/segments", { patch: { remove: [row.entry.segmentId] } }, "Section removed. Review its shot links before applying narration.")}>Remove section</button></details>
    </div>
  </details>;
}
