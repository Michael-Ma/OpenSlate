import { HelpTip } from "./components";
import { useState } from "react";
import type { ProjectSnapshot } from "./model";
import { durationLabel } from "./model";

type Permission = { headVersion: number; revisionId: string; cursor: number; shotIds: string[]; kinds: string[]; continuationRequestId?: string };
export function GenerationPermission({ snapshot, disabled, authorize }: { snapshot: ProjectSnapshot; disabled: boolean; authorize(body: Permission): void }) {
  const [selected, setSelected] = useState<string[]>([]), [kinds, setKinds] = useState<string[]>(["image", "video"]);
  const [review, setReview] = useState<Permission | null>(null);
  const project = snapshot.project, owners = [...new Set(snapshot.holds.filter(hold => hold.active).map(hold => hold.ownerId))];
  const blocked = disabled || !!snapshot.control?.paused || owners.length > 1;
  const fresh = review?.headVersion === project.headVersion && review.revisionId === project.revisionId && review.cursor === snapshot.cursor;
  if (!project.shots.length) return null;
  return <section className="story-card" aria-labelledby="generation-permission-title"><h3 id="generation-permission-title">1. Choose shots <HelpTip label="About generation permission">Allow one new image or video per selected shot, including a replacement. This lets the director prepare the work; it does not approve spending or skip frame review.</HelpTip></h3>
    {snapshot.control?.paused && <p className="field-help">Send a new direction in the Director to continue stopped work first.</p>}
    {owners.length > 1 && <p className="field-help">Continue the pending edits in the Director before reviewing generation permission.</p>}
    {!review ? <><fieldset className="permission-options"><legend>Shots</legend>{project.shots.map((shot, index) => <label key={shot.id}><input type="checkbox" checked={selected.includes(shot.id)} disabled={blocked} onChange={() => setSelected(ids => ids.includes(shot.id) ? ids.filter(id => id !== shot.id) : [...ids, shot.id])} />Shot {index + 1} · {shot.purpose} · {durationLabel(shot.desiredFrames)}</label>)}</fieldset>
      <fieldset className="permission-options"><legend>New operations per shot</legend>{["image", "video"].map(kind => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} disabled={blocked} onChange={() => setKinds(all => all.includes(kind) ? all.filter(item => item !== kind) : [...all, kind])} />One {kind === "image" ? "keyframe image" : "video take"}</label>)}</fieldset>
      {selected.length * kinds.length > 100 && <p role="alert">Select at most 100 operations in one review.</p>}<button className="button small" disabled={blocked || !selected.length || !kinds.length || selected.length * kinds.length > 100 || selected.some(id => !project.shots.some(shot => shot.id === id))} onClick={() => setReview({ headVersion: project.headVersion, revisionId: project.revisionId, cursor: snapshot.cursor, shotIds: [...selected], kinds: [...kinds], ...(owners[0] ? { continuationRequestId: owners[0] } : {}) })}>Review generation permission</button></>
    : <div className="permission-review"><h4>{review.shotIds.length} shot{review.shotIds.length === 1 ? "" : "s"} · {review.shotIds.length * review.kinds.length} generation operations maximum</h4><ul>{project.shots.filter(shot => review.shotIds.includes(shot.id)).map(shot => <li key={shot.id}><strong>{shot.purpose}</strong><p>{shot.imagePrompt}</p><p>{shot.videoPrompt || shot.motion}</p></li>)}</ul><p>This continues the current edit and asks the Director to prepare the plan. It does not increase your spending limit or approve a video keyframe.</p>{!fresh && <p role="alert">The project changed. Go back and review again.</p>}<div className="quick-actions"><button className="button primary" disabled={blocked || !fresh} onClick={() => { authorize(review); setReview(null); setSelected([]); }}>Allow and continue planning</button><button className="button" disabled={disabled} onClick={() => setReview(null)}>Back</button></div></div>}
  </section>;
}
