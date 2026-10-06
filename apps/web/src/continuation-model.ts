/** Browser-safe projection of the human continuation review; no mutation occurs until a fresh message is sent. */
export interface PendingEditContinuation { requestId: string; scopeIds: string[]; holdsDigest: string; directorState?: string | null }
export interface ContinueEdits { headVersion: number; requestIds: string[]; holdsDigest: string }
export interface ContinuationSnapshot {
  project: { id: string; headVersion: number; shots: { id: string; sceneId: string }[] };
  pendingEditContinuations?: PendingEditContinuation[];
}
export function coveredPendingEdits(snapshot: ContinuationSnapshot, scopeIds: readonly string[]): PendingEditContinuation[] {
  const project = snapshot.project;
  return (snapshot.pendingEditContinuations ?? []).filter(group => group.scopeIds.every(id => scopeIds.includes(project.id) || scopeIds.includes(id)
    || project.shots.some(shot => shot.id === id && scopeIds.includes(shot.sceneId))))
    .sort((a, b) => a.requestId.localeCompare(b.requestId));
}
/** Aggregate only the displayed fully covered owners. Server rechecks exact revision and held parts atomically. */
export async function makeEditContinuation(snapshot: ContinuationSnapshot, scopeIds: readonly string[]): Promise<ContinueEdits | null> {
  const groups = coveredPendingEdits(snapshot, scopeIds);
  if (!groups.length) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(groups.map(group => [group.requestId, group.holdsDigest])));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { headVersion: snapshot.project.headVersion, requestIds: groups.map(group => group.requestId),
    holdsDigest: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
}

/** Relevant held scopes include ancestors and descendants of the reviewed shots. */
export async function generationHoldDigest(snapshot: ContinuationSnapshot, scopeIds: readonly string[]): Promise<string> {
  const covers = (scope: readonly string[], id: string) => scope.includes(snapshot.project.id) || scope.includes(id) || snapshot.project.shots.some(shot => shot.id === id && scope.includes(shot.sceneId));
  const groups = (snapshot.pendingEditContinuations ?? []).filter(group => group.scopeIds.some(id => covers(scopeIds,id) || scopeIds.some(selected => covers([id],selected)))).sort((a,b)=>a.requestId.localeCompare(b.requestId));
  const bytes = new TextEncoder().encode(JSON.stringify(groups.map(group=>[group.requestId,group.holdsDigest])));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
