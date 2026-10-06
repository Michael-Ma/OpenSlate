import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@radix-ui/themes';
import type { StudioApi } from './api';
import type { ArtifactFixture, ProjectSnapshot, Shot } from './model';
import { durationLabel } from './model';
import { Icon, useArtifact } from './components';
import { frameExposureIdentity, projectResults } from './project-results-model';
import type { ResultMedia, ResultShot, SceneFrameExposure } from './project-results-model';
import './project-results.css';

export interface ProjectResultsProps {
  api: StudioApi; snapshot: ProjectSnapshot; active?: boolean;
  onInspect?: (value: { url: string; shot: Shot; fixture: ArtifactFixture }) => void;
  onFrameExposure?: (exposure: SceneFrameExposure) => void;
}
const badgeColor = (media: ResultMedia): 'green' | 'amber' | 'red' | 'blue' | 'gray' => media.state === 'saved' ? 'green'
  : media.state === 'previous' || media.state === 'uncertain' ? 'amber' : media.state === 'failed' ? 'red' : media.state === 'working' ? 'blue' : 'gray';

function ResultCard({ api, snapshot, result, active, onInspect, onFrameExposure }: Omit<ProjectResultsProps, 'active'> & { result: ResultShot; active: boolean }) {
  const card = useRef<HTMLElement>(null), video = useRef<HTMLVideoElement>(null), [nearby, setNearby] = useState(false);
  const [failedFrame, setFailedFrame] = useState<string | null>(null), [failedClip, setFailedClip] = useState<string | null>(null);
  const frameTile = useRef<HTMLDivElement>(null), visible = useRef(false), decoded = useRef<{ identity: string; url: string } | null>(null);
  const callback = useRef(onFrameExposure), activeNow = useRef(active); callback.current = onFrameExposure; activeNow.current = active;
  useEffect(() => {
    if (!card.current) return;
    if (typeof IntersectionObserver === 'undefined') { setNearby(true); return; }
    const observer = new IntersectionObserver(entries => setNearby(entries.some(entry => entry.isIntersecting)), { rootMargin: '240px' });
    observer.observe(card.current); return () => observer.disconnect();
  }, []);
  const frame = useArtifact(api, snapshot.project.id, active && nearby ? result.keyframe.artifact : null);
  const clip = useArtifact(api, snapshot.project.id, active && nearby ? result.video.artifact : null);
  useEffect(() => { if (!active || !nearby) video.current?.pause(); }, [active, nearby]);
  const exposure = result.keyframe.artifact ? { projectId: snapshot.project.id, projectRevisionId: snapshot.project.revisionId, shotId: result.shot.id,
    artifactId: result.keyframe.artifact.artifactId, sha256: result.keyframe.artifact.sha256 } : null;
  const exposureId = exposure ? frameExposureIdentity(exposure) : null;
  const eligible = result.keyframe.current;
  const displayNow = useRef<() => void>(() => {});
  displayNow.current = () => {
    if (eligible && exposure && activeNow.current && visible.current && frameTile.current?.isConnected && frame.url && decoded.current?.identity === exposureId && decoded.current.url === frame.url)
      callback.current?.({ ...exposure, displayed: true });
  };
  useEffect(() => {
    if (!frameTile.current) return;
    if (typeof IntersectionObserver === 'undefined') { visible.current = true; displayNow.current(); return; }
    const observer = new IntersectionObserver(entries => { visible.current = entries.some(entry => entry.isIntersecting); if (visible.current) displayNow.current(); });
    observer.observe(frameTile.current); return () => { visible.current = false; observer.disconnect(); };
  }, []);
  useLayoutEffect(() => {
    decoded.current = null;
    if (!exposure) return;
    callback.current?.({ ...exposure, displayed: false });
    return () => callback.current?.({ ...exposure, displayed: false });
    // A phone layout toggle preserves an already-seen proof. Only its actual identity changes clear it.
  }, [exposureId]);
  useLayoutEffect(() => { if (!eligible && exposure) callback.current?.({ ...exposure, displayed: false }); else displayNow.current(); }, [eligible]);
  useEffect(() => { if (frame.error && exposure) callback.current?.({ ...exposure, displayed: false }); }, [frame.error, exposureId]);
  const loaded = (element: HTMLImageElement) => {
    if (exposureId && frame.url && element.currentSrc === frame.url) { decoded.current = { identity: exposureId, url: frame.url }; displayNow.current(); }
  };
  const failed = () => { decoded.current = null; setFailedFrame(frame.url); if (exposure) callback.current?.({ ...exposure, displayed: false }); };
  const metadata = (media: ResultMedia) => <>{media.fixture === true && <Badge color="amber" size="1">Demo fixture</Badge>}
    {media.fixture === null && media.artifact && <span className="result-source-note">Source unverified</span>}
    {media.model && <span className="result-source-note">{media.model}</span>}</>;
  const placeholder = (media: ResultMedia, error: string, kind: 'image' | 'video') => <div className="result-media-placeholder"><Icon name={kind === 'image' ? 'image' : 'play'} size={28} />
    <span>{error ? 'Preview unavailable' : media.artifact ? active && nearby ? 'Loading saved media…' : 'Preview loads when visible' : media.label}</span></div>;
  return <article ref={card} id={`project-results-shot-${result.shot.id}`} className="result-shot" aria-labelledby={`result-shot-title-${result.shot.id}`}>
    <header className="result-shot-header"><div><span className="result-shot-index">Shot {result.label}</span><h3 id={`result-shot-title-${result.shot.id}`}>{result.shot.purpose || 'Untitled shot'}</h3></div>
      <span className="result-planned-duration">{durationLabel(result.shot.desiredFrames)} planned</span></header>
    <p className="result-latest-state">{result.latest}</p>
    <div className="result-media-pair">
      <figure className="result-media-slot"><figcaption><strong>Keyframe</strong><Badge color={badgeColor(result.keyframe)} size="1">{result.keyframe.label}</Badge></figcaption>
        <div ref={frameTile} className="result-media-view">{frame.url && failedFrame !== frame.url ? onInspect ? <button type="button" className="result-inspect" aria-label={`Inspect keyframe for shot ${result.label}`}
          onClick={() => onInspect({ url: frame.url!, shot: result.shot, fixture: result.keyframe.fixture })}><img key={exposureId} src={frame.url} alt={`Keyframe for shot ${result.label}: ${result.shot.purpose}`} onLoad={event => loaded(event.currentTarget)} onError={failed} /></button>
          : <img key={exposureId} src={frame.url} alt={`Keyframe for shot ${result.label}: ${result.shot.purpose}`} onLoad={event => loaded(event.currentTarget)} onError={failed} />
          : placeholder(result.keyframe, frame.error || (failedFrame && failedFrame === frame.url ? 'Image could not be decoded' : ''), 'image')}</div>
        <div className="result-media-meta">{metadata(result.keyframe)}</div>{frame.error && <p className="result-preview-error">{frame.error}</p>}
      </figure>
      <figure className="result-media-slot"><figcaption><strong>Video</strong><Badge color={badgeColor(result.video)} size="1">{result.video.label}</Badge></figcaption>
        <div className="result-media-view">{clip.url && failedClip !== clip.url ? <video key={clip.url} ref={video} src={clip.url} controls muted playsInline preload="metadata" onError={() => setFailedClip(clip.url)} aria-label={`Video picture for shot ${result.label}`} /> : placeholder(result.video, clip.error || (failedClip && failedClip === clip.url ? 'Video could not be decoded' : ''), 'video')}</div>
        <div className="result-media-meta">{metadata(result.video)}{result.video.requestedFrames && <span className="result-source-note">{durationLabel(result.video.requestedFrames)} requested · picture preview</span>}</div>
        {clip.error && <p className="result-preview-error">{clip.error}</p>}
      </figure>
    </div>
    <dl className="result-shot-direction"><div><dt>Direction</dt><dd>{result.shot.framing || 'Not written yet'}</dd></div><div><dt>Motion</dt><dd>{result.shot.motion || 'Not written yet'}</dd></div></dl>
    <details className="result-prompts"><summary>Prompts</summary><dl><div><dt>Image prompt</dt><dd>{result.shot.imagePrompt || 'Not written yet'}</dd></div><div><dt>Video prompt</dt><dd>{result.shot.videoPrompt || 'Not written yet'}</dd></div>
      {result.keyframe.savedPrompt && result.keyframe.savedPrompt !== result.shot.imagePrompt && <div><dt>Saved keyframe recipe</dt><dd>{result.keyframe.savedPrompt}</dd></div>}
      {result.video.savedPrompt && result.video.savedPrompt !== result.shot.videoPrompt && <div><dt>Saved video recipe</dt><dd>{result.video.savedPrompt}</dd></div>}</dl></details>
    <section className="result-narration" aria-label={`Narration for shot ${result.label}`}><div className="result-narration-heading"><strong>{result.narration.label}</strong>{result.narration.voice && <span>{result.narration.voice}</span>}</div>
      {result.narration.text && <p>{result.narration.text}</p>}<small>{result.narration.timing}{result.narration.acceptedFrames ? ' · ' + durationLabel(result.narration.acceptedFrames) : ''}</small></section>
  </article>;
}

/** The right side is a persistent result tree. Its only interactions inspect saved media. */
export function ProjectResults({ api, snapshot, active = true, onInspect, onFrameExposure }: ProjectResultsProps) {
  const results = useMemo(() => projectResults(snapshot), [snapshot]);
  return <div className="project-results" aria-label="Project results" id={`project-results-project-${snapshot.project.id}`}>
    <header className="result-project-header"><span className="eyebrow">Project results</span><h1>{snapshot.project.name}</h1>
      <p>{snapshot.project.scenes.length} scenes · {snapshot.project.shots.length} shots · {results.keyframes} current keyframes · {results.videos} current videos</p>
      {(snapshot.project.brief || snapshot.project.story) && <details className="result-film-direction"><summary>Film direction</summary>{snapshot.project.brief && <p>{snapshot.project.brief}</p>}{snapshot.project.story && <p>{snapshot.project.story}</p>}</details>}
    </header>
    {!results.scenes.length && <section className="result-empty-project"><Icon name="slate" size={32} /><h2>Your project results will appear here.</h2><p>Scenes, shots, prompts and media stay together as the Director develops your film.</p></section>}
    {results.scenes.map(scene => <section className="result-scene" key={scene.id} id={`project-results-scene-${scene.id}`} aria-labelledby={`result-scene-title-${scene.id}`}>
      <header className="result-scene-header"><div><span className="result-scene-index">{scene.unassigned ? 'Saved shots' : 'Scene ' + scene.label}</span><h2 id={`result-scene-title-${scene.id}`}>{scene.purpose || 'Scene direction pending'}</h2></div><span>{scene.shots.length} shots</span></header>
      {scene.shots.length ? <div className="result-shot-grid">{scene.shots.map(result => <ResultCard key={result.shot.id} api={api} snapshot={snapshot} result={result} active={active}
        {...(onInspect ? { onInspect } : {})} {...(onFrameExposure ? { onFrameExposure } : {})} />)}</div>
        : <div className="result-empty-scene">No shots in this scene yet.</div>}
    </section>)}
  </div>;
}
