import { director } from "./catalog/director.ts";
import type { Entry } from "./catalog/entry.ts";
import { errors } from "./catalog/errors.ts";
import { keyframes } from "./catalog/keyframes.ts";
import { narrationMessages } from "./catalog/narration.ts";
import { notes } from "./catalog/notes.ts";
import { assetsMessages } from "./catalog/assets.ts";
import { filmMessages } from "./catalog/film.ts";
import { planMessages } from "./catalog/plan.ts";
import { settingsMessages } from "./catalog/settings.ts";
import { startMessages } from "./catalog/start.ts";
import { shell } from "./catalog/shell.ts";
import { castMessages } from "./catalog/cast.ts";

/** Every message id of the next UI. Add ids to the catalog file of their area. */
export const catalog = { ...shell, ...keyframes, ...director, ...notes, ...planMessages, ...filmMessages, ...assetsMessages, ...settingsMessages, ...startMessages, ...narrationMessages, ...castMessages, ...errors } satisfies Record<string, Entry>;
export type MessageId = keyof typeof catalog;

export function isMessageId(value: string): value is MessageId {
  return Object.hasOwn(catalog, value);
}
