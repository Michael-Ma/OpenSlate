import { TimelineAudioCache, audioWindow, audioKey } from './timeline-audio-cache';
import { audioAt, currentPlayback, scheduleAudioStart, syncAudio, timelineMediaIndex } from './timeline-playback-model';
import type { AudioPlacement, TimelinePlayback } from './timeline-playback-model';
import type { BoardCommand } from './StoryboardControls';
import type { AudioLibraryEntry } from './AudioLibraryPanel';
import { useProjectRefreshVersion } from './project-updates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StudioApi } from './api';
import type { ProjectSnapshot, Shot } from './model';
import { Icon, IconButton, Preview, useArtifact } from './components';
import { durationLabel } from './model';
interface TimelineProps { api: StudioApi; snapshot: ProjectSnapshot; command: BoardCommand; onImportAudio(): void; disabled: boolean; active?: boolean }
export function Timeline(props: TimelineProps) { return props.active === false ? null : <TimelineWorkspace {...props} />; }
function TimelineWorkspace({ api, snapshot, command, onImportAudio, disabled }: TimelineProps) {
  const revision = useProjectRefreshVersion(), [recordings, setRecordings] = useState<AudioLibraryEntry[]>([]);
  useEffect(() => { const abort = new AbortController(); void api.request<{ recordings: AudioLibraryEntry[] }>(`/api/projects/${encodeURIComponent(snapshot.project.id)}/audio-library`, { signal: abort.signal }).then(view => { if (!abort.signal.aborted) setRecordings(view.recordings); }).catch(() => {}); return () => abort.abort(); }, [api, snapshot.project.id, revision]);
  const [playback, setPlayback] = useState<TimelinePlayback | null>(null), [audioUrls, setAudioUrls] = useState<Record<string, string>>({}), [audioError, setAudioError] = useState(''), [audioLoading, setAudioLoading] = useState(false);
  const audioElements = useRef(new Map<string, HTMLAudioElement>()), playbackEpoch = useRef(0), audioCache = useRef<TimelineAudioCache | null>(null);
  const [audioRetry, setAudioRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(), epoch = ++playbackEpoch.current;
    setPlayback(null); setAudioUrls({}); setAudioError(''); setAudioLoading(true); setPlaying(false);
    for (const el of audioElements.current.values()) el.pause();
    const cache = new TimelineAudioCache((placement, signal) => api.narrationAudio(snapshot.project.id, placement.audioId, placement.sha256, signal), URL.revokeObjectURL,
      (urls, error) => { if (!abort.signal.aborted && epoch === playbackEpoch.current) { setAudioUrls(urls); setAudioError(error); if (error) setPlaying(false); } });
    audioCache.current = cache;
    void api.request<TimelinePlayback>(`/api/projects/${encodeURIComponent(snapshot.project.id)}/narration/playback`, { signal: abort.signal }).then(view => {
      if (abort.signal.aborted || epoch !== playbackEpoch.current) return;
      if (!currentPlayback(view, snapshot.project)) throw Error('Timeline changed. Refresh the project before playback.');
      setPlayback(view); setAudioLoading(false);
    }).catch(cause => { if (!abort.signal.aborted && epoch === playbackEpoch.current) { setAudioError(cause instanceof Error ? cause.message : 'Audio could not be loaded.'); setAudioLoading(false); } });
    return () => { abort.abort(); ++playbackEpoch.current; for (const el of audioElements.current.values()) el.pause(); cache.close(); if (audioCache.current === cache) audioCache.current = null; };
  }, [api, snapshot.project.id, snapshot.project.headVersion, snapshot.project.revisionId]);
  const placements: AudioPlacement[] = currentPlayback(playback, snapshot.project) ? [...playback!.placements, ...(playback!.soundtrack ? [playback!.soundtrack] : [])] : [];
  const mediaIndex = useMemo(() => timelineMediaIndex(snapshot), [snapshot.plan?.nodes, snapshot.outputs]);
  const shots = snapshot.project.scenes.flatMap(scene => snapshot.project.shots.filter(s => s.sceneId === scene.id));
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [showRender, setShowRender] = useState(false);
  const controlVersion = useRef(0), playingNow = useRef(false);
  const total = shots.reduce((n,s) => n + s.desiredFrames / 30, 0), video = useRef<HTMLVideoElement>(null), lastTick = useRef(0);
  const assignVideo = useCallback((element: HTMLVideoElement | null) => { if (!element) video.current?.pause(); video.current = element; }, []);
  let start = 0; const clips = shots.map(shot => { const at = start; start += shot.desiredFrames / 30; return { shot, at, end: start }; });
  const current = clips.find(c => position >= c.at && position < c.end) ?? clips.at(-1), media = current ? mediaIndex.get(current.shot.id) : null;
  const clip = useArtifact(api, snapshot.project.id, media?.video?.artifact ?? null), still = useArtifact(api, snapshot.project.id, media?.image?.artifact ?? null);
  const neededAudio = audioWindow(placements, position), neededKeys = [...new Set(neededAudio.map(audioKey))].join(',');
  useEffect(() => { audioCache.current?.select(neededAudio); }, [neededKeys, audioRetry]);
  const audioBuffering = placements.some(placement => audioAt(placement, position).active && !audioUrls[audioKey(placement)]);
  const buffering = audioLoading || audioBuffering || !!(media?.video ? !clip.url && !clip.error : media?.image ? !still.url && !still.error : false), buffered = useRef(false); buffered.current = buffering; playingNow.current = playing && !buffering;
  useEffect(() => { setPlaying(false); setPosition(0); }, [snapshot.project.id, snapshot.project.headVersion]);
  useEffect(() => {
    if (!playing) { video.current?.pause(); return; }
    lastTick.current = performance.now();
    const timer = setInterval(() => { const now = performance.now(), delta = (now - lastTick.current) / 1000; lastTick.current = now; if (buffered.current) return; setPosition(value => { const next = Math.min(total, value + delta); if (next >= total) setPlaying(false); return next; }); }, 33);
    return () => clearInterval(timer);
  }, [playing, total]);
  const playVideo = (el: HTMLVideoElement) => { const epoch = playbackEpoch.current, control = controlVersion.current; void el.play().catch(() => { if (epoch === playbackEpoch.current && control === controlVersion.current && video.current === el) setPlaying(false); }); };
  useEffect(() => { const el = video.current; if (!el || !clip.url) return; el.currentTime = Math.max(0, position - (current?.at ?? 0)); if (playing) playVideo(el); }, [clip.url, playing]);
  useEffect(() => {
    const epoch = playbackEpoch.current, control = controlVersion.current;
    for (const placement of placements) { const el = audioElements.current.get(placement.id); if (!el) continue;
      const pending = syncAudio(el, placement, position, playing && !audioLoading && !audioError && !buffering);
      if (pending) void pending.catch(() => { if (epoch === playbackEpoch.current && control === controlVersion.current) { setPlaying(false); setAudioError('Audio playback was blocked. Press play to try again.'); } });
    }
    if (video.current && clip.url) {
      const at = Math.max(0, position - (current?.at ?? 0));
      if (Math.abs(video.current.currentTime - at) > 0.2) video.current.currentTime = at;
      if (!playing || buffering) video.current.pause();
    }
  }, [position, playing, audioLoading, audioError, audioUrls, clip.url, current?.at, buffering]);
  useEffect(() => {
    if (!playing || buffering || audioLoading || audioError) return;
    const epoch = playbackEpoch.current, control = controlVersion.current, cancellations: Array<() => void> = [];
    for (const placement of neededAudio) {
      const el = audioElements.current.get(placement.id); if (!el || !audioUrls[audioKey(placement)]) continue;
      cancellations.push(scheduleAudioStart(el, placement, position, () => epoch === playbackEpoch.current && control === controlVersion.current && playingNow.current && !buffered.current && audioElements.current.get(placement.id) === el,
        () => { setPlaying(false); setAudioError('Audio playback was blocked. Press play to try again.'); }));
    }
    return () => cancellations.forEach(cancel => cancel());
  }, [position, playing, buffering, audioLoading, audioError, audioUrls, neededKeys]);
  const seek = (at: number) => { ++controlVersion.current; setPosition(at); if (video.current) video.current.currentTime = Math.max(0, at - ((clips.find(c => at >= c.at && at < c.end) ?? clips.at(-1))?.at ?? 0)); };
  if (!shots.length) return <div className="empty-storyboard"><h3>Your timeline starts with a shot.</h3><p>Develop your storyboard in the conversation.</p></div>;
  return <section className="film-timeline" aria-label="Timeline"><div className="timeline-player">{clip.url ? <video ref={assignVideo} src={clip.url} poster={still.url ?? undefined} muted playsInline preload="metadata" onLoadedMetadata={event => { const el = event.currentTarget; if (el !== video.current || el.currentSrc !== clip.url) return; el.currentTime = Math.max(0, position - (current?.at ?? 0)); if (playing) playVideo(el); }} aria-label="Timeline picture preview" /> : still.url ? <img src={still.url} alt={current?.shot.purpose} /> : <div className="timeline-missing"><Icon name="image" size={34} /><p>{clip.error || still.error ? 'Media unavailable' : 'This shot has no current media'}</p></div>}<span className="timeline-player-label">{current?.shot.purpose} · {media?.video ? media.video.fixture ? 'Fixture video' : 'Video' : 'Still · clip missing'}</span></div>
    <div className="timeline-transport"><IconButton icon="refresh" label="Return to beginning" onClick={() => seek(0)} /><IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause timeline preview' : 'Play timeline preview'} disabled={audioLoading} onClick={() => { ++controlVersion.current; if (position >= total) seek(0); if (audioError) { audioCache.current?.retry(); setAudioRetry(value => value + 1); setAudioError(''); } setPlaying(v => !v); }} /><span>{durationLabel(position * 30)} / {durationLabel(total * 30)}</span><small>{audioLoading ? "Loading sound…" : buffering ? "Loading picture…" : placements.length ? playback?.soundtrack ? playback.placements.length ? "Video + narration + music" : "Video + music" : "Video + narration" : "No accepted audio"}</small><button className="text-button" onClick={() => { ++controlVersion.current; setPlaying(false); setShowRender(v => !v); }}>{showRender ? 'Hide export' : 'Rendered export'}</button></div>
    {audioError && <p className="narration-feedback error" role="alert">{audioError}</p>}
    {neededAudio.map(placement => <TimelineAudio key={`${snapshot.project.revisionId}:${placement.id}`} id={placement.id} url={audioUrls[audioKey(placement)]} elements={audioElements.current} />)}
    <div className="timeline-scroll"><div className="timeline-tracks"><div className="timeline-scenes">{snapshot.project.scenes.map((scene,i) => <span key={scene.id} title={scene.purpose} style={{ flex: shots.filter(s => s.sceneId === scene.id).reduce((n,s) => n+s.desiredFrames,0) || 1 }}>{String(i+1).padStart(2,'0')} · {scene.purpose}</span>)}</div><input type="range" aria-label="Timeline playhead" min={0} max={total} step={0.1} value={position} onChange={e => seek(Number(e.target.value))} /><div className="timeline-lane"><span>Video</span><div>{clips.map(({ shot, at }) => <TimelineClip key={shot.id} api={api} snapshot={snapshot} shot={shot} media={mediaIndex.get(shot.id)} active={shot.id === current?.shot.id} select={() => seek(at)} />)}</div></div><div className="timeline-lane"><span>Voice</span><div>{shots.map(shot => <div key={shot.id} className={`timeline-voice ${shot.narration?.text ? 'script' : ''}`} style={{flex:shot.desiredFrames}} title={shot.narration?.text || 'No shot script'}>{shot.narration?.mode === 'generated' ? `${shot.narrationPending ? 'Draft' : 'Script'} · ${shot.narration.text || 'To write'}` : shot.cueId ? 'Saved narration cue' : ''}</div>)}</div></div></div></div>
    <div className="timeline-music"><span>Music</span><select aria-label="Background music" disabled={disabled} value={snapshot.project.soundtrack?.audioId ?? ''} onChange={e => command({ kind: 'soundtrack', field: 'audioId', value: e.target.value })}><option value="">No background music</option>{snapshot.project.soundtrack && !recordings.some(recording => recording.id === snapshot.project.soundtrack!.audioId) && <option value={snapshot.project.soundtrack.audioId}>Saved background music</option>}{recordings.map((r,i) => <option key={r.id} value={r.id}>{r.label || `Recording ${i+1}`} · {r.durationSeconds.toFixed(1)}s</option>)}</select>{snapshot.project.soundtrack && <label>Gain <select aria-label="Music gain" disabled={disabled} value={snapshot.project.soundtrack.gainMilliDb} onChange={e => command({ kind: 'soundtrack', field: 'gainMilliDb', value: e.target.value })}>{[-30000,-24000,-18000,-12000,-6000,0].map(g => <option key={g} value={g}>{g/1000} dB</option>)}</select></label>}<IconButton icon="plus" label="Import background music" onClick={onImportAudio} /><small>Starts at 0 · trims to film length · no looping</small></div>
    {showRender && <Preview api={api} snapshot={snapshot} />}
  </section>;
}
function TimelineClip({ api, snapshot, shot, media, active, select }: { api: StudioApi; snapshot: ProjectSnapshot; shot: Shot; media: ReturnType<typeof timelineMediaIndex> extends Map<string, infer V> ? V | undefined : never; active: boolean; select(): void }) {
  const image = useArtifact(api, snapshot.project.id, media?.image?.artifact ?? null);
  const scene = snapshot.project.scenes.findIndex(s => s.id === shot.sceneId), index = snapshot.project.shots.filter(s => s.sceneId === shot.sceneId).findIndex(s => s.id === shot.id);
  return <button className={`timeline-clip ${active ? 'active' : ''}`} style={{ flex:shot.desiredFrames, ...(image.url ? { backgroundImage:`url("${image.url}")` } : {}) }} onClick={select} title={shot.purpose} aria-label={`Seek to shot ${scene+1}.${index+1}`}><strong>{scene+1}.{index+1} · {shot.purpose}</strong><small>{media?.video ? 'Video' : media?.image ? 'Keyframe' : 'Missing'}</small></button>;
}

function TimelineAudio({ id, url, elements }: { id: string; url: string | undefined; elements: Map<string, HTMLAudioElement> }) {
  const assign = useCallback((element: HTMLAudioElement | null) => { if (element) elements.set(id, element); else { elements.get(id)?.pause(); elements.delete(id); } }, [id, elements]);
  return <audio ref={assign} src={url} preload="auto" hidden aria-hidden="true" />;
}
