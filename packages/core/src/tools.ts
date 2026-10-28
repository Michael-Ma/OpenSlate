import { Ajv, type ErrorObject } from "ajv";
import { canonical, digest, DomainError, invariant } from "./common.js";
import type { JsonObject } from "./contracts.js";
import { changeProposalSchema, contractSevenChangeProposalSchema, parseChangeProposal, sceneTitleSchema, shortFramingSchema, successorChangeProposalSchema } from "./workflow/index.js";
import { legacyChangeProposalSchema } from "./legacy-change-schema.js";

export const TOOL_NAMES = Object.freeze(["read_context", "prepare_change", "apply_change", "control_execution", "inspect_artifact"] as const);
export const V2_TOOL_NAMES = Object.freeze([...TOOL_NAMES, "revise_narration_draft"] as const);
const V3_TOOL_NAMES = Object.freeze([...V2_TOOL_NAMES, "prepare_recording_transcription", "prepare_narration_speech"] as const);
const V5_TOOL_NAMES = Object.freeze([...V3_TOOL_NAMES, "record_notes", "propose_change"] as const);
export const V6_TOOL_NAMES = Object.freeze([...V5_TOOL_NAMES, "make_keyframes", "accept_proposal", "reject_proposal"] as const);
export const V7_TOOL_NAMES = Object.freeze([...V6_TOOL_NAMES, "set_soundtrack", "move_shot", "move_scene", "start_export", "undo_edit",
  "delete_shots", "delete_scene", "use_take", "analyze_music", "make_character_sheets"] as const);
/** Every tool name any catalog has advertised. */
export const ALL_TOOL_NAMES = V7_TOOL_NAMES;
export type ToolName = typeof ALL_TOOL_NAMES[number];
export const TOOL_CONTRACT_VERSION = "1.0.0";
export const SUPPORTED_TOOL_CONTRACTS = Object.freeze(["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0", "6.0.0", "7.0.0"] as const);
export type ToolContractVersion = typeof SUPPORTED_TOOL_CONTRACTS[number];
/** Contracts that shipped guidance packages lock. 7.0.0 is implemented but no shipped skill package declares it yet. */
export const RELEASED_TOOL_CONTRACTS = Object.freeze(["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0", "6.0.0"] as const);
export const CURRENT_TOOL_CONTRACT: ToolContractVersion = "6.0.0";
/** Ordered contract comparison; later contracts keep every earlier behaviour unless they say otherwise. */
export function toolContractAtLeast(version: string | undefined, minimum: ToolContractVersion): boolean {
  const index = (SUPPORTED_TOOL_CONTRACTS as readonly string[]).indexOf(version ?? "1.0.0");
  return index >= 0 && index >= SUPPORTED_TOOL_CONTRACTS.indexOf(minimum);
}
export interface ParsedToolCall { name: ToolName; arguments: JsonObject }
export interface ToolDescriptor {
  name: ToolName;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; destructiveHint: false; openWorldHint: false };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const id = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const descriptor = (name: ToolName, description: string, inputSchema: object, readOnlyHint: boolean): ToolDescriptor => ({
  name, description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
});

/** Fixed advertised schemas; annotations are discovery hints, never authorization. */
export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = freeze([
  descriptor("read_context", "Read bounded project context. With no section, return overview. Select shots, scenes, plan, grants, or receipts and follow returned offsets for additional pages. Plan source is returned in chunks. Compare returned revision/version across pages; restart pagination if it changes.", object({
    section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "grants", "receipts", "aliases"] },
    offset: { type: "integer", minimum: 0, maximum: 10_000_000 },
  }), true),
  descriptor("prepare_change", "Validate and prepare a scoped workflow, creative, or plan change. Preparation does not apply the change.", structuredClone(legacyChangeProposalSchema), false),
  descriptor("apply_change", "Apply an existing prepared change owned by this request. The application checks authority, versions, and generation grants.", object({ preparedId: id }, ["preparedId"]), false),
  descriptor("control_execution", "Hold execution within this request's scope. Only a human command can resume execution.", object({ action: { type: "string", enum: ["pause"] } }, ["action"]), false),
  descriptor("inspect_artifact", "Inspect an artifact belonging to the current project using its saved artifact ID.", object({ artifactId: id }, ["artifactId"]), true),
]);
export const TOOL_CATALOG_DIGEST = digest({ version: TOOL_CONTRACT_VERSION, tools: TOOL_DESCRIPTORS });
const draft = object({
  text: { type: "string", maxLength: 16000 }, textKind: { enum: ["notes", "outline", "draft"] },
  language: { type: "string", minLength: 1, maxLength: 64 }, meaning: { type: "string", maxLength: 4000 },
  source: { oneOf: [object({ kind: { const: "undecided" } }, ["kind"]), object({ kind: { const: "uploaded" } }, ["kind"]),
    object({ kind: { const: "generated" }, voice: { type: ["string", "null"], minLength: 1, maxLength: 160 },
      profileRevisionId: { type: ["string", "null"], minLength: 1, maxLength: 160 } }, ["kind", "voice", "profileRevisionId"])] },
}, ["text", "textKind", "language", "meaning", "source"]);
const items = (item: object) => ({ type: "array", maxItems: 400, items: item });
const draftChangeSchema = object({ expectedVersion: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  patch: object({ add: items(draft), update: items(object({ segmentId: id, draft }, ["segmentId", "draft"])), remove: items(id), order: items(id) }),
}, ["expectedVersion", "patch"]);
// V1 schemas/digests stay exact. V2 removes the alternate canonical narration write path.
const v2ChangeSchema = structuredClone(legacyChangeProposalSchema);
const v2Creative = (v2ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v2Creative.narrationScript;
delete v2Creative.narrationSource;
const v2Descriptors = freeze(TOOL_DESCRIPTORS.map(tool => tool.name === "prepare_change" ? { ...tool, inputSchema: v2ChangeSchema }
  : tool.name === "read_context" ? { ...tool, description: `${tool.description} Select narration for draft sections, recording inventory and independently derived readiness.`,
    inputSchema: object({ section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "grants", "receipts", "aliases", "narration"] }, offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) }
  : tool).concat(descriptor("revise_narration_draft", "Atomically save requested narration script/source drafts at an exact narration version. Read narration context first. Changed sections lose their exact acceptances; unrelated sections remain intact. This does not accept text/audio/timing, attach audio, commit canonical cues, buy media, or release execution holds. Add first, then reorder with returned saved IDs.", draftChangeSchema, false)));
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const headVersion = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const recordingTarget = { oneOf: [object({ kind: { const: "recording" } }, ["kind"]),
  object({ kind: { const: "section" }, segmentId: id, segmentRevisionId: id, audioId: id }, ["kind", "segmentId", "segmentRevisionId", "audioId"])] };
const v3Descriptors = freeze(v2Descriptors.map(tool => tool.name === "read_context" ? { ...tool,
  description: `${tool.description} Select audio_operations for bounded owned recording identities, exact speech/transcription choices and saved proposals. Preparing an audio proposal never approves or starts generation.`,
  inputSchema: object({ section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration", "audio_operations"] },
    offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) } : tool).concat(
  descriptor("prepare_recording_transcription", "Prepare one transcription proposal for the exact owned recording and optional selected section from audio_operations context. Preserves the current plan. No script is required for an independent recording. Human review and separate finite spending approval remain required; this never approves, submits, attaches or adopts anything.",
    object({ expectedHeadVersion: headVersion, audioId: id, sourceRecordDigest: hash, profileId: id,
      language: { type: "string", minLength: 1, maxLength: 64 }, target: recordingTarget },
    ["expectedHeadVersion", "audioId", "sourceRecordDigest", "profileId", "language", "target"]), false),
  descriptor("prepare_narration_speech", "Prepare one speech proposal from the exact saved narration section revision. Read narration and audio_operations first. The application uses the saved text; this tool cannot replace it. Human review and separate finite spending approval remain required. It never generates, attaches or accepts audio.",
    object({ expectedHeadVersion: headVersion, segmentId: id, segmentRevisionId: id, profileId: id, voice: id,
      instructions: { type: "string", maxLength: 256 } }, ["expectedHeadVersion", "segmentId", "segmentRevisionId", "profileId", "voice", "instructions"]), false),
));
// V4 adds compact per-shot narration intent without changing any saved catalog.
const v4ChangeSchema = structuredClone(changeProposalSchema);
const v4Creative = (v4ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v4Creative.narrationScript;
delete v4Creative.narrationSource;
const v4Descriptors = freeze(v3Descriptors.map(tool => tool.name === "prepare_change" ? { ...tool,
  description: `${tool.description} Save compact shot narration intent with createShots/updateShots.narration; this does not accept audio, timing or spending.`,
  inputSchema: v4ChangeSchema } : tool));
export const recordNotesSchema = object({ notes: { type: "array", minItems: 1, maxItems: 6, items: object({
  anchor: { ...object({ sceneId: id, shotIds: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: id } }), anyOf: [{ required: ["sceneId"] }, { required: ["shotIds"] }] },
  kind: { enum: ["observation", "recommendation"] }, blocking: { type: "boolean" }, text: { type: "string", minLength: 1, maxLength: 600 },
  seenKeyframe: object({ shotId: id, artifactId: id, sha256: hash }, ["shotId", "artifactId", "sha256"]),
  choices: { type: "array", minItems: 1, maxItems: 3, items: { oneOf: [
    object({ kind: { const: "accept" }, label: { type: "string", minLength: 1, maxLength: 80 } }, ["kind", "label"]),
    object({ kind: { const: "proposal" }, proposalId: id }, ["kind", "proposalId"]),
    object({ kind: { const: "regenerate_keyframe" }, shotIds: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: id } }, ["kind", "shotIds"]),
    object({ kind: { const: "edit_field" }, shotId: id, field: { enum: ["narration", "imagePrompt", "motion"] } }, ["kind", "shotId", "field"]),
    object({ kind: { const: "reply" } }, ["kind"]),
  ] } },
}, ["anchor", "kind", "blocking", "text", "choices"]) } }, ["notes"]);
// Every shipped catalog, including 5.0.0, remains byte-for-byte unchanged.
export const proposalPatchSchema = object({
  updateShots: { type: "array", minItems: 1, maxItems: 400, items: { ...object({
    id, desiredFrames: { type: "integer", minimum: 1, maximum: 10800 },
    motion: { type: "string", minLength: 1, maxLength: 16000 },
    imagePrompt: { type: "string", minLength: 1, maxLength: 16000 },
    videoPrompt: { type: "string", minLength: 1, maxLength: 16000 },
    narration: object({ mode: { enum: ["undecided", "none", "generated", "uploaded"] }, text: { type: "string", maxLength: 16000 }, voice: { enum: ["stock", "personal"] } }, ["mode", "text", "voice"]),
  }, ["id"]), minProperties: 2 } },
  updateScenes: { type: "array", minItems: 1, maxItems: 400, items: object({ id, purpose: { type: "string", minLength: 1, maxLength: 16000 } }, ["id", "purpose"]) },
});
export const proposeChangeSchema = object({ patch: { ...proposalPatchSchema, minProperties: 1 } }, ["patch"]);
const v5Descriptors = freeze(v4Descriptors.map(tool => tool.name === "read_context" ? { ...tool,
  description: `${tool.description} Select notes for open, resolved and stale notes and human resolutions.`,
  inputSchema: object({ section: { enum: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration", "audio_operations", "notes"] }, offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) }
  : tool.name === "prepare_narration_speech" ? { ...tool, description: "Save a pending speech suggestion for an exact saved narration section. Only a person's press on the audio request route starts paid work. This tool never generates, attaches or accepts audio. No spending allowance or separate approval is needed." }
  : tool.name === "prepare_recording_transcription" ? { ...tool, description: "Save a pending transcription suggestion for an exact owned recording and optional section. Only a person's press on the audio request route starts paid work. This tool never transcribes, attaches or adopts text. No spending allowance or separate approval is needed." }
  : tool).concat(descriptor("record_notes", "Record one point per shot-anchored note, including typed human choices. Use the returned app-assigned letters. Allowed in discuss-only turns. Notes never edit the film or start paid work. Never judge a picture absent from attachedKeyframes or re-raise settled notes.", recordNotesSchema, false), descriptor("propose_change", "Hold one creative patch for human review with an application-computed Now/After preview. Allowed in discuss-only epochs. No holds, plan, grants or generation. Propose duration, narration and changes that outdate paid media; apply harmless text directly with a receipt.", proposeChangeSchema, false)));
// Clone each successor schema independently; historical descriptors share no mutable inputs.
const v6ChangeSchema = structuredClone(successorChangeProposalSchema);
const v6Creative = (v6ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v6Creative.narrationScript;
delete v6Creative.narrationSource;
const v6ProposalPatchSchema = structuredClone(proposalPatchSchema);
const v6ProposalProperties = v6ProposalPatchSchema.properties as {
  updateShots: { items: { properties: Record<string, object> } };
  updateScenes: object;
};
Object.assign(v6ProposalProperties.updateShots.items.properties, {
  purpose: { type: "string", minLength: 1, maxLength: 16000 }, action: { type: "string", minLength: 1, maxLength: 16000 }, framing: structuredClone(shortFramingSchema),
});
v6ProposalProperties.updateScenes = { type: "array", minItems: 1, maxItems: 400,
  items: { ...object({ id, title: structuredClone(sceneTitleSchema), purpose: { type: "string", minLength: 1, maxLength: 16000 } }, ["id"]), minProperties: 2 } };
const v6ProposeChangeSchema = object({ patch: { ...v6ProposalPatchSchema, minProperties: 1 } }, ["patch"]);
const v6RecordNotesSchema = structuredClone(recordNotesSchema);
const v6NoteProperties = v6RecordNotesSchema.properties as { notes: { items: { properties: { choices: { items: { oneOf: object[] } } } } } };
v6NoteProperties.notes.items.properties.choices.items.oneOf.push(
  object({ kind: { const: "confirm_video" }, sceneId: id }, ["kind", "sceneId"]),
);
const generationIds = { type: "array", minItems: 1, maxItems: 400, uniqueItems: true, items: id };
const proposalDecisionSchema = object({ proposalId: id }, ["proposalId"]);
export const makeKeyframesSchema = {
  ...object({ sceneIds: generationIds, shotIds: generationIds, regenerate: { type: "boolean" } }),
  oneOf: [{ required: ["sceneIds"] }, { required: ["shotIds"] }],
  // A new take must name the precise shots requested by the person.
  if: { properties: { regenerate: { const: true } }, required: ["regenerate"] },
  then: { required: ["shotIds"] },
};
const v6Descriptors = freeze(v5Descriptors.map(tool => tool.name === "read_context" ? { ...tool, description: tool.description.replace("Preparing an audio proposal never approves or starts generation.", "Audio operations report pending suggestions and actual request-owned transcription outcomes; only an eligible current human attachment can start transcription from conversation.") }
  : tool.name === "prepare_change" ? { ...tool, inputSchema: v6ChangeSchema }
  : tool.name === "propose_change" ? { ...tool, inputSchema: v6ProposeChangeSchema }
  : tool.name === "record_notes" ? { ...tool, inputSchema: v6RecordNotesSchema,
    description: `${tool.description} For requested video in ready scenes, offer a scene-anchored confirm_video choice, available in chat and Keyframes. Unclear or Director-proposed remakes use regenerate_keyframe choices; named human remake requests may use make_keyframes. Only a human click on confirm_video confirms video, never a chat reply. Clear requests to accept or decline a specific held proposal use accept_proposal or reject_proposal.` }
  : tool.name === "prepare_recording_transcription" ? { ...tool, description: "Prepare transcription of an exact owned recording. In a fresh human editing conversation, an audio attachment sent with that request may be transcribed when the person asks what it says or its line is needed. The application prices and records the operation under that human request. Other recordings remain pending suggestions for a human press. Never attach, adopt or accept the returned text, or blindly resubmit an unknown outcome." }
  : tool).concat(
  descriptor("make_keyframes", "Start only the keyframes and needed voice lines the person's fresh editing conversation requested. Pass exactly one of sceneIds or shotIds using saved IDs within that request's scope. regenerate: true requires explicit shotIds and the person's request for new takes of those shots. For unclear or Director-proposed remakes offer a regenerate_keyframe note choice; preserve existing takes in history. Reports started work, quotes and per-scene refusal codes. Review, read-only and automatic turns cannot start work. For requested video in ready scenes offer confirm_video note choices in chat or Keyframes; only a human click confirms. Reconcile unknown outcomes before retrying.", makeKeyframesSchema, false),
  descriptor("accept_proposal", "Accept a specific held creative proposal when the person's current source:user message clearly requests it in an editing turn. Pass its saved proposal ID or app-assigned note letter; ask which proposal if ambiguous. The application uses its current preview and applies the same patch, note settlement and Undo as the banner. App messages, review, automatic and read-only turns cannot decide proposals. Report success only from the result, then continue other requested work using the accepted prompts. Video still requires a clicked confirm_video choice after its frames are opened.", proposalDecisionSchema, false),
  descriptor("reject_proposal", "Decline a specific held creative proposal when the person's current source:user message clearly requests it in an editing turn. Pass its saved proposal ID or app-assigned note letter; ask which proposal if ambiguous. The application uses its current preview and settles the same proposal and linked note as the banner. App messages, review, automatic and read-only turns cannot decide proposals. Report its actual result and never claim a settled or stale proposal changed.", proposalDecisionSchema, false),
));
// Contract 7.0.0: the person's free edits, confirmation cards for deletion, earlier takes and resume, music analysis,
// project fields and character tools. Built from independent clones; 6.0.0 descriptors are never mutated.
const v7ChangeSchema = structuredClone(contractSevenChangeProposalSchema);
const v7Creative = (v7ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v7Creative.narrationScript;
delete v7Creative.narrationSource;
const ids = (max: number) => ({ type: "array", minItems: 1, maxItems: max, uniqueItems: true, items: id });
export const setSoundtrackSchema = { ...object({
  audioId: { anyOf: [id, { type: "null" }] },
  startFrame: { type: "integer", minimum: 0, maximum: 10800 },
  gainMilliDb: { type: "integer", minimum: -60000, maximum: 0 },
  muted: { type: "boolean" },
}), minProperties: 1 };
const v7Descriptors = freeze(v6Descriptors.map(tool => tool.name === "read_context" ? { ...tool,
  description: `${tool.description} Select audio_library for owned recordings with label, role, length, cached song timing and the current soundtrack. Select characters for planned characters, wardrobe and sheets.`,
  inputSchema: object({ section: { enum: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration", "audio_operations", "notes", "audio_library", "characters"] }, offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) }
  : tool.name === "prepare_change" ? { ...tool, inputSchema: v7ChangeSchema,
    description: `${tool.description} creative.project sets filmKind at intake: the whole film-kind@1 record {kind, subtype, tones, format {platform, aspect, lengthBand, targetSeconds}, audience, source, labels for each other value, basis per field: stated, asked, inferred or default}; kind undecided means not chosen yet. It also sets a visualStyle the person chose (null clears it). createScenes/createShots take an optional beforeId to insert before an existing scene, or a shot of the same scene. createCharacters, updateCharacters, deleteCharacterIds and updateShots[].characterIds go in their own call, without other fields; they apply directly and return a receipt.` }
  : tool.name === "control_execution" ? { ...tool,
    description: "pause holds execution within this request's scope. stop stops the whole film's new generation and this conversation, exactly as the person's Stop; send it last. resume continues stopped paid work only after the person confirms: it records a confirmation card and starts nothing.",
    inputSchema: object({ action: { type: "string", enum: ["pause", "stop", "resume"] } }, ["action"]) }
  : tool).concat(
  descriptor("set_soundtrack", "Choose, change or clear the film's music, its start, gain or mute, with the person's own soundtrack command. Free and undoable. audioId is an owned recording from audio_library (a chat attachment counts), or null for no music. Generating new music is not available. Requires whole-film scope.", setSoundtrackSchema, false),
  descriptor("move_shot", "Move a shot to a scene, before beforeId (a shot of that scene) or to its end, with the person's own move command. Free and undoable. The shot and destination scene must be within this request's scope.", object({ shotId: id, sceneId: id, beforeId: id }, ["shotId", "sceneId"]), false),
  descriptor("move_scene", "Move a scene before beforeId or to the end, with the person's own move command. Free and undoable. The scene must be within this request's scope.", object({ sceneId: id, beforeId: id }, ["sceneId"]), false),
  descriptor("start_export", "Start a local export of the current film, exactly as the person's Export. Free; no provider is called. Earlier exports stay listed. Report the returned state and refusal codes as given. Requires whole-film scope.", object({}), false),
  descriptor("undo_edit", "Undo the latest storyboard command (commandId from a receipt) or an accepted proposal (its proposalId), with the person's own Undo. Free. Only the latest unchanged storyboard command can be undone. Undoing work outside this conversation requires whole-film scope and the person's request.", object({ commandId: id }, ["commandId"]), false),
  descriptor("delete_shots", "Offer a confirmation card to delete these shots. Nothing is deleted until the person clicks it; the card names paid keyframes and clips that leave the timeline. Undo stays available after deletion.", object({ shotIds: ids(64) }, ["shotIds"]), false),
  descriptor("delete_scene", "Offer a confirmation card to delete a scene. withShots: true is required when it has shots. Nothing is deleted until the person clicks it.", object({ sceneId: id, withShots: { type: "boolean" } }, ["sceneId"]), false),
  descriptor("use_take", "Offer a confirmation card to use an earlier keyframe take of a shot (artifactId from its take history). The shot's clip will need confirming and generating again. Nothing changes until the person clicks it.", object({ shotId: id, artifactId: id }, ["shotId", "artifactId"]), false),
  descriptor("analyze_music", "Read an owned recording's tempo, beats, sections (labels when known), vocal ranges and timed lyrics when known, and suggested shot lengths per section. Free and read-only; it never changes the film.", object({ audioId: id }, ["audioId"]), true),
  descriptor("make_character_sheets", "Start character sheets for planned characters the person asked for in this fresh editing conversation. regenerate: true makes a new take for characters that already have one. Approving a sheet stays the person's choice.", object({ characterIds: ids(32), regenerate: { type: "boolean" } }, ["characterIds"]), false),
));
export interface ToolCatalog { version: ToolContractVersion; names: readonly ToolName[]; descriptors: readonly ToolDescriptor[]; digest: string }
export const TOOL_CATALOGS: Readonly<Record<ToolContractVersion, ToolCatalog>> = freeze({
  "1.0.0": { version: "1.0.0", names: TOOL_NAMES, descriptors: TOOL_DESCRIPTORS, digest: TOOL_CATALOG_DIGEST },
  "2.0.0": { version: "2.0.0", names: V2_TOOL_NAMES, descriptors: v2Descriptors, digest: digest({ version: "2.0.0", tools: v2Descriptors }) },
  "3.0.0": { version: "3.0.0", names: V3_TOOL_NAMES, descriptors: v3Descriptors, digest: digest({ version: "3.0.0", tools: v3Descriptors }) },
  "4.0.0": { version: "4.0.0", names: V3_TOOL_NAMES, descriptors: v4Descriptors, digest: digest({ version: "4.0.0", tools: v4Descriptors }) },
  "5.0.0": { version: "5.0.0", names: V5_TOOL_NAMES, descriptors: v5Descriptors, digest: digest({ version: "5.0.0", tools: v5Descriptors }) },
  "6.0.0": { version: "6.0.0", names: V6_TOOL_NAMES, descriptors: v6Descriptors, digest: digest({ version: "6.0.0", tools: v6Descriptors }) },
  "7.0.0": { version: "7.0.0", names: V7_TOOL_NAMES, descriptors: v7Descriptors, digest: digest({ version: "7.0.0", tools: v7Descriptors }) },
});
export function toolCatalog(version: string = TOOL_CONTRACT_VERSION): ToolCatalog {
  invariant(Object.hasOwn(TOOL_CATALOGS, version), "CAPABILITY_MISMATCH", "Unsupported director tool contract");
  return TOOL_CATALOGS[version as ToolContractVersion];
}
/** Exact implementation identity for each immutable catalog. */
export function toolHandlerId(version: ToolContractVersion): string {
  return ({ "1.0.0": "five-tools@1", "2.0.0": "director-tools@2", "3.0.0": "director-tools@3", "4.0.0": "director-tools@4", "5.0.0": "director-tools@5", "6.0.0": "director-tools@6", "7.0.0": "director-tools@7" } as const)[toolCatalog(version).version];
}
const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validators = new Map(Object.values(TOOL_CATALOGS).map(catalog => [catalog.version,
  new Map(catalog.descriptors.map(tool => [tool.name, ajv.compile(tool.inputSchema)]))]));

/** Explain the registered schema without reflecting payload values or unknown field names. */
function toolValidationMessage(name: ToolName, input: unknown, registeredSchema: object, errors: ErrorObject[] | null | undefined): string {
  type Schema = { properties?: Record<string, Schema>; items?: Schema; oneOf?: Schema[]; const?: string; enum?: string[]; [key: string]: unknown };
  const schema = registeredSchema as Schema;
  const choiceSchemas = name === 'record_notes' ? schema.properties!.notes!.items!.properties!.choices!.items!.oneOf! : [];
  const choiceKinds = choiceSchemas.map(choice => choice.properties!.kind!.const!);
  const knownFields = new Set<string>();
  const collectFields = (node: Schema): void => {
    for (const [field, child] of Object.entries(node.properties ?? {})) { knownFields.add(field); collectFields(child); }
    if (node.items) collectFields(node.items);
    for (const child of node.oneOf ?? []) collectFields(child);
  };
  collectFields(schema);
  const pointerParts = (path: string): string[] => path.split("/").slice(1).map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  const safePath = (path: string): string => {
    const parts = pointerParts(path);
    return parts.every(part => knownFields.has(part) || /^(0|[1-9][0-9]{0,7})$/.test(part)) ? path || "/" : "/";
  };
  const schemaAt = (path: string): Schema => {
    let node: unknown = schema;
    for (const part of pointerParts(path)) node = (node as Record<string, unknown> | undefined)?.[part];
    return (node ?? {}) as Schema;
  };
  const allowedFields = (schemaPath: string): string[] => {
    const parts = schemaPath.split('/');
    while (parts.length) {
      const fields = Object.keys(schemaAt(parts.join('/')).properties ?? {});
      if (fields.length) return fields;
      parts.pop();
    }
    return [];
  };
  const valueAt = (path: string): unknown => {
    let value = input;
    for (const part of pointerParts(path)) value = (value as Record<string, unknown> | undefined | null)?.[part];
    return value;
  };
  const reasons = new Set<string>();
  for (const error of errors ?? []) {
    const path = safePath(error.instancePath);
    const choiceMatch = name === 'record_notes' && error.instancePath.match(/^(\/notes\/\d+\/choices\/\d+)(?:\/|$)/);
    if (choiceMatch) {
      const choicePath = safePath(choiceMatch[1]!);
      const choice = valueAt(choiceMatch[1]!);
      if (choice === null || typeof choice !== "object" || Array.isArray(choice)) {
        reasons.add(`${choicePath} must be object`); continue;
      }
      const kind = (choice as Record<string, unknown>).kind;
      const selected = choiceKinds.indexOf(kind as string);
      if (selected < 0) {
        reasons.add(kind === undefined ? `${choicePath}/kind is required` : `${choicePath}/kind must be one of: ${choiceKinds.join(", ")}`);
        continue;
      }
      const branch = error.schemaPath.match(/\/properties\/choices\/items\/oneOf\/(\d+)(?:\/|$)/);
      if (branch && Number(branch[1]) !== selected || error.keyword === "oneOf") continue;
    }
    // A scene or shot anchor is an alternative, not two individually required fields.
    if (name === 'record_notes' && /\/properties\/anchor\/anyOf\//.test(error.schemaPath)) continue;
    const parent = schemaAt(error.schemaPath.slice(0, error.schemaPath.lastIndexOf("/")));
    const count = (value: unknown): string => typeof value === "number" ? String(value) : "the registered limit";
    const fields = name !== 'record_notes' ? allowedFields(error.schemaPath) : [];
    const add = (reason: string): void => { reasons.add(`${reason}${fields.length && error.keyword !== 'additionalProperties' ? `; allowed fields: ${fields.join(', ')}` : ''}`); };
    switch (error.keyword) {
      case "required": {
        const field = error.params.missingProperty as string;
        add(knownFields.has(field) ? `${path === "/" ? "" : path}/${field} is required` : `${path} is missing a required field`); break;
      }
      case "additionalProperties": add(`${path} has unsupported fields; allowed fields: ${Object.keys(parent.properties ?? {}).join(", ")}`); break;
      case "type": add(`${path} must be ${String(parent.type)}`); break;
      case "enum": add(`${path} must be one of: ${(parent.enum ?? []).join(", ")}`); break;
      case "const": add(`${path} must equal ${parent.const ?? "the registered value"}`); break;
      case "minLength": add(`${path} must contain at least ${count(parent.minLength)} character${parent.minLength === 1 ? "" : "s"}`); break;
      case "maxLength": add(`${path} must contain at most ${count(parent.maxLength)} characters`); break;
      case "minItems": add(`${path} must contain at least ${count(parent.minItems)} item${parent.minItems === 1 ? "" : "s"}`); break;
      case "maxItems": add(`${path} must contain at most ${count(parent.maxItems)} items`); break;
      case "uniqueItems": add(`${path} must contain unique items`); break;
      case "minimum": add(`${path} must be at least ${count(parent.minimum)}`); break;
      case "maximum": add(`${path} must be at most ${count(parent.maximum)}`); break;
      case "minProperties": add(`${path} must contain at least ${count(parent.minProperties)} field${parent.minProperties === 1 ? "" : "s"}`); break;
      case "pattern": add(`${path} must be a 64-character lowercase hexadecimal SHA-256`); break;
      case "anyOf": add(`${path} must include sceneId or shotIds (an array of shot IDs)`); break;
      default: add(`${path} must match the registered schema`);
    }
  }
  const selected: string[] = [];
  for (const reason of reasons) {
    if (selected.length >= 8 || selected.join("; ").length + reason.length > 1600) break;
    selected.push(reason);
  }
  if (selected.length < reasons.size) selected.push(`additional validation errors; correct these fields and retry ${name}`);
  return `${name} arguments are invalid: ${selected.join("; ") || "use the registered schema"}`;
}

export function parseToolArguments(toolName: string, input: unknown, version: ToolContractVersion = TOOL_CONTRACT_VERSION): ParsedToolCall {
  const catalog = toolCatalog(version);
  invariant(catalog.names.includes(toolName as ToolName), "NOT_FOUND", "Unknown director tool for the locked contract");
  const name = toolName as ToolName;
  const validate = validators.get(catalog.version)!.get(name)!;
  const valid = validate(input);
  if (!valid && (name === 'record_notes' || name === 'propose_change' || name === 'prepare_change')) {
    const reason = validate.errors?.some(error => /^\/notes\/\d+\/anchor(?:\/|$)/.test(error.instancePath)) ? "invalid_anchor" : "invalid_arguments";
    const schema = catalog.descriptors.find(tool => tool.name === name)!.inputSchema;
    throw new DomainError("VALIDATION_ERROR", toolValidationMessage(name, input, schema, validate.errors), name === 'record_notes' ? { reason } : undefined);
  }
  invariant(valid, "VALIDATION_ERROR", "Tool arguments do not match the registered schema");
  // In-process callers must obey the same JSON data boundary as HTTP/MCP callers.
  canonical(input);
  const parsed = name === "prepare_change" ? parseChangeProposal(input) : structuredClone(input);
  return { name, arguments: parsed as unknown as JsonObject };
}
