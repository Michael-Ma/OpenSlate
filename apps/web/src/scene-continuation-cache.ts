import type { PendingCommand } from "./pending-command";

export interface PersistedSceneStep {
  name: string;
  command: PendingCommand;
  done: boolean;
  result?: unknown;
}
export interface PersistedSceneFlow {
  review: unknown;
  expectedHead: number;
  expectedRequest: string | null;
  expectedNarrationVersion: number;
  steps: PersistedSceneStep[];
  proposals: [string, string][];
  recordings: [string, unknown][];
}
export interface SceneContinuation {
  command: PendingCommand;
  flow: PersistedSceneFlow | null;
}

type Envelope = SceneContinuation & {
  version: 1;
  namespace: string;
  projectId: string;
  updatedAt: number;
  expiresAt: number;
};
const prefix = "openslate:scene-continuation:v1:";
const lifetime = 7 * 24 * 60 * 60 * 1000;
const maximumBytes = 2 * 1024 * 1024;
const forbidden = /token|secret|password|credential|authorization|csrf|cookie|api[_-]?key/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, max = 160): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const version = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Storage is only a local retry hint; endpoint and live authority are checked again by callers. */
export function sceneCommandPath(path: string, projectId: string): boolean {
  const match = /^\/api\/projects\/([^/?#]+)\/scenes\/([^/?#]+)\/(confirm|generate)$/.exec(path);
  if (!match) return false;
  try { return decodeURIComponent(match[1]!) === projectId && bounded(decodeURIComponent(match[2]!)); }
  catch { return false; }
}
function stepPath(path: string, projectId: string): boolean {
  if (sceneCommandPath(path, projectId) && path.endsWith("/generate")) return true;
  const root = /^\/api\/projects\/([^/?#]+)\/narration\/(.+)$/.exec(path);
  if (!root) return false;
  try { if (decodeURIComponent(root[1]!) !== projectId) return false; }
  catch { return false; }
  return /^shots\/[^/?#]+\/(initialize|generate|accept)$/.test(root[2]!) ||
    /^(?:generated-audio-bindings|bindings)$/.test(root[2]!);
}
function plain(value: unknown, depth = 0): boolean {
  if (depth > 28) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => plain(item, depth + 1));
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).length > 300) return false;
  return Object.entries(value).every(([key, item]) => !forbidden.test(key) && plain(item, depth + 1));
}
function returnedVersion(value: Record<string, unknown>): boolean {
  return (!("headVersion" in value) || version(value.headVersion)) &&
    (!("narrationVersion" in value) || version(value.narrationVersion)) &&
    (!("state" in value) || object(value.state) && version(value.state.version)) &&
    (!("shot" in value) || object(value.shot) && returnedVersion(value.shot));
}
function recordingValid(value: unknown): boolean {
  if (!object(value) || !bounded(value.id) || !object(value.media) ||
    typeof value.media.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.media.sha256) ||
    !object(value.media.probe) || !object(value.media.probe.audio) ||
    !Number.isSafeInteger(value.media.probe.audio.samples) ||
    (value.media.probe.audio.samples as number) <= 0 ||
    typeof value.media.probe.audio.durationSeconds !== "number" ||
    !Number.isFinite(value.media.probe.audio.durationSeconds) ||
    value.media.probe.audio.durationSeconds <= 0) return false;
  if (value.originEvidence === "verified_generated_audio")
    return object(value.selection) &&
      typeof value.selection.artifactDigest === "string" && /^[a-f0-9]{64}$/.test(value.selection.artifactDigest) &&
      typeof value.selection.generationEvidenceDigest === "string" && /^[a-f0-9]{64}$/.test(value.selection.generationEvidenceDigest);
  return value.declaredOrigin === "uploaded" || value.declaredOrigin === "generated";
}
function completedResult(name: string, result: unknown): boolean {
  if (!object(result) || !plain(result) || !returnedVersion(result)) return false;
  const suffix = name === "video" ? "video" : name.slice(name.lastIndexOf(":") + 1);
  if (suffix === "open") {
    const session = result.session, segment = result.segment;
    return version(result.headVersion) && object(session) && bounded(session.id) &&
      bounded(session.requestId) && session.state === "active" &&
      object(segment) && object(segment.entry) && bounded(segment.entry.segmentId) &&
      object(segment.script) && bounded(segment.script.id) &&
      typeof segment.script.text === "string" && object(segment.script.source) &&
      ["generated", "uploaded", "undecided"].includes(String(segment.script.source.kind)) &&
      (segment.audio === null || recordingValid(segment.audio));
  }
  if (suffix === "speech") return object(result.proposal) && bounded(result.proposal.id) &&
    object(result.shot) && version(result.shot.headVersion);
  if (suffix === "attach") return object(result.state) && version(result.state.version);
  if (suffix === "save") return version(result.headVersion);
  return suffix === "video";
}
function commandValid(value: unknown, projectId: string, step = false): value is PendingCommand {
  if (!object(value) || !bounded(value.path, 1000) || !bounded(value.key) ||
    !((step ? stepPath : sceneCommandPath)(value.path, projectId)) ||
    "file" in value || ("body" in value && !plain(value.body)) ||
    ("metadata" in value && !plain(value.metadata))) return false;
  if (!step && value.path.endsWith("/confirm")) {
    const meta = value.metadata;
    if (!object(meta) || !object(meta.sceneReview) ||
      meta.sceneId !== meta.sceneReview.sceneId ||
      meta.sceneReview.projectId !== projectId ||
      !bounded(meta.sceneId) ||
      !Array.isArray(meta.sceneReview.rows) || meta.sceneReview.rows.length > 400 ||
      meta.sceneReview.rows.filter((row: unknown) => object(row) && (!row.videoComplete || row.narrationPending)).length > 64 ||
      !meta.sceneReview.rows.every((row: unknown) => object(row) && bounded(row.shotId) &&
        typeof row.motionPrompt === "string" && version(row.durationFrames) &&
        typeof row.videoProfileLabel === "string" && object(row.videoSettings) &&
        typeof row.narrationPending === "boolean" && typeof row.videoComplete === "boolean") ||
      !bounded(meta.sceneReview.confirmationDigest) ||
      !bounded(meta.sceneReview.sceneIntentDigest)) return false;
  }
  return true;
}
function flowValid(value: unknown, projectId: string, command: PendingCommand): value is PersistedSceneFlow {
  if (!object(value) || !command.path.endsWith("/confirm") ||
    !object(value.review) || !plain(value.review) ||
    JSON.stringify(value.review) !== JSON.stringify((command.metadata as { sceneReview?: unknown })?.sceneReview) ||
    !version(value.expectedHead) || !version(value.expectedNarrationVersion) ||
    !(value.expectedRequest === null || bounded(value.expectedRequest)) ||
    !Array.isArray(value.steps) || value.steps.length > 260 ||
    !Array.isArray(value.proposals) || value.proposals.length > 64 ||
    !Array.isArray(value.recordings) || value.recordings.length > 64) return false;
  const review = (command.metadata as { sceneReview: { rows: { shotId: string }[] } }).sceneReview;
  const shots = new Set(review.rows.map(row => row.shotId));
  const names = new Set<string>();
  for (const item of value.steps) {
    if (!object(item) || !bounded(item.name, 300) || names.has(item.name) ||
      !commandValid(item.command, projectId, true) || typeof item.done !== "boolean" ||
      (item.done && (!("result" in item) || !completedResult(item.name, item.result))) ||
      (!item.done && "result" in item && !plain(item.result))) return false;
    const suffix = item.name === "video" ? "video" : item.name.slice(item.name.lastIndexOf(":") + 1);
    const shot = item.name === "video" ? null : item.name.slice(0, item.name.lastIndexOf(":"));
    if (suffix === "video" ? !item.command.path.endsWith("/scenes/" + encodeURIComponent((command.metadata as { sceneId: string }).sceneId) + "/generate") :
      !bounded(shot) || !shots.has(shot) || !["open", "speech", "attach", "save"].includes(suffix) ||
      (suffix === "attach" ? !/\/(?:generated-audio-bindings|bindings)$/.test(item.command.path) :
        !item.command.path.endsWith(`/shots/${encodeURIComponent(shot)}/${suffix === "open" ? "initialize" : suffix === "speech" ? "generate" : "accept"}`))) return false;
    names.add(item.name);
  }
  return value.proposals.every((row: unknown) => Array.isArray(row) && row.length === 2 && shots.has(row[0]) && bounded(row[1])) &&
    value.recordings.every((row: unknown) => Array.isArray(row) && row.length === 2 && shots.has(row[0]) &&
      recordingValid(row[1]) && plain(row[1]));
}

/** A single document owns the command and all runner checkpoints. No draft cache eviction touches it. */
export class SceneContinuationCache {
  readonly namespace: string | undefined;
  private readonly area: Storage | null;
  private readonly memory = new Map<string, SceneContinuation | null>();
  private readonly hydrated = new Set<string>();
  warning: string | null = null;
  mustPauseBeforePost = false;
  constructor(namespace?: string, area?: Storage | null) {
    this.namespace = bounded(namespace, 300) ? namespace : undefined;
    if (area !== undefined) this.area = area;
    else {
      try { this.area = typeof window === "undefined" ? null : window.localStorage; }
      catch { this.area = null; }
    }
    if (this.namespace && !this.area) this.warning = "Local scene recovery is unavailable. Keep this tab open until the request settles.";
  }
  private key(projectId: string) {
    return `${prefix}${encodeURIComponent(this.namespace!)}:${encodeURIComponent(projectId)}`;
  }
  private parse(raw: string, projectId: string): SceneContinuation {
    if (raw.length > maximumBytes) throw Error("oversized");
    const item: unknown = JSON.parse(raw);
    if (!object(item) || item.version !== 1 || item.namespace !== this.namespace ||
      item.projectId !== projectId || !version(item.updatedAt) || !version(item.expiresAt) ||
      (item.expiresAt as number) <= Date.now() || (item.updatedAt as number) > Date.now() + 60_000 ||
      !commandValid(item.command, projectId) ||
      !(item.flow === null || flowValid(item.flow, projectId, item.command))) throw Error("invalid");
    return { command: item.command, flow: item.flow } as SceneContinuation;
  }
  read(projectId: string): SceneContinuation | null {
    if (this.hydrated.has(projectId)) return this.memory.get(projectId) ?? null;
    this.hydrated.add(projectId);
    if (!this.namespace || !this.area || !bounded(projectId)) return null;
    try {
      const raw = this.area.getItem(this.key(projectId));
      if (!raw) return null;
      const saved = this.parse(raw, projectId);
      this.memory.set(projectId, saved);
      return saved;
    } catch {
      try { this.area?.removeItem(this.key(projectId)); } catch { /* still no authority from the hint */ }
      this.warning = "A local scene continuation could not be restored. Check the saved project before another decision.";
      return null;
    }
  }
  write(projectId: string, saved: SceneContinuation | null): boolean {
    this.hydrated.add(projectId);
    this.memory.set(projectId, saved);
    if (!this.namespace) return false;
    if (!this.area) return false;
    try {
      if (saved === null) { this.area.removeItem(this.key(projectId)); return true; }
      if (!commandValid(saved.command, projectId) ||
        !(saved.flow === null || flowValid(saved.flow, projectId, saved.command))) throw Error("invalid");
      const old = this.area.getItem(this.key(projectId));
      if (old && JSON.stringify(this.parse(old, projectId)) === JSON.stringify(saved)) {
        this.warning = null;
        this.mustPauseBeforePost = false;
        return true;
      }
      const now = Date.now();
      const data: Envelope = { ...saved, version: 1, namespace: this.namespace, projectId, updatedAt: now, expiresAt: now + lifetime };
      const raw = JSON.stringify(data);
      if (raw.length > maximumBytes) throw Error("oversized");
      this.area.setItem(this.key(projectId), raw);
      this.warning = null;
      this.mustPauseBeforePost = false;
      return true;
    } catch {
      // Preserve every valid older checkpoint. A new pending POST may proceed
      // only after its exact key/body is present in that durable record.
      try {
        const raw = this.area.getItem(this.key(projectId));
        const previous = raw ? this.parse(raw, projectId) : null;
        const oldSteps = new Map(previous?.flow?.steps.map(step => [step.name, step]));
        this.mustPauseBeforePost = !!previous && !!saved?.flow && saved.flow.steps.some(step => {
          if (step.done) return false;
          const old = oldSteps.get(step.name);
          return !old || JSON.stringify(old.command) !== JSON.stringify(step.command);
        });
      } catch { this.mustPauseBeforePost = true; }
      this.warning = "Local scene recovery could not be saved. Keep this tab open and check the request before retrying.";
      return false;
    }
  }
  updateFlow(projectId: string, command: PendingCommand, flow: PersistedSceneFlow): boolean {
    const prior = this.read(projectId);
    if (!prior || prior.command.key !== command.key || prior.command.path !== command.path) return false;
    return this.write(projectId, { command: prior.command, flow });
  }
  /** Re-read and import the latest complete checkpoint inside the project lock. */
  currentMatches(projectId: string, command: PendingCommand): boolean {
    if (!this.namespace || !this.area) return true;
    try {
      const raw = this.area.getItem(this.key(projectId));
      if (!raw) {
        const remembered = this.memory.get(projectId);
        return !remembered || JSON.stringify(remembered.command) === JSON.stringify(command);
      }
      const latest = this.parse(raw, projectId);
      if (JSON.stringify(latest.command) !== JSON.stringify(command)) return false;
      this.memory.set(projectId, latest);
      this.hydrated.add(projectId);
      return true;
    } catch { return false; }
  }
}

const caches = new WeakMap<object, SceneContinuationCache>();
export function sceneContinuationFor(api: object & { cacheNamespace?: string | undefined }): SceneContinuationCache {
  let cache = caches.get(api);
  if (!cache) { cache = new SceneContinuationCache(api.cacheNamespace); caches.set(api, cache); }
  return cache;
}
