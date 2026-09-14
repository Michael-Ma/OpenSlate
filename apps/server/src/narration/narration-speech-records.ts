import { canonical, digest, diffPlans, invariant, PLAN_LIMITS, providerProfileArguments, RECIPE_DIGEST,
  requiredStages, STAGE_CONTRACTS_DIGEST, validateStageRequirements } from "@openslate/core";
import type { CompiledPlan, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { assertAudioOperationOptions } from "../execution/audio-preflight.js";
import { ownedTranscriptionCatalog, snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import type { NarrationState, SegmentRevision } from "./types.js";
import type { NarrationSpeechProposal, NarrationSpeechSection } from "./narration-speech-types.js";

export type NarrationSpeechReader = Pick<Store, "get" | "getProject" | "db">;
export const NARRATION_SPEECH_LIMITS = Object.freeze({ proposalBytes: 16 * 1024 ** 2, aliases: 400000 });
const fail = (condition: unknown, message = "Saved narration speech evidence is invalid"): void => invariant(condition, "NARRATION_SPEECH_INVALID", message);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 160;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value: unknown, fields: string[]): void => fail(value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === fields.sort().join("\0"));
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
type Reader = NarrationSpeechReader;
export function narrationSpeechRecord<T>(reader: Reader, projectId: string, kind: string, key: string): T {
  fail(id(key)); const metadata = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?").get(kind, key) as { project_id: string; bytes: number } | undefined;
  fail(metadata?.project_id === projectId && metadata.bytes <= NARRATION_SPEECH_LIMITS.proposalBytes, "Saved narration speech evidence is missing or foreign");
  const value = reader.get<T>(kind, key); fail(value); return snapshotOwnedTranscriptionData(value!);
}
const owned = narrationSpeechRecord;
function author(reader: Reader, projectId: string, value: Pick<NarrationSpeechProposal, "requestId" | "principalId" | "epochId">): void {
  fail(id(value.requestId) && id(value.principalId) && (value.epochId === null || id(value.epochId)));
  const message = owned<{ projectId: string; principalId: string; editing: boolean; scopeIds: string[] }>(reader, projectId, "message", value.requestId);
  fail(message.projectId === projectId && message.principalId === value.principalId && message.editing === true && Array.isArray(message.scopeIds) && message.scopeIds.includes(projectId));
  if (value.epochId !== null) {
    const epoch = owned<{ projectId: string; requestId: string; principalId: string; scopeIds: string[] }>(reader, projectId, "epoch", value.epochId);
    fail(epoch.projectId === projectId && epoch.requestId === value.requestId && epoch.principalId === value.principalId && Array.isArray(epoch.scopeIds) && epoch.scopeIds.includes(projectId));
  }
}
/** Exact saved section; historical validity never depends on the current narration selection. */
export function resolveNarrationSpeechSection(reader: Reader, projectId: string, input: NarrationSpeechSection): SegmentRevision {
  const section = snapshotOwnedTranscriptionData(input, 4096); exact(section, ["narrationRevisionId", "segmentId", "segmentRevisionId", "segmentDigest"]);
  fail(id(section.narrationRevisionId) && id(section.segmentId) && id(section.segmentRevisionId) && hash(section.segmentDigest));
  const revision = owned<{ state: NarrationState }>(reader, projectId, "narration_revision", section.narrationRevisionId), state = revision.state;
  fail(state?.projectId === projectId && state.revisionId === section.narrationRevisionId && Array.isArray(state.entries) && state.entries.length <= 400);
  const entries = state.entries.filter(entry => entry.segmentId === section.segmentId);
  fail(entries.length === 1 && entries[0]!.segmentRevisionId === section.segmentRevisionId);
  const script = owned<SegmentRevision>(reader, projectId, "narration_segment", section.segmentRevisionId);
  fail(script.id === section.segmentRevisionId && script.projectId === projectId && script.segmentId === section.segmentId && digest(script) === section.segmentDigest
    && script.textKind === "draft" && script.source.kind === "generated" && typeof script.text === "string" && script.text.trim().length > 0,
  "Choose a finished saved section marked for generated narration");
  return script;
}

export function assertNarrationSpeechProposal(reader: Reader, projectId: string, input: unknown): asserts input is NarrationSpeechProposal {
  const value = snapshotOwnedTranscriptionData(input) as NarrationSpeechProposal;
  exact(value, ["id", "version", "state", "projectId", "requestId", "principalId", "epochId", "inputDigest", "baseProject", "basePlan", "capabilityLock", "section", "profile", "operation", "compiled", "logicalIds", "impact", "stages", "stageVersions"]);
  fail(id(value.id) && value.version === 1 && value.state === "ungranted" && value.projectId === projectId && hash(value.inputDigest)); author(reader, projectId, value);
  exact(value.baseProject, ["revisionId", "headVersion", "digest"]); exact(value.capabilityLock, ["id", "digest"]);
  const project = owned<{ project: ProjectRecord }>(reader, projectId, "project_revision", value.baseProject.revisionId).project;
  fail(project?.id === projectId && project.revisionId === value.baseProject.revisionId && digest(project) === value.baseProject.digest
    && Number.isSafeInteger(value.baseProject.headVersion) && value.baseProject.headVersion >= 0 && project.headVersion === value.baseProject.headVersion);
  const lock = owned<{ id: string; projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string }>(reader, projectId, "capability_lock", value.capabilityLock.id);
  fail(project.capabilityLockId === value.capabilityLock.id && digest(lock) === value.capabilityLock.digest && lock.projectId === projectId
    && lock.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST && Array.isArray(lock.profiles) && lock.profiles.length <= 64
    && lock.profiles.filter(profile => profile.id === value.profile?.id && equal(profile, value.profile)).length === 1 && value.profile.kind === "speech");
  let base: CompiledPlan | null = null;
  if (value.basePlan !== null) {
    exact(value.basePlan, ["id", "digest"]); const plan = owned<{ id: string; projectId: string; compiled: CompiledPlan }>(reader, projectId, "plan", value.basePlan.id);
    fail(plan.id === value.basePlan.id && plan.projectId === projectId && project.activePlanId === plan.id && digest(plan.compiled) === value.basePlan.digest); base = plan.compiled;
  } else fail(project.activePlanId === null);
  const script = resolveNarrationSpeechSection(reader, projectId, value.section);
  exact(value.operation, ["alias", "profileId", "text", "voice", "instructions"]);
  fail(id(value.operation.alias) && value.operation.profileId === value.profile.id && value.operation.text === script.text
    && script.source.kind === "generated" && (script.source.voice === null || script.source.voice === value.operation.voice)
    && (script.source.profileRevisionId === null || script.source.profileRevisionId === value.profile.revision));
  const compiled = value.compiled; exact(compiled, ["source", "canonicalSource", "graphDigest", "nodes", "gates"]);
  fail(typeof compiled.source === "string" && typeof compiled.canonicalSource === "string" && Buffer.byteLength(compiled.source) <= PLAN_LIMITS.sourceBytes
    && Buffer.byteLength(compiled.canonicalSource) <= PLAN_LIMITS.sourceBytes && Array.isArray(compiled.nodes) && compiled.nodes.length <= PLAN_LIMITS.nodes
    && Array.isArray(compiled.gates) && compiled.gates.length <= PLAN_LIMITS.nodes && hash(compiled.graphDigest));
  const additions = compiled.nodes.filter(node => node.alias === value.operation.alias); fail(additions.length === 1);
  const node = additions[0]!;
  const args = { ...providerProfileArguments(value.profile), text: value.operation.text, voice: value.operation.voice, instructions: value.operation.instructions, settings: {} };
  assertAudioOperationOptions(value.profile, args);
  const specDigest = digest({ kind: "speech", args, intent: digest({}), inputs: [] });
  fail(id(node.id) && equal(node, { id: node.id, alias: value.operation.alias, kind: "speech", shotId: null, shotRevisionId: null,
    profileId: value.profile.id, args, inputs: [], requires: [], intentDigest: digest({}), specDigest }));
  fail(equal(compiled.nodes.filter(item => item !== node), base?.nodes ?? []) && equal(compiled.gates, base?.gates ?? [])
    && !(base?.nodes ?? []).some(item => item.alias === node.alias || item.id === node.id)
    && !(base?.gates ?? []).some(item => item.alias === node.alias || item.id === node.id));
  const graph = digest({ nodes: compiled.nodes.map(item => ({ id: item.id, kind: item.kind, spec: item.specDigest, requires: [...item.requires].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    gates: compiled.gates.map(gate => ({ id: gate.id, members: [...gate.members].sort((a, b) => a.videoNodeId.localeCompare(b.videoNodeId)) })).sort((a, b) => a.id.localeCompare(b.id)) });
  fail(compiled.graphDigest === graph); ownedTranscriptionCatalog(reader, projectId, base);
  fail(value.logicalIds && typeof value.logicalIds === "object" && !Array.isArray(value.logicalIds) && Object.keys(value.logicalIds).length <= NARRATION_SPEECH_LIMITS.aliases);
  for (const [alias, identity] of Object.entries(value.logicalIds)) fail(alias.length > 0 && typeof identity === "string" && identity.length > 0 && identity.length <= 256);
  for (const item of [...compiled.nodes, ...compiled.gates]) fail(value.logicalIds[item.alias] === item.id);
  const stages = requiredStages(project, project, compiled); validateStageRequirements(project, stages);
  fail(equal(value.impact, diffPlans(base, compiled)) && equal(value.stages, stages));
  exact(value.stageVersions, stages.map(stage => digest({ projectId, stageId: stage.stageId, scopeId: stage.scopeId })));
  for (const version of Object.values(value.stageVersions)) fail(Number.isSafeInteger(version) && version >= 0);
  // Historical stage versions and extra retained aliases are snapshots, not current bindings or permission.
}
