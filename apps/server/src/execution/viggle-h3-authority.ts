import { canonical, digest, effectiveNodeDigest, invariant, shotIntentDigest } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionCallOptions, ExecutionRequest } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { ArtifactRecord, Attempt, Candidate, Grant, NodeBinding, PlanRecord, ReviewSnapshot } from "./engine.js";
import { assertExternalAllowance, assertExternalAllowanceConsumption } from "./external-allowance-records.js";
import type { AllowanceHumanRequest, ExternalAllowance, ExternalAllowanceConsumption } from "./external-allowance-records.js";
import { assertViggleH3ExecutionProfile, assertViggleH3ExecutionMapping } from "./viggle-h3-receipts.js";
import type { ViggleH3ExecutionMapping } from "./viggle-h3-receipts.js";

export interface ViggleCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; [key: string]: unknown }
export interface ViggleReservation { id: string; projectId: string; attemptId: string; micros: string; state: string }
export interface ViggleAdmission {
  attempt: Attempt; candidate: Candidate; grant: Grant; reservation: ViggleReservation;
  allowance: ExternalAllowance; consumption: ExternalAllowanceConsumption; allowanceRequest: AllowanceHumanRequest;
  profile: ProviderProfile; capabilityLock: ViggleCapabilityLock;
  frame?: ViggleFrameEvidence;
}
interface ViggleApproval { id: string; projectId: string; snapshotId: string; videoNodeId: string; approvalDigest: string; authorityId: string }
export interface ViggleFrameEvidence { artifact: ArtifactRecord; approval: ViggleApproval; snapshot: ReviewSnapshot }
export type ViggleProfilePin = Pick<ViggleH3ExecutionMapping, "capabilityLockId" | "capabilityLockDigest" | "profileDefinition">;
export type ViggleAuthorityStore = Pick<Store, "get" | "getProject" | "db">;
export const VIGGLE_H3_PROFILE_LOOKUP_LIMITS = Object.freeze({ locks: 128, lockBytes: 65536, profiles: 64 });
const fail = (condition: unknown, message: string): void => invariant(condition, "VIGGLE_H3_EXECUTION_CONFLICT", message);

/** Historical proof only: neither current selection nor current allowance availability is reinterpreted here. */
export function assertViggleAdmission(value: ViggleAdmission): void {
  const { attempt, candidate, grant, reservation, allowance, consumption, allowanceRequest, profile, capabilityLock } = value;
  fail(attempt && attempt.id === attempt.request.attemptId && attempt.nodeId === attempt.request.nodeId && attempt.fingerprint === attempt.request.fingerprint
    && attempt.request.kind === "video" && attempt.request.execution?.adapter === "viggle-h3" && attempt.request.execution.version === "1"
    && candidate?.id === attempt.candidateId && candidate.projectId === attempt.projectId && candidate.nodeId === attempt.nodeId
    && grant?.id === candidate.grantId && grant.projectId === attempt.projectId && grant.kind === "video" && grant.origin === candidate.origin
    && reservation?.id === attempt.reservationId && reservation.projectId === attempt.projectId && reservation.attemptId === attempt.id
    && ["reserved", "charged", "released"].includes(reservation.state), "Viggle requires its exact admitted candidate, grant and reservation");
  assertExternalAllowance(allowance, allowanceRequest); assertExternalAllowanceConsumption(consumption, allowance, attempt, reservation);
  assertViggleH3ExecutionProfile(profile, attempt);
  fail(digest(profile) === consumption.profileDefinitionDigest && digest(profile) === allowance.profileDefinitionDigest
    && profile.unitCostMicros === consumption.estimatedMicros && profile.unitCostMicros === reservation.micros,
  "Viggle profile estimate differs from its consumed allowance and reservation");
  fail(capabilityLock?.projectId === attempt.projectId && typeof capabilityLock.id === "string"
    && Array.isArray(capabilityLock.profiles) && capabilityLock.profiles.length > 0 && capabilityLock.profiles.length <= VIGGLE_H3_PROFILE_LOOKUP_LIMITS.profiles
    && Buffer.byteLength(canonical(capabilityLock)) <= VIGGLE_H3_PROFILE_LOOKUP_LIMITS.lockBytes
    && capabilityLock.profiles.some(item => canonical(item) === canonical(profile)), "Viggle profile lacks retained matching lock evidence");
}
export function assertViggleMappingAdmission(admission: ViggleAdmission, mapping: ViggleH3ExecutionMapping): void {
  assertViggleAdmission(admission); assertViggleH3ExecutionMapping(admission.attempt, mapping);
  fail(mapping.capabilityLockId === admission.capabilityLock.id && mapping.capabilityLockDigest === digest(admission.capabilityLock)
    && canonical(mapping.profileDefinition) === canonical(admission.profile) && mapping.allowanceId === admission.allowance.id
    && mapping.allowanceDigest === digest(admission.allowance) && mapping.consumptionDigest === digest(admission.consumption)
    && mapping.estimatedMicros === admission.reservation.micros, "Viggle mapping lost its exact retained admission evidence");
  const frame = admission.frame;
  fail(frame && canonical(mapping.firstFrame) === canonical(viggleFramePin(frame))
    && canonical(mapping.transport.firstFrame) === canonical({ sha256: frame.artifact.artifact.sha256, byteLength: frame.artifact.byteLength,
      width: frame.artifact.width, height: frame.artifact.height, mediaType: "image/png" }), "Viggle mapping lost its exact approved PNG evidence");
}

/** Keyed replay is bounded before hydration; initial approval selection is bounded and only runs once. */
export function viggleRecord<T>(store: ViggleAuthorityStore, kind: string, id: string, projectId: string, maximum = 32768): T | undefined {
  const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?").get(kind, id) as { project_id: string; bytes: number } | undefined;
  if (!meta) return undefined;
  fail(meta.project_id === projectId && meta.bytes > 0 && meta.bytes <= maximum, "Viggle evidence is foreign or exceeds its byte bound");
  const value = store.get<T>(kind, id); fail(value, "Viggle evidence disappeared"); return value;
}
export function viggleFramePin(frame: ViggleFrameEvidence): ViggleH3ExecutionMapping["firstFrame"] {
  return { artifactId: frame.artifact.id, artifactDigest: digest(frame.artifact), approvalId: frame.approval.id,
    approvalDigest: digest(frame.approval), snapshotId: frame.snapshot.id, snapshotDigest: digest(frame.snapshot) };
}
export function resolveViggleFrame(store: ViggleAuthorityStore, attempt: Attempt, pin?: ViggleH3ExecutionMapping["firstFrame"]): ViggleFrameEvidence {
  const reference = attempt.request.inputs[0];
  fail(attempt.request.inputs.length === 1 && reference?.kind === "image", "Viggle requires exactly one reviewed image");
  const artifact = viggleRecord<ArtifactRecord>(store, "artifact", reference!.artifactId, attempt.projectId);
  fail(artifact && artifact.id === reference!.artifactId && artifact.projectId === attempt.projectId && canonical(artifact.artifact) === canonical(reference)
    && artifact.fixture === false && artifact.mimeType === "image/png" && typeof artifact.validationDigest === "string" && /^[a-f0-9]{64}$/.test(artifact.validationDigest)
    && Number.isSafeInteger(artifact.byteLength) && artifact.byteLength! >= 45 && artifact.byteLength! <= 32 * 1024 ** 2
    && Number.isSafeInteger(artifact.width) && artifact.width! >= 1 && artifact.width! <= 8192 && Number.isSafeInteger(artifact.height) && artifact.height! >= 1 && artifact.height! <= 8192,
  "Viggle requires an exact validated owned PNG");
  let approval: ViggleApproval | undefined;
  if (pin) approval = viggleRecord(store, "approval", pin.approvalId, attempt.projectId);
  else {
    const rows = store.db.prepare("SELECT id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='approval' AND project_id=? AND json_extract(body,'$.videoNodeId')=? AND json_extract(body,'$.approvalDigest')=? ORDER BY id LIMIT 129")
      .all(attempt.projectId, attempt.nodeId, attempt.fingerprint) as { id: string; bytes: number }[];
    fail(rows.length > 0 && rows.length <= 128 && rows.every(row => row.bytes <= 32768), "Reviewed frame lookup exceeds its bound or has no approval");
    approval = viggleRecord(store, "approval", rows[0]!.id, attempt.projectId);
  }
  fail(approval && approval.projectId === attempt.projectId && approval.videoNodeId === attempt.nodeId && approval.approvalDigest === attempt.fingerprint,
    "Viggle approval does not cover the admitted image");
  const snapshot = viggleRecord<ReviewSnapshot>(store, "review_snapshot", approval!.snapshotId, attempt.projectId, 2 * 1024 ** 2);
  const human = viggleRecord<{ id: string; projectId: string; principalId: string; scopeIds: string[] }>(store, "message", approval!.authorityId, attempt.projectId, 128 * 1024);
  fail(human && human.id === approval!.authorityId && human.projectId === attempt.projectId && typeof human.principalId === "string" && human.principalId.length > 0
    && Array.isArray(human.scopeIds) && human.scopeIds.length > 0 && human.scopeIds.length <= 400, "Viggle approval lacks retained human request evidence");
  fail(snapshot && snapshot.id === approval!.snapshotId && snapshot.projectId === attempt.projectId && Array.isArray(snapshot.members) && snapshot.members.length <= 800
    && snapshot.members.filter(member => member.videoNodeId === attempt.nodeId).length === 1
    && snapshot.members.some(member => member.videoNodeId === attempt.nodeId && member.ready && member.approvalDigest === attempt.fingerprint
      && canonical(member.keyframe) === canonical(reference)), "Viggle approval lost its exact displayed frame");
  // The successful human application command proves scope was checked at approval time, including scene scope.
  // Reinterpreting the current scene or request state here would make historical result recovery depend on later edits.
  const actorScope = `${human!.principalId}:${attempt.projectId}:review`;
  const commands = store.db.prepare("SELECT key,digest,length(CAST(result AS BLOB)) bytes FROM commands WHERE actor_scope=? AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(result)='array' AND length(CAST(result AS BLOB))<=1048576 THEN result ELSE '[]' END) item WHERE json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.id')=?) LIMIT 2")
    .all(actorScope, approval!.id) as { key: string; digest: string; bytes: number }[];
  fail(commands.length === 1 && commands[0]!.bytes > 0 && commands[0]!.bytes <= 1048576, "Viggle approval lacks its exact human application command");
  const command = commands[0]!, encoded = store.db.prepare("SELECT result FROM commands WHERE actor_scope=? AND key=?").get(actorScope, command.key) as { result: string };
  const resultApprovals = JSON.parse(encoded.result) as ViggleApproval[];
  fail(Array.isArray(resultApprovals) && resultApprovals.length > 0 && resultApprovals.length <= 800
    && resultApprovals.every(item => item && Object.keys(item).length === 6 && item.projectId === attempt.projectId && item.snapshotId === approval!.snapshotId
      && item.authorityId === approval!.authorityId && typeof item.videoNodeId === "string" && typeof item.approvalDigest === "string")
    && new Set(resultApprovals.map(item => item.videoNodeId)).size === resultApprovals.length
    && resultApprovals.filter(item => canonical(item) === canonical(approval)).length === 1,
  "Viggle human review command lost its exact approval result");
  const commandDigest = digest({ snapshotId: approval!.snapshotId, videoNodeIds: resultApprovals.map(item => item.videoNodeId).sort() });
  fail(command.key === commandDigest && command.digest === commandDigest, "Viggle review command differs from the exact selected subset");
  const result = { artifact: artifact!, approval: approval!, snapshot: snapshot! };
  if (pin) fail(canonical(pin) === canonical(viggleFramePin(result)), "Pinned Viggle image or review evidence changed");
  return result;
}

/** Resolve by recorded full-definition digest. The initial bounded scan proves a match, not which lock originated admission. */
export function resolveViggleAdmission(store: ViggleAuthorityStore, input: Readonly<ExecutionRequest>, pinned?: ViggleProfilePin & Partial<Pick<ViggleH3ExecutionMapping, "firstFrame">>): ViggleAdmission {
  const request = structuredClone(input), attempt = store.get<Attempt>("attempt", request.attemptId);
  fail(attempt && canonical(attempt.request) === canonical(request) && attempt.candidateId && attempt.reservationId,
    "Viggle requires an unchanged stored admission");
  const current = attempt!;
  const candidate = store.get<Candidate>("candidate", current.candidateId!), grant = candidate ? store.get<Grant>("grant", candidate.grantId) : undefined;
  const reservation = store.get<ViggleReservation>("reservation", current.reservationId!);
  const allowance = store.get<ExternalAllowance>("external_allowance", request.externalAllowanceId ?? "");
  const consumption = store.get<ExternalAllowanceConsumption>("external_allowance_consumption", current.id);
  const allowanceRequest = allowance ? store.get<AllowanceHumanRequest>("message", allowance.requestId) : undefined;
  fail(candidate && grant && reservation && allowance && consumption && allowanceRequest, "Viggle requires durable allowance consumption and its human issue evidence");
  const lockAt = (id: string): ViggleCapabilityLock | undefined => {
    const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='capability_lock' AND id=?").get(id) as { project_id: string; bytes: number } | undefined;
    if (!meta) return undefined;
    fail(meta.project_id === current.projectId && meta.bytes <= VIGGLE_H3_PROFILE_LOOKUP_LIMITS.lockBytes, "Retained profile lock is foreign or exceeds its byte bound");
    const lock = store.get<ViggleCapabilityLock>("capability_lock", id)!;
    fail(lock.id === id && lock.projectId === current.projectId && Array.isArray(lock.profiles) && lock.profiles.length > 0
      && lock.profiles.length <= VIGGLE_H3_PROFILE_LOOKUP_LIMITS.profiles, "Invalid retained profile lock"); return lock;
  };
  const matching = (lock: ViggleCapabilityLock | undefined): ProviderProfile | undefined => lock?.profiles.find(profile => profile
    && profile.id === request.profile?.id && profile.revision === request.profile?.revision && digest(profile) === consumption!.profileDefinitionDigest);
  let capabilityLock: ViggleCapabilityLock | undefined, profile: ProviderProfile | undefined;
  if (pinned) {
    capabilityLock = lockAt(pinned.capabilityLockId); profile = matching(capabilityLock);
    fail(capabilityLock && digest(capabilityLock) === pinned.capabilityLockDigest && profile && canonical(profile) === canonical(pinned.profileDefinition),
      "Pinned viggle profile evidence is missing or changed");
  } else {
    capabilityLock = lockAt(store.getProject(current.projectId).capabilityLockId); profile = matching(capabilityLock);
    if (!profile) {
      const rows = store.db.prepare("SELECT id FROM entities WHERE kind='capability_lock' AND project_id=? ORDER BY id LIMIT ?")
        .all(current.projectId, VIGGLE_H3_PROFILE_LOOKUP_LIMITS.locks + 1) as { id: string }[];
      invariant(rows.length <= VIGGLE_H3_PROFILE_LOOKUP_LIMITS.locks, "VIGGLE_H3_PROFILE_LOOKUP_LIMIT", "Historical profile lookup exceeds its fixed bound");
      for (const row of rows) { const lock = lockAt(row.id), found = matching(lock); if (found) { capabilityLock = lock; profile = found; break; } }
    }
    fail(profile, "The consumed viggle profile definition has no retained matching lock");
  }
  const result: ViggleAdmission = { attempt: current, candidate: candidate!, grant: grant!, reservation: reservation!, allowance: allowance!, consumption: consumption!,
    allowanceRequest: allowanceRequest!, profile: profile!, capabilityLock: capabilityLock! };
  if (pinned?.firstFrame) result.frame = resolveViggleFrame(store, current, pinned.firstFrame);
  assertViggleAdmission(result); return structuredClone(result);
}

/** Use inside the short pre-marker/local-failure transaction; late provider observations use no first-submit check. */
export function assertViggleFirstDispatch(store: Store, original: ViggleAdmission, expectedLease: ExecutionCallOptions["expectedLease"]): void {
  new InstallationRecoveryGuard(store).assertFirstSubmit(original.attempt.projectId, original.attempt.id);
  const current = resolveViggleAdmission(store, original.attempt.request, { capabilityLockId: original.capabilityLock.id,
    capabilityLockDigest: digest(original.capabilityLock), profileDefinition: original.profile });
  invariant(expectedLease && Object.keys(expectedLease).length === 2 && expectedLease.owner === original.attempt.leaseOwner
    && expectedLease.epoch === original.attempt.leaseEpoch && current.attempt.leaseOwner === expectedLease.owner
    && current.attempt.leaseEpoch === expectedLease.epoch && current.attempt.leaseExpiresAt > Date.now()
    && current.attempt.phase === "submitting" && current.reservation.state === "reserved",
  "VIGGLE_H3_EXECUTION_NOT_DISPATCHABLE", "Viggle no longer owns its original unexpired submitting lease");
  const lock = store.get<ViggleCapabilityLock>("capability_lock", store.getProject(current.attempt.projectId).capabilityLockId);
  invariant(lock?.projectId === current.attempt.projectId && lock.profiles.some(profile => canonical(profile) === canonical(current.profile)),
    "VIGGLE_H3_SELECTION_CHANGED", "Current capability lock no longer contains the consumed profile");
  assertViggleCurrentSelection(store, current.attempt);
}

/** Current eligibility is deliberately separate from historical provider-result recovery. No filesystem work. */
export function assertViggleCurrentSelection(store: ViggleAuthorityStore, attempt: Attempt): void {
  const project = store.getProject(attempt.projectId), binding = store.get<NodeBinding>("node_binding", attempt.nodeId);
  invariant(binding && binding.projectId === project.id && binding.state === "active" && binding.planId === project.activePlanId
    && binding.candidateId === attempt.candidateId && binding.node.specDigest === attempt.specDigest && binding.node.kind === "video"
    && canonical(binding.node.args) === canonical(attempt.request.args) && Object.keys(binding.outputs).length === 0,
  "VIGGLE_H3_SELECTION_CHANGED", "The admitted Viggle selection is no longer current");
  const node = binding.node, plan = store.get<PlanRecord>("plan", binding.planId), shot = project.shots.find(item => item.id === node.shotId);
  const cue = shot?.cueId ? project.cues.find(item => item.id === shot.cueId) : undefined;
  invariant(shot && (!shot.cueId || cue) && node.intentDigest === shotIntentDigest(shot, "video", cue) && shot.promptIntent.video === node.intentDigest
    && node.args.prompt === shot.videoPrompt && (!cue || cue.accepted && cue.measured && cue.durationFrames === shot.desiredFrames && cue.durationFrames === node.args.durationFrames),
  "VIGGLE_H3_SELECTION_CHANGED", "Current shot intent or timing changed before submission");
  const lock = store.get<{ recipeDigest?: string }>("capability_lock", project.capabilityLockId);
  invariant(!lock?.recipeDigest || cue, "VIGGLE_H3_SELECTION_CHANGED", "Narrated production requires its current measured cue");
  invariant(plan?.projectId === project.id && node.requires.length > 0 && node.requires.every(id => plan.compiled.gates.some(gate => gate.id === id
    && gate.members.some(member => member.videoNodeId === node.id && member.recipeDigest === node.specDigest))), "VIGGLE_H3_SELECTION_CHANGED", "Current plan lost the exact review gate");
  const inputs = node.inputs.map(input => {
    const upstream = input.source.kind === "output" ? store.get<NodeBinding>("node_binding", input.source.nodeId) : undefined;
    invariant(!upstream || upstream.projectId === project.id && upstream.state === "active" && upstream.planId === project.activePlanId,
      "VIGGLE_H3_SELECTION_CHANGED", "Reviewed frame upstream is no longer current");
    const ref = input.source.kind === "artifact" ? input.source.artifact : upstream?.outputs[input.source.port];
    const record = ref ? store.get<ArtifactRecord>("artifact", ref.artifactId) : undefined;
    invariant(ref && record?.projectId === project.id && canonical(ref) === canonical(record.artifact), "VIGGLE_H3_SELECTION_CHANGED", "Reviewed frame is unavailable"); return ref;
  });
  invariant(canonical(inputs) === canonical(attempt.request.inputs) && effectiveNodeDigest(node, node.inputs.map((input, index) => ({ destinationPort: input.destinationPort,
    role: input.role, order: input.order, sha256: inputs[index]!.sha256 }))) === attempt.fingerprint, "VIGGLE_H3_SELECTION_CHANGED", "Current frame identity changed");
  invariant(!store.get<{ paused: boolean }>("execution_control", project.id)?.paused, "EXECUTION_PAUSED", "Execution is paused");
  const visited = new Set<string>(), scopes = new Set([project.id]);
  const visit = (value: NodeBinding): void => {
    if (visited.has(value.id)) return; visited.add(value.id); invariant(visited.size <= 1600, "VIGGLE_H3_EXECUTION_CONFLICT", "Input graph exceeds its bound");
    if (value.node.shotId) { scopes.add(value.node.shotId); const scene = project.shots.find(item => item.id === value.node.shotId)?.sceneId; if (scene) scopes.add(scene); }
    for (const input of value.node.inputs) if (input.source.kind === "output") { const prior = store.get<NodeBinding>("node_binding", input.source.nodeId); if (prior) visit(prior); }
  }; visit(binding);
  for (const scope of scopes) {
    const hold = store.db.prepare("SELECT id FROM entities WHERE kind='hold' AND project_id=? AND json_extract(body,'$.active')=1 AND json_extract(body,'$.scopeId')=? LIMIT 1").get(project.id, scope);
    invariant(!hold, "EXECUTION_HELD", "Current work is held by an editing request");
  }
}
