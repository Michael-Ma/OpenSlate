import { ChatMarkdown } from "./ChatMarkdown";
import { useWorkspaceSplit } from "./WorkspaceSplit";
import { useKeyframeReview } from "./useKeyframeReview";
import { WorkspaceRail, WorkspaceViewTabs } from "./WorkspaceNavigation";
import type { WorkspaceView } from "./WorkspaceNavigation";
import { visibleProjectConnection } from "./project-view-model";
import "./chat-markdown.css";
import "./workspace-layout.css";
import { SegmentedControl, Select, TextArea } from "@radix-ui/themes";
import { UiButton, UiTextField } from "./ui";
import { AudioLibraryPanel } from "./AudioLibraryPanel";
import {
  coveredPendingEdits,
  makeEditContinuation,
} from "./continuation-model";
import { ImagePanel } from "./ImagePanel";
import { ImportMedia, ImportTabs } from "./ImportMedia";
import { Timeline } from "./Timeline";
import { StoryboardShot } from "./StoryboardControls";
import { FilmPlan } from "./FilmPlan";
import { GenerationGuide } from "./GenerationGuide";
import { useProjectUpdates, ProjectUpdatesProvider } from "./project-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { APP_NAME } from "@openslate/core/public";
import { ApiError, StudioApi } from "./api";
import { takeStudioLaunchCode } from "./studio-launch";
import {
  Connect,
  Icon,
  IconButton,
  HelpTip,
  Lightbox,
  errorText,
} from "./components";
import { ProjectSettings } from "./ProjectSettings";
import { DirectorPlan } from "./DirectorPlan";
import { MediaPanel } from "./MediaPanel";
import { AssetLibrary } from "./AssetLibrary";
import { NarrationPanel } from "./NarrationPanel";
import { NewProjectProviderFields } from "./ProviderSettings";
import { RecoveryPanel, RecoveryReadOnly } from "./RecoveryPanel";
import { canUseDemo, projectCreationCommand } from "./provider-model";
import type {
  NewProjectCommand,
  ProviderSelection,
  ProviderView,
} from "./provider-model";
import {
  canStopWork,
  continueStoppedWork,
  conversation,
  durationLabel,
  makeImageDiscussion,
  makeMessageCommand,
  makeQuestionReply,
} from "./model";
import type {
  DirectorStatus,
  MessageCommand,
  ProjectSnapshot,
  ProjectSummary,
  ReviewSnapshot,
} from "./model";

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const offlineDirector: DirectorStatus = {
  mode: "offline",
  status: "not_connected",
};
function useProject(
  api: StudioApi,
  projectId: string,
  refreshKey: number,
  updateVersion: number,
) {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const [director, setDirector] = useState<DirectorStatus>(offlineDirector);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [error, setError] = useState("");
  const currentId = useRef(projectId),
    lastSignature = useRef("");
  const [loadedProjectId, setLoadedProjectId] = useState("");
  useEffect(() => {
    if (currentId.current !== projectId) {
      setSnapshot(null);
      setReview(null);
      setDirector(offlineDirector);
      setLoadedProjectId("");
      setConnection("connecting");
      lastSignature.current = "";
      currentId.current = projectId;
    }
    if (!projectId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const [next, status] = await Promise.all([
          api.request<ProjectSnapshot>(projectPath(projectId), {
            signal: controller.signal,
          }),
          api.request<DirectorStatus>(`${projectPath(projectId)}/director`, {
            signal: controller.signal,
          }),
        ]);
        const signature = `${next.project.headVersion}:${next.project.activePlanId}:${next.cursor}`;
        if (signature !== lastSignature.current) {
          const nextReview = await api.request<ReviewSnapshot>(
            `${projectPath(projectId)}/review`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setReview(nextReview);
          lastSignature.current = signature;
        }
        if (controller.signal.aborted) return;
        setSnapshot(next);
        setDirector(status);
        setLoadedProjectId(projectId);
        setConnection("connected");
        setError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setConnection("reconnecting");
        setError(errorText(error));
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, [api, projectId, refreshKey, updateVersion]);
  return {
    snapshot: snapshot?.project.id === projectId ? snapshot : null,
    review: snapshot?.project.id === projectId ? review : null,
    director,
    connection: visibleProjectConnection(
      projectId,
      loadedProjectId,
      connection,
    ),
    error,
  };
}
type PendingMessage = { command: MessageCommand; failed: boolean };
type Action = {
  projectId: string;
  path: string;
  body: unknown;
  key: string;
  label: string;
};
function Studio({
  api,
  initialProjects,
  disconnect,
}: {
  api: StudioApi;
  initialProjects: ProjectSummary[];
  disconnect: () => void | Promise<void>;
}) {
  const [recoveryReadOnly, setRecoveryReadOnly] = useState(true);
  const [projects, setProjects] = useState(initialProjects);
  const [projectId, setProjectId] = useState(initialProjects[0]?.id ?? "");
  const updates = useProjectUpdates(api, projectId);
  const split = useWorkspaceSplit(!!projectId);
  const [refreshKey, setRefreshKey] = useState(0);
  const {
    snapshot,
    review,
    director,
    connection,
    error: connectionError,
  } = useProject(api, projectId, refreshKey, updates.revision);
  const [pendingCreation, setPendingCreation] =
    useState<NewProjectCommand | null>(null);
  const [spendingFocus, setSpendingFocus] = useState<{
    projectId: string;
    candidateId: string;
    requestId: string;
  } | null>(null);
  const [providerSelection, setProviderSelection] =
    useState<ProviderSelection | null>(null);
  const [demoProfiles, setDemoProfiles] = useState<{
    projectId: string;
    allowed: boolean;
  } | null>(null);
  const demoAvailable =
    demoProfiles?.projectId === projectId && demoProfiles.allowed;
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(!initialProjects.length);
  const [showDirectorSettings, setShowDirectorSettings] = useState(false);
  const [selectedShots, setSelectedShots] = useState<string[]>([]);
  const [reviewChanged, setReviewChanged] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, PendingMessage>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, Action>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [stops, setStops] = useState<
    Record<
      string,
      { key: string; failed: boolean; acknowledgedCursor?: number }
    >
  >({});
  const stopping = useRef(new Set<string>()),
    sending = useRef(false),
    actionInFlight = useRef(false),
    creationInFlight = useRef(false);
  const [importTab, setImportTab] = useState<"image" | "video" | "audio">(
    "image",
  );
  const [importOpen, setImportOpen] = useState(false),
    [audioShotId, setAudioShotId] = useState<string | null>(null),
    [musicImportOpen, setMusicImportOpen] = useState(false),
    [advancedAudioOpen, setAdvancedAudioOpen] = useState(false);
  const [tab, setTab] = useState<WorkspaceView>("storyboard");
  const workspaceScroll = useRef<HTMLElement>(null);
  const currentDecision = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workspaceScroll.current?.scrollTo({ top: 0 });
  }, [tab, projectId]);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationHistoryRequest, setGenerationHistoryRequest] = useState<{
    projectId: string;
    id: string;
  } | null>(null);
  const [draftContinuation, setDraftContinuation] = useState<{
    projectId: string;
    requestId: string;
  } | null>(null);
  const [mobileView, setMobileView] = useState("workspace");
  const [replyQuestionId, setReplyQuestionId] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const draft = drafts[projectId] ?? "";
  const pendingMessage = pending[projectId];
  const pendingAction = pendingActions[projectId];
  const connected =
    connection === "connected" &&
    (updates.connection === "connected" || updates.connection === "fallback");
  const messages = conversation(snapshot);
  useEffect(() => {
    setGenerationOpen(false);
    setGenerationHistoryRequest(null);
    setSpendingFocus(null);
    setAudioShotId(null);
    setMusicImportOpen(false);
    setImportOpen(false);
    setAdvancedAudioOpen(false);
    setDraftContinuation(null);
    setSelectedShots([]);
    setFeedback("");
    setActionError("");
    setReviewChanged(false);
    setReplyQuestionId(null);
  }, [projectId]);

  useEffect(() => {
    if (snapshot)
      setSelectedShots((ids) =>
        ids.filter((id) =>
          snapshot.project.shots.some((shot) => shot.id === id),
        ),
      );
  }, [snapshot]);
  useEffect(() => {
    const stream = chatEnd.current?.parentElement;
    if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: "auto" });
  }, [messages.length, pendingMessage?.failed]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void api
      .request<{ profiles: ProviderView[] }>(
        `${projectPath(projectId)}/providers`,
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted)
          setDemoProfiles({ projectId, allowed: canUseDemo(value.profiles) });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDemoProfiles({ projectId, allowed: false });
      });
    return () => controller.abort();
  }, [api, projectId, refreshKey]);
  async function reloadProjects() {
    const value = await api.request<{ projects: ProjectSummary[] }>(
      "/api/projects",
    );
    setProjects(value.projects);
  }
  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (
      recoveryReadOnly ||
      !newName.trim() ||
      creating ||
      creationInFlight.current
    )
      return;
    creationInFlight.current = true;
    setCreating(true);
    setActionError("");
    let command: NewProjectCommand;
    try {
      command =
        pendingCreation ??
        projectCreationCommand(newName, crypto.randomUUID(), providerSelection);
    } catch (error) {
      setActionError(errorText(error));
      creationInFlight.current = false;
      setCreating(false);
      return;
    }
    setPendingCreation(command);
    try {
      const project = await api.request<ProjectSummary>("/api/projects", {
        method: "POST",
        body: command.body,
        key: command.key,
      });
      setPendingCreation(null);
      setProviderSelection(null);
      setProjects((all) => [
        project,
        ...all.filter((item) => item.id !== project.id),
      ]);
      setProjectId(project.id);
      setNewName("");
      setShowNew(false);
      setShowDirectorSettings(true);
      void reloadProjects().catch(() => {});
    } catch (error) {
      if (
        error instanceof ApiError &&
        !["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        )
      )
        setPendingCreation(null);
      setActionError(errorText(error));
    } finally {
      creationInFlight.current = false;
      setCreating(false);
    }
  }
  async function send() {
    if (
      recoveryReadOnly ||
      !snapshot ||
      busy ||
      sending.current ||
      actionInFlight.current ||
      pendingAction ||
      stops[projectId]
    )
      return;
    sending.current = true;
    setBusy(true);
    let command: MessageCommand;
    try {
      const question = snapshot.questions?.find(
        (item) => item.id === replyQuestionId,
      );
      if (replyQuestionId && !question)
        throw new Error(
          "That question is no longer available. Refresh to continue.",
        );
      command =
        pendingMessage?.command ??
        (question
          ? makeQuestionReply(projectId, question, draft, crypto.randomUUID())
          : continueStoppedWork(
              makeMessageCommand(
                snapshot.project,
                draft,
                selectedShots,
                crypto.randomUUID(),
                director.mode === "native",
              ),
              snapshot.control,
            ));
      if (
        !pendingMessage &&
        !question &&
        !snapshot.control?.paused &&
        "scopeIds" in command.body
      ) {
        if (draftContinuation?.projectId === projectId)
          command = {
            ...command,
            body: {
              ...command.body,
              continuationRequestId: draftContinuation.requestId,
            },
          };
        else if (command.body.editing) {
          const continueEdits = await makeEditContinuation(
            snapshot,
            command.body.scopeIds,
          );
          if (continueEdits)
            command = { ...command, body: { ...command.body, continueEdits } };
        }
      }
    } catch (error) {
      sending.current = false;
      setBusy(false);
      setActionError(errorText(error));
      return;
    }
    setBusy(true);
    setActionError("");
    setPending((all) => ({
      ...all,
      [command.projectId]: { command, failed: false },
    }));
    try {
      await api.request(`${projectPath(command.projectId)}/messages`, {
        method: "POST",
        body: command.body,
        key: command.key,
      });
      setPending((all) => {
        const next = { ...all };
        delete next[command.projectId];
        return next;
      });
      setDrafts((all) => ({ ...all, [command.projectId]: "" }));
      setReplyQuestionId(null);
      setDraftContinuation(null);
      setFeedback("Message saved.");
      refresh();
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        )
      )
        setPending((all) => ({
          ...all,
          [command.projectId]: { command, failed: true },
        }));
      else {
        setPending((all) => {
          const next = { ...all };
          delete next[command.projectId];
          return next;
        });
        if (
          ["QUESTION_STALE", "RESTORED_AUTHORITY_REQUIRES_NEW"].includes(
            error.code,
          )
        )
          setReplyQuestionId(null);
        refresh();
      }
      setActionError(errorText(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function stopWork() {
    if (recoveryReadOnly || stopping.current.has(projectId)) return;
    const target = projectId,
      key = stops[target]?.key ?? crypto.randomUUID();
    stopping.current.add(target);
    setStops((all) => ({ ...all, [target]: { key, failed: false } }));
    setActionError("");
    try {
      const stopped = await api.request<{ cursor: number }>(
        `${projectPath(target)}/controls`,
        { method: "POST", body: { action: "stop" }, key },
      );
      setStops((all) => ({
        ...all,
        [target]: { key, failed: false, acknowledgedCursor: stopped.cursor },
      }));
      setReplyQuestionId(null);
      setSelectedShots([]);
      setFeedback(
        "Stopped. Saved work is kept. Send a new direction to continue; submitted provider jobs may still finish.",
      );
      refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        !["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        )
      )
        setStops((all) => {
          const next = { ...all };
          delete next[target];
          return next;
        });
      else setStops((all) => ({ ...all, [target]: { key, failed: true } }));
      setActionError(errorText(error));
      refresh();
    } finally {
      stopping.current.delete(target);
    }
  }
  async function runAction(action: Action) {
    if (recoveryReadOnly || busy || actionInFlight.current || sending.current)
      return;
    actionInFlight.current = true;
    setBusy(true);
    setActionError("");
    setFeedback("");
    try {
      await api.request(action.path, {
        method: "POST",
        body: action.body,
        key: action.key,
      });
      setPendingActions((all) => {
        const next = { ...all };
        delete next[action.projectId];
        return next;
      });
      setFeedback(action.label);
      refresh();
      void reloadProjects().catch(() => {});
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        )
      )
        setPendingActions((all) => ({ ...all, [action.projectId]: action }));
      else {
        setPendingActions((all) => {
          const next = { ...all };
          delete next[action.projectId];
          return next;
        });
        if (action.path.endsWith("/approvals")) {
          setReviewChanged(true);
        }
      }
      setActionError(errorText(error));
      refresh();
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }
  function demo(action: "create" | "close_up" | "wide") {
    if (snapshot && demoAvailable)
      void runAction({
        projectId,
        path: `${projectPath(projectId)}/demo`,
        body: {
          action,
          ...(action === "create" ? {} : { shotId: selectedShots[0] }),
        },
        key: crypto.randomUUID(),
        label: "Demo request recorded. Follow its progress here.",
      });
  }

  const toggleScope = (id: string) => {
    setDraftContinuation(null);
    setMobileView("director");
    setSelectedShots((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
    composer.current?.focus();
  };
  const disabled =
    recoveryReadOnly ||
    busy ||
    creating ||
    !!pendingAction ||
    !!pendingMessage ||
    !!stops[projectId];
  const frames = useKeyframeReview({
    projectId,
    snapshot,
    review,
    connected,
    disabled,
    onApprove: (body) =>
      void runAction({
        projectId,
        path: `${projectPath(projectId)}/approvals`,
        body,
        key: crypto.randomUUID(),
        label: "Keyframe and motion approved.",
      }),
    onError: setActionError,
  });
  const selectedNames =
    snapshot?.project.shots
      .filter((shot) => selectedShots.includes(shot.id))
      .map((shot) => `Shot ${snapshot.project.shots.indexOf(shot) + 1}`) ?? [];
  const totalFrames =
    snapshot?.project.shots.reduce(
      (total, shot) => total + shot.desiredFrames,
      0,
    ) ?? 0;
  const pendingQuestions =
    snapshot?.questions?.filter((question) => question.state === "pending") ??
    [];
  const replyQuestion = pendingQuestions.find(
    (question) => question.id === replyQuestionId,
  );
  useEffect(() => {
    if (
      snapshot?.control?.paused ||
      snapshot?.questions?.find((q) => q.id === replyQuestionId)?.canAnswer ===
        false
    )
      setReplyQuestionId(null);
  }, [snapshot, replyQuestionId]);
  useEffect(() => {
    const ack = stops[projectId]?.acknowledgedCursor;
    if (ack !== undefined && snapshot && snapshot.cursor >= ack)
      setStops((all) => {
        const next = { ...all };
        delete next[projectId];
        return next;
      });
  }, [snapshot, stops, projectId]);
  const heldRequests = [
    ...new Set(
      snapshot?.holds
        .filter(
          (hold) =>
            hold.active &&
            hold.ownerId !== snapshot.latestStoryboardEdit?.requestId,
        )
        .map((hold) => hold.ownerId) ?? [],
    ),
  ];
  const continuingEdits =
    snapshot &&
    !replyQuestion &&
    !draftContinuation &&
    !snapshot.control?.paused &&
    director.mode === "native"
      ? coveredPendingEdits(
          snapshot,
          selectedShots.length ? selectedShots : [projectId],
        ).length
      : 0;

  return (
    <ProjectUpdatesProvider value={updates.revision + refreshKey}>
      <RecoveryReadOnly.Provider value={recoveryReadOnly}>
        <div className="studio-shell">
          {showDirectorSettings && projectId && (
            <ProjectSettings
              key={projectId}
              api={api}
              projectId={projectId}
              refreshKey={updates.revision + refreshKey}
              {...(snapshot ? { snapshot } : {})}
              close={() => setShowDirectorSettings(false)}
              changed={refresh}
              onContinue={() => {
                setShowDirectorSettings(false);
                requestAnimationFrame(() => composer.current?.focus());
              }}
            />
          )}
          {musicImportOpen && snapshot && (
            <ImportMedia
              title="Background music"
              close={() => setMusicImportOpen(false)}
            >
              <AudioLibraryPanel
                api={api}
                projectId={projectId}
                onChanged={refresh}
              />
              <p className="field-help">
                After uploading, choose the recording in Timeline’s Music
                selector.
              </p>
            </ImportMedia>
          )}
          {audioShotId && snapshot && (
            <ImportMedia
              title="Shot narration"
              close={() => setAudioShotId(null)}
            >
              <NarrationPanel
                api={api}
                projectId={projectId}
                headVersion={snapshot.project.headVersion}
                shots={snapshot.project.shots.filter(
                  (s) => s.id === audioShotId,
                )}
                directorMode={director.mode}
                onChanged={refresh}
                onContinue={(requestId) => {
                  const ids = snapshot.pendingEditContinuations
                    ?.find((group) => group.requestId === requestId)
                    ?.scopeIds.filter((id) =>
                      snapshot.project.shots.some((shot) => shot.id === id),
                    ) ?? [audioShotId];
                  setSelectedShots(ids.length ? ids : [audioShotId]);
                  setDraftContinuation({ projectId, requestId });
                  setDrafts((all) => ({
                    ...all,
                    [projectId]:
                      "Continue this shot using its accepted narration and update only the affected production plan.",
                  }));
                  setAudioShotId(null);
                  setMobileView("director");
                  composer.current?.focus();
                }}
                onReviewSpending={(candidateId) => {
                  setGenerationHistoryRequest(null);
                  setSpendingFocus({
                    projectId,
                    candidateId,
                    requestId: crypto.randomUUID(),
                  });
                  setAudioShotId(null);
                  setGenerationOpen(true);
                }}
              />
            </ImportMedia>
          )}
          {importOpen && snapshot && (
            <ImportMedia close={() => setImportOpen(false)}>
              <ImportTabs
                initialTab={importTab}
                onTabChange={setImportTab}
                image={
                  <ImagePanel
                    active={importTab === "image"}
                    api={api}
                    snapshot={snapshot}
                    uploadOnly
                    onChanged={refresh}
                  />
                }
                video={
                  <MediaPanel
                    active={importTab === "video"}
                    api={api}
                    snapshot={snapshot}
                    mode="upload"
                    onChanged={refresh}
                  />
                }
                audio={
                  <>
                    <AudioLibraryPanel
                      active={importTab === "audio"}
                      api={api}
                      projectId={projectId}
                      onChanged={refresh}
                    />
                    <details
                      onToggle={(event) =>
                        setAdvancedAudioOpen(event.currentTarget.open)
                      }
                    >
                      <summary>Advanced narration & transcripts</summary>
                      <NarrationPanel
                        active={importTab === "audio" && advancedAudioOpen}
                        api={api}
                        projectId={projectId}
                        headVersion={snapshot.project.headVersion}
                        shots={snapshot.project.shots}
                        directorMode={director.mode}
                        onChanged={refresh}
                        onReviewSpending={(candidateId) => {
                          setGenerationHistoryRequest(null);
                          setSpendingFocus({
                            projectId,
                            candidateId,
                            requestId: crypto.randomUUID(),
                          });
                          setImportOpen(false);
                          setGenerationOpen(true);
                          setTab("storyboard");
                        }}
                      />
                    </details>
                  </>
                }
              />
            </ImportMedia>
          )}
          <div className="studio-main" id="workspace">
            <header className="workspace-header">
              <a href="#workspace" className="brand">
                <span className="brand-mark">
                  <Icon name="slate" />
                </span>
                {APP_NAME}
              </a>
              <div className="project-switcher">
                <label className="sr-only" htmlFor="project-switch">
                  Current project
                </label>
                <Select.Root
                  value={projectId || "__new__"}
                  disabled={busy || creating}
                  onValueChange={(value) => {
                    if (value !== "__new__") setProjectId(value);
                  }}
                >
                  <Select.Trigger
                    id="project-switch"
                    aria-label="Current project"
                    className="project-select"
                    variant="ghost"
                  />
                  <Select.Content position="popper">
                    {!projectId && (
                      <Select.Item value="__new__">Your next film</Select.Item>
                    )}
                    {projects.map((project) => (
                      <Select.Item key={project.id} value={project.id}>
                        {project.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <UiButton
                  className="icon-button"
                  aria-label="Create a project"
                  title="Create a project"
                  disabled={recoveryReadOnly || busy || creating}
                  onClick={() => setShowNew((value) => !value)}
                >
                  <Icon name="plus" size={18} />
                </UiButton>
              </div>
              <div className="header-actions">
                <span
                  className={`connection ${connected ? "online" : ""}`}
                  role="status"
                >
                  <span className="status-dot" />
                  {connected
                    ? updates.connection === "fallback"
                      ? "Periodic updates"
                      : "Live updates"
                    : "Connecting…"}
                </span>
                <IconButton
                  icon="settings"
                  label="Project settings"
                  disabled={!projectId}
                  onClick={() => setShowDirectorSettings(true)}
                />
                <IconButton
                  icon="logout"
                  label="Disconnect studio"
                  onClick={() =>
                    void Promise.resolve(disconnect()).catch((error) =>
                      setActionError(errorText(error)),
                    )
                  }
                />
              </div>
            </header>
            {showNew && (
              <section className="create-project-panel">
                <div className="section-heading">
                  <h2>Start a new film</h2>
                  <UiButton
                    className="icon-button"
                    aria-label="Close new project"
                    title="Close new project"
                    onClick={() => setShowNew(false)}
                  >
                    <Icon name="close" />
                  </UiButton>
                </div>
                <form
                  className="new-project-form"
                  onSubmit={(event) => void createProject(event)}
                >
                  <label htmlFor="project-name">Project name</label>
                  <UiTextField
                    id="project-name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    maxLength={160}
                    placeholder="Name your film"
                    disabled={!!pendingCreation}
                    autoFocus
                  />
                  <NewProjectProviderFields
                    api={api}
                    selection={providerSelection}
                    changed={setProviderSelection}
                    disabled={recoveryReadOnly || creating || !!pendingCreation}
                  />
                  <UiButton
                    type="submit"
                    disabled={recoveryReadOnly || creating || !newName.trim()}
                    className="button primary"
                  >
                    {creating
                      ? "Creating…"
                      : pendingCreation
                        ? "Retry same project"
                        : "Create project"}
                  </UiButton>
                </form>
              </section>
            )}
            <div className="mobile-workspace-switch">
              <SegmentedControl.Root
                value={mobileView}
                onValueChange={setMobileView}
                aria-label="Workspace panel"
              >
                <SegmentedControl.Item value="workspace">
                  Workspace
                </SegmentedControl.Item>
                <SegmentedControl.Item value="director">
                  Director
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </div>
            <RecoveryPanel
              api={api}
              refreshKey={refreshKey}
              onState={setRecoveryReadOnly}
              onChanged={refresh}
            />
            {(connectionError || actionError) && (
              <div className="notice error" role="alert">
                <span>{actionError || connectionError}</span>
                <IconButton
                  icon="refresh"
                  label="Refresh workspace"
                  onClick={refresh}
                />
              </div>
            )}
            {pendingAction && (
              <div className="notice warning">
                <span>
                  This action wasn’t confirmed. Retry the same request to check
                  its outcome.
                </span>
                <UiButton
                  disabled={recoveryReadOnly || busy}
                  onClick={() => void runAction(pendingAction)}
                >
                  Retry action
                </UiButton>
              </div>
            )}
            {feedback && (
              <div className="sr-only" role="status">
                {feedback}
              </div>
            )}
            {!projectId ? (
              <main className="empty-studio">
                <span className="empty-symbol">
                  <Icon name="slate" size={40} />
                </span>
                <span className="eyebrow">YOUR FIRST SLATE</span>
                <h2>Make room for an idea.</h2>
                <p>
                  Create a project to start a conversation and shape your first
                  storyboard.
                </p>
                <UiButton
                  className="button primary"
                  disabled={recoveryReadOnly}
                  onClick={() => setShowNew(true)}
                >
                  <Icon name="plus" size={16} />
                  New project
                </UiButton>
              </main>
            ) : (
              <div className="studio-body">
                <WorkspaceRail
                  value={tab}
                  onChange={setTab}
                  onSettings={() => setShowDirectorSettings(true)}
                />
                <main
                  ref={split.grid}
                  style={split.style}
                  data-resizing={split.dragging}
                  className={`workspace-grid panel-${mobileView}`}
                >
                  <section
                    id="director-pane"
                    className="conversation-panel"
                    aria-labelledby="conversation-title"
                  >
                    <div className="panel-title">
                      <div>
                        <Icon name="chat" size={18} />
                        <h2 id="conversation-title">Director</h2>
                      </div>
                      <span className="tag subtle">
                        {director.mode === "fake"
                          ? "Demo director"
                          : director.mode === "native"
                            ? "Codex director"
                            : "Director offline"}
                      </span>
                    </div>
                    <div
                      className="conversation-stream"
                      aria-live="polite"
                      aria-relevant="additions text"
                    >
                      <div className="conversation-intro">
                        <span className="small-mark">
                          <Icon name="slate" size={20} />
                        </span>
                        <h3>Let’s shape the story.</h3>
                        <p>
                          Talk through your idea here. Select a shot to focus
                          the conversation on that part of the film.
                        </p>
                      </div>
                      {director.mode === "fake" && (
                        <div className="demo-disclosure">
                          <span className="tiny-label">DEMO MODE</span>
                          <p>
                            {demoAvailable
                              ? "This director uses canned guidance and fixture media. Ordinary chat does not change the video; use the demo edit buttons below."
                              : "This director uses canned guidance. Set up Codex to plan with this project’s saved models."}{" "}
                            Paid generation requires a ready provider and your
                            exact spending allowance. Video also requires
                            approval of its keyframe and motion plan.
                          </p>
                        </div>
                      )}
                      {director.mode === "offline" && (
                        <div className="demo-disclosure">
                          <p>
                            Your messages are saved. A live director isn’t
                            connected.
                          </p>
                        </div>
                      )}
                      {messages.map((message) => (
                        <article
                          key={message.id}
                          className={`message ${message.role}`}
                        >
                          <div className="message-byline">
                            {message.role === "assistant" ? "OpenSlate" : "You"}
                          </div>
                          <ChatMarkdown
                            text={message.text}
                            messageId={message.id}
                          />
                          {message.state === "failed" && (
                            <small>Response needs attention</small>
                          )}
                        </article>
                      ))}
                      {pendingMessage && (
                        <article className="message user pending">
                          <div className="message-byline">
                            You{" "}
                            <span>
                              {pendingMessage.failed
                                ? "Not confirmed"
                                : "Sending…"}
                            </span>
                          </div>
                          <ChatMarkdown
                            text={pendingMessage.command.body.text}
                            messageId={pendingMessage.command.key}
                          />
                          {pendingMessage.failed && (
                            <UiButton
                              className="text-button"
                              disabled={recoveryReadOnly || busy}
                              onClick={() => void send()}
                            >
                              Retry this message
                            </UiButton>
                          )}
                        </article>
                      )}
                      {director.status === "running" && (
                        <div className="director-working" role="status">
                          <span className="working-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                          Working on your request
                        </div>
                      )}
                      {director.message && director.status === "error" && (
                        <div className="inline-error">{director.message}</div>
                      )}
                      <div ref={chatEnd} />
                    </div>
                    <div ref={currentDecision} className="current-decision">
                      {snapshot && (
                        <DirectorPlan
                          snapshot={snapshot}
                          director={director}
                          review={review}
                          connected={connected}
                          disabled={disabled}
                          scopeIds={
                            selectedShots.length ? selectedShots : [projectId]
                          }
                          onDiscuss={() => {
                            setMobileView("director");
                            composer.current?.focus();
                          }}
                          onAnswer={(questionId) => {
                            setReplyQuestionId(questionId);
                            setMobileView("director");
                            composer.current?.focus();
                          }}
                          onResume={(edit) =>
                            void runAction({
                              projectId,
                              path: `${projectPath(projectId)}/messages`,
                              body: {
                                text: "Continue this earlier edit using its saved scope and current project state.",
                                scopeIds: edit.scopeIds,
                                continuationRequestId: edit.requestId,
                                editing: true,
                              },
                              key: crypto.randomUUID(),
                              label: "The saved edit was resumed.",
                            })
                          }
                          onGeneration={() => {
                            setGenerationHistoryRequest(null);
                            setGenerationOpen(true);
                            setTab("storyboard");
                            setMobileView("workspace");
                          }}
                          onHistory={() => {
                            setGenerationHistoryRequest({
                              projectId,
                              id: crypto.randomUUID(),
                            });
                            setSpendingFocus(null);
                            setGenerationOpen(true);
                            setTab("storyboard");
                            setMobileView("workspace");
                          }}
                          onFrames={() => {
                            setGenerationOpen(false);
                            setTab("storyboard");
                            setMobileView("workspace");
                          }}
                          onTimeline={() => {
                            setTab("preview");
                            setMobileView("workspace");
                          }}
                          onClearScope={() => {
                            setSelectedShots([]);
                            setDraftContinuation(null);
                            requestAnimationFrame(() =>
                              currentDecision.current
                                ?.querySelector<HTMLElement>(
                                  ".director-plan-head strong",
                                )
                                ?.focus({ preventScroll: true }),
                            );
                          }}
                        />
                      )}
                      {pendingQuestions.map((question) => (
                        <section
                          key={question.id}
                          className={`question-card ${replyQuestionId === question.id ? "selected" : ""}`}
                          aria-label="OpenSlate question"
                        >
                          <span className="tiny-label">
                            {question.canAnswer === false
                              ? "SAVED QUESTION"
                              : "YOUR INPUT NEEDED"}
                          </span>
                          {question.questions.map((item) => (
                            <div key={item.id}>
                              <h3>{item.header}</h3>
                              <p>{item.question}</p>
                              {item.options.length > 0 && (
                                <ul>
                                  {item.options.map((option) => (
                                    <li key={option.label}>
                                      <strong>{option.label}</strong> —{" "}
                                      {option.description}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                          {question.canAnswer === false ? (
                            <p>
                              This question is saved for reference. Use a fresh
                              conversation to continue when the project is
                              ready.
                            </p>
                          ) : (
                            <UiButton
                              className="button small"
                              disabled={disabled}
                              onClick={() => {
                                setReplyQuestionId(question.id);
                                composer.current?.focus();
                              }}
                            >
                              {replyQuestionId === question.id
                                ? "Replying below"
                                : "Answer this question"}
                            </UiButton>
                          )}
                        </section>
                      ))}
                    </div>
                    <div className="composer-area">
                      {replyQuestion && (
                        <div className="scope-chip">
                          <span>
                            Replying to:{" "}
                            {replyQuestion.questions
                              .map((item) => item.header)
                              .join(", ")}
                          </span>
                          <UiButton
                            onClick={() => setReplyQuestionId(null)}
                            aria-label="Cancel question reply"
                            title="Cancel question reply"
                          >
                            <Icon name="close" size={13} />
                          </UiButton>
                        </div>
                      )}
                      {!replyQuestion && selectedShots.length > 0 && (
                        <div className="scope-chip">
                          <Icon name="image" size={14} />
                          <span>{selectedNames.join(", ")}</span>
                          <UiButton
                            onClick={() => setSelectedShots([])}
                            aria-label="Clear shot selection"
                            title="Clear shot selection"
                          >
                            <Icon name="close" size={13} />
                          </UiButton>
                        </div>
                      )}
                      {director.mode === "fake" &&
                        demoAvailable &&
                        !replyQuestion &&
                        selectedShots.length === 1 && (
                          <div className="quick-actions">
                            <span>Try an edit</span>
                            <UiButton
                              disabled={disabled || !connected}
                              onClick={() => demo("close_up")}
                            >
                              Close-up
                            </UiButton>
                            <UiButton
                              disabled={disabled || !connected}
                              onClick={() => demo("wide")}
                            >
                              Wide shot
                            </UiButton>
                          </div>
                        )}
                      {draftContinuation?.projectId === projectId && (
                        <div className="scope-chip">
                          <span>Continuing the saved edit</span>
                          <IconButton
                            label="Clear saved edit continuation"
                            onClick={() => setDraftContinuation(null)}
                          />
                        </div>
                      )}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void send();
                        }}
                        className="composer"
                      >
                        {continuingEdits > 0 && (
                          <small className="composer-continuation">
                            This message continues {continuingEdits} saved edit
                            {continuingEdits === 1 ? "" : "s"} in this scope.
                          </small>
                        )}
                        <label className="sr-only" htmlFor="message-draft">
                          Message OpenSlate
                        </label>
                        <TextArea
                          ref={composer}
                          id="message-draft"
                          value={draft}
                          onChange={(event) =>
                            setDrafts((all) => ({
                              ...all,
                              [projectId]: event.target.value,
                            }))
                          }
                          placeholder={
                            replyQuestion
                              ? "Your answer to the selected question…"
                              : selectedShots.length
                                ? `What should change in ${selectedNames.join(", ").toLowerCase()}?`
                                : "Tell me about the film you have in mind…"
                          }
                          maxLength={16000}
                          disabled={!!pendingMessage}
                          rows={3}
                          onKeyDown={(event) => {
                            if (
                              (event.metaKey || event.ctrlKey) &&
                              event.key === "Enter"
                            ) {
                              event.preventDefault();
                              void send();
                            }
                          }}
                        />
                        <div className="composer-bottom">
                          <IconButton
                            icon="plus"
                            label="Import image, audio or video"
                            disabled={disabled}
                            onClick={() => setImportOpen(true)}
                          />
                          <HelpTip label="Conversation scope">
                            {selectedShots.length
                              ? `Editing ${selectedNames.join(", ")}. Clear the selection to discuss the whole film.`
                              : "Discuss the whole film, or choose Discuss on a shot to focus an edit. Press Command or Control + Enter to send."}
                          </HelpTip>
                          <div className="composer-actions">
                            {(canStopWork(snapshot, director) ||
                              !!stops[projectId] ||
                              (!!pendingMessage &&
                                !snapshot?.control?.paused)) && (
                              <UiButton
                                type="button"
                                className="stop-button"
                                disabled={
                                  recoveryReadOnly ||
                                  (!!stops[projectId] &&
                                    !stops[projectId]?.failed)
                                }
                                onClick={() => void stopWork()}
                                aria-label={
                                  stops[projectId]?.failed
                                    ? "Retry stop"
                                    : "Stop conversation and generation"
                                }
                                title="Stop the conversation and new generation. Submitted provider jobs may still finish."
                              >
                                <span aria-hidden="true">■</span>
                                <span className="sr-only">
                                  {stops[projectId]?.failed
                                    ? "Retry stop"
                                    : stops[projectId]
                                      ? "Stopping…"
                                      : "Stop"}
                                </span>
                              </UiButton>
                            )}
                            <UiButton
                              type="submit"
                              className="send-button"
                              disabled={disabled || !draft.trim() || !snapshot}
                              aria-label="Send message"
                              title="Send message"
                            >
                              <Icon name="arrow" size={18} />
                            </UiButton>
                          </div>
                        </div>
                      </form>
                    </div>
                  </section>
                  {split.separator}
                  <section
                    id="production-pane"
                    ref={workspaceScroll}
                    className="review-workspace"
                    aria-label="Production workspace"
                  >
                    <div className="workspace-toolbar">
                      <WorkspaceViewTabs value={tab} onChange={setTab} />
                      {tab !== "storyboard" && (
                        <span className="film-meta">
                          {snapshot?.project.shots.length ?? 0} shots ·{" "}
                          {durationLabel(totalFrames)}
                        </span>
                      )}
                    </div>
                    {tab === "preview" && snapshot && (
                      <Timeline
                        active={tab === "preview"}
                        api={api}
                        snapshot={snapshot}
                        disabled={disabled || !connected}
                        onImportAudio={() => setMusicImportOpen(true)}
                        command={(body) =>
                          void runAction({
                            projectId,
                            path: `${projectPath(projectId)}/storyboard`,
                            body: {
                              expectedHeadVersion: snapshot.project.headVersion,
                              ...body,
                            },
                            key: crypto.randomUUID(),
                            label: "Soundtrack saved.",
                          })
                        }
                      />
                    )}
                    {snapshot?.control?.paused && (
                      <div className="notice warning">
                        <span>
                          {recoveryReadOnly
                            ? "Execution is paused for recovery review."
                            : "Stopped. Send a new direction in the conversation to continue from saved work. Previously submitted jobs may still finish at their provider."}
                        </span>
                      </div>
                    )}
                    {reviewChanged && (
                      <div className="notice warning">
                        <span>
                          The storyboard changed. Inspect the current frame and
                          motion before approving.
                        </span>
                        <IconButton
                          onClick={() => setReviewChanged(false)}
                          label="Dismiss notice"
                          icon="close"
                        />
                      </div>
                    )}
                    {!snapshot ? (
                      <div className="loading-state">
                        <span className="loading-ring" />
                        Loading your workspace…
                      </div>
                    ) : (
                      <div hidden={tab !== "storyboard"}>
                        <FilmPlan
                          active={tab === "storyboard"}
                          key={projectId}
                          api={api}
                          snapshot={snapshot}
                          director={director}
                          disabled={disabled || !connected}
                          generationOpen={generationOpen}
                          openGeneration={() => {
                            setGenerationHistoryRequest(null);
                            setGenerationOpen(true);
                          }}
                          closeGeneration={() => {
                            setGenerationOpen(false);
                            setGenerationHistoryRequest(null);
                            setSpendingFocus(null);
                          }}
                          onDiscuss={(text, ids) => {
                            setDraftContinuation(
                              text && heldRequests.length === 1
                                ? { projectId, requestId: heldRequests[0]! }
                                : null,
                            );
                            setMobileView("director");
                            if (ids) setSelectedShots(ids);
                            else if (text) setSelectedShots([]);
                            if (text)
                              setDrafts((all) => ({
                                ...all,
                                [projectId]: text,
                              }));
                            composer.current?.focus();
                          }}
                          action={(path, body, label, key) =>
                            void runAction({
                              projectId,
                              path,
                              body,
                              label,
                              key: key ?? crypto.randomUUID(),
                            })
                          }
                          onDemo={
                            director.mode === "fake" && demoAvailable
                              ? () => demo("create")
                              : undefined
                          }
                          generation={
                            <GenerationGuide
                              active={tab === "storyboard" && generationOpen}
                              key={projectId}
                              api={api}
                              snapshot={snapshot}
                              review={review}
                              director={director}
                              disabled={disabled || !connected}
                              authorize={(body) =>
                                void runAction({
                                  projectId,
                                  path: `${projectPath(projectId)}/generation-permission`,
                                  body,
                                  key: crypto.randomUUID(),
                                  label:
                                    "Permission saved. Follow the generation review as the plan becomes ready.",
                                })
                              }
                              {...(generationHistoryRequest?.projectId ===
                              projectId
                                ? {
                                    historyRequestId:
                                      generationHistoryRequest.id,
                                  }
                                : {})}
                              onChanged={refresh}
                              onChat={() => {
                                setMobileView("director");
                                composer.current?.focus();
                              }}
                              onFrames={() => {
                                setGenerationOpen(false);
                                setTab("storyboard");
                              }}
                              onTimeline={() => setTab("preview")}
                              onAudio={(shotId) => setAudioShotId(shotId)}
                              {...(spendingFocus?.projectId === projectId
                                ? { focus: spendingFocus }
                                : {})}
                            />
                          }
                          renderShot={(shot, focus) => {
                            const member = review?.members.find(
                              (member) => member.shotId === shot.id,
                            );
                            return (
                              <StoryboardShot
                                api={api}
                                snapshot={snapshot}
                                shot={shot}
                                member={member}
                                selected={focus?.selected}
                                compact={focus?.compact}
                                onSelect={focus?.onSelect}
                                onInspect={(url, fixture) =>
                                  frames.inspect(shot, url, fixture)
                                }
                                stale={disabled || !connected}
                                onDisplayed={frames.onDisplayed}
                                command={(body) =>
                                  void runAction({
                                    projectId,
                                    path: `${projectPath(projectId)}/storyboard`,
                                    body: {
                                      expectedHeadVersion:
                                        snapshot.project.headVersion,
                                      ...body,
                                    },
                                    key: crypto.randomUUID(),
                                    label: "Storyboard saved.",
                                  })
                                }
                                onDiscuss={() => {
                                  toggleScope(shot.id);
                                  setMobileView("director");
                                  composer.current?.focus();
                                }}
                                onNarration={() => setAudioShotId(shot.id)}
                              />
                            );
                          }}
                        />
                      </div>
                    )}
                    {snapshot && (
                      <div hidden={tab !== "assets"}>
                        <AssetLibrary
                          active={tab === "assets"}
                          key={projectId}
                          api={api}
                          snapshot={snapshot}
                          onChanged={refresh}
                          disabled={
                            disabled ||
                            !connected ||
                            !director.imageAttachmentsAvailable
                          }
                          onDiscuss={
                            director.mode === "native"
                              ? (artifact) => {
                                  const command = makeImageDiscussion(
                                    projectId,
                                    artifact,
                                    crypto.randomUUID(),
                                  );
                                  setMobileView("director");
                                  void runAction({
                                    projectId,
                                    path: `${projectPath(projectId)}/messages`,
                                    body: command.body,
                                    key: command.key,
                                    label: "Image attached to this discussion.",
                                  });
                                }
                              : undefined
                          }
                        />
                      </div>
                    )}
                    {snapshot && (
                      <div hidden={tab !== "preview"}>
                        <MediaPanel
                          active={tab === "preview"}
                          key={projectId}
                          api={api}
                          snapshot={snapshot}
                          mode="render"
                          onChanged={refresh}
                        />
                      </div>
                    )}
                  </section>
                </main>
              </div>
            )}
          </div>
          {frames.inspection && (
            <Lightbox
              value={frames.inspection}
              returnFocusRef={frames.returnFocus}
              onClose={frames.close}
              approved={frames.approved}
              approveDisabled={frames.approveDisabled}
              {...(frames.inspection.reviewNodeId
                ? { onApprove: frames.approve }
                : {})}
            />
          )}
        </div>
      </RecoveryReadOnly.Provider>
    </ProjectUpdatesProvider>
  );
}
export default function App() {
  const [session, setSession] = useState<{
    api: StudioApi;
    projects: ProjectSummary[];
  } | null>(null);
  useEffect(() => () => session?.api.close(), [session]);
  async function connect() {
    const api = await StudioApi.connect(
      takeStudioLaunchCode(window.location, window.history),
    );
    try {
      const response = await api.request<{ projects: ProjectSummary[] }>(
        "/api/projects",
      );
      api.onSessionExpired = () => {
        api.close();
        setSession(null);
      };
      setSession({ api, projects: response.projects });
    } catch (error) {
      api.close();
      throw error;
    }
  }
  useEffect(() => {
    // Launchers can reuse an existing window; a fragment change does not remount React.
    const reconnect = () => {
      if (window.location.hash.startsWith("#connect="))
        void connect().catch(() => setSession(null));
    };
    window.addEventListener("hashchange", reconnect);
    return () => window.removeEventListener("hashchange", reconnect);
  }, []);
  async function disconnect() {
    if (!session) return;
    await session.api.request("/api/session/logout", { method: "POST" });
    session.api.close();
    setSession(null);
  }
  return session ? (
    <Studio
      api={session.api}
      initialProjects={session.projects}
      disconnect={disconnect}
    />
  ) : (
    <Connect onConnect={connect} />
  );
}
