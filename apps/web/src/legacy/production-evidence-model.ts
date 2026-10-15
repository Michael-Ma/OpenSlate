import type { ProjectSnapshot } from './model.ts';

/** History remains in the snapshot; only server-identified current bindings drive the next action. */
export function currentProjectAttempts(snapshot: ProjectSnapshot): ProjectSnapshot['attempts'] {
  if (snapshot.currentAttemptIds === undefined) return snapshot.attempts;
  const current = new Set(snapshot.currentAttemptIds);
  return snapshot.attempts.filter(attempt => current.has(attempt.id));
}

/** Only explicit current-binding evidence can classify an unfinished record as earlier work. */
export function earlierProjectAttempts(snapshot: ProjectSnapshot): ProjectSnapshot['attempts'] {
  if (snapshot.currentAttemptIds === undefined) return [];
  const current = new Set(snapshot.currentAttemptIds);
  return snapshot.attempts.filter(attempt => !current.has(attempt.id)
    && ['submission_unknown','preparing','submitting','remote_pending','ingesting'].includes(attempt.phase));
}
