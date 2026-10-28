import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "../../api/client.ts";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import {
  afterFailure,
  capabilitiesFrom,
  checkFile,
  DEFAULT_CAPABILITIES,
  fileKindMsg,
  IMPORT_ACCEPT,
  formatBytes,
  importedArtifactId,
  importedAsFilmMusic,
  importIdentity,
  refusalMsg,
  retryable,
  sendingView,
  uploadPath,
  type AudioUse,
  type FileCheck,
  type ImportCapabilities,
  type ImportKind,
} from "../../model/assets-import.ts";
import { projectUploadPath, refreshUploadRequest } from "../../model/import-flight.ts";
import { msg, type Msg } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { importKeysFor } from "./import-keys.ts";
import { Sheet } from "./Sheet.tsx";
import { fixtureUploader, inspectFile, liveUploader, type Inspection } from "./upload.ts";

export interface ImportResult {
  kind: ImportKind;
  use: AudioUse;
  name: string;
  artifactId: string | null;
  /** Imported music became the film's soundtrack. */
  filmMusic?: boolean;
  /** The sheet was closed while the studio checked the file: the import finished in the background. */
  background: boolean;
}

type Phase =
  | { state: "ready" }
  | { state: "sending"; loaded: number; total: number }
  | { state: "checking" }
  /** `retry`: the same file can work on another try. Otherwise Import stays off until another file is chosen. */
  | { state: "refused"; refusal: Msg; retry: boolean }
  | { state: "stopped" };

/** What the browser read from the chosen file before anything is sent (a PNG's size, a clip's length). */
type Reading = { state: "none" } | { state: "reading" } | ({ state: "done" } & Inspection);

const ACCEPT = IMPORT_ACCEPT;

const aborted = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof DOMException && error.name === "AbortError");

/**
 * Import an image (PNG), a video or audio (as Music or Other audio) through the studio's upload routes,
 * with the bytes sent as a real fraction, then an indeterminate check while the studio stores the file.
 * Refusals are said in place, neutral, with an icon and words. Importing is free and puts nothing on a shot.
 *
 * A lost reply is resent exactly as first sent (same key, same film version), found again by the file's
 * identity, so the studio replays its receipt instead of importing twice. While the studio checks the file,
 * the sheet can be closed: the import finishes in the background and says so in a toast.
 */
export function ImportSheet({ onClose, onImported }: { onClose(): void; onImported(result: ImportResult): void }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const mode = useMode();
  const connected = useStudio((s) => s.connection === "connected");
  // A restored studio in recovery review is read-only (app/useWriteGuard.ts): Import is off with that one reason.
  const locked = useRecoveryLock();
  const uploader = useMemo(() => (mode === "fixture" ? fixtureUploader(store) : liveUploader(store)), [mode, store]);
  const input = useRef<HTMLInputElement>(null);
  /** The import being sent: `sentAll` turns true the moment the last byte has gone out. */
  const flight = useRef<{ controller: AbortController; sentAll: boolean } | null>(null);
  const [capabilities, setCapabilities] = useState<ImportCapabilities>(DEFAULT_CAPABILITIES);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [reading, setReading] = useState<Reading>({ state: "none" });
  const [use, setUse] = useState<AudioUse>("music");
  const [phase, setPhase] = useState<Phase>({ state: "ready" });
  const mounted = useRef(true);
  /** Stop a transfer that is still going out. Once the last byte has gone, the import is the studio's to finish. */
  function stopSending() {
    const current = flight.current;
    if (current && !current.sentAll) current.controller.abort();
  }
  const readToken = useRef(0);

  // What this studio can import (FFmpeg present, byte limits). A failed read keeps the defaults; the route still decides.
  useEffect(() => {
    const controller = new AbortController();
    const read = (path: string) => store.read<{ capabilities?: { import?: boolean; maxBytes?: number } }>(path, controller.signal).catch(() => null);
    void Promise.all([read("/images"), read("/audio-library?role=music")]).then(([images, audio]) => {
      if (!controller.signal.aborted) setCapabilities(capabilitiesFrom(images, audio));
    });
    return () => controller.abort();
  }, [store]);

  // A file chosen before the capabilities arrived is checked again against them.
  useEffect(() => { if (file) setCheck(checkFile(file, capabilities)); }, [capabilities, file]);
  // Closing while the bytes are still being sent stops the transfer (the studio never had the whole file).
  // Once everything is sent, the studio's check goes on in the background.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopSending();
    };
  }, []);

  const busy = phase.state === "sending" || phase.state === "checking";
  const kind = check?.ok ? check.kind : null;
  const inspected = kind && reading.state === "done" ? reading.check : null;
  const final = phase.state === "refused" && !phase.retry;
  const refusal = check && !check.ok ? check.refusal
    : inspected && !inspected.ok ? inspected.refusal
    : phase.state === "refused" ? phase.refusal : null;
  /** The chosen file can't be imported as it is: shown with the neutral border, and Import is off. */
  const refusedFile = !kind || (inspected !== null && !inspected.ok) || final;

  const choose = (next: File | null) => {
    const nextCheck = next ? checkFile(next, capabilities) : null;
    setFile(next);
    setCheck(nextCheck);
    setPhase({ state: "ready" });
    if (next && /^audio\//.test(next.type)) setUse("music");
    const token = ++readToken.current;
    if (!next || !nextCheck?.ok) { setReading({ state: "none" }); return; }
    setReading({ state: "reading" });
    void inspectFile(next, nextCheck.kind).then((result) => {
      if (mounted.current && readToken.current === token) setReading({ state: "done", ...result });
    });
  };

  const close = () => {
    // Everything is sent and the studio is checking: closing keeps the import going. Closing while the bytes
    // are still going out stops the transfer (see the unmount above), and says so.
    const current = flight.current;
    if (current?.sentAll && file) store.dispatch({ type: "toast", message: msg("assets.import.background_toast", { name: file.name }), tone: "info" });
    else if (current) store.dispatch({ type: "toast", message: msg("assets.import.stopped"), tone: "info" });
    onClose();
  };

  const canGo = !!file && !refusedFile && !busy && connected && !locked && reading.state !== "reading";

  const go = async () => {
    if (!file || !kind || !canGo) return;
    const keys = importKeysFor(store, mode);
    if (!keys) return;
    const origin = store.getState();
    if (!origin.projectId || origin.snapshot?.project.id !== origin.projectId) return;
    const projectId = origin.projectId;
    const active = () => store.getState().projectId === projectId && store.getState().projectEpoch === origin.projectEpoch;
    const chosen = file, fileKind = kind, chosenUse = use;
    const seconds = reading.state === "done" ? reading.seconds : null;
    const identity = importIdentity(chosen, fileKind, chosenUse);
    const initialPath = projectUploadPath(projectId, uploadPath(fileKind, origin.snapshot.project.headVersion, chosenUse, chosen.name));
    const controller = new AbortController();
    const current = { controller, sentAll: false };
    flight.current = current;
    const set = (next: Phase) => { if (active() && mounted.current && !controller.signal.aborted) setPhase(next); };
    let request = keys.begin(identity, initialPath);
    set({ state: "sending", loaded: 0, total: chosen.size });
    try {
      for (;;) {
        try {
          const receipt = await uploader.send({ path: request.path, file: chosen, kind: fileKind, key: request.key, durationSeconds: seconds, signal: controller.signal }, {
            sending: (loaded, total) => set({ state: "sending", loaded, total }),
            // Every byte reached the studio: from now on only the studio knows whether the import is made.
            checking: () => { current.sentAll = true; set({ state: "checking" }); },
          });
          keys.settle(identity);
          if (active()) onImported({ kind: fileKind, use: chosenUse, name: chosen.name, artifactId: importedArtifactId(fileKind, receipt), filmMusic: importedAsFilmMusic(fileKind, receipt), background: !mounted.current });
          return;
        } catch (error) {
          if (aborted(error, controller.signal)) {
            // Stopped while sending (never after the last byte): the studio never had the whole file, so the next
            // try is a new import.
            keys.settle(identity);
            if (active() && mounted.current) setPhase({ state: "stopped" });
            return;
          }
          const code = error instanceof ApiError ? error.code : "NETWORK_ERROR";
          const next = afterFailure(code, request.resent);
          if (next === "fresh") {
            // The resent request was out of date, so the first try never arrived: send it again as a new import.
            keys.settle(identity);
            const refreshed = await refreshUploadRequest(store.read.bind(store), projectId, fileKind, chosenUse, chosen.name);
            if (!refreshed.ok) {
              set({ state: "refused", refusal: refreshed.refusal, retry: refreshed.retry });
              if (active() && !mounted.current) store.dispatch({ type: "toast", message: msg("assets.import.refused_later", { name: chosen.name, reason: tm(refreshed.refusal) }), tone: "error" });
              return;
            }
            request = keys.begin(identity, refreshed.path);
            current.sentAll = false;
            continue;
          }
          if (next === "settle") keys.settle(identity);
          // A newer film version is needed before the next try.
          if (code === "REVISION_CONFLICT") void store.refresh();
          const said = refusalMsg(code, fileKind);
          if (active() && mounted.current) setPhase({ state: "refused", refusal: said, retry: retryable(code) });
          // Closed while the studio checked it: say how it ended. An unknown answer is not called a refusal.
          else if (active() && next === "keep") store.dispatch({ type: "toast", message: msg("assets.import.unknown_later", { name: chosen.name }), tone: "error" });
          else if (active()) store.dispatch({ type: "toast", message: msg("assets.import.refused_later", { name: chosen.name, reason: tm(said) }), tone: "error" });
          return;
        }
      }
    } finally {
      if (flight.current === current) flight.current = null;
    }
  };

  const onUseKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: AudioUse = use === "music" ? "upload" : "music";
    setUse(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-use="${next}"]`)?.focus();
  };

  const sending = phase.state === "sending" ? sendingView(phase.loaded, phase.total) : null;
  const tryAgain = phase.state === "refused" && phase.retry;

  return (
    <Sheet labelledBy="av-import-title" onClose={close} act="import-sheet" className="av-import">
      <div className="sheet-head">
        <h2 id="av-import-title">{t("assets.import.title")}</h2>
        <button type="button" className="pill sm" data-act="import-close" onClick={close}>{t("assets.close")}</button>
      </div>
      <div className="sheet-body">
        <p className="hint av-lead">{t("assets.import.lead")}</p>
        <div className="field">
          <span className="label" id="av-file-label">{t("assets.import.file")}</span>
          <input ref={input} type="file" hidden accept={ACCEPT} data-act="import-file" aria-labelledby="av-file-label" onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} />
          {file && (
            <div className="file-opt" data-kind={kind && !refusedFile ? kind : "refused"}>
              <span className="name">{file.name}</span>
              <span>{kind ? tm(fileKindMsg(kind, file.size)) : formatBytes(file.size)}</span>
            </div>
          )}
          <div className="av-choose">
            <button type="button" className="pill" data-act="choose-file" disabled={busy} onClick={() => input.current?.click()}>{t(file ? "assets.import.choose_other" : "assets.import.choose")}</button>
          </div>
          <span className="hint">{t("assets.import.accepts", { image: formatBytes(capabilities.limits.image), video: formatBytes(capabilities.limits.video), audio: formatBytes(capabilities.limits.audio) })}</span>
          {reading.state === "reading" && <span className="hint" role="status">{t("assets.import.inspecting")}</span>}
        </div>
        {refusal && (
          <div className="av-refusal" role="alert" data-state="refused">
            <span className="ic" aria-hidden="true">!</span>
            <span>{tm(refusal)}</span>
          </div>
        )}
        {kind === "audio" && (
          <div className="field">
            <span className="label" id="av-use-label">{t("assets.import.use_as")}</span>
            <span className="segctl" role="radiogroup" aria-labelledby="av-use-label" onKeyDown={onUseKey}>
              {(["music", "upload"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={use === value} tabIndex={use === value ? 0 : -1} data-act="import-use" data-use={value} disabled={busy} onClick={() => setUse(value)}>
                  {t(value === "music" ? "assets.import.use.music" : "assets.import.use.upload")}
                </button>
              ))}
            </span>
            <span className="hint">{t("assets.import.use_hint")}</span>
          </div>
        )}
        {sending && (
          <div className="av-progress" data-state="sending">
            <span className="hint">{tm(sending.label)}</span>
            <div className="progress" role="progressbar" aria-label={tm(sending.label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sending.fraction * 100)}><i style={{ width: `${sending.fraction * 100}%` }} /></div>
          </div>
        )}
        {phase.state === "checking" && (
          <div className="av-progress" data-state="checking">
            <span className="hint">{t("assets.import.checking")}</span>
            <div className="progress indet" role="progressbar" aria-label={t("assets.import.checking")}><i /></div>
            <span className="hint">{t("assets.import.checking_note")} {t("assets.import.background_note")}</span>
          </div>
        )}
        {phase.state === "stopped" && <p className="hint av-stopped" role="status">{t("assets.import.stopped")}</p>}
        {!connected ? <p className="hint" role="status">{t("assets.import.offline")}</p> : locked && <p className="hint" role="status" data-note="recovery">{locked}</p>}
      </div>
      <div className="sheet-foot">
        <span className="grow">{t("assets.import.free")}</span>
        {phase.state === "sending"
          ? <button type="button" className="pill" data-act="import-stop" onClick={stopSending}>{t("assets.import.stop")}</button>
          : phase.state === "checking"
            ? <button type="button" className="pill" data-act="import-background" onClick={close}>{t("assets.import.background")}</button>
            : <button type="button" className="pill" data-act="import-cancel" onClick={close}>{t("assets.import.cancel")}</button>}
        <button type="button" className="pill primary" data-act="import-go" disabled={!canGo} title={!connected ? t("assets.import.offline") : locked ?? undefined} onClick={() => void go()}>
          {t(tryAgain ? "assets.import.retry" : "assets.import.go")}
        </button>
      </div>
    </Sheet>
  );
}
