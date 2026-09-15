import type { StudioApi } from "./api";
import type { StreamEvent } from "./event-stream";
export interface ProjectUpdateState { revision: number; connection: "connecting" | "connected" | "reconnecting" | "fallback" }
type Listener = () => void;
interface Visibility { readonly hidden: boolean; addEventListener(name: string, listener: Listener): void; removeEventListener(name: string, listener: Listener): void }
export interface SubscriptionEnvironment {
  visibility?: Visibility; focus?: Pick<Visibility, "addEventListener" | "removeEventListener">;
  setTimer(callback: Listener, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void;
  now(): number;
}
const browserEnvironment = (): SubscriptionEnvironment => ({
  ...(typeof document === "undefined" ? {} : { visibility: document }), ...(typeof window === "undefined" ? {} : { focus: window }),
  setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: timer => clearTimeout(timer), now: () => Date.now(),
});
/** One project invalidation channel. Domain data stays in the existing authenticated GET projections. */
export class ProjectSubscription {
  #state: ProjectUpdateState = { revision: 0, connection: "connecting" };
  #listeners = new Set<Listener>(); #cursor: number | undefined; #controller: AbortController | undefined; #generation = 0;
  #coalesced: ReturnType<typeof setTimeout> | undefined; #retry: ReturnType<typeof setTimeout> | undefined; #fallback: ReturnType<typeof setTimeout> | undefined;
  #failures = 0; #openedAt = 0; readonly #environment: SubscriptionEnvironment;
  readonly api: Pick<StudioApi, "events" | "closed">; readonly projectId: string;
  constructor(api: Pick<StudioApi, "events" | "closed">, projectId: string, environment = browserEnvironment()) { this.api = api; this.projectId = projectId; this.#environment = environment; }
  readonly getSnapshot = (): ProjectUpdateState => this.#state;
  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#environment.visibility?.addEventListener("visibilitychange", this.#visibility);
      this.#environment.focus?.addEventListener("focus", this.#focus);
      if (!this.#hidden()) this.#connect();
    }
    return () => { this.#listeners.delete(listener); if (!this.#listeners.size) this.#stop(); };
  };
  readonly refresh = (): void => this.#invalidate();
  #hidden(): boolean { return this.#environment.visibility?.hidden === true; }
  #emit(): void { for (const listener of [...this.#listeners]) listener(); }
  #connection(connection: ProjectUpdateState["connection"]): void {
    if (this.#state.connection !== connection) { this.#state = { ...this.#state, connection }; this.#emit(); }
  }
  #invalidate(): void {
    if (!this.#listeners.size || this.#hidden() || this.#coalesced !== undefined) return;
    this.#coalesced = this.#environment.setTimer(() => {
      this.#coalesced = undefined; if (!this.#listeners.size || this.#hidden()) return;
      this.#state = { ...this.#state, revision: this.#state.revision + 1 }; this.#emit();
    }, 150);
  }
  #receive(event: StreamEvent): void {
    const value: unknown = JSON.parse(event.data);
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as { projectId?: unknown }).projectId !== this.projectId) throw new Error("EVENT_STREAM_PROJECT_MISMATCH");
    const resync = event.event === "project.resync", invalidation = event.event === "project.invalidate";
    if (resync || invalidation) {
      const data = value as { version?: unknown; cursor?: unknown };
      if (data.version !== 1 || !Number.isSafeInteger(data.cursor) || Number(data.cursor) < 0) throw new Error("EVENT_STREAM_CURSOR_INVALID");
    }
    if (event.id !== null) {
      if (!/^(0|[1-9][0-9]{0,15})$/.test(event.id) || !Number.isSafeInteger(Number(event.id))) throw new Error("EVENT_STREAM_CURSOR_INVALID");
      const cursor = Number(event.id), data = value as { sequence?: unknown; cursor?: unknown };
      if (resync ? data.cursor !== cursor : data.sequence !== cursor) throw new Error("EVENT_STREAM_CURSOR_INVALID");
      if (!resync && this.#cursor !== undefined && cursor <= this.#cursor) return;
      this.#cursor = cursor;
    } else if (!invalidation) throw new Error("EVENT_STREAM_CURSOR_MISSING");
    this.#invalidate();
  }
  #connect(): void {
    if (!this.projectId || this.api.closed || !this.#listeners.size || this.#hidden() || this.#controller) return;
    this.#environment.clearTimer(this.#retry); this.#retry = undefined;
    const controller = new AbortController(), generation = ++this.#generation; this.#controller = controller;
    const current = () => generation === this.#generation && !controller.signal.aborted && this.#listeners.size > 0;
    void this.api.events(this.projectId, { signal: controller.signal, ...(this.#cursor === undefined ? {} : { after: this.#cursor }),
      onOpen: () => {
        if (!current()) return; this.#openedAt = this.#environment.now(); this.#connection("connected");
        this.#environment.clearTimer(this.#fallback); this.#fallback = undefined;
        // A connection/resumption never assumes that its event cursor covers every projection mutation.
        this.#invalidate();
      }, onEvent: event => { if (current()) this.#receive(event); },
    }).then(() => { if (current()) this.#unavailable(generation); }, error => {
      if (!current()) return;
      if ((error as { code?: unknown })?.code === "VALIDATION_ERROR") { this.#cursor = undefined; this.#invalidate(); }
      this.#unavailable(generation);
    });
  }
  #unavailable(generation: number): void {
    if (generation !== this.#generation || this.api.closed || !this.#listeners.size || this.#hidden()) return;
    this.#controller = undefined; this.#connection("fallback");
    if (this.#failures === 0) this.#invalidate();
    if (this.#openedAt > 0 && this.#environment.now() - this.#openedAt >= 30000) this.#failures = 0;
    this.#openedAt = 0; this.#failures++;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.#failures - 1, 5));
    this.#retry = this.#environment.setTimer(() => { this.#retry = undefined; this.#connect(); }, delay);
    if (this.#fallback === undefined) this.#fallback = this.#environment.setTimer(() => this.#fallbackRefresh(), 30000);
  }
  #fallbackRefresh(): void {
    this.#fallback = undefined;
    if (!this.#listeners.size || this.#hidden() || this.api.closed || this.#state.connection === "connected") return;
    this.#invalidate(); this.#fallback = this.#environment.setTimer(() => this.#fallbackRefresh(), 30000);
  }
  #disconnect(): void {
    this.#generation++; this.#controller?.abort(); this.#controller = undefined;
    for (const timer of [this.#retry, this.#fallback, this.#coalesced]) this.#environment.clearTimer(timer);
    this.#retry = this.#fallback = this.#coalesced = undefined;
  }
  readonly #visibility = (): void => {
    if (this.#hidden()) { this.#disconnect(); this.#connection("reconnecting"); }
    else { this.#invalidate(); this.#connect(); }
  };
  readonly #focus = (): void => { if (!this.#hidden()) { this.#invalidate(); if (!this.#controller) this.#connect(); } };
  #stop(): void {
    this.#disconnect(); this.#environment.visibility?.removeEventListener("visibilitychange", this.#visibility); this.#environment.focus?.removeEventListener("focus", this.#focus);
  }
}
const subscriptions = new WeakMap<StudioApi, Map<string, ProjectSubscription>>();
export function projectSubscription(api: StudioApi, projectId: string): ProjectSubscription {
  let entries = subscriptions.get(api); if (!entries) { entries = new Map(); subscriptions.set(api, entries); }
  let subscription = entries.get(projectId); if (!subscription) { subscription = new ProjectSubscription(api, projectId); entries.set(projectId, subscription); }
  return subscription;
}
