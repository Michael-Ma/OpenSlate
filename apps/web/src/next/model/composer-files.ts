import type { DirectorAttachmentRef } from "@openslate/core/public";
import { formatBytes, type ImportKind } from "./assets-import.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Files the person sends with a Director message (attach, drop or paste). Each is saved to the film's Assets first,
 * through the same upload routes as Import, and then named in the message as an attachment. Pure; the composer's
 * upload hook runs the transfers and the store keeps the list.
 */

/** The studio takes up to eight attachments on one message, pictures shown to the Director included. */
export const MAX_ATTACHMENTS = 8;

export interface ComposerFile {
  /** Local identity of this chip (not the artifact): a file dropped twice is two chips until one is removed. */
  key: string;
  name: string;
  kind: ImportKind;
  size: number;
  state: "uploading" | "ready" | "failed";
  /** Bytes sent so far while uploading; equal to size while the studio checks the file. */
  loaded: number;
  /** The stored file, once the studio saved it. */
  ref?: DirectorAttachmentRef;
  /** Why it could not be saved. */
  refusal?: Msg;
  /** A small picture of an image, read in the browser (not kept in drafts). */
  preview?: string;
}

export const readyRefs = (files: readonly ComposerFile[] = []): DirectorAttachmentRef[] =>
  files.flatMap((file) => (file.state === "ready" && file.ref ? [{ artifactId: file.ref.artifactId, sha256: file.ref.sha256 }] : []));

/** The chip's second line: what it is and how big, how far the upload got, or why it failed. */
export function fileStatus(file: ComposerFile): Msg {
  if (file.state === "failed") return file.refusal ?? msg("director.file.failed");
  if (file.state === "uploading")
    return file.loaded >= file.size ? msg("director.file.checking") : msg("director.file.sending", { percent: Math.floor((file.loaded / Math.max(1, file.size)) * 100) });
  return msg(`director.file.kind.${file.kind}` as const, { size: formatBytes(file.size) });
}

/**
 * Why Send waits or is held: files still uploading (it waits, the words stay), a file that failed (remove it or
 * send without it), or more attachments than one message takes. Null when the files allow sending.
 */
export function filesProblem(files: readonly ComposerFile[] = [], pictureCount = 0): { reason: Msg; waiting: boolean } | null {
  const uploading = files.filter((file) => file.state === "uploading").length;
  if (uploading) return { reason: msg("director.file.waiting", { count: uploading }), waiting: true };
  if (files.some((file) => file.state === "failed")) return { reason: msg("director.file.remove_failed"), waiting: false };
  const total = files.length + pictureCount;
  if (total > MAX_ATTACHMENTS) return { reason: msg("director.file.too_many", { max: MAX_ATTACHMENTS, count: total }), waiting: false };
  return null;
}

/** How many more files fit next to the ones already there and the pictures shown. */
export const roomFor = (files: readonly ComposerFile[] = [], pictureCount = 0): number => Math.max(0, MAX_ATTACHMENTS - files.length - pictureCount);

/** The composer once a message was sent: the files that went with it leave, a file added meanwhile stays. */
export const filesAfterSend = (files: readonly ComposerFile[] = [], sent: readonly ComposerFile[] = []): ComposerFile[] => {
  const gone = new Set(sent.map((file) => file.key));
  return files.filter((file) => !gone.has(file.key));
};

/** Files from a drop or a paste: only real files (a dragged link or text is not one). */
export function droppedFiles(items: { kind: string; getAsFile(): File | null }[] | null, files: ArrayLike<File> | null): File[] {
  const fromItems = (items ?? []).flatMap((item) => (item.kind === "file" ? [item.getAsFile()].filter((file): file is File => !!file) : []));
  return fromItems.length ? fromItems : Array.from(files ?? []);
}
