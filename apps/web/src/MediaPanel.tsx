import { useProjectRefreshVersion } from "./project-updates";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { StudioApi } from "./api";
import { ApiError } from "./api";
import { errorText } from "./components";
import { durationLabel } from "./model";
import type { Artifact, ProjectSnapshot } from "./model";
import { activeProjectEdit, pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import "./media.css";

interface Job {
  id: string;
  state: string;
  artifact: Artifact | null;
  errorCode: string | null;
  totalFrames: number;
  canRun: boolean;
  canRecover: boolean;
}
interface MediaState {
  jobs: Job[];
  preview: { artifact: Artifact; renderJobId: string } | null;
  sources: {
    artifactId: string;
    sha256: string;
    kind: "video" | "audio";
    frames: number;
    byteLength: number;
  }[];
}

type MediaPanelProps = {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  onChanged(): void;
  mode?: "upload" | "render";
  active?: boolean;
  onContinue?: ((requestId: string) => void) | undefined;
};
export function MediaPanel(props: MediaPanelProps) {
  return <MediaWorkspace key={props.snapshot.project.id} {...props} />;
}
function MediaWorkspace({
  api,
  snapshot,
  onChanged,
  onContinue,
  mode = "render",
  active = true,
}: MediaPanelProps) {
  const projectUpdate = useProjectRefreshVersion();
  const recoveryReadOnly = useRecoveryReadOnly();
  const projectId = snapshot.project.id,
    base = `/api/projects/${encodeURIComponent(projectId)}/media`;
  const [state, setState] = useState<MediaState | null>(null),
    [loadError, setLoadError] = useState("");
  const registry = pendingCommandsFor(api);
  const slot = useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(projectId, listener),
      [registry, projectId],
    ),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const busy = slot.running,
    pending = slot.command,
    error = slot.error ? errorText(slot.error) : "";
  const [refresh, setRefresh] = useState(0),
    [file, setFile] = useState<File | null>(null);
  const [reuse, setReuse] = useState(true),
    [fileVersion, setFileVersion] = useState(0);
  const currentImportRequest = activeProjectEdit(snapshot.messages, projectId);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const observed = useRef({ registry, version: 0 });
  useEffect(() => {
    if (observed.current.registry !== registry)
      observed.current = { registry, version: 0 };
    if (slot.settledVersion <= observed.current.version) return;
    observed.current.version = slot.settledVersion;
    if (slot.lastSuccess && slot.lastWasUpload) {
      setFile(null);
      setFileVersion((value) => value + 1);
    }
    setRefresh((value) => value + 1);
    changed.current();
  }, [registry, slot.settledVersion, slot.lastSuccess, slot.lastWasUpload]);
  const renderNode = snapshot.plan?.nodes?.find(
    (node) => node.kind === "render",
  );
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const poll = async () => {
      try {
        const next = await api.request<MediaState>(base, {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setState(next);
          setLoadError("");
        }
      } catch (error) {
        if (!abort.signal.aborted) setLoadError(errorText(error));
      }
    };
    void poll();
    return () => {
      abort.abort();
    };
  }, [api, base, refresh, snapshot.project.headVersion, projectUpdate, active]);
  function execute(command: PendingCommand) {
    if (recoveryReadOnly) return;
    void registry.run(
      projectId,
      command,
      (saved) =>
        saved.file
          ? api.upload(saved.path, saved.file, saved.key)
          : api.request(saved.path, {
              method: "POST",
              body: saved.body ?? {},
              key: saved.key,
              timeoutMs: 90000,
            }),
      (error) =>
        !(error instanceof ApiError) ||
        ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        ),
    );
  }
  const run = (path: string, body: unknown = {}) =>
    void execute({ path, body, key: crypto.randomUUID() });
  const clips =
    state?.sources.filter((source) => source.kind === "video") ?? [];
  return (
    <section
      className="media-panel"
      aria-labelledby={
        mode === "upload" ? "uploaded-video-title" : "local-media-title"
      }
    >
      <div className="media-heading">
        <div>
          <h3
            id={
              mode === "upload" ? "uploaded-video-title" : "local-media-title"
            }
          >
            {mode === "upload" ? "Upload a video" : "Export"}
          </h3>
        </div>
        <span className="tag">Local rendering</span>
      </div>
      {mode === "upload" && (
        <p>
          Uploaded video audio is removed. Add narration from a shot in the
          storyboard.
        </p>
      )}
      {(error || loadError) && (
        <p role="alert" className="form-error">
          {error || loadError}
        </p>
      )}
      {pending && busy && (
        <p role="status">
          Your saved request is still running. Switching projects will not start
          it again.
        </p>
      )}
      {pending && !busy && (
        <div className="notice warning">
          <span>
            The result was not confirmed. Retry the saved request to check its
            outcome.
          </span>
          <button
            disabled={recoveryReadOnly}
            onClick={() => void execute(pending)}
          >
            Retry same action
          </button>
        </div>
      )}
      {mode === "upload" && (
        <form
          className="clip-upload"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            const query = new URLSearchParams({
              expectedHeadVersion: String(snapshot.project.headVersion),
              ...(reuse && currentImportRequest
                ? { requestId: currentImportRequest }
                : {}),
            });
            void execute({
              path: `${base}/uploads?${query}`,
              file,
              key: crypto.randomUUID(),
            });
          }}
        >
          <label htmlFor="supplied-video">Video file · up to 128 MiB</label>
          <input
            key={fileVersion}
            id="supplied-video"
            type="file"
            accept="video/*"
            disabled={recoveryReadOnly || busy || !!pending}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {currentImportRequest && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={reuse}
                disabled={recoveryReadOnly || busy || !!pending}
                onChange={(event) => setReuse(event.target.checked)}
              />
              Add this clip to the current edit
            </label>
          )}
          <button
            className="button small"
            disabled={recoveryReadOnly || busy || !!pending || !file}
          >
            {busy ? "Working…" : "Import clip"}
          </button>
        </form>
      )}
      {mode === "render" && (
        <>
          {!!clips.length && currentImportRequest && onContinue && (
            <button
              className="text-button"
              disabled={recoveryReadOnly || busy || !!pending}
              onClick={() => onContinue(currentImportRequest)}
            >
              Discuss these clips with OpenSlate
            </button>
          )}
          <div className="render-controls">
            <button
              className="button primary"
              disabled={
                recoveryReadOnly || busy || !!pending || !renderNode || !state
              }
              onClick={() =>
                renderNode &&
                run(`${base}/renders`, {
                  expectedHeadVersion: snapshot.project.headVersion,
                  renderNodeId: renderNode.id,
                })
              }
            >
              Render current plan
            </button>
            <p>
              {renderNode
                ? "Uses the current clips and accepted narration. Pending edits and pause still apply."
                : "A timeline plan is needed before rendering."}
            </p>
          </div>
          {!!state?.jobs.length && (
            <details>
              <summary>Render history · {state.jobs.length}</summary>
              <div className="render-jobs">
                {state.jobs.map((job) => (
                  <div key={job.id}>
                    <strong>
                      {job.state.replaceAll("_", " ")} ·{" "}
                      {durationLabel(job.totalFrames)}
                    </strong>
                    {job.errorCode && (
                      <p>{errorText(new ApiError(job.errorCode))}</p>
                    )}
                    <div className="render-actions">
                      {job.canRun && (
                        <button
                          disabled={recoveryReadOnly || busy || !!pending}
                          onClick={() => run(`${base}/renders/${job.id}/run`)}
                        >
                          Run prepared render
                        </button>
                      )}
                      {job.canRecover && (
                        <button
                          disabled={recoveryReadOnly || busy || !!pending}
                          onClick={() =>
                            run(`${base}/renders/${job.id}/recover`)
                          }
                        >
                          Check saved completion
                        </button>
                      )}
                      {["prepared", "running"].includes(job.state) && (
                        <button
                          disabled={recoveryReadOnly || busy || !!pending}
                          onClick={() =>
                            run(`${base}/renders/${job.id}/cancel`)
                          }
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
