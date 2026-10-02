import { HelpTip } from './components';
import { useState } from 'react';
import type { ProjectSnapshot } from './model';
import { durationLabel } from './model';
import { coveredPendingEdits, makeEditContinuation, generationHoldDigest } from './continuation-model';
import type { ContinueEdits } from './continuation-model';

type Permission = { headVersion: number; revisionId: string; cursor: number; reviewedControlAuthorityId: string | null; reviewedHoldDigest: string; shotIds: string[]; kinds: string[]; continueEdits?: ContinueEdits; continuationScope?: 'project' };
export function GenerationPermission({ snapshot, disabled, authorize, initialKinds }: { initialKinds?: string[]; snapshot: ProjectSnapshot; disabled: boolean; authorize(body: Permission): void }) {
  const [selected, setSelected] = useState<string[]>([]), [kinds, setKinds] = useState<string[]>(initialKinds ?? ['image','video']);
  const [review, setReview] = useState<Permission | null>(null), [wholeFilm, setWholeFilm] = useState(false), [preparing, setPreparing] = useState(false), [error,setError] = useState('');
  const project = snapshot.project, scope = wholeFilm ? [project.id] : selected;
  const owners = [...new Set(snapshot.holds.filter(h => h.active && (wholeFilm || h.scopeId === project.id || selected.includes(h.scopeId) || project.shots.some(shot => selected.includes(shot.id) && shot.sceneId === h.scopeId))).map(h => h.ownerId))];
  const covered = coveredPendingEdits(snapshot,scope), uncovered = owners.filter(id => !covered.some(g => g.requestId === id));
  const blocked = disabled || !!snapshot.control?.paused || preparing;
  const fresh = review?.headVersion === project.headVersion && review.revisionId === project.revisionId && review.reviewedControlAuthorityId === (snapshot.control?.authorityId ?? null);
  const choose = async () => {
    if (blocked || uncovered.length) return;
    setPreparing(true);setError('');
    try {
      const continueEdits=await makeEditContinuation(snapshot,scope);
      setReview({headVersion:project.headVersion,revisionId:project.revisionId,cursor:snapshot.cursor,reviewedControlAuthorityId:snapshot.control?.authorityId ?? null,reviewedHoldDigest:await generationHoldDigest(snapshot,scope),shotIds:[...selected],kinds:[...kinds],
        ...(continueEdits ? {continueEdits,...(wholeFilm ? {continuationScope:'project' as const} : {})} : {})});
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not prepare this review.'); }
    finally { setPreparing(false); }
  };
  if (!project.shots.length) return null;
  return <section className="story-card" aria-labelledby="generation-permission-title"><h3 id="generation-permission-title">Choose shots <HelpTip label="About generation permission">Allow one new image or video per selected shot, including a replacement. Costs and returned keyframes are reviewed at their later steps.</HelpTip></h3>
    {snapshot.control?.paused && <p className="field-help">Send a new direction in the Director to continue stopped work first.</p>}
    {!review ? <><fieldset className="permission-options"><legend>Shots</legend>{project.shots.map((shot,index)=><label key={shot.id}><input type="checkbox" checked={selected.includes(shot.id)} disabled={blocked} onChange={()=>setSelected(ids=>ids.includes(shot.id)?ids.filter(id=>id!==shot.id):[...ids,shot.id])} />Shot {index+1} · {shot.purpose} · {durationLabel(shot.desiredFrames)}</label>)}</fieldset>
      <fieldset className="permission-options"><legend>New operations per shot</legend>{['image','video'].map(kind=><label key={kind}><input type="checkbox" checked={kinds.includes(kind)} disabled={blocked} onChange={()=>setKinds(all=>all.includes(kind)?all.filter(item=>item!==kind):[...all,kind])} />One {kind==='image'?'keyframe image':'video take'}</label>)}</fieldset>
      {owners.length>0 && <label className="permission-continuation"><input type="checkbox" checked={wholeFilm} disabled={blocked} onChange={e=>setWholeFilm(e.target.checked)} />Continue saved edits across the film; generate only selected shots.</label>}
      {uncovered.length>0 && <p className="field-help">{uncovered.length} saved edit{uncovered.length===1?'':'s'} also affect other parts. Select their full scope or choose to continue saved edits across the film.</p>}
      {selected.length*kinds.length>100 && <p role="alert">Select at most 100 operations in one review.</p>}
      <button className="button small" disabled={blocked||uncovered.length>0||!selected.length||!kinds.length||selected.length*kinds.length>100||selected.some(id=>!project.shots.some(shot=>shot.id===id))} onClick={()=>void choose()}>{preparing?'Preparing review…':'Review generation'}</button></>
    : <div className="permission-review"><h4>{review.shotIds.length} shot{review.shotIds.length===1?'':'s'} · {review.shotIds.length*review.kinds.length} generation operations maximum</h4>
      <ul>{project.shots.filter(shot=>review.shotIds.includes(shot.id)).map(shot=><li key={shot.id}><strong>{shot.purpose}</strong>{review.kinds.includes('image')&&<p>{shot.imagePrompt}</p>}{review.kinds.includes('video')&&<p>{shot.videoPrompt||shot.motion}</p>}</li>)}</ul>
      {review.continueEdits&&<p>This continues {review.continueEdits.requestIds.length} saved edit{review.continueEdits.requestIds.length===1?'':'s'}{review.continuationScope==='project'?' across the film':' in the selected scope'}. Generation permission covers only the selected shots.</p>}
      <p>The director will prepare this work. Review costs and each returned keyframe before video starts.</p>{!fresh&&<p role="alert">The project changed. Go back and review again.</p>}
      <div className="quick-actions"><button className="button primary" disabled={blocked||!fresh} onClick={()=>{authorize(review);setReview(null);setSelected([]);}}>Allow and continue planning</button><button className="button" disabled={disabled} onClick={()=>setReview(null)}>Back</button></div></div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
