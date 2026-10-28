/** Shared domain values. All persisted IDs are issued by application services. */
export type Id = string;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type OperationKind =
  | "image"
  | "video"
  | "speech"
  | "transcription"
  | "timeline"
  | "render";

export interface ArtifactRef {
  artifactId: Id;
  sha256: string;
  kind: "image" | "video" | "audio" | "document" | "data";
}

export interface ShotRecord {
  /** Explicit unfinished direction for a newly added storyboard shot. */
  promptState?: "placeholder" | "ready";
  /** App-derived writing gap. Models cannot clear it; canonical human audio acceptance does. */
  narrationPending?: boolean;
  /** Protected canonical policy: actual narration may be shorter than this shot's visual slot. */
  narrationTimingMode?: "within_shot";
  narrationFit?: "cut_to_shot" | "extend_shot";
  /** Shot-level writing intent; acceptance and measured audio remain in narration records. */
  narration?: {
    mode: "undecided" | "none" | "generated" | "uploaded";
    text: string;
    /** Legacy stock uses the film default; a stock selector pins this shot's voice. */
    voice: "stock" | "personal" | "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer" | "verse" | "marin" | "cedar";
  };
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
  /** Characters visible in this shot, in reference order. Absent on plans written before character planning. */
  characterIds?: Id[];

  // Music-video performance (lip sync). Optional and omitted on ordinary shots, so older plans and digests are unchanged.
  /**
   * "singing": the shot shows a vocalist whose mouth must match the song under it. It is made by the lip-sync profile
   * from its keyframe and that shot's song segment instead of the project's normal video profile.
   */
  performance?: "singing";
}

/** One character's outfit for one scene. Clothing only; identity stays on the character. */
export interface CharacterWardrobe {
  sceneId: Id;
  outfit: string;
  /** Optional continuity note for this scene (wet hair, torn sleeve). */
  notes?: string;
}

/** A human-approved character sheet: the exact image every keyframe of this character uses as a reference. */
export interface CharacterSheetRef {
  artifactId: Id;
  sha256: string;
  /** Digest of the sheet prompt the approved take was generated from. */
  promptDigest: string;
  approvedAt: string;
}

/** Plan-level character. Wardrobe is per scene; the sheet carries identity, never a scene's clothing. */
export interface CharacterRecord {
  id: Id;
  revisionId: Id;
  name: string;
  /** Scene-independent look: face, hair, build, age, distinguishing marks. No clothing. */
  identity: string;
  /** Neutral outfit worn on the character sheet and used where a scene has no wardrobe entry. */
  baseOutfit?: string;
  wardrobe: CharacterWardrobe[];
  sheet: CharacterSheetRef | null;
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
export interface ProviderConfiguration {
  model: string;
  settings?: JsonObject;
}

/** Video types the Director recognises at intake (docs/ai/skill-drafts/video-types) plus music video. */
export const FILM_KINDS = Object.freeze(["narrative_short", "commercial_ad", "product_showcase", "brand_film", "explainer", "tutorial",
  "mini_doc", "testimonial", "social_vertical", "trailer_teaser", "event_recap", "fashion_lookbook", "place_film",
  "kids_animated_story", "app_promo", "narrated_story", "tribute", "music_video"] as const);
export type FilmKind = typeof FILM_KINDS[number];

export interface VisualStyleTraits {
  palette: string;
  lighting: string;
  lensFormat: string;
  texture: string;
  composition: string;
  productionDesign: string;
}
/** One look per film (docs/ai/skill-drafts/visual-styles/index.md). */
export interface VisualStyle {
  styleId: string;
  libraryVersion: string;
  label: string;
  /** Application-issued; changes whenever any field changes. */
  revisionId: Id;
  traits: VisualStyleTraits;
  imageBlock: string;
  motionBlock: string;
  motion: {
    cameraGrammar: string;
    frameRateFeel: "24fps-cinematic" | "30fps-video" | "12fps-on-twos" | "8-12fps-stop-motion" | "60fps-smooth";
    motionScale: "still" | "subtle" | "moderate" | "energetic";
  };
  negatives: string[];
  anchors: { referenceArtifactIds: Id[]; characterSheets: Id[] };
  variationAxes: Array<"timeOfDay" | "paletteShift" | "lightingKey" | "weather" | "treatment">;
  overrides?: Partial<VisualStyleTraits>;
  rationale: string;
}

export interface ProjectRecord {
  soundtrack?: {
    audioId: string;
    gainMilliDb: number;
    startFrame?: number;
    muted?: boolean;
  } | null;
  id: Id;
  revisionId: Id;
  headVersion: number;
  name: string;
  /** Default for new narration only; existing takes retain their voice. */
  narratorVoice?: string;
  archived?: boolean;
  updatedAt?: string;
  brief: string;
  story: string;
  scenes: Array<{ id: Id; revisionId: Id; purpose: string; title?: string }>;
  /** Planned characters with per-scene wardrobe. Absent on plans written before character planning. */
  characters?: CharacterRecord[];
  /** Explicit video type, set by the Director at intake. Absent on older plans. */
  filmKind?: FilmKind;
  /** The film's single look. Stored only; prompt compilation comes later. Absent on older plans. */
  visualStyle?: VisualStyle;
  narration: {
    script: string;
    source: "undecided" | "uploaded" | "generated" | "mixed";
  };
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
  /**
   * Character-sheet image owned by a planned character instead of a shot (`shotId` is null). Never produced by the
   * planning compiler; only the application's character-sheet command creates such a node, outside the shot plan.
   */
  characterId?: Id;
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
export interface NodeImpact {
  nodeId: Id;
  kind: NodeImpactKind;
  reason: string;
}

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
  {
    id: "fake-image-v1",
    revision: "1",
    kind: "image",
    adapter: "fake",
    maxConcurrency: 2,
    unitCostMicros: "100",
    maxRetries: 1,
  },
  {
    id: "fake-video-v1",
    revision: "1",
    kind: "video",
    adapter: "fake",
    maxConcurrency: 2,
    unitCostMicros: "1000",
    maxRetries: 1,
    minFrames: 120,
    maxFrames: 450,
  },
  {
    id: "fake-speech-v1",
    revision: "1",
    kind: "speech",
    adapter: "fake",
    maxConcurrency: 2,
    unitCostMicros: "100",
    maxRetries: 1,
  },
  {
    id: "fake-transcription-v1",
    revision: "1",
    kind: "transcription",
    adapter: "fake",
    maxConcurrency: 2,
    unitCostMicros: "100",
    maxRetries: 1,
  },
];
