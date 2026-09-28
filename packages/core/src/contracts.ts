/** Shared domain values. All persisted IDs are issued by application services. */
export type Id = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type OperationKind = "image" | "video" | "speech" | "transcription" | "timeline" | "render";

export interface ArtifactRef {
  artifactId: Id;
  sha256: string;
  kind: "image" | "video" | "audio" | "data";
}

export interface ShotRecord {
  /** Shot-level writing intent; acceptance and measured audio remain in narration records. */
  narration?: { mode: "undecided" | "none" | "generated" | "uploaded"; text: string; voice: "stock" | "personal" };
  id: Id;
  revisionId: Id;
  sceneId: Id;
  purpose: string;
  action: string;
  framing: string;
  motion: string;
  desiredFrames: number;
  imagePrompt: string;
  videoPrompt: string;
  promptIntent: { image: string; video: string };
  referenceArtifactIds: Id[];
  cueId: Id | null;
}

export interface CueRecord {
  id: Id;
  meaning: string;
  durationFrames: number;
  placementFrames: number;
  audio: ArtifactRef;
  accepted: boolean;
  measured: boolean;
}

export interface ProviderProfile {
  id: Id;
  revision: string;
  kind: OperationKind;
  adapter: string;
  /** Execution mapping contract, independent of this profile's revision. */
  executionVersion?: string;
  /** Non-secret, pinned transport settings. Omitted on historical fake profiles. */
  configuration?: ProviderConfiguration;
  maxConcurrency: number;
  unitCostMicros: string;
  maxRetries: number;
  minFrames?: number;
  maxFrames?: number;
}
export interface ProviderConfiguration { model: string; settings?: JsonObject }

export interface ProjectRecord {
  soundtrack?: { audioId: string; gainMilliDb: number } | null;
  id: Id;
  revisionId: Id;
  headVersion: number;
  name: string;
  brief: string;
  story: string;
  scenes: Array<{ id: Id; revisionId: Id; purpose: string }>;
  narration: { script: string; source: "undecided" | "uploaded" | "generated" | "mixed" };
  maxFrames: number;
  capabilityLockId: Id;
  shots: ShotRecord[];
  cues: CueRecord[];
  artifacts: ArtifactRef[];
  activePlanId: Id | null;
}

export type InputSource =
  | { kind: "artifact"; artifact: ArtifactRef }
  | { kind: "output"; nodeId: Id; port: string };

export interface InputBinding {
  destinationPort: string;
  role: string;
  order: number;
  source: InputSource;
}

export interface PlanNode {
  id: Id;
  alias: string;
  kind: OperationKind;
  shotId: Id | null;
  shotRevisionId: Id | null;
  profileId: Id | null;
  args: JsonObject;
  inputs: InputBinding[];
  requires: Id[];
  intentDigest: string;
  specDigest: string;
  /** Host-authored source binding. Compilation alone does not establish ownership or generation authority. */
  applicationInput?: TranscriptionApplicationInput;
}

export interface TranscriptionInputBinding {
  id: string;
  digest: string;
  consumerAlias: string;
  artifact: ArtifactRef;
}

export interface TranscriptionApplicationInput {
  kind: "owned_transcription";
  id: string;
  digest: string;
}

export interface ReviewMember {
  videoNodeId: Id;
  shotId: Id;
  frameSource: InputSource;
  recipeDigest: string;
}

export interface ReviewGate {
  id: Id;
  alias: string;
  members: ReviewMember[];
}

export interface CompiledPlan {
  source: string;
  canonicalSource: string;
  graphDigest: string;
  nodes: PlanNode[];
  gates: ReviewGate[];
}

export interface LocalExecutionIdentity {
  readonly adapter: "local-media";
  readonly version: "1";
}

export interface CompileContext {
  project: ProjectRecord;
  profiles: ProviderProfile[];
  /** Trusted host selection, never supplied through the planning language. Omission preserves legacy assembly. */
  localExecution?: LocalExecutionIdentity;
  /** Trusted compact metadata for exact transcription consumers; never source ownership or approval by itself. */
  transcriptionInputs?: readonly TranscriptionInputBinding[];
  /** Existing symbolic aliases survive source edits. Missing aliases allocate once per prepare. */
  logicalIds: Record<string, Id>;
  allocateId: () => Id;
}

export type NodeImpactKind = "reuse" | "replace" | "new" | "retire";
export interface NodeImpact { nodeId: Id; kind: NodeImpactKind; reason: string }

export type ActorContext =
  | { kind: "human"; principalId: Id; requestId: Id }
  | { kind: "director"; principalId: Id; requestId: Id; epochId: Id };

export interface ProjectEvent {
  eventId: Id;
  projectId: Id;
  sequence: number;
  kind: string;
  payload: JsonObject;
  occurredAt: string;
}

export const DEFAULT_PROFILES: ProviderProfile[] = [
  { id: "fake-image-v1", revision: "1", kind: "image", adapter: "fake", maxConcurrency: 2, unitCostMicros: "100", maxRetries: 1 },
  { id: "fake-video-v1", revision: "1", kind: "video", adapter: "fake", maxConcurrency: 2, unitCostMicros: "1000", maxRetries: 1, minFrames: 120, maxFrames: 450 },
  { id: "fake-speech-v1", revision: "1", kind: "speech", adapter: "fake", maxConcurrency: 2, unitCostMicros: "100", maxRetries: 1 },
  { id: "fake-transcription-v1", revision: "1", kind: "transcription", adapter: "fake", maxConcurrency: 2, unitCostMicros: "100", maxRetries: 1 },
];
