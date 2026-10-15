import type { Artifact, MessageCommand, ProjectSnapshot } from "./model.ts";
import { continueStoppedWork, makeMessageCommand } from "./model.ts";
export type ReferenceKind =
  | "project"
  | "scene"
  | "shot"
  | "image"
  | "video"
  | "audio";
export interface StudioReference {
  key: string;
  projectId: string;
  kind: ReferenceKind;
  id: string;
  label: string;
  detail?: string;
  artifact?: Artifact;
}
export function referenceKey(
  projectId: string,
  kind: ReferenceKind,
  id: string,
  hash = "",
) {
  return JSON.stringify([projectId, kind, id, hash]);
}
export function referenceLink(ref: StudioReference) {
  return (
    "#openslate-ref/" +
    [ref.projectId, ref.kind, ref.id, ref.artifact?.sha256 ?? ""]
      .map(encodeURIComponent)
      .join("/")
  );
}
export function parseReferenceLink(hash: string): {
  projectId: string;
  kind: ReferenceKind;
  id: string;
  sha256: string;
} | null {
  if (!hash.startsWith("#openslate-ref/")) return null;
  try {
    const parts = hash.slice(15).split("/").map(decodeURIComponent);
    if (
      parts.length !== 4 ||
      !parts[0] ||
      !parts[2] ||
      !["project", "scene", "shot", "image", "video", "audio"].includes(
        parts[1]!,
      )
    )
      return null;
    return {
      projectId: parts[0]!,
      kind: parts[1] as ReferenceKind,
      id: parts[2]!,
      sha256: parts[3]!,
    };
  } catch {
    return null;
  }
}
export function mentionAt(text: string, cursor = text.length) {
  const prefix = text.slice(0, Math.max(0, Math.min(cursor, text.length))),
    match = /(?:^|\s)@([^@\n]{0,100})$/.exec(prefix);
  if (!match) return null;
  return {
    start: prefix.length - match[1]!.length - 1,
    end: prefix.length,
    query: match[1]!,
  };
}
export function consumeMention(
  text: string,
  range: ReturnType<typeof mentionAt>,
) {
  return range ? text.slice(0, range.start) + text.slice(range.end) : text;
}
export function projectReferences(
  snapshot: ProjectSnapshot,
): StudioReference[] {
  const p = snapshot.project;
  return [
    {
      key: referenceKey(p.id, "project", p.id),
      projectId: p.id,
      kind: "project",
      id: p.id,
      label: p.name,
      detail: "整个项目",
    },
    ...p.scenes.flatMap((s, i) => [
      {
        key: referenceKey(p.id, "scene", s.id),
        projectId: p.id,
        kind: "scene" as const,
        id: s.id,
        label: `Scene ${String(i + 1).padStart(2, "0")}`,
        detail: s.purpose,
      },
      ...p.shots
        .filter((x) => x.sceneId === s.id)
        .map((x, j) => ({
          key: referenceKey(p.id, "shot", x.id),
          projectId: p.id,
          kind: "shot" as const,
          id: x.id,
          label: `Shot ${i + 1}.${j + 1}`,
          detail: x.purpose,
        })),
    ]),
  ];
}
function safeLabel(label: string) {
  return label.replace(/[\\\[\]\r\n]/g, " ").slice(0, 180);
}
export function makeReferencedMessage(
  project: ProjectSnapshot["project"],
  draft: string,
  selected: readonly string[],
  references: readonly StudioReference[],
  key: string,
  editing: boolean,
  attachImages: boolean,
): MessageCommand {
  if (references.length > 12) throw Error("一次最多引用 12 个项目对象。");
  const scopes: string[] = [];
  let whole = false;
  for (const r of references) {
    if (r.projectId !== project.id)
      throw Error("引用来自另一个项目，请重新选择。");
    if (r.kind === "project") {
      if (r.id !== project.id) throw Error("项目引用已失效。");
      whole = true;
    } else if (r.kind === "scene") {
      if (!project.scenes.some((s) => s.id === r.id))
        throw Error("引用的场景已移除。");
      scopes.push(r.id);
    } else if (r.kind === "shot") {
      if (!project.shots.some((s) => s.id === r.id))
        throw Error("引用的镜头已移除。");
      scopes.push(r.id);
    } else if (
      !r.id ||
      (r.artifact &&
        (!/^[a-f0-9]{64}$/.test(r.artifact.sha256) ||
          r.artifact.artifactId !== r.id ||
          r.artifact.kind !== r.kind))
    )
      throw Error("素材引用已失效。");
  }
  const scopeIds = whole
    ? [project.id]
    : scopes.length
      ? [...new Set(scopes)]
      : selected.length
        ? [...selected]
        : [project.id];
  const text =
    (references.length
      ? references
          .map((r) => `[@${safeLabel(r.label)}](${referenceLink(r)})`)
          .join(" ") + "\n\n"
      : "") + draft.trim();
  const command = makeMessageCommand(project, text, selected, key, editing);
  const images = attachImages
    ? references
        .filter((r) => r.kind === "image" && r.artifact)
        .map((r) => ({
          artifactId: r.artifact!.artifactId,
          sha256: r.artifact!.sha256,
        }))
    : [];
  if (images.length > 4)
    throw Error("一次最多附带 4 张图片，其余素材可通过项目引用讨论。");
  return {
    ...command,
    body: { ...command.body, scopeIds, ...(images.length ? { images } : {}) },
  };
}

/** A referenced narrow edit cannot silently become a project-wide resume. */
export function continueReferencedWork(
  command: MessageCommand,
  control: ProjectSnapshot["control"],
) {
  if (
    control?.paused &&
    "scopeIds" in command.body &&
    !command.body.scopeIds.includes(command.projectId)
  )
    throw Error("制作已暂停。先清除镜头与场景引用，或显式引用整个项目后继续。");
  return continueStoppedWork(command, control);
}

/** Replying to a question disables mentions without disabling submission of the reply itself. */
export function composerEnterAction(input: {
  disabled: boolean;
  pending: boolean;
  allowReferences: boolean;
  pickerOpen: boolean;
  hasOption: boolean;
  modified: boolean;
}): "choose" | "send" | "none" {
  if (input.pending) return "none";
  if (
    input.allowReferences &&
    input.pickerOpen &&
    input.hasOption &&
    !input.modified
  )
    return "choose";
  return input.disabled ? "none" : "send";
}
