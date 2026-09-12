export interface Artifact { artifactId: string; sha256: string; kind: "image" | "video" | "audio" | "data" }
export interface Shot { id: string; revisionId: string; sceneId: string; purpose: string; action: string; framing: string; motion: string; desiredFrames: number; imagePrompt: string; videoPrompt: string; cueId: string | null }
export interface ProjectSummary { id: string; name: string; headVersion: number; activePlanId: string | null; shotCount?: number }
export interface ConversationMessage { id: string; role: "user" | "assistant"; text: string; state?: string; requestId?: string }
export interface PendingQuestion { id: string; requestId: string; state: "pending" | "answered"; questions: { id: string; header: string; question: string; options: { label: string; description: string }[] }[]; answerRequestId?: string }
export interface ProjectSnapshot {
  project: ProjectSummary & { revisionId: string; brief: string; story: string; shots: Shot[]; scenes: { id: string; revisionId: string; purpose: string }[]; narration: { script: string; source: string }; cues: { id: string; meaning: string; accepted: boolean; measured: boolean }[] };
  messages: { id: string; text: string; state?: string; requestId?: string }[];
  conversation?: ConversationMessage[];
  questions?: PendingQuestion[];
  previousPreviews?: { artifact: Artifact; nodeId: string; fixture: boolean }[];
  outputs: { nodeId: string; candidateId: string | null; port: string; artifact: Artifact; fixture: boolean }[];
  attempts: { id: string; nodeId: string; phase: string; createdAt?: string }[];
  holds: { id: string; scopeId: string; ownerId: string; active: boolean }[];
  control?: { paused: boolean };
  plan?: { id: string; graphDigest: string; canonicalSource: string; nodes?: { id: string; kind: string; alias: string; shotId: string | null }[] } | null;
  workflow?: { narration?: { inputState?: string } };
  cursor: number;
}
export interface ReviewMember { videoNodeId: string; shotId: string; keyframe: Artifact | null; approvalDigest: string | null; ready: boolean; approved?: boolean; motionPrompt?: string; durationFrames?: number; profileLabel?: string }
export interface ReviewSnapshot { id: string | null; planId: string | null; projectId?: string; headVersion: number; revisionId: string; members: ReviewMember[] }
export interface DirectorStatus { mode: "offline" | "fake" | "native"; status: "idle" | "running" | "waiting_user" | "error" | "not_connected"; message?: string; activeRequestId?: string | null }
export type MessageBody = { text: string; scopeIds: string[]; editing: boolean; continuationRequestId?: string } | { text: string; replyToQuestionId: string };
export interface MessageCommand { key: string; projectId: string; body: MessageBody }

export function makeMessageCommand(project: ProjectSnapshot["project"], draft: string, selectedIds: readonly string[], key: string, editing = true): MessageCommand {
  const text = draft.trim();
  if (!text || text.length > 16000) throw new Error("Write a message of up to 16,000 characters.");
  if (!key) throw new Error("The message needs a retry identity.");
  const scopeIds = [...new Set(selectedIds)];
  if (scopeIds.some(id => !project.shots.some(shot => shot.id === id))) throw new Error("A selected shot changed. Refresh and select it again.");
  return { key, projectId: project.id, body: { text, scopeIds: scopeIds.length ? scopeIds : [project.id], editing } };
}
export function makeQuestionReply(projectId: string, question: PendingQuestion, draft: string, key: string): MessageCommand {
  const text = draft.trim();
  if (question.state !== "pending") throw new Error("That question has already been answered. Refresh to continue.");
  if (!text || text.length > 16000 || !key) throw new Error("Write an answer of up to 16,000 characters.");
  return { projectId, key, body: { text, replyToQuestionId: question.id } };
}
export function previewOutput(snapshot: ProjectSnapshot) {
  const render = snapshot.plan?.nodes?.find(node => node.kind === "render");
  const current = snapshot.outputs.find(output => output.nodeId === render?.id && output.artifact.kind === "video");
  if (current) return { artifact: current.artifact, previous: false };
  const previous = snapshot.previousPreviews?.find(output => output.artifact.kind === "video");
  return previous ? { artifact: previous.artifact, previous: true } : null;
}
export function reviewIdentity(review: ReviewSnapshot | null): string {
  if (!review) return "none";
  return JSON.stringify({ planId: review.planId, headVersion: review.headVersion, revisionId: review.revisionId,
    members: review.members.map(member => ({ videoNodeId: member.videoNodeId, shotId: member.shotId, sha256: member.keyframe?.sha256 ?? null,
      artifactId: member.keyframe?.artifactId ?? null, approvalDigest: member.approvalDigest, ready: member.ready, approved: member.approved ?? false,
      motionPrompt: member.motionPrompt ?? null, durationFrames: member.durationFrames ?? null, profileLabel: member.profileLabel ?? null })).sort((a, b) => a.videoNodeId.localeCompare(b.videoNodeId)) });
}
export function reviewMatchesProject(review: ReviewSnapshot | null, snapshot: ProjectSnapshot | null): boolean {
  return !!review && !!snapshot && review.planId === snapshot.project.activePlanId && review.headVersion === snapshot.project.headVersion && review.revisionId === snapshot.project.revisionId;
}
export function approvalPayload(review: ReviewSnapshot, selected: readonly string[], displayed: Readonly<Record<string, string>>, expectedIdentity: string) {
  if (!review.id || reviewIdentity(review) !== expectedIdentity) throw new Error("The storyboard changed. Review the refreshed frames before approving.");
  const ids = [...new Set(selected)];
  if (!ids.length || ids.length !== selected.length) throw new Error("Select the displayed keyframes you want to approve.");
  for (const id of ids) {
    const member = review.members.find(item => item.videoNodeId === id);
    if (!member?.ready || !member.keyframe || !member.approvalDigest || member.approved || displayed[id] !== member.keyframe.sha256 || !member.motionPrompt || !member.durationFrames || !member.profileLabel) {
      throw new Error("Only current, displayed keyframes with their motion plan can be approved.");
    }
  }
  return { snapshotId: review.id, videoNodeIds: ids };
}
export function conversation(snapshot: ProjectSnapshot | null): ConversationMessage[] {
  if (!snapshot) return [];
  return snapshot.conversation ?? snapshot.messages.map(message => ({ id: message.id, role: "user", text: message.text, ...(message.state ? { state: message.state } : {}) }));
}
export function durationLabel(frames: number): string {
  const seconds = Math.max(0, Math.round(frames / 30));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function pollingDelay(failures: number, hidden = false): number { return Math.min(30000, Math.max(hidden ? 15000 : 4000, 2000 * 2 ** Math.min(4, Math.max(0, failures)))); }
export function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Your local access token was rejected. Reconnect with the current token.",
    REVISION_CONFLICT: "This project changed while you were working. Refresh to continue with its latest state.",
    HUMAN_REVIEW_REQUIRED: "The video is waiting for approval of its exact keyframe and motion plan.",
    REVIEW_STALE: "These frames have changed. Refresh the storyboard and review the new version.",
    REVIEW_MISMATCH: "The review no longer matches the current shot. Refresh before approving.",
    STALE_REVIEW: "The review no longer matches the current shot. Refresh before approving.",
    NOT_FOUND: "That item is no longer available. Refresh the project.",
    ORIGIN_NOT_AUTHORIZED: "This action needs a current human generation allowance.",
    EPOCH_REVOKED: "A newer request replaced this action. Refresh to continue.",
    QUESTION_STALE: "That question is no longer waiting for an answer. Refresh to see the current conversation.",
    ARTIFACT_CHANGED: "The preview bytes changed. Refresh before reviewing this frame.",
    ARTIFACT_TOO_LARGE: "This preview is too large to load here.",
    NETWORK_ERROR: "The local server is unreachable. Your draft and last view are still here.",
  };
  return messages[code] ?? "The local server could not complete that action. Refresh and try again.";
}
export function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join(""); }
