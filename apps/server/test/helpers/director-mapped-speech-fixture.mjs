import { digest } from '@openslate/core';
import { narrationSpeechFixture, key } from '../narration-speech-fixture.mjs';
import { projectFixture } from '../execution-fixture.mjs';
import { createShotNarrationSession, narrationSpeechShotScopes, shotDraftId } from '../../dist/narration/narration-scope.js';

/** Real application-created speech ownership and candidate; admission never dispatches the injected provider. */
export async function directorMappedSpeechFixture(t, { admit = false } = {}) {
  const f = await narrationSpeechFixture(t, { realSpeech: true }), before = f.store.getProject(f.project.id), rows = f.view().segments;
  const shape = projectFixture(before.id, 2);
  shape.shots[0].narration = { mode: 'generated', text: rows[0].script.text, voice: 'stock' };
  const project = f.store.saveProject({ ...shape, capabilityLockId: before.capabilityLockId }, before.headVersion);
  f.store.insert('project_revision', project.revisionId, project.id, { project });
  f.project = project;
  f.store.put('narration_shot_draft', shotDraftId(project.id, 'shot-0'), project.id,
    { shotId: 'shot-0', segmentId: rows[0].entry.segmentId, intentDigest: digest(project.shots[0].narration) });
  const session = createShotNarrationSession(f.production, project.id, 'shot-0', key()),
    scoped = { kind: 'human', principalId: 'local-user', requestId: session.requestId };
  const proposal = await f.service.prepare(project.id, scoped, f.input());
  const application = await f.service.review(project.id, scoped, { key: key(), proposalId: proposal.id, proposalDigest: digest(proposal) });
  const candidate = f.store.get('candidate', application.candidateId), binding = f.store.get('node_binding', candidate.nodeId);
  for (const hold of f.store.list('hold', project.id).filter(hold => hold.active)) f.engine.releaseHold(project.id, hold.id, hold.ownerId);
  const attempt = admit ? (f.issue(application), f.admit(application)) : null;
  return { ...f, service: f.production, speech: f.service, session, scoped, proposal, application, binding, attempt,
    shotScopes: narrationSpeechShotScopes(f.store, project.id, candidate.id) };
}
