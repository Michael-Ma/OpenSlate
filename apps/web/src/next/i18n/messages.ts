import { director } from "./catalog/director.ts";
import type { Entry } from "./catalog/entry.ts";
import { errors } from "./catalog/errors.ts";
import { keyframes } from "./catalog/keyframes.ts";
import { shell } from "./catalog/shell.ts";

/** Every message id of the next UI. Add ids to the catalog file of their area. */
export const catalog = { ...shell, ...keyframes, ...director, ...errors } satisfies Record<string, Entry>;
export type MessageId = keyof typeof catalog;

export function isMessageId(value: string): value is MessageId {
  return Object.hasOwn(catalog, value);
}
