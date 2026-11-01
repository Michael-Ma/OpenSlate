import type { ProjectRecord } from "@openslate/core";
import type { AssetItem, AssetRole } from "@openslate/core/public";
import type { Store } from "../persistence/store.js";
import type { CodePlanChoice, CodePlanRun, CodePlanStep } from "./records.js";
import { codePlanShotLinks } from "./projection.js";
import { codePlanArtifacts, object, pictureSize, publicArtifact } from "./artifacts.js";
import { audioLibraryRole, type AudioLabel } from "../narration/audio-library-role.js";
import type { NarrationAudio } from "../narration/types.js";
import type { SuppliedDocumentArtifact } from "../media/document-application.js";

const roles: Record<CodePlanStep["kind"], AssetRole> = { image: "keyframe", video: "clip", speech: "voice", music: "music", render: "export" };
const image = (value: unknown) => { const ref = object(object(value).artifact ?? value); return ref.kind === "image" ? ref : {}; };
const sameImage = (value: unknown, ref: CodePlanStep["input"]) => {
  const option = image(value);
  return option.sha256 === ref.sha256 && (option.artifactId === undefined || option.artifactId === ref.artifactId);
};

/** Code films have no graph bindings or storyboard shots. Keep all joins within their own journal. */
export function codePlanAssets(store: Store, project: ProjectRecord): AssetItem[] {
  const projectId = project.id, media = codePlanArtifacts(store, projectId);
  const steps = store.list<CodePlanStep>("code_plan_step", projectId), choices = store.list<CodePlanChoice>("code_plan_choice", projectId);
  const run = store.get<CodePlanRun>("code_plan_run", projectId), reached = new Set(run?.reachedStepKeys ?? []);
  const links = codePlanShotLinks(steps, choices), shots = new Map((run?.declarations.shots ?? []).map(shot => [shot.id, shot]));
  const scenes = new Map((run?.declarations.scenes ?? []).map(scene => [scene.id, scene]));
  const produced = new Map(steps.filter(step => step.state === "succeeded" && step.result?.ok)
    .flatMap(step => step.result?.ok ? [step.result.artifact, ...step.result.artifacts].map(ref => [ref.artifactId, step] as const) : []));
  const videoFrames = new Set(steps.filter(step => step.kind === "video" && reached.has(step.key)).map(step => object(step.input.firstFrame).sha256));
  const labels = new Map(store.list<AudioLabel>("audio_library_label", projectId).map(row => [row.id, row]));
  const metadata = new Map(store.list<{ id: string; createdAt: string }>("asset_metadata", projectId).map(row => [row.id, row.createdAt]));
  const audio = new Map(store.list<NarrationAudio>("narration_audio", projectId).map(row => [row.id, row]));
  const firstEvent = store.readEvents(projectId)[0]?.occurredAt ?? new Date(0).toISOString();
  const counts = new Map<string, number>(), items: AssetItem[] = [];
  for (const record of media.records) {
    if (media.posterIds.has(record.id) || !["image", "video", "audio", "document"].includes(record.artifact.kind)) continue;
    const step = produced.get(record.id), recording = audio.get(record.id), shotId = step ? links.get(step.key) : undefined;
    const shot = shotId ? shots.get(shotId) : undefined, sceneId = typeof shot?.sceneId === "string" ? shot.sceneId : undefined;
    const scene = sceneId ? scenes.get(sceneId) : undefined;
    const role: AssetRole = step ? roles[step.kind] : record.artifact.kind === "document" ? "document"
      : recording ? audioLibraryRole(project, recording, labels.get(record.id))
      : record.origin === "supplied_image" || record.origin === "supplied_video" ? "upload"
      : record.origin === "local_render" ? "export" : record.artifact.kind === "image" ? "keyframe" : record.artifact.kind === "video" ? "clip" : "voice";
    const group = `${shotId ?? ""}:${role}`, numbered = role === "keyframe" || role === "clip", takeIndex = (counts.get(group) ?? 0) + 1;
    if (numbered) counts.set(group, takeIndex);
    const ref = record.artifact, frameChoices = step?.kind === "image" ? choices.filter(choice => choice.options.some(option => sameImage(option, { ...ref }))) : [];
    const current = !!step && reached.has(step.key) && (step.kind !== "image" || frameChoices.length === 0
      || frameChoices.some(choice => sameImage(choice.answer, { ...ref })) || videoFrames.has(ref.sha256));
    const poster = media.posters.get(record.id), size = pictureSize(ref.kind === "image" ? record : poster);
    const document = role === "document" ? record as SuppliedDocumentArtifact : undefined;
    const label = document ? `${document.name}${document.pages !== undefined ? ` · ${document.pages} ${document.pages === 1 ? "page" : "pages"}` : ""}`
      : (role === "upload" ? record.name : undefined) ?? labels.get(record.id)?.label
        ?? (role === "export" ? `${record.fixture ? "Demo export" : "Export"} · ${project.name}`
          : `${String(scene?.title || scene?.purpose || project.name)}${shot ? ` · ${String(shot.purpose || shot.id)}` : ""} · ${role}${numbered ? ` ${takeIndex}` : ""}`);
    items.push({ artifact: publicArtifact(ref), role, ...(step ? { stepKey: step.key } : {}), ...(shotId ? { shotId } : {}), ...(sceneId ? { sceneId } : {}),
      ...(numbered ? { takeIndex } : {}), current, source: record.fixture ? "demo" : role === "upload" || role === "document" || recording && !("originEvidence" in recording) ? "imported" : "generated",
      label, createdAt: metadata.get(`artifact:${record.id}`) ?? step?.createdAt ?? firstEvent,
      ...(record.physicalDurationSeconds !== null ? { durationSeconds: record.physicalDurationSeconds } : {}), ...size,
      ...(poster && (role === "clip" || role === "export") ? { poster: publicArtifact(poster.artifact) } : {}) });
    audio.delete(record.id);
  }
  for (const recording of audio.values()) {
    const role = audioLibraryRole(project, recording, labels.get(recording.id));
    items.push({ artifact: { artifactId: recording.id, sha256: recording.media.sha256, kind: "audio" }, role,
      current: project.soundtrack?.audioId === recording.id, source: "originEvidence" in recording ? "generated" : "imported",
      label: labels.get(recording.id)?.label ?? (role === "voice" ? "Voice line" : "Uploaded audio"),
      createdAt: metadata.get(`narration_audio:${recording.id}`) ?? firstEvent,
      ...(recording.media.probe?.audio?.samples ? { durationSeconds: recording.media.probe.audio.samples / 48000 } : {}) });
  }
  return items.reverse();
}
