import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "../../api/client.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import {
  capabilitiesFrom,
  checkFile,
  DEFAULT_CAPABILITIES,
  fileKindMsg,
  formatBytes,
  importedArtifactId,
  refusalMsg,
  resendsSameKey,
  sendingView,
  uploadPath,
  type AudioUse,
  type FileCheck,
  type ImportCapabilities,
  type ImportKind,
} from "../../model/assets-import.ts";
import type { Msg } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { Sheet } from "./Sheet.tsx";
import { fixtureUploader, liveUploader } from "./upload.ts";

export interface ImportResult {
  kind: ImportKind;
  use: AudioUse;
  name: string;
  artifactId: string | null;
}

type Phase =
  | { state: "ready" }
  | { state: "sending"; loaded: number; total: number }
  | { state: "checking" }
  | { state: "refused"; refusal: Msg }
  | { state: "stopped" };

const ACCEPT = "image/png,video/*,audio/*,.png,.mp4,.mov,.m4v,.webm,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus";

/**
 * Import an image (PNG), a video or audio (as Music or Other audio) through the studio's upload routes,
 * with the bytes sent as a real fraction, then an indeterminate check while the studio stores the file.
 * Refusals are said in place, neutral, with an icon and words. Importing is free and puts nothing on a shot.
 */
export function ImportSheet({ onClose, onImported }: { onClose(): void; onImported(result: ImportResult): void }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const mode = useMode();
  const connected = useStudio((s) => s.connection === "connected");
  const uploader = useMemo(() => (mode === "fixture" ? fixtureUploader(store) : liveUploader(store)), [mode, store]);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [capabilities, setCapabilities] = useState<ImportCapabilities>(DEFAULT_CAPABILITIES);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [use, setUse] = useState<AudioUse>("music");
  const [phase, setPhase] = useState<Phase>({ state: "ready" });
  /** After a lost reply, the next press resends the same request with the same key. */
  const [resend, setResend] = useState<{ key: string; path: string } | null>(null);

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
  // Leaving mid-send stops the transfer.
  useEffect(() => () => abort.current?.abort(), []);

  const busy = phase.state === "sending" || phase.state === "checking";
  const kind = check?.ok ? check.kind : null;
  const refusal = check && !check.ok ? check.refusal : phase.state === "refused" ? phase.refusal : null;

  const choose = (next: File | null) => {
    setFile(next);
    setCheck(next ? checkFile(next, capabilities) : null);
    setResend(null);
    setPhase({ state: "ready" });
    if (next && /^audio\//.test(next.type)) setUse("music");
  };

  const go = async () => {
    if (!file || !check?.ok || busy || !connected) return;
    const fileKind = check.kind;
    const headVersion = store.getState().snapshot?.project.headVersion ?? 0;
    const path = uploadPath(fileKind, headVersion, use, file.name);
    const key = resend && resend.path === path ? resend.key : crypto.randomUUID();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ state: "sending", loaded: 0, total: file.size });
    try {
      const receipt = await uploader.send({ path, file, kind: fileKind, key, signal: controller.signal }, {
        sending: (loaded, total) => { if (!controller.signal.aborted) setPhase({ state: "sending", loaded, total }); },
        checking: () => { if (!controller.signal.aborted) setPhase({ state: "checking" }); },
      });
      setResend(null);
      onImported({ kind: fileKind, use, name: file.name, artifactId: importedArtifactId(fileKind, receipt) });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setResend(null);
        setPhase({ state: "stopped" });
        return;
      }
      const code = error instanceof ApiError ? error.code : "NETWORK_ERROR";
      setResend(resendsSameKey(code) ? { key, path } : null);
      // A newer film version is needed before the next try.
      if (code === "REVISION_CONFLICT") void store.refresh();
      setPhase({ state: "refused", refusal: refusalMsg(code) });
    } finally {
      if (abort.current === controller) abort.current = null;
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
  const tryAgain = phase.state === "refused";
  const canGo = !!file && !!check?.ok && !busy && connected;

  return (
    <Sheet labelledBy="av-import-title" onClose={onClose} holdOpen={phase.state === "checking"} act="import-sheet" className="av-import">
      <div className="sheet-head">
        <h2 id="av-import-title">{t("assets.import.title")}</h2>
        <button type="button" className="pill sm" data-act="import-close" disabled={phase.state === "checking"} onClick={onClose}>{t("assets.close")}</button>
      </div>
      <div className="sheet-body">
        <p className="hint av-lead">{t("assets.import.lead")}</p>
        <div className="field">
          <span className="label" id="av-file-label">{t("assets.import.file")}</span>
          <input ref={input} type="file" hidden accept={ACCEPT} data-act="import-file" aria-labelledby="av-file-label" onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} />
          {file && (
            <div className="file-opt" data-kind={kind ?? "refused"}>
              <span className="name">{file.name}</span>
              <span>{kind ? tm(fileKindMsg(kind, file.size)) : formatBytes(file.size)}</span>
            </div>
          )}
          <div className="av-choose">
            <button type="button" className="pill" data-act="choose-file" disabled={busy} onClick={() => input.current?.click()}>{t(file ? "assets.import.choose_other" : "assets.import.choose")}</button>
          </div>
          <span className="hint">{t("assets.import.accepts", { image: formatBytes(capabilities.limits.image), video: formatBytes(capabilities.limits.video), audio: formatBytes(capabilities.limits.audio) })}</span>
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
            <span className="hint">{t("assets.import.checking_note")}</span>
          </div>
        )}
        {phase.state === "stopped" && <p className="hint av-stopped" role="status">{t("assets.import.stopped")}</p>}
        {!connected && <p className="hint" role="status">{t("assets.import.offline")}</p>}
      </div>
      <div className="sheet-foot">
        <span className="grow">{t("assets.import.free")}</span>
        {phase.state === "sending"
          ? <button type="button" className="pill" data-act="import-stop" onClick={() => abort.current?.abort()}>{t("assets.import.stop")}</button>
          : <button type="button" className="pill" data-act="import-cancel" disabled={phase.state === "checking"} onClick={onClose}>{t("assets.import.cancel")}</button>}
        <button type="button" className="pill primary" data-act="import-go" disabled={!canGo} title={!connected ? t("assets.import.offline") : undefined} onClick={() => void go()}>
          {t(tryAgain ? "assets.import.retry" : "assets.import.go")}
        </button>
      </div>
    </Sheet>
  );
}
