import { shotAudioReview } from './shot-audio-model';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { StudioApi } from './api';
import { ApiError } from './api';
import { IconButton } from './components';
import { useProjectRefreshVersion } from './project-updates';
import { useRecoveryReadOnly } from './RecoveryPanel';
import { pendingCommandsFor } from './pending-command';
import type { PendingCommand } from './pending-command';
import { isGeneratedRecording, recordingBinding, recordingLabel, sampleSeconds, secondsToSamples } from './narration-model';
import type { GeneratedRecordingPage, NarrationSegment, NarrationView, Recording } from './narration-model';
import { speechStatus } from './narration-speech-model';
import type { SpeechDetail, SpeechOptions } from './narration-speech-model';
import { UiButton } from './ui';
import './shot-audio.css';
interface ShotAudioView { shotId: string; headVersion: number; plannedFrames: number; segment: NarrationSegment | null; latestSpeechProposalId: string | null; session: NarrationView["session"]; intentCurrent?: boolean; committed: boolean }
interface Props { active?: boolean; api: StudioApi; projectId: string; headVersion: number; shot: { id: string; desiredFrames?: number; purpose?: string; narration?: { mode: string; text: string; voice: string } }; onChanged(): void; onContinue?(requestId: string): void; onRequested?(): void; onViewJobs?(candidateId: string): void }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The audio request could not complete.';
const ambiguous = (cause: unknown) => !(cause instanceof ApiError) || ['NETWORK_ERROR', 'REQUEST_FAILED', 'INTERNAL_ERROR'].includes(cause.code);
/** Compact human workflow. Script/recording/range stay candidates until the explicit final acceptance. */
export function ShotAudioPanel({ active: visible = true, api, projectId, headVersion, shot, onChanged, onContinue, onRequested, onViewJobs }: Props) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`, shotBase = `${base}/shots/${encodeURIComponent(shot.id)}`;
  const updates = useProjectRefreshVersion(), recovery = useRecoveryReadOnly(), registry = pendingCommandsFor(api, 'shot-audio');
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]), useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const [view, setView] = useState<NarrationView | null>(null), [detail, setDetail] = useState<ShotAudioView | null>(null), [recordings, setRecordings] = useState<Recording[]>([]), [options, setOptions] = useState<SpeechOptions | null>(null);
  const [text, setText] = useState(shot.narration?.text ?? ''), [dirty, setDirty] = useState(false), [scriptBase, setScriptBase] = useState<string | null>(null);
  const [mode, setMode] = useState<'uploaded' | 'generated'>(shot.narration?.mode === 'uploaded' ? 'uploaded' : 'generated'), [profileId, setProfileId] = useState(''), [voice, setVoice] = useState('cedar');
  const [recordingId, setRecordingId] = useState(''), [start, setStart] = useState('0'), [end, setEnd] = useState(''), [trimDirty, setTrimDirty] = useState(false), [matchDuration, setMatchDuration] = useState(false);
  const [speech, setSpeech] = useState<SpeechDetail | null>(null), [speechId, setSpeechId] = useState(''), [refresh, setRefresh] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState(''), [listened, setListened] = useState('');
  const [url, setUrl] = useState(''), [urlIdentity, setUrlIdentity] = useState(''), [audioBusy, setAudioBusy] = useState(false), fileInput = useRef<HTMLInputElement>(null), audioPlayer = useRef<HTMLAudioElement>(null), previewOwner = useRef<StudioApi | null>(null), observed = useRef(slot.settledVersion);
  const assignAudio = useCallback((element: HTMLAudioElement | null) => { if (!element) audioPlayer.current?.pause(); audioPlayer.current = element; }, []);
  const writing = useRef({ dirty, text }); writing.current = { dirty, text };
  const row = detail?.segment ?? null, active = view?.session?.state === 'active', locked = !visible || recovery || slot.running || !!slot.command, disabled = locked || !active;
  const recording = recordings.find(recording => recording.id === recordingId) ?? (row?.audio?.id === recordingId ? row.audio : null);
  const personal = shot.narration?.voice === 'personal';
  const personalVoices = (options as SpeechOptions & { personalVoices?: { id: string; label: string; ready: boolean }[] } | null)?.personalVoices?.filter(voice => voice.ready) ?? [];
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    void Promise.all([api.request<NarrationView>(base, { signal: abort.signal }), api.request<ShotAudioView>(shotBase, { signal: abort.signal }), api.request<GeneratedRecordingPage>(`${base}/generated-recordings`, { signal: abort.signal })]).then(([workspace, next, generated]) => {
      if (abort.signal.aborted) return; setView({ ...workspace, session: next.session, continuationRequest: null }); setDetail(next);
      if (next.intentCurrent === false && !writing.current.dirty) { setText(shot.narration?.text ?? next.segment?.script.text ?? ''); setMode(shot.narration?.mode === 'generated' ? 'generated' : 'uploaded'); setScriptBase(next.segment?.script.id ?? null); setDirty(true); }
      const merged = [...workspace.audioLibrary, ...generated.recordings.filter(recording => !workspace.audioLibrary.some(saved => saved.id === recording.id))];
      if (next.segment?.audio && !merged.some(recording => recording.id === next.segment!.audio!.id)) merged.push(next.segment.audio);
      setRecordings(merged);
    }).catch(cause => { if (!abort.signal.aborted) setError(message(cause)); });
    void api.request<SpeechOptions>(`${base}/speech-options`, { signal: abort.signal }).then(next => { if (!abort.signal.aborted) { setOptions(next); setProfileId(current => next.preferredProfileId !== undefined ? next.profiles.find(profile => profile.id === next.preferredProfileId)?.id ?? '' : next.profiles.some(profile => profile.id === current) ? current : next.profiles[0]?.id ?? ''); if (!personal) setVoice(current => next.voices.includes(current) ? current : next.voices.find(item => !item.startsWith('openai-custom:')) ?? ''); } }).catch(() => {});
    return () => abort.abort();
  }, [visible, api, base, shotBase, headVersion, updates, refresh]);
  useEffect(() => { if (!row || dirty) return; setText(row.script.text); setScriptBase(row.script.id); setMode(row.script.source.kind === 'generated' ? 'generated' : 'uploaded'); if (row.script.source.kind === 'generated' && row.script.source.voice) setVoice(row.script.source.voice); }, [row?.script.id, dirty]);
  useEffect(() => { if (!trimDirty && row) { setRecordingId(row.audio?.id ?? ''); setStart(sampleSeconds(row.cue?.startSample ?? 0)); setEnd(sampleSeconds(row.cue?.endSample ?? row.audio?.media.probe.audio?.samples ?? 0)); } }, [row?.audio?.id, row?.cue?.id, trimDirty]);
  useEffect(() => { setSpeechId(detail?.latestSpeechProposalId ?? ''); }, [shot.id, row?.script.id]);
  useEffect(() => { if (!visible) return; if (!speechId) { setSpeech(null); return; } const abort = new AbortController(); void api.request<SpeechDetail>(`${base}/speech-proposals/${encodeURIComponent(speechId)}`, { signal: abort.signal }).then(next => { if (!abort.signal.aborted) setSpeech(next); }).catch(cause => { if (!abort.signal.aborted) setError(message(cause)); }); return () => abort.abort(); }, [visible, api, base, speechId, updates, refresh]);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return; observed.current = slot.settledVersion;
    const meta = slot.settledCommand?.metadata as { action?: string; shotId?: string } | undefined;
    if (meta?.shotId && meta.shotId !== shot.id) { onChanged(); setRefresh(value => value + 1); return; }
    if (slot.lastSuccess) { setError(''); const accepted = slot.result as { receipt?: { planRebase?: { status: string; message?: string } } }; setNotice(meta?.action === 'accept' ? accepted.receipt?.planRebase?.status === 'requires_plan_review' ? `Narration accepted. Update the visual plan: ${accepted.receipt.planRebase.message ?? 'the current plan needs review.'}` : 'Narration accepted for this shot.' : 'Saved.');
      if (meta?.action === 'script') { setDirty(false); setTrimDirty(false); }
      if (meta?.action === 'upload') { const audio = slot.result as Recording; setRecordingId(audio.id); setStart('0'); setEnd(sampleSeconds(audio.media.probe.audio?.samples ?? 0)); setTrimDirty(true); }
      if (meta?.action === 'speech-prepare' || meta?.action === 'speech-request') { setSpeechId((slot.result as { proposal: { id: string } }).proposal.id); setDirty(false); setTrimDirty(false); if(meta.action==='speech-request')onRequested?.(); }
      if (meta?.action === 'accept') setTrimDirty(false);
      onChanged(); setRefresh(value => value + 1);
    } else if (slot.error) setError(message(slot.error));
  }, [slot.settledVersion]);
  const run = (command: PendingCommand) => { setError(''); setNotice(''); const metadata = command.metadata as { shotId?: string } | undefined; const captured = metadata?.shotId ? command : { ...command, metadata: { ...command.metadata as object, shotId: shot.id } }; void registry.run(projectId, captured, async saved => {
    const meta = saved.metadata as { action?: string; shotId?: string } | undefined;
    if (saved.file && meta?.action === 'upload') {
      const initialized = await api.request<ShotAudioView>(saved.path, { method: 'POST', body: saved.body, key: saved.key });
      if (!initialized.session) throw Error('The shot audio session could not be opened.');
      return api.upload(`${base}/audio?sessionId=${encodeURIComponent(initialized.session.id)}&declaredOrigin=uploaded`, saved.file, saved.key);
    }
    return saved.file ? api.upload(saved.path, saved.file, saved.key) : api.request(saved.path, { method: 'POST', body: saved.body, key: saved.key, timeoutMs: 180000 });
  }, ambiguous); };
  const post = (path: string, body: unknown, action: string) => run({ path, body, key: crypto.randomUUID(), metadata: { action } });
  const edit = (suffix: string, fields: Record<string, unknown>, action: string) => { if (view?.session && !disabled) post(`${base}${suffix}`, { sessionId: view.session.id, expectedVersion: view.snapshot.state.version, ...fields }, action); };
  const changedElsewhere = dirty && !!row && row.script.id !== scriptBase;
  const selectionKey = recording ? `${projectId}:${recording.id}:${recording.media.sha256}` : '';
  useEffect(() => {
    setUrl(''); setUrlIdentity(''); setListened(''); setAudioBusy(visible && !!recording); if (!visible || !recording) return;
    const abort = new AbortController(); let owned = '';
    const load = isGeneratedRecording(recording) ? api.artifact(projectId, { artifactId: recording.id, sha256: recording.media.sha256, kind: 'audio' }, abort.signal) : api.narrationAudio(projectId, recording.id, recording.media.sha256, abort.signal);
    void load.then(next => { if (abort.signal.aborted) URL.revokeObjectURL(next); else { owned = next; previewOwner.current = api; setUrlIdentity(selectionKey); setUrl(next); setAudioBusy(false); } }).catch(cause => { if (!abort.signal.aborted) { setAudioBusy(false); setError(message(cause)); } });
    return () => { audioPlayer.current?.pause(); abort.abort(); if (owned) URL.revokeObjectURL(owned); };
  }, [visible, api, projectId, selectionKey]);
  useEffect(() => { setListened(''); }, [start, end]);
  let rangeSamples = 0, startSample: number | null = null, endSample: number | null = null; try { startSample = secondsToSamples(start); endSample = secondsToSamples(end); rangeSamples = endSample - startSample; } catch {}
  const previewUrl = visible && !api.closed && previewOwner.current === api && urlIdentity === selectionKey ? url : '';
  const plannedFrames = detail?.plannedFrames ?? shot.desiredFrames ?? 180;
  const rangeIdentity = `${selectionKey}:${start}:${end}`;
  const audioReview = shotAudioReview({ active, locked, dirty: dirty || changedElsewhere, row, recording, heardIdentity: listened, displayedIdentity: rangeIdentity, startSample, endSample, plannedFrames, durationMode: matchDuration ? 'match_audio' : 'keep' });
  const { canAccept, rangeValid } = audioReview;
  const initialization = () => ({ expectedHeadVersion: view?.headVersion ?? headVersion, expectedNarrationVersion: view?.snapshot.state.version,
    ...(view?.session?.state === 'active' ? { sessionId: view.session.id } : detail?.session ? { continuationSessionId: detail.session.id } : {}),
    text: text.trim(), mode, ...(mode === 'generated' && voice ? { voice } : {}), ...(profileId ? { profileId } : {}) });
  const saveScript = () => { if (!view || locked || changedElsewhere) return; post(`${shotBase}/initialize`, initialization(), 'script'); };
  return <section className="shot-audio-panel" aria-label="Shot narration"><header><div><h2>Narration</h2><p>{shot.purpose}</p></div><IconButton icon="refresh" label="Refresh shot audio" disabled={locked} onClick={() => setRefresh(value => value + 1)} /></header>
    {error && <p role="alert" className="narration-feedback error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {detail?.intentCurrent === false && <p role="status">The shot’s audio direction changed. Save these current words or revise them before preparing new speech.</p>}
    {slot.command && !slot.running && <button className="button" onClick={() => run(slot.command!)}>Retry saved request</button>}
    {!view ? <p>Loading…</p> : <>
      <div className="shot-audio-source"><label>Source<select value={mode} disabled={locked} onChange={event => { setMode(event.target.value as typeof mode); setDirty(true); }}><option value="generated">Generate speech</option><option value="uploaded">Upload recording</option></select></label>{mode === 'generated' && <><p className="field-help">{options?.profiles.find(profile => profile.id === profileId)?.model ?? 'Choose narration model in Project settings'}</p><label>Voice<select value={voice} disabled={locked} onChange={event => { setVoice(event.target.value); setDirty(true); }}>{personal ? <><option value="">Choose your registered voice</option>{personalVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</> : options?.voices.map(voice => <option key={voice} value={voice}>{voice}</option>)}</select></label></> }</div>
      <label className="shot-audio-script">{mode === "uploaded" ? "Words or description" : "Script"}<textarea rows={3} maxLength={16000} value={text} disabled={locked} onChange={event => { setText(event.target.value); setDirty(true); }} placeholder={mode === "uploaded" ? "Optional description of this recording" : "Words for this shot"} /></label>
      {changedElsewhere && <p role="status">A newer script was saved. Your draft is kept. <button className="text-button" onClick={() => { setScriptBase(row?.script.id ?? null); }}>Keep my draft</button><button className="text-button" onClick={() => setDirty(false)}>Use saved script</button></p>}
      <div className="shot-audio-actions"><IconButton icon="check" label="Save shot script" disabled={locked || !text.trim() || changedElsewhere} onClick={saveScript} />
        {mode === 'generated' ? <UiButton variant="primary" disabled={locked || changedElsewhere || !text.trim() || !profileId || !options?.capabilities.configured || personal && !personalVoices.some(item => item.id === voice)} onClick={() => { const { mode: _mode, ...input } = initialization(); post(`${shotBase}/generate`, input, 'speech-request'); }}>Generate narration</UiButton> : <UiButton variant="primary" disabled={locked || changedElsewhere || view.capabilities?.audioImport === false} onClick={() => fileInput.current?.click()}>Upload recording</UiButton>}
        <input hidden ref={fileInput} type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; if (file) run({ path: `${shotBase}/initialize`, body: initialization(), key: crypto.randomUUID(), file, metadata: { action: 'upload' } }); event.target.value = ''; }} />
      </div>
      {mode === "generated" && !options?.capabilities.configured && <p role="status">Select and configure a speech model in Settings to generate narration.</p>}
      {personal && mode === 'generated' && !personalVoices.length && <p role="status">Enroll your recorded voice in Settings before generating speech.</p>}
      {speech && <div className="shot-speech-review"><strong>{speech.proposal.voice} · {speech.proposal.model.model}</strong><blockquote>{speech.proposal.segment.text}</blockquote><p>{speech.application ? speechStatus(speech.execution.state) : 'Earlier preparation saved. Use Generate narration to request the current script.'}</p>{speech.execution.candidateId && onViewJobs && <UiButton onClick={() => onViewJobs(speech.execution.candidateId!)}>View job status</UiButton>}</div>}
      <><label className="shot-audio-recording">Recording<select value={recordingId} disabled={disabled} onChange={event => { setRecordingId(event.target.value); const next = recordings.find(recording => recording.id === event.target.value); setStart('0'); setEnd(sampleSeconds(next?.media.probe.audio?.samples ?? 0)); setTrimDirty(true); }}><option value="">Choose a take</option>{recordings.map((recording, index) => <option key={recording.id} value={recording.id}>{recordingLabel(recording, index)}</option>)}</select></label>
        {recording && recording.id !== row?.audio?.id && <IconButton icon="check" label="Use this recording for the shot" disabled={disabled || dirty || !row} onClick={() => { if (!row) return; try { const binding = recordingBinding(row, recording); edit(binding.suffix, binding.fields, 'bind'); } catch (cause) { setError(message(cause)); } }} />}
        {audioBusy ? <p>Checking recording…</p> : previewUrl && <audio ref={assignAudio} controls src={previewUrl} aria-label="Listen to shot narration" onPlay={event => { if (event.currentTarget.currentSrc !== previewUrl || event.currentTarget !== audioPlayer.current) { event.currentTarget.pause(); return; } if (audioPlayer.current && startSample !== null && endSample !== null && (audioPlayer.current.currentTime < startSample / 48000 || audioPlayer.current.currentTime >= endSample / 48000)) audioPlayer.current.currentTime = startSample / 48000; setListened(rangeIdentity); }} onTimeUpdate={() => { if (audioPlayer.current && endSample !== null && audioPlayer.current.currentTime >= endSample / 48000) audioPlayer.current.pause(); }} />}
        {recording && <div className="shot-audio-range"><label>From<input inputMode="decimal" value={start} onChange={event => { setStart(event.target.value); setTrimDirty(true); }} disabled={disabled} /></label><label>To<input inputMode="decimal" value={end} onChange={event => { setEnd(event.target.value); setTrimDirty(true); }} disabled={disabled} /></label><span>{(rangeSamples / 48000).toFixed(2)}s voice · {(plannedFrames / 30).toFixed(2)}s shot</span></div>}
        {recording && <label className="shot-duration-choice"><input type="checkbox" checked={matchDuration} disabled={disabled} onChange={event => setMatchDuration(event.target.checked)} />Match the shot to the recording (3–15s)</label>}
        {recording && !row && <p role="status">Save the words or describe this recording before accepting it.</p>}
        {recording && !rangeValid && <p role="status">{matchDuration ? 'Choose a 3–15 second range within this recording.' : 'Choose a nonempty range within this shot’s planned duration, or explicitly match a longer recording.'}</p>}
        <div className="shot-audio-final"><span>{detail?.committed && !dirty && !trimDirty ? 'Accepted narration' : 'Listen, then accept the script, recording and range.'}</span><IconButton icon="check" label="Accept narration and timing for this shot" disabled={disabled || !canAccept} onClick={() => { if (!view.session || !row || !recording) return; try { post(`${shotBase}/accept`, { sessionId: view.session.id, expectedHeadVersion: view.headVersion, expectedVersion: view.snapshot.state.version, segmentId: row.entry.segmentId, segmentRevisionId: row.script.id, audioId: recording.id, sha256: recording.media.sha256, startSample: secondsToSamples(start), endSample: secondsToSamples(end), durationMode: matchDuration ? 'match_audio' : 'keep' }, 'accept'); } catch (cause) { setError(message(cause)); } }} /></div>
        {detail?.committed && onContinue && view.session && <button className="text-button" onClick={() => onContinue(view.session!.requestId)}>Continue with director</button>}
      </>
    </>}
  </section>;
}
