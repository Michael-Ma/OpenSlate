import { useCallback, useEffect, useMemo, useRef } from "react";
import { ApiError } from "../api/client.ts";
import { afterFailure, checkFile, importedRef, importIdentity, refusalMsg, uploadPath, type ImportKind } from "../model/assets-import.ts";
import { roomFor, type ComposerFile } from "../model/composer-files.ts";
import { projectUploadPath, refreshUploadRequest } from "../model/import-flight.ts";
import { msg } from "../model/types.ts";
import { useMode, useStore } from "../store/react.tsx";
import { importKeysFor } from "../views/assets/import-keys.ts";
import { fixtureUploader, inspectFile, liveUploader } from "../views/assets/upload.ts";

const PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

function preview(file: File): Promise<string | undefined> {
  if (!PREVIEW_TYPES.has(file.type) || file.size > PREVIEW_MAX_BYTES) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

let serial = 0;
const newKey = () => `file-${Date.now().toString(36)}-${++serial}`;

/**
 * Files attached, dropped or pasted into the composer: each is checked, then saved to the film's Assets through the
 * Import routes (same resend-safe keys, so a lost reply never imports twice), and its chip follows the upload.
 * Removing a chip stops a transfer still going out; once the last byte is sent, the studio finishes saving it.
 */
export function useComposerUploads() {
  const store = useStore();
  const mode = useMode();
  const uploader = useMemo(() => (mode === "fixture" ? fixtureUploader(store) : liveUploader(store)), [mode, store]);
  const flights = useRef(new Map<string, { controller: AbortController; file: File }>());
  // Pictures, video and documents are saved against the film's version, and each save moves it on: they go one at a
  // time, so a second file never finds the version the first one just changed. Audio has no version and goes at once.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // Another film: its composer starts empty, and transfers for the old one stop.
  const projectId = store.getState().projectId;
  useEffect(() => () => { for (const { controller } of flights.current.values()) controller.abort(); flights.current.clear(); }, [projectId]);

  /** One file's transfer, from its check to the saved file (or why not). */
  const transfer = useCallback(async (key: string, file: File, kind: ImportKind, project: string, controller: AbortController) => {
    const current = () => store.getState().composer.files.find((f) => f.key === key);
    const same = () => store.getState().projectId === project && !controller.signal.aborted && !!current();
    const update = (patch: Partial<ComposerFile>) => { const now = current(); if (same() && now) store.dispatch({ type: "composerFile", file: { ...now, ...patch } }); };
    if (!same()) return;
    const inspected = await inspectFile(file, kind);
    if (!inspected.check.ok) { update({ state: "failed", refusal: inspected.check.refusal }); return; }
    const keys = importKeysFor(store, mode);
    const head = store.getState().snapshot?.project.headVersion;
    if (!keys || head === undefined) { update({ state: "failed", refusal: msg("director.file.failed") }); return; }
    const identity = importIdentity(file, kind, "upload");
    let request = keys.begin(identity, projectUploadPath(project, uploadPath(kind, head, "upload", file.name)));
    // A version conflict on a first try (another edit moved the film on) is retried once against the new version.
    let conflictRetried = false;
    for (;;) {
      try {
        const receipt = await uploader.send({ path: request.path, file, kind, key: request.key, durationSeconds: inspected.seconds, signal: controller.signal }, {
          sending: (loaded) => update({ loaded }),
          checking: () => update({ loaded: file.size }),
        });
        keys.settle(identity);
        const refused = (receipt as { refused?: { code?: unknown } } | null)?.refused?.code;
        const ref = importedRef(kind, receipt);
        if (typeof refused === "string" || !ref) { update({ state: "failed", refusal: refusalMsg(typeof refused === "string" ? refused : "IMPORT_FAILED", kind) }); return; }
        update({ state: "ready", ref, loaded: file.size });
        return;
      } catch (error) {
        // Removed while sending: the studio never had the whole file.
        if (controller.signal.aborted) { keys.settle(identity); return; }
        const code = error instanceof ApiError ? error.code : "NETWORK_ERROR";
        const next = afterFailure(code, request.resent);
        if (next === "fresh" || (code === "REVISION_CONFLICT" && !request.resent && !conflictRetried)) {
          conflictRetried = conflictRetried || code === "REVISION_CONFLICT";
          keys.settle(identity);
          const refreshed = await refreshUploadRequest(store.read.bind(store), project, kind, "upload", file.name);
          if (!refreshed.ok) { update({ state: "failed", refusal: refreshed.refusal }); return; }
          request = keys.begin(identity, refreshed.path);
          continue;
        }
        if (next === "settle") keys.settle(identity);
        if (code === "REVISION_CONFLICT") void store.refresh();
        update({ state: "failed", refusal: refusalMsg(code, kind) });
        return;
      }
    }
  }, [mode, store, uploader]);

  const run = useCallback((key: string, file: File, kind: ImportKind) => {
    const origin = store.getState();
    if (!origin.projectId || origin.snapshot?.project.id !== origin.projectId) return;
    const project = origin.projectId;
    const controller = new AbortController();
    flights.current.set(key, { controller, file });
    store.dispatch({ type: "composerFile", file: { key, name: file.name, kind, size: file.size, state: "uploading", loaded: 0 } });
    void preview(file).then((url) => {
      const now = store.getState().composer.files.find((f) => f.key === key);
      if (url && now) store.dispatch({ type: "composerFile", file: { ...now, preview: url } });
    });
    const go = () => transfer(key, file, kind, project, controller).finally(() => {
      if (flights.current.get(key)?.controller === controller) flights.current.delete(key);
    });
    // Versioned saves wait for the ones before them; this chip shows 0% meanwhile.
    if (kind === "audio") { void go(); return; }
    const job = queue.current.then(go, go);
    queue.current = job.catch(() => undefined);
  }, [store, transfer]);

  /** Attach these files; those past the message's limit are left out, and a toast says so. */
  const attach = useCallback((files: readonly File[]) => {
    const state = store.getState();
    const pictures = state.composer.images.length;
    const room = roomFor(state.composer.files, pictures);
    if (files.length > room) store.dispatch({ type: "toast", message: msg("director.file.full", { max: 8 }), tone: "info" });
    for (const file of files.slice(0, room)) {
      const key = newKey();
      const check = checkFile(file);
      // Refused before anything is sent (a format the studio can't take, empty, too large): the chip says why.
      if (!check.ok) {
        store.dispatch({ type: "composerFile", file: { key, name: file.name, kind: "document", size: file.size, state: "failed", loaded: 0, refusal: check.refusal } });
        continue;
      }
      run(key, file, check.kind);
    }
  }, [run, store]);

  /** Take a chip off; a transfer still going out stops. A saved file stays in Assets. */
  const remove = useCallback((key: string) => {
    flights.current.get(key)?.controller.abort();
    flights.current.delete(key);
    const file = store.getState().composer.files.find((f) => f.key === key);
    if (file) store.dispatch({ type: "composerFile", file, remove: true });
  }, [store]);

  return { attach, remove };
}
