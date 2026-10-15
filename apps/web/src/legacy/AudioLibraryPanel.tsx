import { useTranslation } from "./Locale";
import { mediaUiCopy } from "./media-ui-copy";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { StudioApi } from "./api";
import { ApiError } from "./api";
import { errorText, HelpTip, Icon, IconButton } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { useProjectRefreshVersion } from "./project-updates";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import "./audio-library.css";

export interface AudioLibraryEntry {
  id: string;
  label: string;
  sha256: string;
  durationSeconds: number;
  samples: number;
  byteLength: number;
  origin: "uploaded" | "generated";
}
interface Library {
  recordings: AudioLibraryEntry[];
  coverage: { offset: number; total: number; nextOffset: number | null };
  capabilities: { import: boolean; maxBytes: number; maxSeconds: number };
}
type Props = {
  api: StudioApi;
  projectId: string;
  onChanged(): void;
  active?: boolean;
  readOnly?: boolean;
  onReference?(recording: AudioLibraryEntry): void;
};
function AudioListen({
  api,
  projectId,
  recording,
}: {
  api: StudioApi;
  projectId: string;
  recording: AudioLibraryEntry;
}) {
  const { t, ui } = useTranslation();

  const identity = JSON.stringify([projectId, recording.id, recording.sha256]);
  const [result, setResult] = useState<{
    api: StudioApi;
    identity: string;
    signal: AbortSignal;
    url: string;
    error: string;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let owned = "";
    void api
      .narrationAudio(projectId, recording.id, recording.sha256, abort.signal)
      .then((url) => {
        if (abort.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        owned = url;
        setResult({ api, identity, signal: abort.signal, url, error: "" });
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setResult({
            api,
            identity,
            signal: abort.signal,
            url: "",
            error: errorText(cause),
          });
      });
    return () => {
      abort.abort();
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [api, identity]);
  const visible =
    result?.api === api &&
    result.identity === identity &&
    !result.signal.aborted
      ? result
      : null;
  return (
    <div className="library-audio-player">
      {visible?.url ? (
        <audio
          controls
          preload="metadata"
          src={visible.url}
          aria-label={t("Listen to {v0}", "试听 {v0}", { v0: recording.label })}
        />
      ) : (
        <p role={visible?.error ? "alert" : "status"}>
          {ui(visible?.error ?? "", mediaUiCopy) ||
            ui("Loading verified audio…", mediaUiCopy)}
        </p>
      )}
    </div>
  );
}

/** Owned audio import/listen only. Selecting a recording here never places it on a shot or soundtrack. */
export function AudioLibraryPanel(props: Props) {
  return <AudioLibraryWorkspace key={props.projectId} {...props} />;
}
function AudioLibraryWorkspace({
  api,
  projectId,
  onChanged,
  active = true,
  readOnly = false,
  onReference,
}: Props) {
  const { t, ui } = useTranslation();

  const projectUpdate = useProjectRefreshVersion(),
    recovery = useRecoveryReadOnly(),
    base = `/api/projects/${encodeURIComponent(projectId)}/audio-library`;
  const registry = pendingCommandsFor(api, "audio-library");
  const slot = useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(projectId, listener),
      [registry, projectId],
    ),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const [library, setLibrary] = useState<Library | null>(null),
    [selected, setSelected] = useState<AudioLibraryEntry | null>(null),
    [file, setFile] = useState<File | null>(null);
  const [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [fileVersion, setFileVersion] = useState(0),
    [loadError, setLoadError] = useState("");
  const observed = useRef({ registry, version: slot.settledVersion }),
    changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    void api
      .request<Library>(`${base}?offset=${offset}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) {
          setLibrary(value);
          setLoadError("");
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setLoadError(errorText(cause));
      });
    return () => abort.abort();
  }, [api, base, offset, refresh, projectUpdate, active]);
  useEffect(() => {
    if (observed.current.registry !== registry)
      observed.current = { registry, version: 0 };
    if (slot.settledVersion <= observed.current.version) return;
    observed.current.version = slot.settledVersion;
    if (slot.lastSuccess) {
      setSelected((slot.result as { recording: AudioLibraryEntry }).recording);
      setFile(null);
      setFileVersion((value) => value + 1);
      setOffset(0);
    }
    setRefresh((value) => value + 1);
    changed.current();
  }, [registry, slot.settledVersion, slot.lastSuccess]);
  const blocked = recovery || slot.running || !!slot.command;
  function execute(command: PendingCommand) {
    if (recovery) return;
    void registry.run(
      projectId,
      command,
      (saved) => api.upload(saved.path, saved.file!, saved.key),
      (cause) =>
        !(cause instanceof ApiError) ||
        [
          "NETWORK_ERROR",
          "INTERNAL_ERROR",
          "REQUEST_FAILED",
          "MEDIA_BUSY",
        ].includes(cause.code),
    );
  }
  const maxBytes = library?.capabilities.maxBytes ?? 128 * 1024 * 1024,
    invalidFile = !!file && (!file.size || file.size > maxBytes);
  return (
    <section
      className="audio-library-panel"
      aria-labelledby="owned-audio-title"
    >
      <div className="section-heading">
        <h3 id="owned-audio-title">
          {ui("Recordings", mediaUiCopy)}{" "}
          <HelpTip label={ui("Audio library", mediaUiCopy)}>
            {ui(
              "Upload music or a recording, then listen. Importing adds an owned asset only. Choose background music in Timeline, or attach narration from a shot. Audio is normalized locally; no provider request or voice enrollment occurs.",
              mediaUiCopy,
            )}
          </HelpTip>
        </h3>
        <IconButton
          icon="refresh"
          label={ui("Refresh recordings", mediaUiCopy)}
          onClick={() => setRefresh((value) => value + 1)}
        />
      </div>
      {!readOnly && (
        <form
          className="audio-library-upload"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              blocked ||
              !file ||
              invalidFile ||
              !library?.capabilities.import
            )
              return;
            const name =
              file.name
                .replace(/[\u0000-\u001f\u007f/\\]/g, "")
                .slice(0, 120)
                .trim() || "Uploaded recording";
            execute({
              path: `${base}/uploads?${new URLSearchParams({ name })}`,
              file,
              key: crypto.randomUUID(),
              metadata: {
                label: "Recording imported. Select its use separately.",
              },
            });
          }}
        >
          <label className="sr-only" htmlFor="library-audio-file">
            {ui("Import a recording or music", mediaUiCopy)}
          </label>
          <input
            key={fileVersion}
            id="library-audio-file"
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm"
            disabled={blocked || !library?.capabilities.import}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            className="icon-button"
            type="submit"
            aria-label={ui("Import selected audio", mediaUiCopy)}
            title={ui("Import selected audio", mediaUiCopy)}
            disabled={
              blocked || !file || invalidFile || !library?.capabilities.import
            }
          >
            <Icon name="plus" />
          </button>
        </form>
      )}
      {library && !library.capabilities.import && (
        <p role="status">
          {ui("Local FFmpeg and ffprobe are needed. Run", mediaUiCopy)}{" "}
          <code>./start.sh --doctor</code>
          {ui("for setup instructions.", mediaUiCopy)}
        </p>
      )}
      {invalidFile && (
        <p role="alert">
          {ui("Choose nonempty audio up to", mediaUiCopy)}
          {Math.floor(maxBytes / 1048576)}
          {ui("MiB.", mediaUiCopy)}
        </p>
      )}
      {!!(loadError || slot.error) && (
        <p role="alert">
          {ui(loadError, mediaUiCopy) || ui(errorText(slot.error), mediaUiCopy)}
        </p>
      )}
      {!readOnly && slot.command && (
        <div className="audio-library-pending">
          <span>
            {slot.running
              ? ui("Importing and verifying audio…", mediaUiCopy)
              : ui("The import was not confirmed.", mediaUiCopy)}
          </span>
          {!slot.running && (
            <IconButton
              icon="refresh"
              label={ui("Retry the same audio import", mediaUiCopy)}
              disabled={recovery}
              onClick={() => execute(slot.command!)}
            />
          )}
        </div>
      )}
      {!library && !loadError && (
        <p role="status">{ui("Loading recordings…", mediaUiCopy)}</p>
      )}
      {!!library?.recordings.length && (
        <ul className="audio-library-list">
          {library.recordings.map((recording) => (
            <li key={recording.id}>
              <button
                className={`audio-library-row ${selected?.id === recording.id ? "selected" : ""}`}
                aria-pressed={selected?.id === recording.id}
                onClick={() => setSelected(recording)}
              >
                <Icon name="play" size={17} />
                <strong>{recording.label}</strong>
                <span>
                  {recording.durationSeconds.toFixed(1)}
                  {t("s", "秒")}
                </span>
                <small>
                  {recording.origin === "generated"
                    ? ui("Generated", mediaUiCopy)
                    : ui("Uploaded", mediaUiCopy)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {library?.recordings.length === 0 && (
        <p className="field-help">{ui("No recordings yet.", mediaUiCopy)}</p>
      )}
      {selected && onReference && (
        <button className="text-button" onClick={() => onReference(selected)}>
          <Icon name="at" size={16} />
          {t("Add to conversation", "引用到对话")}
        </button>
      )}
      {selected && active && (
        <>
          <div className="audio-library-selected">
            <strong>{selected.label}</strong>
            <IconButton
              label={ui("Close audio preview", mediaUiCopy)}
              onClick={() => setSelected(null)}
            />
          </div>
          <AudioListen
            key={selected.id}
            api={api}
            projectId={projectId}
            recording={selected}
          />
        </>
      )}
      {library && (offset > 0 || library.coverage.nextOffset !== null) && (
        <nav
          className="audio-library-pages"
          aria-label={ui("Recording pages", mediaUiCopy)}
        >
          <button
            className="text-button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 40))}
          >
            {ui("Previous", mediaUiCopy)}
          </button>
          <span>
            {library.coverage.total} {ui("recordings", mediaUiCopy)}
          </span>
          <button
            className="text-button"
            disabled={library.coverage.nextOffset === null}
            onClick={() => setOffset(library.coverage.nextOffset!)}
          >
            {ui("Next", mediaUiCopy)}
          </button>
        </nav>
      )}
    </section>
  );
}
