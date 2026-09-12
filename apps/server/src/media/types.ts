export interface MediaLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxDurationFrames: number;
  maxClips: number;
  /** Distinct normalized audio inputs and maximum simultaneous mixing lanes. */
  maxAudioTracks: number;
  /** Total cue placements, including sequential uses of one recording. */
  maxAudioPlacements: number;
  timeoutMs: number;
}

export interface LocalMediaOptions {
  /** Private, application-owned directory, not writable by an untrusted producer. */
  rootDir: string;
  /** Trusted host configuration. Never accept these roots from a model tool. */
  allowedInputRoots: string[];
  ffmpegPath: string;
  ffprobePath: string;
  limits?: Partial<MediaLimits>;
}

export interface MediaProbe {
  durationSeconds: number;
  video?: { streamIndex: number; width: number; height: number; frameRate: string; frames: number; durationSeconds: number; codec: string };
  audio?: { streamIndex: number; sampleRate: number; channels: number; samples: number | null; durationSeconds: number; codec: string };
}

/** A measured, normalized, service-issued descriptor. No caller-selected storage path. */
export interface SuppliedMedia {
  id: string;
  artifactId: string;
  kind: "video" | "audio";
  originalSha256: string;
  originalByteLength: number;
  sha256: string;
  byteLength: number;
  probe: MediaProbe;
  toolchainDigest: string;
}

export interface SuppliedClip {
  source: SuppliedMedia;
  startFrame: number;
  durationFrames: number;
  fit: "contain" | "cover";
}

export interface SuppliedAudioPlacement {
  source: SuppliedMedia;
  startSample: number;
  durationSamples: number;
  atSample: number;
  /** Fixed gain only. Fades, ducking and loudness normalization are deferred. */
  gainMilliDb?: number;
}

export interface RenderManifestInput {
  projectId: string;
  targetRevisionId: string;
  width: number;
  height: number;
  clips: SuppliedClip[];
  audio?: SuppliedAudioPlacement[];
}

export interface FrozenRenderManifest {
  digest: string;
  version: 1;
  projectId: string;
  targetRevisionId: string;
  width: number;
  height: number;
  frameRate: { numerator: 30; denominator: 1 };
  sampleRate: 48000;
  totalFrames: number;
  clips: SuppliedClip[];
  audio: (SuppliedAudioPlacement & { gainMilliDb: number })[];
  toolchainDigest: string;
}

export interface RenderedMedia {
  id: string;
  manifestDigest: string;
  sha256: string;
  byteLength: number;
  /** Internal host path. Serve an authorized artifact ID to browsers instead. */
  path: string;
  probe: MediaProbe;
}

export interface RenderCompletion {
  manifest: FrozenRenderManifest;
  artifact: RenderedMedia;
}

export interface RenderOptions {
  signal?: AbortSignal;
  /** Optional cheap preflight. The final publish comparison is still mandatory. */
  isCurrent?: (manifest: FrozenRenderManifest) => boolean;
  /**
   * Trusted synchronous port: persist the artifact and compare/select the target
   * revision in ONE application transaction. Return false to retain history only.
   * This service never performs a separate check-then-write of current selection.
   * A throw leaves an immutable recoverable output and completion receipt on disk.
   */
  publish?: (completion: RenderCompletion) => boolean;
}

export interface RenderResult extends RenderCompletion {
  status: "completed" | "published" | "historical";
}
