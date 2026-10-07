import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { StudioApi } from "./api";
import { ApiError } from "./api";
import { errorText, Icon } from "./components";
import type { DirectorStatus, ProjectSnapshot } from "./model";
import { durationLabel } from "./model";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import { useProjectRefreshVersion } from "./project-updates";
import { UiButton } from "./ui";
import {
  conversationSceneState,
  makeConversationSceneCommand,
  sceneGenerationLabels,
  sceneShotMediaStatus,
} from "./conversation-actions-model";
import type {
  ConversationSceneView,
  ExposedSceneFrames,
} from "./conversation-actions-model";
import "./conversation-actions.css";

export { exposedSceneFrameKey } from "./conversation-actions-model";
export type { ExposedSceneFrames } from "./conversation-actions-model";

export interface ConversationActionsProps {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  director: DirectorStatus;
  disabled: boolean;
  exposedFrames: ExposedSceneFrames;
  reviewedFrames?: ExposedSceneFrames;
  initialOpenSceneId?: string;
  /** Optional read-only navigation filter. The decision remains for the complete named scene. */
  sceneIds?: readonly string[];
  onChanged(): void;
  onFocusScene(sceneId: string): void;
  onNarrationShot(shotId: string): void;
}

const uncertain = (cause: unknown) =>
  !(cause instanceof ApiError) ||
  ["NETWORK_ERROR", "REQUEST_FAILED", "INTERNAL_ERROR"].includes(cause.code);
type SceneActionMeta = {
  sceneId: string;
  kind: "image" | "video";
  revisionId: string;
};

/** Contextual decisions belong in the same scroll surface as the conversation; result media stays on the right. */
export function ConversationActions(props: ConversationActionsProps) {
  const { api, snapshot, sceneIds, onChanged } = props,
    projectId = snapshot.project.id;
  const registry = pendingCommandsFor(api, "conversation-scenes");
  const slot = useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(projectId, listener),
      [registry, projectId],
    ),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const observed = useRef({ api, projectId, version: slot.settledVersion }),
    [refresh, setRefresh] = useState(0),
    [openScene, setOpenScene] = useState<string | null>(
      props.initialOpenSceneId ?? null,
    );
  useEffect(() => {
    if (props.initialOpenSceneId) setOpenScene(props.initialOpenSceneId);
  }, [props.initialOpenSceneId]);
  const pendingMeta = slot.command?.metadata as SceneActionMeta | undefined;
  const scenes = snapshot.project.scenes.filter(
    (scene) =>
      !sceneIds ||
      sceneIds.includes(scene.id) ||
      pendingMeta?.sceneId === scene.id,
  );
  useEffect(() => {
    if (
      observed.current.api !== api ||
      observed.current.projectId !== projectId
    ) {
      observed.current = { api, projectId, version: slot.settledVersion };
      return;
    }
    if (slot.settledVersion <= observed.current.version) return;
    observed.current.version = slot.settledVersion;
    setRefresh((value) => value + 1);
    onChanged();
  }, [api, projectId, slot.settledVersion, onChanged]);
  const run = (command: PendingCommand) =>
    void registry.run(
      projectId,
      command,
      (saved) =>
        api.request(saved.path, {
          method: "POST",
          body: saved.body,
          key: saved.key,
          timeoutMs: 180000,
        }),
      uncertain,
    );
  const orphanedDecision =
    !!slot.command &&
    !snapshot.project.scenes.some((scene) => scene.id === pendingMeta?.sceneId);
  if (!scenes.length && !orphanedDecision) return null;
  return (
    <div className="conversation-actions" aria-label="Scene decisions">
      {orphanedDecision && (
        <section
          className="conversation-scene-action conversation-scene-body"
          aria-label="Earlier scene decision"
        >
          <p className="conversation-scene-note" role="status">
            An earlier scene decision was not confirmed. Its exact saved request
            is kept.
          </p>
          <UiButton
            variant="secondary"
            disabled={
              props.disabled ||
              slot.running ||
              !!snapshot.control?.paused ||
              props.director.status === "running"
            }
            onClick={() => run(slot.command!)}
          >
            {slot.running
              ? "Checking saved decision…"
              : "Check saved scene decision"}
          </UiButton>
          {!!slot.error && (
            <p className="inline-error" role="alert">
              {errorText(slot.error)}
            </p>
          )}
        </section>
      )}
      {scenes.map((scene) => (
        <ConversationSceneAction
          key={`${projectId}:${scene.id}`}
          {...props}
          sceneId={scene.id}
          refresh={refresh}
          open={openScene === scene.id}
          onOpen={() =>
            setOpenScene((current) => (current === scene.id ? null : scene.id))
          }
          slot={slot}
          run={run}
        />
      ))}
    </div>
  );
}

function ConversationSceneAction({
  api,
  snapshot,
  director,
  disabled,
  exposedFrames: seenFrames,
  reviewedFrames,
  sceneId,
  onChanged: _onChanged,
  onFocusScene,
  onNarrationShot,
  refresh,
  open,
  onOpen,
  slot,
  run,
}: ConversationActionsProps & {
  sceneId: string;
  refresh: number;
  open: boolean;
  onOpen(): void;
  slot: PendingCommandSnapshot;
  run(command: PendingCommand): void;
}) {
  const exposedFrames =
    reviewedFrames === undefined
      ? seenFrames
      : Object.fromEntries(
          Object.entries(seenFrames).filter(([key]) => reviewedFrames[key]),
        );
  const revision = useProjectRefreshVersion(),
    base = `/api/projects/${encodeURIComponent(snapshot.project.id)}/scenes/${encodeURIComponent(sceneId)}`;
  const [view, setView] = useState<ConversationSceneView | null>(null),
    [error, setError] = useState(""),
    [localRefresh, setLocalRefresh] = useState(0);
  const labels = sceneGenerationLabels(snapshot, sceneId),
    scene = snapshot.project.scenes.find((item) => item.id === sceneId);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .request<ConversationSceneView>(`${base}/generation`, {
        signal: controller.signal,
      })
      .then((next) => {
        if (!controller.signal.aborted) {
          setView(next);
          setError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
          setView(null);
        }
      });
    return () => controller.abort();
  }, [
    api,
    base,
    snapshot.project.headVersion,
    snapshot.project.revisionId,
    revision,
    refresh,
    localRefresh,
  ]);
  const savedMeta = slot.command?.metadata as SceneActionMeta | undefined,
    settledMeta = slot.settledCommand?.metadata as SceneActionMeta | undefined;
  const ownPending = savedMeta?.sceneId === sceneId,
    ownCompletion = settledMeta?.sceneId === sceneId;
  const confirmedHead = (
    slot.settledCommand?.body as { headVersion?: number } | undefined
  )?.headVersion;
  const waitingForSavedDecision =
    ownCompletion && slot.lastSuccess && view?.headVersion === confirmedHead;
  const state = view
    ? conversationSceneState(
        view,
        snapshot,
        director,
        exposedFrames,
        disabled || slot.running || !!slot.command || waitingForSavedDecision,
      )
    : null;
  const summary = !state
    ? error
      ? "Needs attention"
      : "Checking saved work…"
    : waitingForSavedDecision
      ? `${settledMeta.kind === "image" ? "Keyframes" : "Video"} requested`
      : state.unknown
        ? "Job outcome unconfirmed"
        : state.existingWork
          ? "Generation in progress"
          : state.stage === "complete"
            ? state.narrationShotIds.length
              ? "Narration to review"
              : "Media saved"
            : state.stage === "image"
              ? `${state.targets.length} keyframe${state.targets.length === 1 ? "" : "s"} to create`
              : state.stage === "video"
                ? `${state.targets.length} video${state.targets.length === 1 ? "" : "s"} to create`
                : "No shots yet";
  // Terminal scenes remain a concise saved result. They cannot leave stale action buttons in the conversation.
  if (
    state?.fresh &&
    state.stage === "complete" &&
    !state.existingWork &&
    !state.narrationShotIds.length &&
    !ownPending &&
    !(ownCompletion && !slot.lastSuccess)
  )
    return (
      <p className="conversation-scene-saved">
        <Icon name="check" size={14} /> {labels.scene} · media saved
      </p>
    );
  return (
    <section
      className="conversation-scene-action"
      aria-label={`${labels.scene} generation`}
    >
      <UiButton
        variant="ghost"
        className="conversation-scene-summary"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls={`scene-action-${sceneId}`}
      >
        <span>
          <strong>{labels.scene}</strong>
          <span>{summary}</span>
        </span>
        <span className={`conversation-scene-chevron${open ? " open" : ""}`}>
          <Icon name="chevron" size={16} />
        </span>
      </UiButton>
      {open && (
        <div id={`scene-action-${sceneId}`} className="conversation-scene-body">
          <div className="conversation-scene-direction">
            <p>{scene?.purpose}</p>
            <UiButton
              size="1"
              variant="ghost"
              onClick={() => onFocusScene(sceneId)}
            >
              See scene
            </UiButton>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {!view && (
            <UiButton
              size="1"
              variant="secondary"
              disabled={disabled || slot.running}
              onClick={() => setLocalRefresh((value) => value + 1)}
            >
              Refresh scene
            </UiButton>
          )}
          {view && state && (
            <>
              <ol className="conversation-scene-recipes">
                {state.targets.map((row) => {
                  const shot = snapshot.project.shots.find(
                    (item) => item.id === row.shotId,
                  );
                  return (
                    <li key={row.shotId}>
                      <div className="conversation-scene-shot-heading">
                        <strong>{labels.shots[row.shotId] ?? "Shot"}</strong>
                        <span>{sceneShotMediaStatus(row)}</span>
                      </div>
                      {row.purpose && (
                        <p className="conversation-scene-shot-purpose">
                          {row.purpose}
                        </p>
                      )}
                      <p className="conversation-scene-motion">
                        <span>
                          {state.stage === "video"
                            ? "Video motion"
                            : "Planned motion"}
                        </span>
                        {row.motionPrompt || "Motion is not saved yet."}
                      </p>
                      <p className="conversation-scene-recipe-meta">
                        {durationLabel(row.durationFrames)}
                        {row.durationFrames !== row.plannedFrames
                          ? ` generated · ${durationLabel(row.plannedFrames)} in the film`
                          : ""}{" "}
                        ·{" "}
                        {state.stage === "image"
                          ? view.imageProfileLabel
                          : row.videoProfileLabel}
                        {row.imageFixture ? " · Demo frame" : ""}
                      </p>
                      {state.stage === "image" && shot?.imagePrompt && (
                        <details className="conversation-scene-prompt">
                          <summary>Keyframe prompt</summary>
                          <p>{shot.imagePrompt}</p>
                        </details>
                      )}
                      {state.stage === "video" &&
                        Object.keys(row.videoSettings).length > 0 && (
                          <details className="conversation-scene-prompt">
                            <summary>Video settings</summary>
                            <dl>
                              {Object.entries(row.videoSettings).map(
                                ([name, value]) => (
                                  <div key={name}>
                                    <dt>{name}</dt>
                                    <dd>
                                      {typeof value === "object"
                                        ? JSON.stringify(value)
                                        : String(value)}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          </details>
                        )}
                    </li>
                  );
                })}
              </ol>
              {view.rows.length > state.targets.length &&
                state.targets.length > 0 && (
                  <p className="conversation-scene-note">
                    {view.rows.length - state.targets.length} completed shot
                    {view.rows.length - state.targets.length === 1
                      ? ""
                      : "s"}{" "}
                    kept.
                  </p>
                )}
              {state.reason && (
                <p className="conversation-scene-note" role="status">
                  {state.stage === "video" &&
                  !state.framesReady &&
                  !state.existingWork &&
                  !state.unknown &&
                  !view.busy &&
                  !waitingForSavedDecision
                    ? "先查看每个当前关键帧，并确认此画面，再检查视频方案。"
                    : state.reason}
                </p>
              )}
              {state.narrationShotIds.map((shotId) => (
                <UiButton
                  key={shotId}
                  size="1"
                  variant="secondary"
                  disabled={disabled || slot.running}
                  onClick={() => onNarrationShot(shotId)}
                >
                  Open narration · {labels.shots[shotId] ?? "Shot"}
                </UiButton>
              ))}
              {(state.stage === "image" || state.stage === "video") && (
                <UiButton
                  variant="success"
                  className="conversation-scene-generate"
                  disabled={!state.canGenerate}
                  onClick={() => {
                    try {
                      run(
                        makeConversationSceneCommand(
                          view,
                          snapshot,
                          director,
                          exposedFrames,
                          crypto.randomUUID(),
                          disabled ||
                            slot.running ||
                            !!slot.command ||
                            waitingForSavedDecision,
                        ),
                      );
                    } catch (cause) {
                      setError(errorText(cause));
                    }
                  }}
                >
                  <Icon name="check" size={16} />
                  {slot.running && ownPending
                    ? "Saving scene decision…"
                    : state.stage === "image"
                      ? `Generate keyframes · ${labels.scene}`
                      : `Generate video · ${labels.scene}`}
                </UiButton>
              )}
            </>
          )}
          {ownPending && !slot.running && (
            <div className="conversation-scene-retry">
              <p role="status">
                The response was not confirmed. Check the saved decision with
                the same request.
              </p>
              <UiButton
                variant="secondary"
                disabled={
                  disabled ||
                  !!snapshot.control?.paused ||
                  director.status === "running"
                }
                onClick={() => run(slot.command!)}
              >
                Check saved scene decision
              </UiButton>
            </div>
          )}
          {ownCompletion && !!slot.error && (
            <p className="inline-error" role="alert">
              {errorText(slot.error)}
            </p>
          )}
          {ownCompletion && slot.lastSuccess && (
            <p className="conversation-scene-note" role="status">
              {settledMeta.kind === "image" ? "Keyframes" : "Video"} requested
              for {labels.scene}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
