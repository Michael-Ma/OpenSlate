import { useTranslation } from "./Locale";
import { mediaUiCopy } from "./media-ui-copy";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import type { Artifact, ProjectSnapshot } from "./model";
import { activeProjectEdit, pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import "./media.css";

interface Reference {
  artifact: Artifact;
  width: number;
  height: number;
  byteLength: number;
}
interface Library {
  headVersion: number;
  images: Reference[];
  capabilities: {
    import: boolean;
    maxBytes: number;
    unavailableReason: string | null;
  };
  coverage: {
    offset: number;
    returned: number;
    total: number;
    nextOffset: number | null;
  };
}
type Props = {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  onChanged(): void;
  uploadOnly?: boolean;
  active?: boolean;
  onDiscuss?: ((artifact: Artifact) => void) | undefined;
  discussDisabled?: boolean;
  discussionUnavailable?: boolean;
};
function importError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UPLOAD_TOO_LARGE")
      return "Choose a nonempty PNG image up to 32 MiB.";
    if (error.code === "IMAGE_INPUT_INVALID")
      return "Choose a PNG no larger than 4096 pixels on either side and 8.29 megapixels overall.";
    if (["IMAGE_VALIDATION_FAILED", "MEDIA_TOOL_FAILED"].includes(error.code))
      return "This file could not be decoded as a complete PNG. Choose another image.";
    if (
      [
        "IMAGE_DIGEST_MISMATCH",
        "IMAGE_INTEGRITY_ERROR",
        "UPLOAD_CORRUPT",
      ].includes(error.code)
    )
      return "The image changed during verification. Select the original file and try again.";
  }
  return errorText(error);
}

function ImagePreview({
  api,
  projectId,
  reference,
}: {
  api: StudioApi;
  projectId: string;
  reference: Reference;
}) {
  const { t, ui } = useTranslation();

  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let owned = "";
    setUrl("");
    setError("");
    setLoaded(false);
    void api
      .artifact(projectId, reference.artifact, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) {
          URL.revokeObjectURL(value);
          return;
        }
        owned = value;
        setUrl(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(errorText(error));
      });
    return () => {
      abort.abort();
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [
    api,
    projectId,
    reference.artifact.artifactId,
    reference.artifact.sha256,
  ]);
  return (
    <div className="owned-image-preview">
      {(!loaded || error) && (
        <p role={error ? "alert" : "status"}>
          {ui(error, mediaUiCopy) ||
            ui("Loading verified reference…", mediaUiCopy)}
        </p>
      )}
      {url && !error && (
        <img
          src={url}
          alt={ui("Selected supplied reference", mediaUiCopy)}
          onLoad={() => setLoaded(true)}
          onError={() => setError("This reference could not be displayed.")}
        />
      )}
    </div>
  );
}

export function ImagePanel(props: Props) {
  return <ImageWorkspace key={props.snapshot.project.id} {...props} />;
}
function ImageWorkspace({
  api,
  snapshot,
  onChanged,
  onDiscuss,
  discussDisabled,
  discussionUnavailable,
  uploadOnly = false,
  active = true,
}: Props) {
  const { t, ui } = useTranslation();

  const recoveryReadOnly = useRecoveryReadOnly();
  const projectId = snapshot.project.id,
    base = `/api/projects/${encodeURIComponent(projectId)}/images`,
    registry = pendingCommandsFor(api, "images");
  const slot = useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(projectId, listener),
      [registry, projectId],
    ),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const [library, setLibrary] = useState<Library | null>(null),
    [loadError, setLoadError] = useState(""),
    [fileError, setFileError] = useState("");
  const [selected, setSelected] = useState<Reference | null>(null),
    [file, setFile] = useState<File | null>(null),
    [fileVersion, setFileVersion] = useState(0);
  const [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [reuse, setReuse] = useState(true);
  const currentRequest = activeProjectEdit(snapshot.messages, projectId),
    blocked = recoveryReadOnly || slot.running || !!slot.command;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const observed = useRef({ registry, version: 0 });
  useEffect(() => {
    if (observed.current.registry !== registry)
      observed.current = { registry, version: 0 };
    if (slot.settledVersion <= observed.current.version) return;
    observed.current.version = slot.settledVersion;
    if (slot.lastSuccess) {
      setFile(null);
      setFileVersion((value) => value + 1);
      setOffset(0);
    }
    setRefresh((value) => value + 1);
    changed.current();
  }, [registry, slot.settledVersion, slot.lastSuccess]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    setLoading(true);
    setLoadError("");
    void api
      .request<Library>(`${base}?offset=${offset}`, { signal: abort.signal })
      .then((next) => {
        if (!abort.signal.aborted) {
          setLibrary(next);
          setSelected((current) => current ?? next.images[0] ?? null);
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setLoadError(errorText(error));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [api, base, offset, refresh, snapshot.project.headVersion, active]);
  function execute(command: PendingCommand) {
    if (recoveryReadOnly) return;
    void registry.run(
      projectId,
      command,
      (saved) => api.upload(saved.path, saved.file!, saved.key),
      (error) =>
        !(error instanceof ApiError) ||
        ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        ),
    );
  }
  const error =
    fileError || (slot.error ? importError(slot.error) : "") || loadError;
  return (
    <section className="media-panel" aria-labelledby="reference-images-title">
      <div className="media-heading">
        <div>
          <h3 id="reference-images-title">
            {ui("Upload an image", mediaUiCopy)}
          </h3>
        </div>
        <span className="tag">{ui("Your images", mediaUiCopy)}</span>
      </div>

      {error && (
        <p role="alert" className="form-error">
          {ui(error, mediaUiCopy)}
        </p>
      )}
      {library && !library.capabilities.import && (
        <p role="status">
          {ui(library.capabilities.unavailableReason ?? "", mediaUiCopy)}
        </p>
      )}
      {slot.command && slot.running && (
        <p role="status">
          {ui(
            "Your saved import is running. Switching projects will not start it again.",
            mediaUiCopy,
          )}
        </p>
      )}
      {slot.command && !slot.running && (
        <div className="notice warning">
          <span>
            {ui(
              "The import result was not confirmed. Check the same saved request.",
              mediaUiCopy,
            )}
          </span>
          <button
            disabled={recoveryReadOnly}
            onClick={() => execute(slot.command!)}
          >
            {ui("Retry same import", mediaUiCopy)}
          </button>
        </div>
      )}
      <form
        className="clip-upload"
        onSubmit={(event) => {
          event.preventDefault();
          if (!file || fileError || !library?.capabilities.import || blocked)
            return;
          const query = new URLSearchParams({
            expectedHeadVersion: String(snapshot.project.headVersion),
            ...(reuse && currentRequest ? { requestId: currentRequest } : {}),
          });
          execute({
            path: `${base}/uploads?${query}`,
            file,
            key: crypto.randomUUID(),
          });
        }}
      >
        <label htmlFor="supplied-image">
          {ui("PNG image · up to 32 MiB", mediaUiCopy)}
        </label>
        <input
          key={fileVersion}
          id="supplied-image"
          type="file"
          accept="image/png,.png"
          disabled={blocked || !library?.capabilities.import}
          onChange={(event) => {
            const selectedFile = event.target.files?.[0] ?? null;
            setFile(selectedFile);
            setFileError(
              selectedFile &&
                (!selectedFile.size || selectedFile.size > 32 * 1024 * 1024)
                ? "Choose a nonempty PNG image up to 32 MiB."
                : "",
            );
          }}
        />
        {currentRequest && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={reuse}
              disabled={blocked}
              onChange={(event) => setReuse(event.target.checked)}
            />
            {ui("Add this reference to the current edit", mediaUiCopy)}
          </label>
        )}
        <button
          className="button small"
          disabled={
            blocked || !file || !!fileError || !library?.capabilities.import
          }
        >
          {slot.running
            ? ui("Importing…", mediaUiCopy)
            : ui("Import reference", mediaUiCopy)}
        </button>
      </form>
      {!uploadOnly && (
        <>
          {loading && (
            <p role="status">{ui("Loading reference library…", mediaUiCopy)}</p>
          )}
          {!loading && library && !library.coverage.total && (
            <p>{ui("No reference images yet.", mediaUiCopy)}</p>
          )}
          {!!library?.images.length && (
            <div className="supplied-clips">
              {library.images.map((reference, index) => (
                <button
                  className="supplied-clip"
                  key={reference.artifact.artifactId}
                  aria-pressed={
                    selected?.artifact.artifactId ===
                    reference.artifact.artifactId
                  }
                  onClick={() => setSelected(reference)}
                >
                  <strong>
                    {ui("Reference", mediaUiCopy)}{" "}
                    {library.coverage.offset + index + 1}
                  </strong>
                  <span>
                    {reference.width} × {reference.height} ·{" "}
                    {(reference.byteLength / 1048576).toFixed(2)} MiB
                  </span>
                  <small>{ui("Preview", mediaUiCopy)}</small>
                </button>
              ))}
            </div>
          )}
          {library && library.coverage.total > 40 && (
            <div className="render-actions">
              <button
                disabled={loading || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 40))}
              >
                {ui("Previous references", mediaUiCopy)}
              </button>
              <span>
                {library.coverage.offset + 1}–
                {library.coverage.offset + library.coverage.returned}{" "}
                {ui("of", mediaUiCopy)} {library.coverage.total}
              </span>
              <button
                disabled={loading || library.coverage.nextOffset === null}
                onClick={() => setOffset(library.coverage.nextOffset!)}
              >
                {ui("More references", mediaUiCopy)}
              </button>
            </div>
          )}
          {selected && active && (
            <>
              <ImagePreview
                key={selected.artifact.artifactId}
                api={api}
                projectId={projectId}
                reference={selected}
              />
              {onDiscuss && (
                <>
                  <button
                    className="text-button"
                    disabled={
                      blocked || discussDisabled || discussionUnavailable
                    }
                    onClick={() => onDiscuss(selected.artifact)}
                  >
                    {ui("Attach and discuss", mediaUiCopy)}
                  </button>
                  <p>
                    {discussionUnavailable
                      ? ui(
                          "Local FFmpeg is needed to prepare an image for Codex.",
                          mediaUiCopy,
                        )
                      : ui(
                          "Send a reduced image to Codex for this discussion. Your project stays unchanged; request edits in the conversation. Later messages do not automatically include the image.",
                          mediaUiCopy,
                        )}
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
