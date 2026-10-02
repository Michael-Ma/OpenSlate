import { canonical, effectiveNodeDigest, invariant, shotIntentDigest, shotVideoTiming } from '@openslate/core';
import type { ArtifactRef } from '@openslate/core';
import type { Store } from '../persistence/store.js';
import type { Attempt, NodeBinding, PlanRecord } from './engine.js';

/** First-dispatch eligibility only. Historical POST/result recovery must never re-use this mutable check. */
export function assertCurrentGeneratedSelection(store: Pick<Store, 'get' | 'getProject' | 'db'>, attempt: Readonly<Attempt>, code: string): void {
  const project = store.getProject(attempt.projectId), binding = store.get<NodeBinding>('node_binding', attempt.nodeId);
  const fail = (value: unknown, message: string): void => invariant(value, code, message);
  invariant(binding && binding.projectId === project.id && binding.state === 'active' && binding.planId === project.activePlanId
    && binding.candidateId === attempt.candidateId && binding.node.specDigest === attempt.specDigest && binding.node.kind === attempt.request.kind
    && canonical(binding.node.args) === canonical(attempt.request.args) && Object.keys(binding.outputs).length === 0,
  code, 'The admitted generation selection was superseded before its first provider request');
  const plan = store.get<PlanRecord>('plan', binding.planId), node = binding.node;
  fail(plan?.projectId === project.id && plan.compiled.nodes.some(value => value.id === node.id && canonical(value) === canonical(node)), 'Generation no longer matches its current executable plan');
  if (node.shotId !== null) {
    const shot = project.shots.find(value => value.id === node.shotId);
    invariant(shot && (node.kind === 'image' || node.kind === 'video'), code, 'Generation requires its current shot intent');
    const cue = shot.cueId ? project.cues.find(value => value.id === shot.cueId) : undefined;
    fail(!shot.cueId || cue, 'The selected shot cue is missing');
    fail(node.intentDigest === shotIntentDigest(shot, node.kind, cue) && shot.promptIntent[node.kind] === node.intentDigest
      && node.args.prompt === (node.kind === 'image' ? shot.imagePrompt : shot.videoPrompt), 'Shot direction changed before first dispatch');
    if (node.kind === 'video') {
      fail(typeof node.args.durationFrames === 'number' && node.args.durationFrames >= shot.desiredFrames
        && (!cue || shotVideoTiming(project, shot).ready), 'Shot timing changed before first dispatch');
      const lock = store.get<{ recipeDigest?: string }>('capability_lock', project.capabilityLockId);
      fail(!lock?.recipeDigest || shotVideoTiming(project, shot).ready, 'The current narration decision or accepted recording changed');
      fail(node.requires.length > 0 && node.requires.every(id => plan!.compiled.gates.some(gate => gate.id === id
        && gate.members.some(member => member.videoNodeId === node.id && member.recipeDigest === node.specDigest))), 'The current video lost its exact review contract');
      fail(store.db.prepare("SELECT id FROM entities WHERE kind='approval' AND project_id=? AND json_extract(body,'$.videoNodeId')=? AND json_extract(body,'$.approvalDigest')=? LIMIT 1")
        .get(project.id, node.id, attempt.fingerprint), 'The current video lacks its exact human review');
    }
  }
  const inputs: ArtifactRef[] = node.inputs.map(input => {
    const upstream = input.source.kind === 'output' ? store.get<NodeBinding>('node_binding', input.source.nodeId) : undefined;
    fail(!upstream || upstream.projectId === project.id && upstream.state === 'active' && upstream.planId === project.activePlanId, 'A generation dependency changed');
    // The adapter's preparation verifies owned descriptor/bytes and captures an immutable copy.
    // This check detects later selection changes without masking a definite local input rejection.
    const ref = input.source.kind === 'artifact' ? input.source.artifact : upstream?.outputs[input.source.port];
    invariant(ref, code, 'A generation input binding is unavailable');
    return ref;
  });
  fail(canonical(inputs) === canonical(attempt.request.inputs) && effectiveNodeDigest(node, node.inputs.map((input, index) => ({ destinationPort: input.destinationPort,
    role: input.role, order: input.order, sha256: inputs[index]!.sha256 }))) === attempt.fingerprint, 'Generation inputs changed during preparation');
  fail(!store.get<{ paused: boolean }>('execution_control', project.id)?.paused, 'Generation was stopped before first dispatch');
  const scopes = new Set([project.id]), visited = new Set<string>(), queue = [binding];
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at]!; if (visited.has(current.id)) continue;
    visited.add(current.id); fail(visited.size <= 1600, 'Generation dependencies exceed the current bound');
    if (current.node.shotId) { scopes.add(current.node.shotId); const sceneId = project.shots.find(shot => shot.id === current.node.shotId)?.sceneId; if (sceneId) scopes.add(sceneId); }
    for (const input of current.node.inputs) if (input.source.kind === 'output') {
      const upstream = store.get<NodeBinding>('node_binding', input.source.nodeId);
      invariant(upstream?.projectId === project.id && upstream.state === 'active' && upstream.planId === project.activePlanId, code, 'A held dependency is no longer current'); queue.push(upstream);
    }
  }
  for (const scopeId of scopes) fail(!store.db.prepare("SELECT id FROM entities WHERE kind='hold' AND project_id=? AND json_extract(body,'$.active')=1 AND json_extract(body,'$.scopeId')=? LIMIT 1")
    .get(project.id, scopeId), 'A new human edit holds this generation before its first provider request');
}
