import { createHash, randomUUID } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { SeedanceProvider, FalVideoProvider, seedanceBody, falVideoBody, seedancePriceMicros, assertExecutionRequest, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest, VideoSubmit, SeedancePoll } from "@openslate/providers";
import type { FalH3LipSyncSubmitResult, FalH3LipSyncPollResult } from "@openslate/providers";
import { resolveCodePlanProviderAdmission, assertCodePlanFirstDispatch, assertCodePlanProviderLease } from "../code-plan/provider-authority.js";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Store } from "../persistence/store.js";
import type { LocalImageStore } from "../media/local-images.js";
import type { ArtifactRecord, Attempt } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import type { OutputReceipt } from "./output-store.js";
import { ProtectedVideoDownloader } from "./video-download.js";

type Submit = VideoSubmit;
interface Identity { id: string; projectId: string; attemptId: string; requestDigest: string }
interface Mapping extends Identity { bodySha256: string; firstFrame: { sha256: string; width: number; height: number }; lastFrameSha256: string | null }
interface Dispatch extends Identity { mappingDigest: string; createdAt: number }
interface Submission extends Identity { dispatchDigest: string | null; observation: Submit }
interface Terminal extends Identity { dispatchDigest: string; taskId: string; result: { kind: "completed"; outputReceiptId: string; lastFrame: { locator: string; expiresAt: string } | null; completionTokens: number | null; actualCostMicros: string | null }
  | { kind: "failed"; code: string; message: string; retry: "none"; free: boolean } }
interface PollSchedule extends Identity { taskId: string; count: number; nextPollAt: number; claim: string | null }
const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const unknown = (taskId?: string): ExecutionOutcome => ({ type: "unknown", diagnostic: "Video outcome is unresolved. Reconcile retained evidence; do not resubmit.", ...(taskId ? { taskId } : {}) });
const check = (value: unknown): void => invariant(value, "VIDEO_I2V_RECEIPT_CONFLICT", "Video receipt differs from its exact owned submission");
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "VIDEO_I2V_CANCELLED", "Video operation was cancelled");
export interface VideoI2vExecutionOptions { store: Store; outputStore: ExecutionOutputStore; artifactRoot: string; credentials: EnvironmentMediaCredentials;
  downloader: ProtectedVideoDownloader; images: LocalImageStore; fetch?: typeof globalThis.fetch; timeoutMs?: number; now?: () => number; pollMs?: number }
/** Code-plan only. A durable marker and original lease fence every first POST. Recoveries can only read. */
export class VideoI2vExecution implements ExecutionProvider {
  private readonly root: string;
  private readonly now: () => number;
  private readonly recovery: InstallationRecoveryGuard;
  private readonly pollMs: number;
  private readonly timeout: number;
  constructor(readonly adapter: "seedance" | "fal-video-i2v", private readonly options: VideoI2vExecutionOptions) {
    check(options.outputStore.store === options.store && isAbsolute(options.artifactRoot) && options.artifactRoot !== "/");
    mkdirSync(options.artifactRoot, { recursive: true, mode: 0o700 }); this.root = realpathSync(options.artifactRoot);
    this.now = options.now ?? Date.now; this.pollMs = options.pollMs ?? 2000; this.timeout = options.timeoutMs ?? 30000;
    check(Number.isSafeInteger(this.pollMs) && this.pollMs >= 0 && this.pollMs <= 60000 && Number.isSafeInteger(this.timeout) && this.timeout > 0 && this.timeout <= 120000);
    this.recovery = new InstallationRecoveryGuard(options.store); registerExecutionProvider(this, { adapter, version: "1" });
  }
  private get store() { return this.options.store; }
  private identity(attempt: Attempt): Identity { return { id: attempt.id, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request) }; }
  private read<T extends Identity>(kind: string, attempt: Attempt): T | undefined {
    const row = this.store.get<T>(kind, attempt.id);
    if (row) { const identity = this.identity(attempt); check(Object.entries(identity).every(([key,value]) => (row as unknown as Record<string,unknown>)[key] === value)); }
    return row;
  }
  private admitted(input: Readonly<ExecutionRequest>): Attempt {
    this.recovery.assertWritable(); assertExecutionRequest(this,input);
    const admission = resolveCodePlanProviderAdmission(this.store, input);
    invariant(admission && input.kind === "video", "VIDEO_I2V_CODE_ONLY", "This video model requires a code-plan project");
    const mapping = this.read<Mapping>("video_i2v_mapping", admission.attempt), dispatch = this.read<Dispatch>("video_i2v_dispatch", admission.attempt);
    if (dispatch) check(mapping && dispatch.mappingDigest === digest(mapping));
    const submit = this.read<Submission>("video_i2v_submit", admission.attempt);
    if (submit) check(submit.dispatchDigest === (dispatch ? digest(dispatch) : null) && (dispatch || submit.observation.kind === "rejected"));
    return admission.attempt;
  }
  private transport(request: ExecutionRequest): SeedanceProvider | FalVideoProvider {
    const apiKey = this.options.credentials.resolve(this.adapter === "seedance" ? "modelark-video" : "fal-video");
    const options = { apiKey, timeoutMs: this.timeout, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) };
    return this.adapter === "seedance" ? new SeedanceProvider(options) : new FalVideoProvider({ ...options, model: request.profile!.configuration.model });
  }
  private started(attempt: Attempt): boolean { return !!(this.read("video_i2v_dispatch",attempt) || this.read("video_i2v_submit",attempt)); }
  private saveSubmit(attempt: Attempt, observation: Submit): void {
    const dispatch = this.read<Dispatch>("video_i2v_dispatch", attempt);
    this.store.insert("video_i2v_submit",attempt.id,attempt.projectId,{ ...this.identity(attempt), dispatchDigest: dispatch ? digest(dispatch) : null, observation });
  }
  private async refuse(attempt: Attempt, options: ExecutionCallOptions, code: string): Promise<ExecutionOutcome> {
    this.store.transaction(() => {
      if (!this.started(attempt)) { assertCodePlanProviderLease(this.store,attempt,options.expectedLease); this.saveSubmit(attempt,{kind:"rejected",code}); }
    }); return this.replay(this.admitted(attempt.request),options.signal);
  }
  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const request = structuredClone(input), attempt = this.admitted(request), signal = options.signal;
    if (this.started(attempt)) return this.replay(attempt,signal);
    assertCodePlanProviderLease(this.store,attempt,options.expectedLease);
    let body: string, mapping: Mapping, transport: SeedanceProvider | FalVideoProvider;
    try {
      stopped(signal); assertCodePlanFirstDispatch(this.store,attempt,options.expectedLease);
      check(request.inputs.length >= 1 && request.inputs.length <= 2 && request.inputs.every(row => row.kind === "image"
        && (row.sha256 === request.args.firstFrameSha256 || row.sha256 === request.args.lastFrameSha256)));
      const firstFrame = await this.frame(attempt,String(request.args.firstFrameSha256),signal);
      const lastFrame = request.args.lastFrameSha256 ? await this.frame(attempt,String(request.args.lastFrameSha256),signal) : undefined;
      const model = request.profile!.configuration.model, settings = request.args.settings as never;
      body = this.adapter === "seedance" ? seedanceBody({ model, prompt:String(request.args.prompt), seconds:Number(request.args.durationFrames)/30, settings, firstFrame,
        ...(lastFrame ? {lastFrame} : {}), ...(request.args.seed === undefined ? {} : {seed:Number(request.args.seed)}) })
        : falVideoBody({ model, prompt:String(request.args.prompt), seconds:Number(request.args.durationFrames)/30, settings,
          imageUrl:`data:image/png;base64,${firstFrame.bytes.toString("base64")}`, ...(lastFrame ? {lastFrameUrl:`data:image/png;base64,${lastFrame.bytes.toString("base64")}`} : {}),
          ...(request.args.seed === undefined ? {} : {seed:Number(request.args.seed)}) });
      mapping = { ...this.identity(attempt), bodySha256: hash(body), firstFrame: { sha256:String(request.args.firstFrameSha256), width:firstFrame.width,height:firstFrame.height }, lastFrameSha256: request.args.lastFrameSha256 as string ?? null };
      transport = this.transport(request); stopped(signal);
    } catch { return this.refuse(attempt,options,signal?.aborted ? "VIDEO_NOT_SUBMITTED" : "VIDEO_INPUT_OR_CREDENTIAL_INVALID"); }
    let claimed = false;
    try { claimed = this.store.transaction(() => {
      if (this.started(attempt)) return false;
      stopped(signal); assertCodePlanFirstDispatch(this.store,attempt,options.expectedLease);
      const saved = this.read<Mapping>("video_i2v_mapping",attempt);
      check(!saved || canonical(saved) === canonical(mapping));
      if (!saved) this.store.insert("video_i2v_mapping",attempt.id,attempt.projectId,mapping);
      this.store.insert("video_i2v_dispatch",attempt.id,attempt.projectId,{...this.identity(attempt),mappingDigest:digest(mapping),createdAt:this.now()}); return true;
    }); } catch { return this.refuse(attempt,options,"VIDEO_NOT_SUBMITTED"); }
    if (!claimed) return this.replay(this.admitted(request),signal);
    let observation: Submit = { kind:"unknown",code:"VIDEO_CREATE_UNKNOWN" };
    try {
      if (transport instanceof SeedanceProvider) observation = await transport.submit(body,signal);
      else {
        const result: FalH3LipSyncSubmitResult = await transport.submit(body,mapping.bodySha256,signal ? {signal} : {});
        observation = result.kind === "accepted" ? {kind:"accepted",taskId:result.taskId} : {kind:result.kind,code:result.error.code};
      }
      this.store.transaction(() => this.saveSubmit(attempt,observation));
    } catch { return observation.kind === "accepted" ? {type:"accepted",taskId:observation.taskId} : unknown(); }
    return this.replay(this.admitted(request),signal);
  }
  async lookup(attemptId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const saved = this.store.get<Attempt>("attempt",attemptId); check(saved && (!input || input.attemptId === attemptId));
    const attempt = this.admitted(input ?? saved!.request);
    // A new reconciliation lease seals a known pre-marker interruption, fencing any old preparer.
    if (!this.started(attempt) && !attempt.taskId && attempt.phase === "submission_unknown" && !options.signal?.aborted) {
      this.store.transaction(() => {
        assertCodePlanProviderLease(this.store,attempt,options.expectedLease,true);
        if (!this.started(attempt)) this.saveSubmit(attempt,{kind:"rejected",code:"VIDEO_NOT_SUBMITTED"});
      });
    }
    return this.replay(this.admitted(attempt.request),options.signal);
  }
  private submission(attempt: Attempt): Submission | undefined {
    let saved = this.read<Submission>("video_i2v_submit",attempt);
    if (!saved && attempt.taskId && this.read("video_i2v_dispatch",attempt)) {
      const evidence = this.store.list<{attemptId:string;outcome:ExecutionOutcome;outcomeDigest:string}>("execution_evidence",attempt.projectId);
      if (evidence.some(e => e.attemptId === attempt.id && e.outcomeDigest === digest(e.outcome) && e.outcome.type === "accepted" && e.outcome.taskId === attempt.taskId)) {
        this.saveSubmit(attempt,{kind:"accepted",taskId:attempt.taskId}); saved = this.read<Submission>("video_i2v_submit",attempt);
      }
    }
    return saved;
  }
  private terminal(attempt: Attempt): Terminal | undefined {
    const row = this.read<Terminal>("video_i2v_terminal",attempt);
    if (row) {
      const dispatch = this.read<Dispatch>("video_i2v_dispatch",attempt), submit = this.submission(attempt);
      check(dispatch && row.dispatchDigest === digest(dispatch) && submit?.observation.kind === "accepted" && row.taskId === submit.observation.taskId);
    }
    return row;
  }
  private async replay(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    const submit = this.submission(attempt);
    if (submit?.observation.kind === "rejected") return { type:"rejected",certainty:"not_accepted",failureId:submit.observation.code,technical:true,retryAllowed:false };
    const terminal = this.terminal(attempt);
    if (terminal?.result.kind === "failed") return { type:"failed",taskId:terminal.taskId,failureId:terminal.result.code,technical:false,retryAllowed:false };
    if (terminal?.result.kind === "completed") {
      try {
        await this.lastFrame(attempt,terminal,signal);
        let completion = await this.options.outputStore.recoverCompletion(attempt.projectId,attempt.id,signal ? {signal} : {});
        if (!completion) {
          const receipt = this.store.get<OutputReceipt>("execution_output_receipt",terminal.result.outputReceiptId)!;
          await this.options.outputStore.spool(attempt.projectId,receipt.id,this.options.downloader.source(receipt),signal ? {signal} : {});
          completion = await this.options.outputStore.recoverCompletion(attempt.projectId,attempt.id,signal ? {signal} : {});
        }
        check(completion); return completion!;
      } catch { return unknown(terminal.taskId); }
    }
    return submit?.observation.kind === "accepted" ? {type:"accepted",taskId:submit.observation.taskId} : unknown(attempt.taskId ?? undefined);
  }
  async poll(taskId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    check(input); const attempt = this.admitted(input!), local = await this.replay(attempt,options.signal);
    if (local.type !== "accepted") return local;
    check(taskId === local.taskId && (!attempt.taskId || attempt.taskId === taskId));
    const claim = this.store.transaction(() => {
      stopped(options.signal);
      const schedule = this.read<PollSchedule>("video_i2v_poll",attempt);
      if (schedule) check(schedule.taskId === taskId);
      if (schedule && schedule.nextPollAt > this.now()) return null;
      return this.store.put("video_i2v_poll",attempt.id,attempt.projectId,{...this.identity(attempt),taskId,count:(schedule?.count ?? 0)+1,nextPollAt:this.now()+this.timeout+600000,claim:randomUUID()}) as PollSchedule;
    });
    if (!claim) return local;
    try {
      const transport = this.transport(attempt.request);
      let result: SeedancePoll;
      if (transport instanceof SeedanceProvider) result = await transport.poll(taskId,options.signal);
      else {
        const fal: FalH3LipSyncPollResult = await transport.poll(taskId,options.signal ? {signal:options.signal} : {});
        result = fal.kind === "completed" ? {kind:"completed",taskId,videoUrl:fal.output.url,lastFrameUrl:null,completionTokens:null}
          : fal.kind === "failed" ? {kind:"failed",taskId,code:fal.error.category === "policy" ? "FAL_VIDEO_MODERATION_REJECTED" : "FAL_VIDEO_TASK_FAILED",message:"The video provider could not complete this clip.",retry:"none",free:true}
          : fal.kind === "pending" ? {kind:"pending",taskId} : {kind:"unknown",taskId,code:fal.error.code};
      }
      if (result.kind === "pending") return local;
      if (result.kind === "unknown") return unknown(taskId);
      this.store.transaction(() => {
        if (this.terminal(attempt)) return;
        const dispatch = this.read<Dispatch>("video_i2v_dispatch",attempt)!;
        let terminal: Terminal["result"];
        if (result.kind === "failed") terminal = {kind:"failed",code:result.code,message:result.message,retry:"none",free:this.adapter === "seedance"};
        else {
          const expiresAt = this.adapter === "seedance" ? new Date(this.now()+86400000).toISOString() : null;
          const output = this.options.outputStore.recordReceipt(attempt.projectId,{attemptId:attempt.id,expectedRequestDigest:digest(attempt.request),port:"video",kind:"video",mimeType:"video/mp4",vendorTaskId:taskId,diagnosticRequestId:null,
            source:{kind:"protected_locator",locator:result.videoUrl,expiresAt}});
          terminal = {kind:"completed",outputReceiptId:output.id,lastFrame:result.lastFrameUrl ? {locator:result.lastFrameUrl,expiresAt:expiresAt!} : null,completionTokens:result.completionTokens,
            actualCostMicros:result.completionTokens === null ? null : seedancePriceMicros(attempt.request.profile!.configuration.model,attempt.request.args.settings as never,{completionTokens:result.completionTokens})};
        }
        this.store.insert("video_i2v_terminal",attempt.id,attempt.projectId,{...this.identity(attempt),dispatchDigest:digest(dispatch),taskId,result:terminal});
      });
      return await this.replay(this.admitted(attempt.request),options.signal);
    } catch { return unknown(taskId); }
    finally {
      this.store.transaction(() => {
        const current = this.read<PollSchedule>("video_i2v_poll",attempt);
        if (current?.claim === claim.claim) this.store.put("video_i2v_poll",attempt.id,attempt.projectId,{...current,claim:null,nextPollAt:this.now()+Math.min(15000,this.pollMs*2**Math.min(current.count-1,3))});
      });
    }
  }
  private async frame(attempt: Attempt, sha256: string, signal?: AbortSignal): Promise<{bytes: Buffer; width: number; height: number}> {
    const reference = attempt.request.inputs.find(row => row.kind === "image" && row.sha256 === sha256);
    const record = reference ? this.store.get<ArtifactRecord>("artifact",reference.artifactId) : undefined;
    check(record && record.projectId === attempt.projectId && canonical(record.artifact) === canonical(reference) && record.fixture === false && record.mimeType === "image/png"
      && /^[a-f0-9]{64}$/.test(record.validationDigest ?? "") && Number.isSafeInteger(record.byteLength) && record.byteLength! >= 33 && record.byteLength! < 30_000_000 && isAbsolute(record.path));
    const path = await realpath(record!.path), child = relative(this.root,path);
    check(path === record!.path && child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
    stopped(signal); const file = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat(); check(stat.isFile() && stat.size === record!.byteLength);
      const bytes = Buffer.alloc(stat.size+1); let offset = 0;
      while (offset < bytes.length) { stopped(signal); const part = await file.read(bytes,offset,bytes.length-offset,null); if (!part.bytesRead) break; offset += part.bytesRead; }
      check(offset === stat.size && hash(bytes.subarray(0,offset)) === sha256);
      check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(16) === record!.width && bytes.readUInt32BE(20) === record!.height);
      return {bytes:bytes.subarray(0,offset),width:record!.width!,height:record!.height!};
    } finally { await file.close(); }
  }
  private async lastFrame(attempt: Attempt, terminal: Terminal, signal?: AbortSignal): Promise<void> {
    if (terminal.result.kind !== "completed" || !terminal.result.lastFrame) return;
    const id = digest({attemptId:attempt.id,port:"lastFrame"});
    if (this.store.get<ArtifactRecord>("artifact",id)) return;
    const source = this.options.downloader.imageSource(terminal.result.lastFrame), parts: Buffer[] = []; let size = 0;
    for await (const bytes of await source(signal ?? new AbortController().signal)) { size += bytes.length; check(size <= 32*1024*1024); parts.push(Buffer.from(bytes)); }
    const bytes = Buffer.concat(parts), image = await this.options.images.normalizeUpload({bytes,sha256:hash(bytes)},signal ? {signal} : {});
    const artifact: ArtifactRecord = {id,projectId:attempt.projectId,attemptId:attempt.id,artifact:{artifactId:id,kind:"image",sha256:image.sha256},path:image.path,mimeType:"image/png",fixture:false,physicalDurationSeconds:null,
      byteLength:image.byteLength,width:image.width,height:image.height,validationDigest:image.validationDigest};
    this.store.transaction(() => { if (!this.store.get("artifact",id)) this.store.insert("artifact",id,attempt.projectId,artifact); });
  }
}
/** Only durable, request-bound terminal provider evidence can release an accepted Seedance liability. */
export function videoI2vFailure(store: Pick<Store,"get">, attempt: Attempt): {code:string;message:string;retry:"none";free:boolean} | null {
  if (!["seedance","fal-video-i2v"].includes(attempt.request.execution.adapter)) return null;
  const row = store.get<Terminal>("video_i2v_terminal",attempt.id), dispatch = store.get<Dispatch>("video_i2v_dispatch",attempt.id), submit = store.get<Submission>("video_i2v_submit",attempt.id);
  if (!row || row.result.kind !== "failed") {
    if (submit?.observation.kind === "rejected" && submit.projectId === attempt.projectId && submit.requestDigest === digest(attempt.request)) {
      const code = submit.observation.code;
      if (code === "SEEDANCE_FACE_REJECTED") return {code,message:"Seedance 2.x cannot use this image of a realistic human face. Use a stylized frame or a different model.",retry:"none",free:true};
      if (code === "SEEDANCE_MODERATION_REJECTED") return {code,message:"Seedance refused this content. Change the frame or prompt before generating again.",retry:"none",free:true};
    }
    return null;
  }
  check(row.projectId === attempt.projectId && row.requestDigest === digest(attempt.request) && dispatch && row.dispatchDigest === digest(dispatch)
    && submit?.dispatchDigest === digest(dispatch) && submit.observation.kind === "accepted" && row.taskId === submit.observation.taskId && row.taskId === attempt.taskId);
  return {...row.result,free:attempt.request.execution.adapter === "seedance" && row.result.free};
}
