import { useTranslation, LanguageSwitch } from "./Locale";
import { ChatMarkdown } from "./ChatMarkdown";
import { useWorkspaceSplit } from "./WorkspaceSplit";
import { useKeyframeInspection } from "./useKeyframeInspection";
import { initialWorkspaceView, WorkspaceViewTabs } from "./WorkspaceNavigation";
import type { WorkspaceView } from "./WorkspaceNavigation";
import { visibleProjectConnection } from "./project-view-model";
import "./chat-markdown.css";
import "./workspace-layout.css";
import { SegmentedControl, Select, TextArea } from "@radix-ui/themes";
import {
  AppDialog,
  ConversationSurface,
  ConversationToolBusy,
  UiButton,
  UiSelect,
  UiTextField,
} from "./ui";
import {
  AssetActions,
  TimelineSettings,
  ExportDownload,
} from "./ConversationMediaTools";
import { ProjectEditor } from "./ProjectEditor";
import { PlanImport } from "./PlanImport";
import { FrameWorkspace } from "./FrameWorkspace";
import { AppearanceSwitch } from "./Appearance";
import { ReferenceComposer } from "./ReferenceComposer";
import {
  continueReferencedWork,
  makeReferencedMessage,
  parseReferenceLink,
  projectReferences,
  referenceKey,
} from "./reference-model";
import type { StudioReference } from "./reference-model";
import { projectResults } from "./project-results-model";
import { currentFrameExposures, frameSelection } from "./frame-workspace-model";
import { FrameDecision, SceneDecisionFooter } from "./FrameDecision";
import type { FrameRequest } from "./frame-decision-model";
import { pendingCommandsFor } from "./pending-command";
import "./frame-shell.css";
import { ConversationActions } from "./ConversationActions";
import { exposedSceneFrameKey } from "./conversation-actions-model";
import "./conversation-workspace.css";
import { AudioLibraryPanel } from "./AudioLibraryPanel";
import {
  coveredPendingEdits,
  makeEditContinuation,
} from "./continuation-model";
import { ImagePanel } from "./ImagePanel";
import { ImportMedia, ImportTabs } from "./ImportMedia";
import { Timeline } from "./Timeline";
import { GenerationGuide } from "./GenerationGuide";
import { useProjectUpdates, ProjectUpdatesProvider } from "./project-updates";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  const { t, ui } = useTranslation();
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
  const [selectedFrameIds, setSelectedFrameIds] = useState<
    Record<string, string>
  >({});
  const [referenceDrafts, setReferenceDrafts] = useState<
    Record<string, StudioReference[]>
  >({});
  const referenceDraft = referenceDrafts[projectId] ?? [];
  const [reviewedFrames, setReviewedFrames] = useState<Record<string, boolean>>(
    {},
  );
  const [frameRequest, setFrameRequest] = useState<FrameRequest | null>(null);
  const [sceneReview, setSceneReview] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<string | null>(null);
  const [assetFocus, setAssetFocus] = useState<string | null>(null);
  const sceneRegistry = pendingCommandsFor(api, "conversation-scenes");
  const sceneSlot = useSyncExternalStore(
    useCallback(
      (listener) => sceneRegistry.subscribe(projectId, listener),
      [sceneRegistry, projectId],
    ),
    useCallback(
      () => sceneRegistry.snapshot(projectId),
      [sceneRegistry, projectId],
    ),
  );
  const sceneBusy = sceneSlot.running;
  const seenSceneSettlement = useRef(sceneSlot.settledVersion);
  useEffect(() => {
    if (sceneSlot.settledVersion <= seenSceneSettlement.current) return;
    seenSceneSettlement.current = sceneSlot.settledVersion;
    const meta = sceneSlot.settledCommand?.metadata as
      | { sceneId?: string; kind?: string }
      | undefined;
    if (sceneSlot.lastSuccess && meta?.kind === "video")
      setSceneReview((current) => (current === meta.sceneId ? null : current));
  }, [
    sceneSlot.settledVersion,
    sceneSlot.lastSuccess,
    sceneSlot.settledCommand,
  ]);
  const conversationScroll = useRef<HTMLDivElement>(null),
    followChat = useRef(true);
  const [newChat, setNewChat] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false),
    [briefImportOpen, setBriefImportOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [toolBusy, setToolBusy] = useState<Record<string, boolean>>({});
  const registerToolBusy = useCallback(
    (id: string, value: boolean) =>
      setToolBusy((previous) => {
        if (!!previous[id] === value) return previous;
        const next = { ...previous };
        if (value) next[id] = true;
        else delete next[id];
        return next;
      }),
    [],
  );
  const protectedTool = Object.values(toolBusy).some(Boolean);
  const [exposedFrames, setExposedFrames] = useState<Record<string, boolean>>(
    {},
  );
  const [compactScreen, setCompactScreen] = useState(
    () => window.matchMedia("(max-width:760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px)");
    const change = () => setCompactScreen(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
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
  const [tab, updateTab] = useState<WorkspaceView>(() =>
    initialWorkspaceView(window.location.search),
  );
  const setTab = (next: WorkspaceView) => {
    updateTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.replaceState(null, "", url);
    } catch {
      /*The current work area still switches when browser history is unavailable.*/
    }
  };
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
  const chatEnd = useRef<HTMLDivElement>(null),
    sceneDecisions = useRef<HTMLDivElement>(null);
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
    setEditorOpen(false);
    setBriefImportOpen(false);
    setExportOpen(false);
    setExposedFrames({});
    setReviewedFrames({});
    setFrameRequest(null);
    setSceneReview(null);
    setEditorTarget(null);
    setAssetFocus(null);
    followChat.current = true;
    setNewChat(false);
    setGenerationOpen(false);
    setGenerationHistoryRequest(null);
    setAudioShotId(null);
    setMusicImportOpen(false);
    setImportOpen(false);
    setAdvancedAudioOpen(false);
    setDraftContinuation(null);
    setSelectedShots([]);
    setFeedback("");
    setActionError("");
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
    const stream = conversationScroll.current;
    if (stream && followChat.current)
      stream.scrollTo({ top: stream.scrollHeight, behavior: "auto" });
    else if (stream) setNewChat(true);
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
      disabled ||
      (!!projectId && !connected) ||
      sending.current ||
      actionInFlight.current ||
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
    if (!pendingMessage && !draft.trim()) return;
    if (
      recoveryReadOnly ||
      protectedTool ||
      sceneRegistry.snapshot(projectId).running ||
      !connected ||
      !snapshot ||
      creating ||
      creationInFlight.current ||
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
          : continueReferencedWork(
              makeReferencedMessage(
                snapshot.project,
                draft,
                selectedShots,
                referenceDraft,
                crypto.randomUUID(),
                director.mode === "native",
                director.mode === "native" &&
                  director.imageAttachmentsAvailable === true,
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
      setReferenceDrafts((all) => ({ ...all, [command.projectId]: [] }));
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
    if (
      recoveryReadOnly ||
      protectedTool ||
      sceneRegistry.snapshot(projectId).running ||
      !connected ||
      creating ||
      creationInFlight.current ||
      !!pendingMessage ||
      (!!pendingAction && pendingAction.key !== action.key) ||
      busy ||
      actionInFlight.current ||
      sending.current
    )
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

  const mutationsDisabled =
    recoveryReadOnly ||
    busy ||
    creating ||
    !!pendingAction ||
    !!pendingMessage ||
    !!stops[projectId];
  const disabled = mutationsDisabled || protectedTool || sceneBusy;
  const frames = useKeyframeInspection({
    projectId,
    snapshot,
    review,
  });
  const selectedNames =
    snapshot?.project.shots
      .filter((shot) => selectedShots.includes(shot.id))
      .map((shot) =>
        t("Shot {number}", "镜头 {number}", {
          number: snapshot.project.shots.indexOf(shot) + 1,
        }),
      ) ?? [];
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
  const continuingEdits =
    snapshot &&
    !replyQuestion &&
    !draftContinuation &&
    !snapshot.control?.paused &&
    director.mode === "native"
      ? coveredPendingEdits(
          snapshot,
          selectedShots.length ? selectedShots : [projectId],
        ).filter((group) => group.directorState !== "completed").length
      : 0;

  const results = snapshot ? projectResults(snapshot) : null;
  const selectedFrame =
    snapshot && results
      ? frameSelection(results.scenes, selectedFrameIds[projectId] ?? null)
      : null;
  const checkedFrames = { ...reviewedFrames };
  if (
    snapshot &&
    review &&
    review.planId === snapshot.project.activePlanId &&
    review.headVersion === snapshot.project.headVersion &&
    review.revisionId === snapshot.project.revisionId
  ) {
    for (const member of review.members) {
      const actual = results?.scenes
        .flatMap((s) => s.shots)
        .find((r) => r.shot.id === member.shotId);
      if (
        member.approved &&
        member.keyframe &&
        actual?.keyframe.current &&
        actual.keyframe.artifact?.artifactId === member.keyframe.artifactId &&
        actual.keyframe.artifact.sha256 === member.keyframe.sha256
      )
        checkedFrames[
          exposedSceneFrameKey(
            projectId,
            snapshot.project.revisionId,
            member.shotId,
            member.keyframe.artifactId,
            member.keyframe.sha256,
          )
        ] = true;
    }
  }
  const selectedFrameId = selectedFrame?.result.shot.id ?? null;
  const selectedSceneId = selectedFrame?.scene.id ?? null;
  const updateReferences = (refs: StudioReference[]) =>
    setReferenceDrafts((all) => ({ ...all, [projectId]: refs }));
  const chooseShot = (id: string) => {
    setSelectedFrameIds((all) => ({ ...all, [projectId]: id }));
    setSelectedShots([id]);
    setDraftContinuation(null);
  };
  const editTarget = (id: string) => {
    setEditorTarget(id);
    setEditorOpen(true);
    setMobileView("director");
  };
  const addReference = (kind: "shot" | "scene", id: string) => {
    if (!snapshot) return;
    const ref = projectReferences(snapshot).find(
      (r) => r.kind === kind && r.id === id,
    );
    if (!ref) return;
    updateReferences(
      referenceDraft.some((r) => r.key === ref.key)
        ? referenceDraft
        : [...referenceDraft, ref],
    );
    setMobileView("director");
    requestAnimationFrame(() => composer.current?.focus());
  };
  const navigateReference = (ref: StudioReference) => {
    if (ref.projectId !== projectId) {
      setActionError("The reference belongs to another project.");
      return;
    }
    if (ref.kind === "shot") {
      if (!snapshot?.project.shots.some((s) => s.id === ref.id)) {
        setActionError("The referenced shot is no longer in this project.");
        return;
      }
      chooseShot(ref.id);
      setTab("frames");
      setMobileView("workspace");
    } else if (ref.kind === "scene") {
      const shot = snapshot?.project.shots.find((s) => s.sceneId === ref.id);
      if (shot) chooseShot(shot.id);
      setTab("plan");
      setMobileView("workspace");
      requestAnimationFrame(() =>
        document
          .getElementById("plan-scene-" + ref.id)
          ?.scrollIntoView({ block: "start" }),
      );
    } else if (ref.kind === "project") {
      setTab("plan");
      setMobileView("workspace");
    } else if (ref.kind === "audio") {
      setMusicImportOpen(true);
      setMobileView("director");
    } else {
      setAssetFocus(ref.id);
      setTab("assets");
      setMobileView("workspace");
    }
  };
  const requestFrames = (sceneId: string, shotId?: string) => {
    if (!snapshot) return;
    const targets = snapshot.project.shots.filter(
      (s) => s.sceneId === sceneId && (!shotId || s.id === shotId),
    );
    const missing = targets.filter(
      (s) =>
        !results?.scenes
          .flatMap((scene) => scene.shots)
          .find((r) => r.shot.id === s.id)?.keyframe.current,
    );
    setFrameRequest({
      sceneId,
      targetShotIds: (missing.length ? missing : targets).map((s) => s.id),
      regenerate: !missing.length,
    });
    setMobileView("director");
  };
  const confirmFrame = (shotId: string) => {
    const current = results?.scenes
      .flatMap((scene) => scene.shots)
      .find((r) => r.shot.id === shotId);
    if (!snapshot || !current?.keyframe.current || !current.keyframe.artifact)
      return;
    const artifact = current.keyframe.artifact,
      key = exposedSceneFrameKey(
        projectId,
        snapshot.project.revisionId,
        shotId,
        artifact.artifactId,
        artifact.sha256,
      );
    if (!exposedFrames[key] || disabled || !connected) return;
    setReviewedFrames((previous) => ({ ...previous, [key]: true }));
  };
  const exposeFrame = (event: {
    projectId: string;
    projectRevisionId: string;
    shotId: string;
    artifactId: string;
    sha256: string;
    displayed: boolean;
  }) => {
    const key = exposedSceneFrameKey(
      event.projectId,
      event.projectRevisionId,
      event.shotId,
      event.artifactId,
      event.sha256,
    );
    setExposedFrames((previous) => {
      if (!!previous[key] === event.displayed) return previous;
      const next = { ...previous };
      if (event.displayed) next[key] = true;
      else delete next[key];
      return next;
    });
    if (!event.displayed)
      setReviewedFrames((previous) => {
        if (!previous[key]) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      });
  };
  useEffect(() => {
    if (!snapshot || !results) return;
    const valid = new Set(
      currentFrameExposures(snapshot, results.scenes).map((e) =>
        exposedSceneFrameKey(
          e.projectId,
          e.projectRevisionId,
          e.shotId,
          e.artifactId,
          e.sha256,
        ),
      ),
    );
    const prune = (previous: Record<string, boolean>) => {
      const keys = Object.keys(previous);
      return keys.every((k) => valid.has(k))
        ? previous
        : Object.fromEntries(
            keys.filter((k) => valid.has(k)).map((k) => [k, true]),
          );
    };
    setExposedFrames(prune);
    setReviewedFrames(prune);
  }, [snapshot]);

  return (
    <ProjectUpdatesProvider value={updates.revision + refreshKey}>
      <RecoveryReadOnly.Provider value={recoveryReadOnly}>
        <div className="studio-shell">
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
                  {t("Current project", "当前项目")}
                </label>
                <Select.Root
                  value={projectId || "__new__"}
                  disabled={busy || creating || protectedTool || sceneBusy}
                  onValueChange={(value) => {
                    if (value !== "__new__") setProjectId(value);
                  }}
                >
                  <Select.Trigger
                    id="project-switch"
                    aria-label={t("Current project", "当前项目")}
                    className="project-select"
                    variant="ghost"
                  />
                  <Select.Content position="popper">
                    {!projectId && (
                      <Select.Item value="__new__">
                        {t("Your next film", "你的下一部影片")}
                      </Select.Item>
                    )}
                    {projects.map((project) => (
                      <Select.Item key={project.id} value={project.id}>
                        {project.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </div>
              <div className="header-actions">
                <AppearanceSwitch />
                <LanguageSwitch />
                <UiButton
                  className="header-export"
                  variant="secondary"
                  disabled={!snapshot || disabled}
                  onClick={() => {
                    setExportOpen(true);
                    setMobileView("director");
                  }}
                >
                  <Icon name="download" size={16} />
                  {t("Export project", "导出项目")}
                </UiButton>
                <span
                  className={`connection ${connected ? "online" : ""}`}
                  role="status"
                >
                  <span className="status-dot" />
                  {connected
                    ? updates.connection === "fallback"
                      ? t("Periodic sync", "定时同步")
                      : t("Synced", "已同步")
                    : t("Connecting…", "连接中…")}
                </span>
              </div>
            </header>
            <div className="mobile-workspace-switch">
              <SegmentedControl.Root
                value={mobileView}
                onValueChange={setMobileView}
                aria-label={t("Workspace panel", "工作区面板")}
              >
                <SegmentedControl.Item value="workspace">
                  {t("Workspace", "工作区")}
                </SegmentedControl.Item>
                <SegmentedControl.Item value="director">
                  {t("Conversation", "对话")}
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </div>
            <div className="studio-body">
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
                      <h2 id="conversation-title">
                        {t("Creative conversation", "创作对话")}
                      </h2>
                    </div>
                    <span className="tag subtle">
                      {director.mode === "fake"
                        ? t("Demo director", "演示助手")
                        : director.mode === "native"
                          ? "Codex"
                          : t("Director disconnected", "未连接助手")}
                    </span>
                  </div>
                  <div
                    className="conversation-tools"
                    aria-label={t("Conversation tools", "对话工具")}
                  >
                    <IconButton
                      icon="edit"
                      label={t("Edit shots and scenes", "编辑镜头与场景")}
                      disabled={!projectId || protectedTool}
                      onClick={() => setEditorOpen((v) => !v)}
                    />
                    <IconButton
                      icon="list"
                      label={t("Import a written plan", "导入文本方案")}
                      disabled={!projectId || protectedTool}
                      onClick={() => setBriefImportOpen((v) => !v)}
                    />
                    <IconButton
                      icon="plus"
                      label={t(
                        "Import image, video or audio",
                        "导入图像、视频或音频",
                      )}
                      disabled={!projectId || protectedTool}
                      onClick={() => setImportOpen((v) => !v)}
                    />
                    <IconButton
                      icon="settings"
                      label={t("Model settings", "模型设置")}
                      disabled={!projectId || protectedTool}
                      onClick={() => setShowDirectorSettings((v) => !v)}
                    />
                    <IconButton
                      icon="folder"
                      label={t("New project", "新建项目")}
                      disabled={recoveryReadOnly || protectedTool}
                      onClick={() => setShowNew((v) => !v)}
                    />
                    <IconButton
                      icon="logout"
                      label={t("Disconnect studio", "断开工作区连接")}
                      disabled={protectedTool}
                      onClick={() =>
                        void Promise.resolve(disconnect()).catch((e) =>
                          setActionError(errorText(e)),
                        )
                      }
                    />
                  </div>
                  {snapshot && (
                    <div className="conversation-scope">
                      <UiSelect
                        aria-label={t("Discussion scope", "讨论范围")}
                        value={
                          selectedShots.length === 1
                            ? selectedShots[0]!
                            : selectedShots.length
                              ? "__selected__"
                              : projectId
                        }
                        disabled={disabled}
                        onValueChange={(value) => {
                          setSelectedShots(value === projectId ? [] : [value]);
                          setDraftContinuation(null);
                        }}
                        options={[
                          {
                            value: projectId,
                            label: t("Whole project", "整个项目"),
                          },
                          ...(selectedShots.length > 1
                            ? [
                                {
                                  value: "__selected__",
                                  label: t(
                                    "{count} selected shots",
                                    "已选择 {count} 个镜头",
                                    { count: selectedShots.length },
                                  ),
                                },
                              ]
                            : []),
                          ...snapshot.project.scenes.flatMap((scene, i) =>
                            snapshot.project.shots
                              .filter((s) => s.sceneId === scene.id)
                              .map((shot, j) => ({
                                value: shot.id,
                                label: t(
                                  "Shot {scene}.{shot} · {purpose}",
                                  "镜头 {scene}.{shot} · {purpose}",
                                  {
                                    scene: i + 1,
                                    shot: j + 1,
                                    purpose: shot.purpose,
                                  },
                                ),
                              })),
                          ),
                        ]}
                      />
                    </div>
                  )}
                  <div
                    ref={conversationScroll}
                    onScroll={(event) => {
                      const e = event.currentTarget;
                      followChat.current =
                        e.scrollHeight - e.scrollTop - e.clientHeight < 120;
                      if (followChat.current) setNewChat(false);
                    }}
                    onClick={(event) => {
                      const anchor = (event.target as HTMLElement).closest("a");
                      const ref = anchor
                        ? parseReferenceLink(anchor.getAttribute("href") ?? "")
                        : null;
                      if (ref) {
                        event.preventDefault();
                        navigateReference({
                          key: referenceKey(
                            ref.projectId,
                            ref.kind,
                            ref.id,
                            ref.sha256,
                          ),
                          projectId: ref.projectId,
                          kind: ref.kind,
                          id: ref.id,
                          label: anchor!.textContent ?? "Project resource",
                        });
                      }
                    }}
                    className="conversation-stream"
                    aria-live="polite"
                    aria-relevant="additions text"
                  >
                    {messages.length === 0 && (
                      <div className="conversation-intro">
                        <span className="small-mark">
                          <Icon name="slate" size={20} />
                        </span>
                        <h3>{t("Start with an idea.", "从一个想法开始。")}</h3>
                        <p>
                          {t(
                            "Talk through your idea here. Choose a shot above to focus the conversation. Your project results stay on the right.",
                            "在这里讨论想法，选择上方的镜头聚焦对话。项目结果始终显示在右侧。",
                          )}
                        </p>
                      </div>
                    )}
                    {director.mode === "fake" && (
                      <div className="demo-disclosure">
                        <span className="tiny-label">
                          {t("Demo mode", "演示模式")}
                        </span>
                        <p>
                          {demoAvailable
                            ? t(
                                "Sample media. Try shot actions to explore production; free conversation does not generate real media.",
                                "使用示例素材。用镜头操作体验制作流程；自由对话不会生成真实媒体。",
                              )
                            : t(
                                "This conversation uses the demo director. Choose Codex in model settings.",
                                "当前对话使用演示助手，可在模型设置中选择 Codex。",
                              )}
                        </p>
                      </div>
                    )}
                    {director.mode === "offline" && (
                      <div className="demo-disclosure">
                        <p>
                          {t(
                            "Your messages are saved. A live director isn’t connected.",
                            "消息已保存，真实导演尚未连接。",
                          )}
                        </p>
                      </div>
                    )}
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className={`message ${message.role}`}
                      >
                        <div className="message-byline">
                          {message.role === "assistant"
                            ? "OpenSlate"
                            : t("You", "你")}
                        </div>
                        <ChatMarkdown
                          text={message.text}
                          messageId={message.id}
                        />
                        {message.state === "failed" && (
                          <small>
                            {t("Response needs attention", "回复需要处理")}
                          </small>
                        )}
                      </article>
                    ))}
                    {pendingMessage && (
                      <article className="message user pending">
                        <div className="message-byline">
                          {t("You", "你")}{" "}
                          <span>
                            {pendingMessage.failed
                              ? t("Not confirmed", "尚未确认")
                              : t("Sending…", "发送中…")}
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
                            {t("Retry this message", "重试此消息")}
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
                        {t("Working on your request", "正在处理请求")}
                      </div>
                    )}
                    {director.message && director.status === "error" && (
                      <div className="inline-error">{director.message}</div>
                    )}
                    <div ref={currentDecision} className="current-decision">
                      {snapshot && (
                        <DirectorPlan
                          onPlan={() => {
                            setTab("plan");
                            setMobileView("workspace");
                          }}
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
                          onScenes={() => {
                            setGenerationHistoryRequest(null);
                            setGenerationOpen(false);
                            setMobileView("director");
                            requestAnimationFrame(() => {
                              sceneDecisions.current?.scrollIntoView({
                                block: "start",
                              });
                              sceneDecisions.current?.focus({
                                preventScroll: true,
                              });
                            });
                          }}
                          onGeneration={() => {
                            setGenerationHistoryRequest(null);
                            setGenerationOpen(true);
                            setMobileView("director");
                          }}
                          onHistory={() => {
                            setGenerationHistoryRequest({
                              projectId,
                              id: crypto.randomUUID(),
                            });
                            setGenerationOpen(true);
                            setTab("frames");
                            setMobileView("director");
                          }}
                          onFrames={() => {
                            setGenerationOpen(false);
                            setTab("frames");
                            setMobileView("workspace");
                          }}
                          onTimeline={() => {
                            setTab("cut");
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
                          aria-label={t("OpenSlate question", "OpenSlate 提问")}
                        >
                          <span className="tiny-label">
                            {question.canAnswer === false
                              ? t("SAVED QUESTION", "已保存的问题")
                              : t("YOUR INPUT NEEDED", "需要你的回答")}
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
                              {t(
                                "This question is saved for reference. Use a fresh conversation to continue when the project is ready.",
                                "此问题已保存供参考。项目就绪后，请通过新对话继续。",
                              )}
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
                                ? t("Replying below", "在下方回答")
                                : t("Answer this question", "回答此问题")}
                            </UiButton>
                          )}
                        </section>
                      ))}
                    </div>
                    <ConversationSurface.Provider value={true}>
                      <ConversationToolBusy.Provider value={registerToolBusy}>
                        <div ref={sceneDecisions} tabIndex={-1}>
                          {snapshot && (
                            <ConversationActions
                              api={api}
                              snapshot={snapshot}
                              director={director}
                              disabled={disabled || !connected}
                              onChanged={refresh}
                              exposedFrames={exposedFrames}
                              reviewedFrames={checkedFrames}
                              onFocusScene={(sceneId) => {
                                setTab("frames");
                                setMobileView("workspace");
                                requestAnimationFrame(() =>
                                  document
                                    .getElementById(
                                      "project-results-scene-" + sceneId,
                                    )
                                    ?.scrollIntoView({ block: "start" }),
                                );
                              }}
                              onNarrationShot={(shotId) => {
                                setAudioShotId(shotId);
                                setMobileView("director");
                              }}
                            />
                          )}
                        </div>
                        <RecoveryPanel
                          api={api}
                          refreshKey={refreshKey}
                          onState={setRecoveryReadOnly}
                          onChanged={refresh}
                        />
                        {(connectionError || actionError) && (
                          <div className="notice error" role="alert">
                            <span>{ui(actionError || connectionError)}</span>
                            <IconButton
                              icon="refresh"
                              label={t("Refresh workspace", "刷新工作区")}
                              onClick={refresh}
                            />
                          </div>
                        )}
                        {pendingAction && (
                          <div className="notice warning">
                            <span>
                              {t(
                                "This action wasn’t confirmed. Retry the same request to check its outcome.",
                                "此操作尚未确认，请重试同一请求以检查结果。",
                              )}
                            </span>
                            <UiButton
                              disabled={recoveryReadOnly || busy}
                              onClick={() => void runAction(pendingAction)}
                            >
                              {t("Retry action", "重试操作")}
                            </UiButton>
                          </div>
                        )}
                        {feedback && (
                          <div className="sr-only" role="status">
                            {ui(feedback)}
                          </div>
                        )}
                        {showNew && (
                          <section className="create-project-panel">
                            <div className="section-heading">
                              <h2>{t("Start a new film", "开始一部新影片")}</h2>
                              <UiButton
                                className="icon-button"
                                aria-label={t(
                                  "Close new project",
                                  "关闭新建项目",
                                )}
                                title={t("Close new project", "关闭新建项目")}
                                onClick={() => setShowNew(false)}
                              >
                                <Icon name="close" />
                              </UiButton>
                            </div>
                            <form
                              className="new-project-form"
                              onSubmit={(event) => void createProject(event)}
                            >
                              <label htmlFor="project-name">
                                {t("Project name", "项目名称")}
                              </label>
                              <UiTextField
                                id="project-name"
                                value={newName}
                                onChange={(event) =>
                                  setNewName(event.target.value)
                                }
                                maxLength={160}
                                placeholder={t("Name your film", "为影片命名")}
                                disabled={disabled || !!pendingCreation}
                                autoFocus
                              />
                              <NewProjectProviderFields
                                api={api}
                                selection={providerSelection}
                                changed={setProviderSelection}
                                disabled={disabled || !!pendingCreation}
                              />
                              <UiButton
                                type="submit"
                                disabled={
                                  disabled ||
                                  (!!projectId && !connected) ||
                                  !newName.trim()
                                }
                                className="button primary"
                              >
                                {creating
                                  ? t("Creating…", "创建中…")
                                  : pendingCreation
                                    ? t(
                                        "Retry same project",
                                        "重试创建同一项目",
                                      )
                                    : t("Create project", "创建项目")}
                              </UiButton>
                            </form>
                          </section>
                        )}
                        <RecoveryReadOnly.Provider
                          value={mutationsDisabled || !connected}
                        >
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
                                requestAnimationFrame(() =>
                                  composer.current?.focus(),
                                );
                              }}
                            />
                          )}
                        </RecoveryReadOnly.Provider>
                        {frameRequest && snapshot && (
                          <RecoveryReadOnly.Provider
                            value={mutationsDisabled || !connected}
                          >
                            <FrameDecision
                              api={api}
                              snapshot={snapshot}
                              director={director}
                              request={frameRequest}
                              disabled={
                                mutationsDisabled || protectedTool || !connected
                              }
                              onChanged={refresh}
                              close={() => setFrameRequest(null)}
                            />
                          </RecoveryReadOnly.Provider>
                        )}
                        <RecoveryReadOnly.Provider
                          value={disabled || !connected}
                        >
                          {musicImportOpen && snapshot && (
                            <ImportMedia
                              title={t("Background music", "背景音乐")}
                              close={() => setMusicImportOpen(false)}
                            >
                              <AudioLibraryPanel
                                api={api}
                                projectId={projectId}
                                onChanged={refresh}
                              />
                              <p className="field-help">
                                {t(
                                  "After uploading, choose it in Export’s background music selector.",
                                  "上传后，在导出工具的背景音乐选项中选择。",
                                )}
                              </p>
                            </ImportMedia>
                          )}
                          {audioShotId && snapshot && (
                            <ImportMedia
                              title={t("Shot narration", "镜头旁白")}
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
                                    ?.find(
                                      (group) => group.requestId === requestId,
                                    )
                                    ?.scopeIds.filter((id) =>
                                      snapshot.project.shots.some(
                                        (shot) => shot.id === id,
                                      ),
                                    ) ?? [audioShotId];
                                  setSelectedShots(
                                    ids.length ? ids : [audioShotId],
                                  );
                                  setDraftContinuation({
                                    projectId,
                                    requestId,
                                  });
                                  setDrafts((all) => ({
                                    ...all,
                                    [projectId]:
                                      "Continue this shot using its accepted narration and update only the affected production plan.",
                                  }));
                                  setAudioShotId(null);
                                  setMobileView("director");
                                  composer.current?.focus();
                                }}
                                onRequested={() => {
                                  setGenerationHistoryRequest(null);
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
                                        setAdvancedAudioOpen(
                                          event.currentTarget.open,
                                        )
                                      }
                                    >
                                      <summary>
                                        {t(
                                          "Advanced narration & transcripts",
                                          "高级旁白与转录",
                                        )}
                                      </summary>
                                      <NarrationPanel
                                        active={
                                          importTab === "audio" &&
                                          advancedAudioOpen
                                        }
                                        api={api}
                                        projectId={projectId}
                                        headVersion={
                                          snapshot.project.headVersion
                                        }
                                        shots={snapshot.project.shots}
                                        directorMode={director.mode}
                                        onChanged={refresh}
                                        onRequested={() => {
                                          setGenerationHistoryRequest(null);
                                          setImportOpen(false);
                                          setGenerationOpen(true);
                                          setTab("frames");
                                        }}
                                      />
                                    </details>
                                  </>
                                }
                              />
                              <AssetActions
                                api={api}
                                snapshot={snapshot}
                                disabled={disabled || !connected}
                                onDiscuss={(artifact) => {
                                  const command = makeImageDiscussion(
                                    projectId,
                                    artifact,
                                    crypto.randomUUID(),
                                  );
                                  setImportOpen(false);
                                  void runAction({
                                    projectId,
                                    path: projectPath(projectId) + "/messages",
                                    body: command.body,
                                    key: command.key,
                                    label:
                                      "Image attached to the conversation.",
                                  });
                                  setMobileView("director");
                                  composer.current?.focus();
                                }}
                              />
                            </ImportMedia>
                          )}

                          {editorOpen && snapshot && (
                            <ImportMedia
                              title={t("Edit project", "编辑项目")}
                              close={() => setEditorOpen(false)}
                            >
                              <ProjectEditor
                                snapshot={snapshot}
                                {...(editorTarget
                                  ? { targetId: editorTarget }
                                  : {})}
                                disabled={disabled || !connected}
                                action={(body) =>
                                  void runAction({
                                    projectId,
                                    path:
                                      projectPath(projectId) + "/storyboard",
                                    body,
                                    key: crypto.randomUUID(),
                                    label: "Project updated.",
                                  })
                                }
                                onNarration={setAudioShotId}
                                onDiscuss={(shotId) => {
                                  setSelectedShots(shotId ? [shotId] : []);
                                  setMobileView("director");
                                  composer.current?.focus();
                                }}
                              />
                            </ImportMedia>
                          )}
                          {briefImportOpen && snapshot && (
                            <ImportMedia
                              title={t("Bring a brief", "导入创作简报")}
                              close={() => setBriefImportOpen(false)}
                            >
                              <PlanImport
                                api={api}
                                snapshot={snapshot}
                                disabled={disabled || !connected}
                                native={director.mode === "native"}
                                action={(path, body, label, key) =>
                                  void runAction({
                                    projectId,
                                    path,
                                    body,
                                    label,
                                    key: key ?? crypto.randomUUID(),
                                  })
                                }
                              />
                            </ImportMedia>
                          )}
                          {exportOpen && snapshot && (
                            <ImportMedia
                              title={t("Export & soundtrack", "导出与配乐")}
                              close={() => setExportOpen(false)}
                            >
                              <MediaPanel
                                api={api}
                                snapshot={snapshot}
                                mode="render"
                                onChanged={refresh}
                              />
                              <ExportDownload api={api} snapshot={snapshot} />
                              <TimelineSettings
                                api={api}
                                snapshot={snapshot}
                                disabled={disabled || !connected}
                                onImportAudio={() => setMusicImportOpen(true)}
                                command={(body) =>
                                  void runAction({
                                    projectId,
                                    path:
                                      projectPath(projectId) + "/storyboard",
                                    body: {
                                      expectedHeadVersion:
                                        snapshot.project.headVersion,
                                      ...body,
                                    },
                                    key: crypto.randomUUID(),
                                    label: "Soundtrack saved.",
                                  })
                                }
                              />
                            </ImportMedia>
                          )}
                          {generationOpen && snapshot && (
                            <GenerationGuide
                              snapshot={snapshot}
                              {...(generationHistoryRequest?.projectId ===
                              projectId
                                ? {
                                    historyRequestId:
                                      generationHistoryRequest.id,
                                  }
                                : {})}
                              onChat={() => composer.current?.focus()}
                              onTimeline={() => {
                                setTab("cut");
                                setMobileView("workspace");
                              }}
                            />
                          )}
                        </RecoveryReadOnly.Provider>
                      </ConversationToolBusy.Provider>
                    </ConversationSurface.Provider>
                    <div ref={chatEnd} />
                  </div>
                  <div className="composer-area">
                    {newChat && (
                      <UiButton
                        size="1"
                        variant="ghost"
                        onClick={() => {
                          followChat.current = true;
                          setNewChat(false);
                          conversationScroll.current?.scrollTo({
                            top: conversationScroll.current.scrollHeight,
                            behavior: "auto",
                          });
                        }}
                      >
                        {t("View new messages", "查看新消息")}
                      </UiButton>
                    )}
                    {replyQuestion && (
                      <div className="scope-chip">
                        <span>
                          {t("Replying to:", "正在回答：")}{" "}
                          {replyQuestion.questions
                            .map((item) => item.header)
                            .join(", ")}
                        </span>
                        <UiButton
                          onClick={() => setReplyQuestionId(null)}
                          aria-label={t(
                            "Cancel question reply",
                            "取消回答问题",
                          )}
                          title={t("Cancel question reply", "取消回答问题")}
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
                          aria-label={t("Clear shot selection", "清除镜头选择")}
                          title={t("Clear shot selection", "清除镜头选择")}
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
                          <span>{t("Try an edit", "尝试调整")}</span>
                          <UiButton
                            disabled={disabled || !connected}
                            onClick={() => demo("close_up")}
                          >
                            {t("Close-up", "特写")}
                          </UiButton>
                          <UiButton
                            disabled={disabled || !connected}
                            onClick={() => demo("wide")}
                          >
                            {t("Wide shot", "广角")}
                          </UiButton>
                        </div>
                      )}
                    {draftContinuation?.projectId === projectId && (
                      <div className="scope-chip">
                        <span>
                          {t("Continuing the saved edit", "继续已保存的编辑")}
                        </span>
                        <IconButton
                          label={t(
                            "Clear saved edit continuation",
                            "取消继续已保存的编辑",
                          )}
                          onClick={() => setDraftContinuation(null)}
                        />
                      </div>
                    )}
                    <form
                      className="studio-message-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void send();
                      }}
                    >
                      <ReferenceComposer
                        api={api}
                        snapshot={snapshot}
                        value={draft}
                        changed={(value) =>
                          setDrafts((all) => ({ ...all, [projectId]: value }))
                        }
                        textareaRef={composer}
                        references={replyQuestion ? [] : referenceDraft}
                        referencesChanged={updateReferences}
                        onNavigate={navigateReference}
                        send={() => void send()}
                        pending={!!pendingMessage}
                        disabled={disabled || !!replyQuestion}
                        placeholder={
                          replyQuestion
                            ? t("Answer the current question…", "回答当前问题…")
                            : selectedShots.length
                              ? t(
                                  "Describe a shot change. Type @ to reference resources…",
                                  "描述这个镜头的调整，输入 @ 引用资源…",
                                )
                              : t(
                                  "Describe your idea. Type @ to reference assets…",
                                  "描述你的想法，输入 @ 引用素材…",
                                )
                        }
                        continuation={
                          continuingEdits > 0 ? (
                            <small className="composer-continuation">
                              {t(
                                continuingEdits === 1
                                  ? "Continue {count} saved edit"
                                  : "Continue {count} saved edits",
                                "继续 {count} 个已保存的编辑",
                                { count: continuingEdits },
                              )}
                            </small>
                          ) : undefined
                        }
                        actions={
                          <>
                            {" "}
                            <IconButton
                              icon="plus"
                              label={t(
                                "Import image, audio or video",
                                "导入图像、音频或视频",
                              )}
                              disabled={disabled}
                              onClick={() => setImportOpen(true)}
                            />
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
                                      ? t("Retry stop", "重试停止")
                                      : t(
                                          "Stop conversation and generation",
                                          "停止对话与生成",
                                        )
                                  }
                                  title={t(
                                    "Stop the conversation and new generation. Submitted provider jobs may still finish.",
                                    "停止对话与新的生成，已提交给服务商的任务仍可能完成。",
                                  )}
                                >
                                  <span aria-hidden="true">■</span>
                                  <span className="sr-only">
                                    {stops[projectId]?.failed
                                      ? t("Retry stop", "重试停止")
                                      : stops[projectId]
                                        ? t("Stopping…", "停止中…")
                                        : t("Stop", "停止")}
                                  </span>
                                </UiButton>
                              )}
                              <UiButton
                                type="submit"
                                className="send-button"
                                disabled={
                                  disabled || !draft.trim() || !snapshot
                                }
                                aria-label={t("Send message", "发送消息")}
                                title={t("Send message", "发送消息")}
                              >
                                <Icon name="arrow" size={18} />
                              </UiButton>
                            </div>
                          </>
                        }
                      />
                    </form>
                  </div>
                </section>
                {split.separator}
                <section
                  id="production-pane"
                  ref={workspaceScroll}
                  className="review-workspace"
                  aria-label={t("Production workspace", "制作工作区")}
                >
                  <div className="workspace-toolbar">
                    <span className="workspace-label">
                      {t("Production workspace", "制作工作区")}
                    </span>
                    <WorkspaceViewTabs value={tab} onChange={setTab} />
                    <span className="film-meta">
                      {durationLabel(totalFrames)}
                    </span>
                  </div>
                  {!projectId ? (
                    <div className="result-empty">
                      <h2>{t("Start a new project", "开始一个新项目")}</h2>
                      <p>
                        {t(
                          "Describe your idea or import reference assets on the left.",
                          "在左侧描述想法或导入参考素材。",
                        )}
                      </p>
                    </div>
                  ) : !snapshot ? (
                    <div className="loading-state">
                      {t("Loading project…", "读取项目…")}
                    </div>
                  ) : (
                    <>
                      <div hidden={tab !== "plan" && tab !== "frames"}>
                        <FrameWorkspace
                          api={api}
                          snapshot={snapshot}
                          view={tab === "plan" ? "plan" : "frames"}
                          active={
                            (tab === "plan" || tab === "frames") &&
                            (!compactScreen || mobileView === "workspace")
                          }
                          disabled={disabled || !connected}
                          selectedShotId={selectedFrameId}
                          onSelectShot={chooseShot}
                          reviewedFrames={checkedFrames}
                          onConfirmFrame={confirmFrame}
                          onEditShot={editTarget}
                          onEditScene={editTarget}
                          onReferenceShot={(id) => addReference("shot", id)}
                          onReferenceScene={(id) => addReference("scene", id)}
                          onInspect={({ url, shot, fixture }) =>
                            frames.inspect(shot, url, fixture)
                          }
                          onFrameExposure={exposeFrame}
                          onGenerateKeyframes={requestFrames}
                          onReviewScene={(id) => setSceneReview(id)}
                          sceneActions={
                            <SceneDecisionFooter
                              api={api}
                              snapshot={snapshot}
                              director={director}
                              sceneId={selectedSceneId}
                              disabled={disabled || !connected}
                              exposedFrames={exposedFrames}
                              reviewedFrames={checkedFrames}
                              onReviewScene={setSceneReview}
                              onGenerateKeyframes={requestFrames}
                            />
                          }
                        />
                      </div>
                      <div hidden={tab !== "assets"}>
                        <AssetLibrary
                          key={projectId}
                          api={api}
                          snapshot={snapshot}
                          active={tab === "assets"}
                          focusArtifactId={assetFocus}
                          onReference={(artifact) => {
                            const ref: StudioReference = {
                              key: referenceKey(
                                projectId,
                                artifact.kind as "image" | "video",
                                artifact.artifactId,
                                artifact.sha256,
                              ),
                              projectId,
                              kind: artifact.kind as "image" | "video",
                              id: artifact.artifactId,
                              label:
                                artifact.kind === "image"
                                  ? "Reference image"
                                  : "Video clip",
                              artifact,
                            };
                            updateReferences(
                              referenceDraft.some((r) => r.key === ref.key)
                                ? referenceDraft
                                : [...referenceDraft, ref],
                            );
                            setMobileView("director");
                            requestAnimationFrame(() =>
                              composer.current?.focus(),
                            );
                          }}
                        />
                        <details className="workspace-audio-assets">
                          <summary>{t("Audio assets", "音频素材")}</summary>
                          <AudioLibraryPanel
                            api={api}
                            projectId={projectId}
                            active={tab === "assets"}
                            readOnly
                            onChanged={refresh}
                            onReference={(recording) => {
                              const ref: StudioReference = {
                                key: referenceKey(
                                  projectId,
                                  "audio",
                                  recording.id,
                                ),
                                projectId,
                                kind: "audio",
                                id: recording.id,
                                label: recording.label,
                                detail:
                                  recording.durationSeconds.toFixed(1) + "s",
                              };
                              updateReferences(
                                referenceDraft.some((r) => r.key === ref.key)
                                  ? referenceDraft
                                  : [...referenceDraft, ref],
                              );
                              setMobileView("director");
                              requestAnimationFrame(() =>
                                composer.current?.focus(),
                              );
                            }}
                          />
                        </details>
                      </div>
                      <div hidden={tab !== "cut"}>
                        <Timeline
                          api={api}
                          snapshot={snapshot}
                          active={tab === "cut"}
                          selectedShotId={selectedFrameId}
                          onSelectShot={chooseShot}
                          disabled={disabled || !connected}
                          command={(body) =>
                            void runAction({
                              projectId,
                              path: projectPath(projectId) + "/storyboard",
                              body: {
                                expectedHeadVersion:
                                  snapshot.project.headVersion,
                                ...body,
                              },
                              key: crypto.randomUUID(),
                              label: "Timeline updated.",
                            })
                          }
                          onEditShot={editTarget}
                          onImportAudio={() => {
                            setMusicImportOpen(true);
                            setMobileView("director");
                          }}
                        />
                      </div>
                    </>
                  )}
                </section>
              </main>
            </div>
          </div>
          {sceneReview && snapshot && (
            <AppDialog
              inline={false}
              open
              title={t("Review scene video plan", "检查场景视频方案")}
              description={t(
                "Use the checked current keyframes and the motion below to create video.",
                "使用已检查的当前关键帧与下列动作制作视频。",
              )}
              preventClose={sceneBusy}
              closeDisabled={sceneBusy}
              onOpenChange={(open) => {
                if (!open) setSceneReview(null);
              }}
              closeLabel={t("Close video plan", "关闭视频方案")}
            >
              <ConversationActions
                api={api}
                snapshot={snapshot}
                director={director}
                disabled={mutationsDisabled || protectedTool || !connected}
                sceneIds={[sceneReview]}
                initialOpenSceneId={sceneReview}
                exposedFrames={exposedFrames}
                reviewedFrames={checkedFrames}
                onChanged={refresh}
                onFocusScene={(id) => {
                  setSceneReview(null);
                  setTab("frames");
                  setMobileView("workspace");
                  const shot = snapshot.project.shots.find(
                    (s) => s.sceneId === id,
                  );
                  if (shot) chooseShot(shot.id);
                }}
                onNarrationShot={(id) => {
                  setSceneReview(null);
                  setAudioShotId(id);
                  setMobileView("director");
                }}
              />
            </AppDialog>
          )}
          {frames.inspection && (
            <Lightbox
              value={frames.inspection}
              returnFocusRef={frames.returnFocus}
              onClose={frames.close}
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
