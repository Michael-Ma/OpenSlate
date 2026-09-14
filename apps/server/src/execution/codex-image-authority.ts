import { canonical, digest, effectiveNodeDigest, invariant, shotIntentDigest } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionCallOptions, ExecutionRequest } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { ArtifactRecord, Attempt, Candidate, Grant, NodeBinding } from "./engine.js";
import { assertExternalAllowance, assertExternalAllowanceConsumption } from "./external-allowance-records.js";
import type { AllowanceHumanRequest, ExternalAllowance, ExternalAllowanceConsumption } from "./external-allowance-records.js";
import { assertCodexImageExecutionProfile, assertCodexImageExecutionMapping } from "./codex-image-receipts.js";
import type { CodexImageExecutionMapping } from "./codex-image-receipts.js";

export interface CodexImageCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; [key: string]: unknown }
export interface CodexImageReservation { id: string; projectId: string; attemptId: string; micros: string; state: string }
export interface CodexImageAdmission {
  attempt: Attempt; candidate: Candidate; grant: Grant; reservation: CodexImageReservation;
  allowance: ExternalAllowance; consumption: ExternalAllowanceConsumption; allowanceRequest: AllowanceHumanRequest;
  profile: ProviderProfile; capabilityLock: CodexImageCapabilityLock; references?: ArtifactRecord[];
}
export type CodexImageProfilePin = Pick<CodexImageExecutionMapping, "capabilityLockId" | "capabilityLockDigest" | "profileDefinition">;
export type CodexImageAuthorityStore = Pick<Store, "get" | "getProject" | "db">;
export const CODEX_IMAGE_PROFILE_LOOKUP_LIMITS = Object.freeze({ locks: 128, lockBytes: 65536, profiles: 64 });
const fail = (condition: unknown, message: string): void => invariant(condition, "CODEX_IMAGE_EXECUTION_CONFLICT", message);

/** Historical proof only: neither current selection nor current allowance availability is reinterpreted here. */
export function assertCodexImageAdmission(value: CodexImageAdmission): void {
  const { attempt, candidate, grant, reservation, allowance, consumption, allowanceRequest, profile, capabilityLock } = value;
  fail(attempt && attempt.id === attempt.request.attemptId && attempt.nodeId === attempt.request.nodeId && attempt.fingerprint === attempt.request.fingerprint
    && attempt.request.kind === "image" && attempt.request.execution?.adapter === "codex-image" && attempt.request.execution.version === "1"
    && attempt.taskId === null && candidate?.id === attempt.candidateId && candidate.projectId === attempt.projectId && candidate.nodeId === attempt.nodeId
    && grant?.id === candidate.grantId && grant.projectId === attempt.projectId && grant.kind === "image" && grant.origin === candidate.origin
    && reservation?.id === attempt.reservationId && reservation.projectId === attempt.projectId && reservation.attemptId === attempt.id
    && ["reserved", "charged", "released"].includes(reservation.state), "CodexImage requires its exact admitted candidate, grant and reservation");
  assertExternalAllowance(allowance, allowanceRequest); assertExternalAllowanceConsumption(consumption, allowance, attempt, reservation);
  assertCodexImageExecutionProfile(profile, attempt);
  fail(digest(profile) === consumption.profileDefinitionDigest && digest(profile) === allowance.profileDefinitionDigest
    && profile.unitCostMicros === consumption.estimatedMicros && profile.unitCostMicros === reservation.micros,
  "CodexImage profile estimate differs from its consumed allowance and reservation");
  fail(capabilityLock?.projectId === attempt.projectId && typeof capabilityLock.id === "string"
    && Array.isArray(capabilityLock.profiles) && capabilityLock.profiles.length > 0 && capabilityLock.profiles.length <= CODEX_IMAGE_PROFILE_LOOKUP_LIMITS.profiles
    && Buffer.byteLength(canonical(capabilityLock)) <= CODEX_IMAGE_PROFILE_LOOKUP_LIMITS.lockBytes
    && capabilityLock.profiles.some(item => canonical(item) === canonical(profile)), "CodexImage profile lacks retained matching lock evidence");
}
export function assertCodexImageMappingAdmission(admission: CodexImageAdmission, mapping: CodexImageExecutionMapping): void {
  assertCodexImageAdmission(admission); assertCodexImageExecutionMapping(admission.attempt, mapping);
  fail(mapping.capabilityLockId === admission.capabilityLock.id && mapping.capabilityLockDigest === digest(admission.capabilityLock)
    && canonical(mapping.profileDefinition) === canonical(admission.profile) && mapping.allowanceId === admission.allowance.id
    && mapping.allowanceDigest === digest(admission.allowance) && mapping.consumptionDigest === digest(admission.consumption)
    && mapping.estimatedMicros === admission.reservation.micros, "CodexImage mapping lost its exact retained admission evidence");
  fail(admission.references && canonical(mapping.references) === canonical(admission.references.map(ref => ({artifactId:ref.id,artifactDigest:digest(ref)})))
    && canonical(mapping.transport.images) === canonical(admission.references.map(ref => ({artifactId:ref.id,sha256:ref.artifact.sha256,byteLength:ref.byteLength}))), "Native mapping lost its exact owned references");
}

/** Resolve by recorded full-definition digest. The initial bounded scan proves a match, not which lock originated admission. */
export function resolveCodexImageAdmission(store: CodexImageAuthorityStore, input: Readonly<ExecutionRequest>, pinned?: CodexImageProfilePin & Partial<Pick<CodexImageExecutionMapping, "references">>): CodexImageAdmission {
  const request = structuredClone(input), attempt = store.get<Attempt>("attempt", request.attemptId);
  fail(attempt && canonical(attempt.request) === canonical(request) && attempt.candidateId && attempt.reservationId,
    "CodexImage requires an unchanged stored admission");
  const current = attempt!;
  const candidate = store.get<Candidate>("candidate", current.candidateId!), grant = candidate ? store.get<Grant>("grant", candidate.grantId) : undefined;
  const reservation = store.get<CodexImageReservation>("reservation", current.reservationId!);
  const allowance = store.get<ExternalAllowance>("external_allowance", request.externalAllowanceId ?? "");
  const consumption = store.get<ExternalAllowanceConsumption>("external_allowance_consumption", current.id);
  const allowanceRequest = allowance ? store.get<AllowanceHumanRequest>("message", allowance.requestId) : undefined;
  fail(candidate && grant && reservation && allowance && consumption && allowanceRequest, "CodexImage requires durable allowance consumption and its human issue evidence");
  const lockAt = (id: string): CodexImageCapabilityLock | undefined => {
    const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='capability_lock' AND id=?").get(id) as { project_id: string; bytes: number } | undefined;
    if (!meta) return undefined;
    fail(meta.project_id === current.projectId && meta.bytes <= CODEX_IMAGE_PROFILE_LOOKUP_LIMITS.lockBytes, "Retained profile lock is foreign or exceeds its byte bound");
    const lock = store.get<CodexImageCapabilityLock>("capability_lock", id)!;
    fail(lock.id === id && lock.projectId === current.projectId && Array.isArray(lock.profiles) && lock.profiles.length > 0
      && lock.profiles.length <= CODEX_IMAGE_PROFILE_LOOKUP_LIMITS.profiles, "Invalid retained profile lock"); return lock;
  };
  const matching = (lock: CodexImageCapabilityLock | undefined): ProviderProfile | undefined => lock?.profiles.find(profile => profile
    && profile.id === request.profile?.id && profile.revision === request.profile?.revision && digest(profile) === consumption!.profileDefinitionDigest);
  let capabilityLock: CodexImageCapabilityLock | undefined, profile: ProviderProfile | undefined;
  if (pinned) {
    capabilityLock = lockAt(pinned.capabilityLockId); profile = matching(capabilityLock);
    fail(capabilityLock && digest(capabilityLock) === pinned.capabilityLockDigest && profile && canonical(profile) === canonical(pinned.profileDefinition),
      "Pinned Codex image profile evidence is missing or changed");
  } else {
    capabilityLock = lockAt(store.getProject(current.projectId).capabilityLockId); profile = matching(capabilityLock);
    if (!profile) {
      const rows = store.db.prepare("SELECT id FROM entities WHERE kind='capability_lock' AND project_id=? ORDER BY id LIMIT ?")
        .all(current.projectId, CODEX_IMAGE_PROFILE_LOOKUP_LIMITS.locks + 1) as { id: string }[];
      invariant(rows.length <= CODEX_IMAGE_PROFILE_LOOKUP_LIMITS.locks, "CODEX_IMAGE_PROFILE_LOOKUP_LIMIT", "Historical profile lookup exceeds its fixed bound");
      for (const row of rows) { const lock = lockAt(row.id), found = matching(lock); if (found) { capabilityLock = lock; profile = found; break; } }
    }
    fail(profile, "The consumed Codex image profile definition has no retained matching lock");
  }
  const result = { attempt: current, candidate: candidate!, grant: grant!, reservation: reservation!, allowance: allowance!, consumption: consumption!,
    allowanceRequest: allowanceRequest!, profile: profile!, capabilityLock: capabilityLock! };
  const admission: CodexImageAdmission = result;
  if (pinned?.references) { admission.references = resolveCodexImageReferences(store, current); fail(canonical(pinned.references) === canonical(admission.references.map(ref => ({artifactId:ref.id,artifactDigest:digest(ref)}))), "Native mapping reference evidence changed"); }
  assertCodexImageAdmission(admission); return structuredClone(admission);
}

/** Use inside the short pre-marker/local-failure transaction; late provider observations use no first-submit check. */
export function assertCodexImageFirstDispatch(store: Store, original: CodexImageAdmission, expectedLease: ExecutionCallOptions["expectedLease"]): void {
  new InstallationRecoveryGuard(store).assertFirstSubmit(original.attempt.projectId, original.attempt.id);
  const current = resolveCodexImageAdmission(store, original.attempt.request, { capabilityLockId: original.capabilityLock.id,
    capabilityLockDigest: digest(original.capabilityLock), profileDefinition: original.profile });
  invariant(expectedLease && Object.keys(expectedLease).length === 2 && expectedLease.owner === original.attempt.leaseOwner
    && expectedLease.epoch === original.attempt.leaseEpoch && current.attempt.leaseOwner === expectedLease.owner
    && current.attempt.leaseEpoch === expectedLease.epoch && current.attempt.leaseExpiresAt > Date.now()
    && current.attempt.phase === "submitting" && current.reservation.state === "reserved",
  "CODEX_IMAGE_EXECUTION_NOT_DISPATCHABLE", "Codex image no longer owns its original unexpired submitting lease");
  const lock = store.get<CodexImageCapabilityLock>("capability_lock", store.getProject(current.attempt.projectId).capabilityLockId);
  invariant(lock?.profiles.some(profile => canonical(profile) === canonical(current.profile)), "CODEX_IMAGE_SELECTION_CHANGED", "The current profile changed");
  assertCodexImageCurrentSelection(store, current.attempt);
}

export function resolveCodexImageReferences(store: CodexImageAuthorityStore, attempt: Attempt): ArtifactRecord[] {
  fail(attempt.request.inputs.length <= 8, 'Too many image references');
  let total = 0;
  return attempt.request.inputs.map(input => {
    const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='artifact' AND id=?").get(input.artifactId) as {project_id:string;bytes:number}|undefined;
    fail(meta?.project_id === attempt.projectId && meta.bytes <= 32768, 'Reference row is missing, foreign or oversized');
    const value = store.get<ArtifactRecord>('artifact', input.artifactId);
    fail(value && value.id === input.artifactId && value.projectId === attempt.projectId && canonical(value.artifact) === canonical(input)
      && input.kind === 'image' && value.fixture === false && value.mimeType === 'image/png'
      && /^[a-f0-9]{64}$/.test(value.validationDigest ?? '') && Number.isSafeInteger(value.byteLength)
      && value.byteLength! >= 33 && value.byteLength! <= 4 * 1024 ** 2 && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height),
    'Reference must be an exact validated owned PNG');
    total += value!.byteLength!; fail(total <= 24 * 1024 ** 2, 'Reference bytes exceed their total limit'); return value!;
  });
}
/** Current eligibility only. Historical result recovery does not reinterpret later edits/holds. */
export function assertCodexImageCurrentSelection(store: CodexImageAuthorityStore, attempt: Attempt): void {
  const project = store.getProject(attempt.projectId), binding = store.get<NodeBinding>('node_binding', attempt.nodeId);
  invariant(binding && binding.projectId === project.id && binding.state === 'active' && binding.planId === project.activePlanId
    && binding.candidateId === attempt.candidateId && binding.node.specDigest === attempt.specDigest && binding.node.kind === 'image'
    && canonical(binding.node.args) === canonical(attempt.request.args) && Object.keys(binding.outputs).length === 0,
  'CODEX_IMAGE_SELECTION_CHANGED', 'The admitted image selection is no longer current');
  const node = binding.node, shot = project.shots.find(item => item.id === node.shotId);
  invariant(shot && node.intentDigest === shotIntentDigest(shot, 'image') && shot.promptIntent.image === node.intentDigest
    && node.args.prompt === shot.imagePrompt, 'CODEX_IMAGE_SELECTION_CHANGED', 'Current image prompt or references changed');
  const inputs = node.inputs.map(input => {
    const upstream = input.source.kind === 'output' ? store.get<NodeBinding>('node_binding', input.source.nodeId) : undefined;
    invariant(!upstream || upstream.projectId === project.id && upstream.state === 'active' && upstream.planId === project.activePlanId,
      'CODEX_IMAGE_SELECTION_CHANGED', 'Image reference upstream changed');
    const ref = input.source.kind === 'artifact' ? input.source.artifact : upstream?.outputs[input.source.port];
    invariant(ref, 'CODEX_IMAGE_SELECTION_CHANGED', 'Image reference is unavailable'); return ref;
  });
  invariant(canonical(inputs) === canonical(attempt.request.inputs) && effectiveNodeDigest(node, node.inputs.map((input,index) => ({destinationPort:input.destinationPort,
    role:input.role,order:input.order,sha256:inputs[index]!.sha256}))) === attempt.fingerprint, 'CODEX_IMAGE_SELECTION_CHANGED', 'Image reference identity changed');
  resolveCodexImageReferences(store, attempt);
  invariant(!store.get<{paused:boolean}>('execution_control', project.id)?.paused, 'EXECUTION_PAUSED', 'Execution is paused');
  const visited = new Set<string>(), scopes = new Set([project.id]);
  const visit = (value: NodeBinding): void => {
    if (visited.has(value.id)) return; visited.add(value.id); fail(visited.size <= 1600, 'Input graph exceeds its bound');
    if (value.node.shotId) { scopes.add(value.node.shotId); const scene = project.shots.find(item => item.id === value.node.shotId)?.sceneId; if (scene) scopes.add(scene); }
    for (const input of value.node.inputs) if (input.source.kind === 'output') { const prior = store.get<NodeBinding>('node_binding',input.source.nodeId); if (prior) visit(prior); }
  }; visit(binding);
  for (const scope of scopes) invariant(!store.db.prepare("SELECT id FROM entities WHERE kind='hold' AND project_id=? AND json_extract(body,'$.active')=1 AND json_extract(body,'$.scopeId')=? LIMIT 1").get(project.id,scope),
    'EXECUTION_HELD', 'Current image work is held by an editing request');
}
