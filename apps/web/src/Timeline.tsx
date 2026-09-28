import type { BoardCommand } from './StoryboardControls';
import type { NarrationView } from './narration-model';
import { useProjectRefreshVersion } from './project-updates';
import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from './api';
import type { ProjectSnapshot, Shot } from './model';
import { Icon, IconButton, Preview, useArtifact } from './components';
import { durationLabel } from './model';
function sources(snapshot: ProjectSnapshot, shot: Shot) {
  const find = (kind: string) => snapshot.outputs.find(output => snapshot.plan?.nodes?.some(n => n.id === output.nodeId && n.shotId === shot.id && n.kind === kind));
  return { video: find('video'), image: find('image') };
}
export function Timeline({ api, snapshot, command, onImportAudio, disabled }: { api: StudioApi; snapshot: ProjectSnapshot; command: BoardCommand; onImportAudio(): void; disabled: boolean }) {
  const revision = useProjectRefreshVersion(), [recordings, setRecordings] = useState<NarrationView["audioLibrary"]>([]);
  useEffect(() => { const abort = new AbortController(); void api.request<NarrationView>(`/api/projects/${encodeURIComponent(snapshot.project.id)}/narration`, { signal: abort.signal }).then(view => { if (!abort.signal.aborted) setRecordings(view.audioLibrary); }).catch(() => {}); return () => abort.abort(); }, [api, snapshot.project.id, revision]);
  const shots = snapshot.project.scenes.flatMap(scene => snapshot.project.shots.filter(s => s.sceneId === scene.id));
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [showRender, setShowRender] = useState(false);
  const total = shots.reduce((n,s) => n + s.desiredFrames / 30, 0), video = useRef<HTMLVideoElement>(null), lastTick = useRef(0);
  let start = 0; const clips = shots.map(shot => { const at = start; start += shot.desiredFrames / 30; return { shot, at, end: start }; });
  const current = clips.find(c => position >= c.at && position < c.end) ?? clips.at(-1), media = current ? sources(snapshot, current.shot) : null;
  const clip = useArtifact(api, snapshot.project.id, media?.video?.artifact ?? null), still = useArtifact(api, snapshot.project.id, media?.image?.artifact ?? null);
  useEffect(() => { setPlaying(false); setPosition(0); }, [snapshot.project.id, snapshot.project.headVersion]);
  useEffect(() => {
    if (!playing) { video.current?.pause(); return; }
    lastTick.current = performance.now();
    const timer = setInterval(() => { const now = performance.now(), delta = (now - lastTick.current) / 1000; lastTick.current = now; setPosition(value => { const next = Math.min(total, value + delta); if (next >= total) setPlaying(false); return next; }); }, 100);
    return () => clearInterval(timer);
  }, [playing, total]);
  useEffect(() => { const el = video.current; if (!el || !clip.url) return; el.currentTime = Math.max(0, position - (current?.at ?? 0)); if (playing) void el.play().catch(() => setPlaying(false)); }, [clip.url, playing]);
  const seek = (at: number) => { setPosition(at); if (video.current) video.current.currentTime = Math.max(0, at - (clips.find(c => at >= c.at && at < c.end)?.at ?? 0)); };
  if (!shots.length) return <div className="empty-storyboard"><h3>Your timeline starts with a shot.</h3><p>Develop your storyboard in the conversation.</p></div>;
  return <section className="film-timeline" aria-label="Timeline"><div className="timeline-player">{clip.url ? <video ref={video} src={clip.url} poster={still.url ?? undefined} muted playsInline preload="metadata" onLoadedMetadata={() => { if (video.current) { video.current.currentTime = Math.max(0, position - (current?.at ?? 0)); if (playing) void video.current.play().catch(() => setPlaying(false)); } }} aria-label="Timeline picture preview" /> : still.url ? <img src={still.url} alt={current?.shot.purpose} /> : <div className="timeline-missing"><Icon name="image" size={34} /><p>{clip.error || still.error ? 'Media unavailable' : 'This shot has no current media'}</p></div>}<span className="timeline-player-label">{current?.shot.purpose} · {media?.video ? media.video.fixture ? 'Fixture video' : 'Video' : 'Still · clip missing'}</span></div>
    <div className="timeline-transport"><IconButton icon="refresh" label="Return to beginning" onClick={() => seek(0)} /><IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause timeline preview' : 'Play timeline preview'} onClick={() => { if (position >= total) seek(0); setPlaying(v => !v); }} /><span>{durationLabel(position * 30)} / {durationLabel(total * 30)}</span><small>Picture preview · sound in rendered export</small><button className="text-button" onClick={() => setShowRender(v => !v)}>{showRender ? 'Hide export' : 'Rendered export'}</button></div>
    <div className="timeline-scroll"><div className="timeline-tracks"><div className="timeline-scenes">{snapshot.project.scenes.map((scene,i) => <span key={scene.id} title={scene.purpose} style={{ flex: shots.filter(s => s.sceneId === scene.id).reduce((n,s) => n+s.desiredFrames,0) || 1 }}>{String(i+1).padStart(2,'0')} · {scene.purpose}</span>)}</div><input type="range" aria-label="Timeline playhead" min={0} max={total} step={0.1} value={position} onChange={e => seek(Number(e.target.value))} /><div className="timeline-lane"><span>Video</span><div>{clips.map(({ shot, at }) => <TimelineClip key={shot.id} api={api} snapshot={snapshot} shot={shot} active={shot.id === current?.shot.id} select={() => seek(at)} />)}</div></div><div className="timeline-lane"><span>Voice</span><div>{shots.map(shot => <div key={shot.id} className={`timeline-voice ${shot.narration?.text ? 'script' : ''}`} style={{flex:shot.desiredFrames}} title={shot.narration?.text || 'No shot script'}>{shot.narration?.mode === 'generated' ? `Script · ${shot.narration.text || 'To write'}` : shot.cueId ? 'Saved narration cue' : ''}</div>)}</div></div></div></div>
    <div className="timeline-music"><span>Music</span><select aria-label="Background music" disabled={disabled} value={snapshot.project.soundtrack?.audioId ?? ''} onChange={e => command({ kind: 'soundtrack', field: 'audioId', value: e.target.value })}><option value="">No background music</option>{recordings.map((r,i) => <option key={r.id} value={r.id}>Recording {i+1} · {(r.media.probe.audio?.durationSeconds ?? 0).toFixed(1)}s · {r.media.sha256.slice(0,6)}</option>)}</select>{snapshot.project.soundtrack && <label>Gain <select aria-label="Music gain" disabled={disabled} value={snapshot.project.soundtrack.gainMilliDb} onChange={e => command({ kind: 'soundtrack', field: 'gainMilliDb', value: e.target.value })}>{[-30000,-24000,-18000,-12000,-6000,0].map(g => <option key={g} value={g}>{g/1000} dB</option>)}</select></label>}<IconButton icon="plus" label="Import background music" onClick={onImportAudio} /><small>Starts at 0 · trims to film length · no looping</small></div>
    {showRender && <Preview api={api} snapshot={snapshot} />}
  </section>;
}
function TimelineClip({ api, snapshot, shot, active, select }: { api: StudioApi; snapshot: ProjectSnapshot; shot: Shot; active: boolean; select(): void }) {
  const media = sources(snapshot, shot), image = useArtifact(api, snapshot.project.id, media.image?.artifact ?? null);
  const scene = snapshot.project.scenes.findIndex(s => s.id === shot.sceneId), index = snapshot.project.shots.filter(s => s.sceneId === shot.sceneId).findIndex(s => s.id === shot.id);
  return <button className={`timeline-clip ${active ? 'active' : ''}`} style={{ flex:shot.desiredFrames, ...(image.url ? { backgroundImage:`url("${image.url}")` } : {}) }} onClick={select} title={shot.purpose} aria-label={`Seek to shot ${scene+1}.${index+1}`}><strong>{scene+1}.{index+1} · {shot.purpose}</strong><small>{media.video ? 'Video' : media.image ? 'Keyframe' : 'Missing'}</small></button>;
}
