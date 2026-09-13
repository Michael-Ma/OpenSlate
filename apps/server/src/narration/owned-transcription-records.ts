import { types } from "node:util";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { canonical, digest, diffPlans, invariant, PLAN_LIMITS, providerProfileArguments, RECIPE_DIGEST,
  requiredStages, STAGE_CONTRACTS_DIGEST, validateStageRequirements } from "@openslate/core";
import type { CompiledPlan, ProjectRecord, ProviderProfile, TranscriptionInputBinding } from "@openslate/core";
import type { TranscriptionAuthorityStore } from "../execution/transcription-execution-authority.js";
import { assertTranscriptionAudioSource } from "../execution/transcription-audio.js";
import { assertAudioOperationOptions } from "../execution/audio-preflight.js";
import type { ArtifactRecord } from "../execution/engine.js";
import { assertGeneratedNarrationAudio, isVerifiedGeneratedNarrationAudio } from "./generated-audio.js";
import type { NarrationAudio, NarrationState, SegmentRevision } from "./types.js";
import type { OwnedTranscriptionProposal, OwnedTranscriptionSource } from "./owned-transcription-types.js";

export const OWNED_TRANSCRIPTION_LIMITS = Object.freeze({ sourceBytes: 65536, proposalBytes: 16 * 1024 ** 2,
  catalogEntries: 64, aliases: 400000, values: 400000, depth: 128 });
const fail = (condition: unknown, message = "Owned recording proposal evidence is invalid"): void =>
  invariant(condition, "OWNED_TRANSCRIPTION_INVALID", message);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 160;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value: unknown, fields: string[]): void => fail(value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === fields.sort().join("\0"));
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Detached bounded data; accessors, proxies and coercion hooks are never evaluated. */
export function snapshotOwnedTranscriptionData<T>(input: T, maxBytes: number = OWNED_TRANSCRIPTION_LIMITS.proposalBytes): T {
  fail(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= OWNED_TRANSCRIPTION_LIMITS.proposalBytes);
  let count = 0, bytes = 0; const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    fail(++count <= OWNED_TRANSCRIPTION_LIMITS.values && depth <= OWNED_TRANSCRIPTION_LIMITS.depth);
    if (typeof value === "string") { bytes += Buffer.byteLength(value); fail(bytes <= maxBytes); return value; }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { fail(Number.isFinite(value)); return value; }
    fail(typeof value === "object" && value !== null && !types.isProxy(value) && !ancestors.has(value as object));
    const object = value as object, array = Array.isArray(object);
    fail(array ? Object.getPrototypeOf(object) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(object)));
    const keys = Reflect.ownKeys(object); fail(keys.length <= OWNED_TRANSCRIPTION_LIMITS.values); ancestors.add(object);
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    if (array) fail(keys.length === (object as unknown[]).length + 1);
    for (const key of keys) {
      if (array && key === "length") continue;
      fail(typeof key === "string"); const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(Object.hasOwn(property, "value") && property.enumerable);
      if (array) fail(/^(0|[1-9][0-9]*)$/.test(key as string) && Number(key) < (object as unknown[]).length);
      bytes += Buffer.byteLength(key as string); fail(bytes <= maxBytes);
      Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(object); return result;
  };
  const result = copy(input, 0); fail(Buffer.byteLength(canonical(result)) <= maxBytes); return result as T;
}

type Reader = TranscriptionAuthorityStore;
function owned<T>(reader: Reader, projectId: string, kind: string, key: string): T {
  fail(id(key)); const metadata = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?").get(kind, key) as { project_id: string; bytes: number } | undefined;
  fail(metadata?.project_id === projectId && metadata.bytes <= OWNED_TRANSCRIPTION_LIMITS.proposalBytes, "Missing or foreign recording proposal evidence");
  const value = reader.get<T>(kind, key); fail(value); return snapshotOwnedTranscriptionData(value!);
}
function author(reader: Reader, projectId: string, value: Pick<OwnedTranscriptionSource, "requestId" | "principalId" | "epochId">): void {
  fail(id(value.requestId) && id(value.principalId) && (value.epochId === null || id(value.epochId)));
  const message = owned<{ projectId: string; principalId: string; editing: boolean; scopeIds: string[] }>(reader, projectId, "message", value.requestId);
  fail(message.projectId === projectId && message.principalId === value.principalId && message.editing === true
    && Array.isArray(message.scopeIds) && message.scopeIds.includes(projectId));
  if (value.epochId !== null) {
    const epoch = owned<{ projectId: string; requestId: string; principalId: string; scopeIds: string[] }>(reader, projectId, "epoch", value.epochId);
    fail(epoch.projectId === projectId && epoch.requestId === value.requestId && epoch.principalId === value.principalId
      && Array.isArray(epoch.scopeIds) && epoch.scopeIds.includes(projectId));
  }
  // Historical authorship survives superseded requests and revoked epochs. Live authority belongs to the service.
}

export function assertOwnedTranscriptionSource(reader: Reader, projectId: string, input: unknown): asserts input is OwnedTranscriptionSource {
  const value = snapshotOwnedTranscriptionData(input, OWNED_TRANSCRIPTION_LIMITS.sourceBytes) as OwnedTranscriptionSource;
  exact(value, ["id", "version", "projectId", "requestId", "principalId", "epochId", "consumerAlias", "sourceRecord", "source", "sourceStartSample", "sourceEndSample", "artifact", "artifactRecordDigest", "target"]);
  fail(value.version === 1 && value.projectId === projectId && id(value.id) && id(value.consumerAlias)); author(reader, projectId, value);
  exact(value.sourceRecord, ["kind", "id", "digest"]); exact(value.artifact, ["artifactId", "kind", "sha256"]);
  fail(value.sourceRecord.kind === "narration_audio" && id(value.sourceRecord.id) && hash(value.sourceRecord.digest) && hash(value.artifactRecordDigest));
  const audio = owned<NarrationAudio>(reader, projectId, "narration_audio", value.sourceRecord.id);
  fail(audio.id === value.sourceRecord.id && audio.projectId === projectId && digest(audio) === value.sourceRecord.digest && equal(audio.media, value.source));
  assertTranscriptionAudioSource(value.source);
  fail(value.sourceStartSample === 0 && value.sourceEndSample === value.source.probe.audio!.samples
    && value.sourceRecord.id === value.source.artifactId && equal(value.artifact, { artifactId: audio.id, kind: "audio", sha256: value.source.sha256 }));
  const artifact = owned<ArtifactRecord>(reader, projectId, "artifact", audio.id);
  fail(digest(artifact) === value.artifactRecordDigest && artifact.id === audio.id && artifact.projectId === projectId
    && equal(artifact.artifact, value.artifact) && artifact.fixture === false && artifact.mimeType === "audio/wav"
    && artifact.byteLength === value.source.byteLength && artifact.physicalDurationSeconds === value.sourceEndSample / 48000
    && artifact.sourceDescriptorId === value.source.id && typeof artifact.path === "string" && isAbsolute(artifact.path)
    && resolve(artifact.path) === artifact.path && basename(artifact.path) === `${value.source.sha256}.wav` && basename(dirname(artifact.path)) === projectId);
  if (isVerifiedGeneratedNarrationAudio(audio)) assertGeneratedNarrationAudio(reader, projectId, audio);
  else {
    exact(audio, ["id", "projectId", "media", "declaredOrigin", "requestId"]);
    fail((audio.declaredOrigin === "uploaded" || audio.declaredOrigin === "generated") && id(audio.requestId)
      && artifact.origin === "narration_audio" && artifact.attemptId === null);
    const request = owned<{ projectId: string }>(reader, projectId, "message", audio.requestId); fail(request.projectId === projectId);
  }
  if (value.target?.kind === "recording") exact(value.target, ["kind"]);
  else {
    const target = value.target;
    exact(target, ["kind", "narrationRevisionId", "segmentId", "segmentRevisionId", "audioId"]);
    fail(target.kind === "section" && target.audioId === audio.id && id(target.segmentId) && id(target.segmentRevisionId));
    const revision = owned<{ state: NarrationState }>(reader, projectId, "narration_revision", target.narrationRevisionId), state = revision.state;
    fail(state?.projectId === projectId && state.revisionId === target.narrationRevisionId && Array.isArray(state.entries) && state.entries.length <= 400);
    const entries = state.entries.filter(entry => entry.segmentId === target.segmentId);
    fail(entries.length === 1 && entries[0]!.segmentRevisionId === target.segmentRevisionId && entries[0]!.audioId === audio.id);
    const segment = owned<SegmentRevision>(reader, projectId, "narration_segment", target.segmentRevisionId);
    fail(segment.projectId === projectId && segment.segmentId === target.segmentId && segment.id === target.segmentRevisionId);
  }
}

/** Exact saved base consumers only, never a project-wide history scan or a current-selection lookup. */
export function ownedTranscriptionCatalog(reader: Reader, projectId: string, compiledBase?: CompiledPlan | null): TranscriptionInputBinding[] {
  if (!compiledBase) return [];
  const plan = snapshotOwnedTranscriptionData(compiledBase); fail(Array.isArray(plan.nodes) && plan.nodes.length <= PLAN_LIMITS.nodes);
  const result: TranscriptionInputBinding[] = [], seen = new Set<string>();
  for (const node of plan.nodes) if (Object.hasOwn(node, "applicationInput")) {
    exact(node.applicationInput, ["kind", "id", "digest"]);
    const binding = node.applicationInput!; fail(binding.kind === "owned_transcription" && id(binding.id) && hash(binding.digest) && !seen.has(binding.id));
    fail(result.length < OWNED_TRANSCRIPTION_LIMITS.catalogEntries); seen.add(binding.id);
    const source = owned<OwnedTranscriptionSource>(reader, projectId, "owned_transcription_source", binding.id);
    assertOwnedTranscriptionSource(reader, projectId, source);
    fail(digest(source) === binding.digest && source.consumerAlias === node.alias && node.kind === "transcription"
      && equal(node.inputs, [{ destinationPort: "audio", role: "audio", order: 0, source: { kind: "artifact", artifact: source.artifact } }]));
    result.push({ id: source.id, digest: digest(source), consumerAlias: source.consumerAlias, artifact: source.artifact });
  }
  return result;
}

export function assertOwnedTranscriptionProposal(reader: Reader, projectId: string, input: unknown): asserts input is OwnedTranscriptionProposal {
  const value = snapshotOwnedTranscriptionData(input) as OwnedTranscriptionProposal;
  exact(value, ["id", "version", "state", "projectId", "requestId", "principalId", "epochId", "inputDigest", "baseProject", "basePlan", "capabilityLock", "sourceBinding", "profile", "operation", "compiled", "logicalIds", "impact", "stages", "stageVersions"]);
  fail(id(value.id) && value.version === 1 && value.state === "ungranted" && value.projectId === projectId && hash(value.inputDigest)); author(reader, projectId, value);
  exact(value.baseProject, ["revisionId", "headVersion", "digest"]); exact(value.capabilityLock, ["id", "digest"]); exact(value.sourceBinding, ["id", "digest"]);
  const project = owned<{ project: ProjectRecord }>(reader, projectId, "project_revision", value.baseProject.revisionId).project;
  fail(project?.id === projectId && project.revisionId === value.baseProject.revisionId && digest(project) === value.baseProject.digest
    && Number.isSafeInteger(value.baseProject.headVersion) && value.baseProject.headVersion >= 0 && project.headVersion === value.baseProject.headVersion);
  const lock = owned<{ id: string; projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string }>(reader, projectId, "capability_lock", value.capabilityLock.id);
  fail(project.capabilityLockId === value.capabilityLock.id && digest(lock) === value.capabilityLock.digest && lock.projectId === projectId
    && lock.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST && Array.isArray(lock.profiles) && lock.profiles.length <= 64
    && lock.profiles.filter(profile => profile.id === value.profile?.id && equal(profile, value.profile)).length === 1 && value.profile.kind === "transcription");
  let base: CompiledPlan | null = null;
  if (value.basePlan !== null) {
    exact(value.basePlan, ["id", "digest"]); const plan = owned<{ id: string; projectId: string; compiled: CompiledPlan }>(reader, projectId, "plan", value.basePlan.id);
    fail(plan.id === value.basePlan.id && plan.projectId === projectId && project.activePlanId === plan.id && digest(plan.compiled) === value.basePlan.digest); base = plan.compiled;
  } else fail(project.activePlanId === null);
  const binding = owned<OwnedTranscriptionSource>(reader, projectId, "owned_transcription_source", value.sourceBinding.id);
  assertOwnedTranscriptionSource(reader, projectId, binding);
  fail(value.sourceBinding.digest === digest(binding) && binding.requestId === value.requestId && binding.principalId === value.principalId && binding.epochId === value.epochId);
  exact(value.operation, ["alias", "profileId", "inputBindingId", "language"]);
  fail(value.operation.alias === binding.consumerAlias && value.operation.inputBindingId === binding.id && value.operation.profileId === value.profile.id
    && typeof value.operation.language === "string" && Buffer.byteLength(value.operation.language) <= 64);
  const compiled = value.compiled; exact(compiled, ["source", "canonicalSource", "graphDigest", "nodes", "gates"]);
  fail(typeof compiled.source === "string" && typeof compiled.canonicalSource === "string" && Buffer.byteLength(compiled.source) <= PLAN_LIMITS.sourceBytes
    && Buffer.byteLength(compiled.canonicalSource) <= PLAN_LIMITS.sourceBytes && Array.isArray(compiled.nodes) && compiled.nodes.length <= PLAN_LIMITS.nodes
    && Array.isArray(compiled.gates) && compiled.gates.length <= PLAN_LIMITS.nodes && hash(compiled.graphDigest));
  const additions = compiled.nodes.filter(node => node.alias === value.operation.alias); fail(additions.length === 1);
  const node = additions[0]!, applicationInput = { kind: "owned_transcription", id: binding.id, digest: digest(binding) };
  const args = { ...providerProfileArguments(value.profile), language: value.operation.language, timing: "word", settings: {} };
  assertAudioOperationOptions(value.profile, args);
  const inputs = [{ destinationPort: "audio", role: "audio", order: 0, source: { kind: "artifact", artifact: binding.artifact } }];
  const specDigest = digest({ kind: "transcription", args, intent: digest({}), inputs: [{ destinationPort: "audio", role: "audio", order: 0,
    source: { hash: binding.artifact.sha256, kind: "audio" } }], applicationInput });
  fail(id(node.id) && equal(node, { id: node.id, alias: value.operation.alias, kind: "transcription", shotId: null, shotRevisionId: null,
    profileId: value.profile.id, args, inputs, requires: [], intentDigest: digest({}), specDigest, applicationInput }));
  fail(equal(compiled.nodes.filter(item => item !== node), base?.nodes ?? []) && equal(compiled.gates, base?.gates ?? [])
    && !(base?.nodes ?? []).some(item => item.alias === node.alias || item.id === node.id)
    && !(base?.gates ?? []).some(item => item.alias === node.alias || item.id === node.id));
  const graph = digest({ nodes: compiled.nodes.map(item => ({ id: item.id, kind: item.kind, spec: item.specDigest, requires: [...item.requires].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    gates: compiled.gates.map(gate => ({ id: gate.id, members: [...gate.members].sort((a, b) => a.videoNodeId.localeCompare(b.videoNodeId)) })).sort((a, b) => a.id.localeCompare(b.id)) });
  fail(compiled.graphDigest === graph); ownedTranscriptionCatalog(reader, projectId, base);
  fail(value.logicalIds && typeof value.logicalIds === "object" && !Array.isArray(value.logicalIds) && Object.keys(value.logicalIds).length <= OWNED_TRANSCRIPTION_LIMITS.aliases);
  for (const [alias, identity] of Object.entries(value.logicalIds)) fail(alias.length > 0 && typeof identity === "string" && identity.length > 0 && identity.length <= 256);
  for (const item of [...compiled.nodes, ...compiled.gates]) fail(value.logicalIds[item.alias] === item.id);
  const stages = requiredStages(project, project, compiled); validateStageRequirements(project, stages);
  fail(equal(value.impact, diffPlans(base, compiled)) && equal(value.stages, stages));
  exact(value.stageVersions, stages.map(stage => digest({ projectId, stageId: stage.stageId, scopeId: stage.scopeId })));
  for (const version of Object.values(value.stageVersions)) fail(Number.isSafeInteger(version) && version >= 0);
  // Historical stage versions and extra retained aliases are snapshots, not current bindings or permission.
}
