import { invariant } from "@openslate/core";

export const uploadNameSchema = { type: "string", minLength: 1, maxLength: 120, pattern: "^[^\\u0000-\\u001f\\u007f/\\\\]+$" };

/** Optional display metadata, never a managed file path. Preserve it exactly in request identities. */
export function validateUploadName(name: unknown): void {
  invariant(name === undefined || (typeof name === "string" && [...name].length >= 1 && [...name].length <= 120 && !/[\u0000-\u001f\u007f/\\]/.test(name)),
    "VALIDATION_ERROR", "Choose a file name of 1 to 120 characters without control characters or slashes");
}
