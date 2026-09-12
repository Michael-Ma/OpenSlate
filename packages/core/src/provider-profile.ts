import { digest, invariant } from "./common.js";
import type { JsonObject, ProviderProfile } from "./contracts.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const privateKey = /secret|token|password|credential|authorization|api.?key|headers?|endpoint|url|path|^env$/i;
function configuration(value: unknown): asserts value is NonNullable<ProviderProfile["configuration"]> {
  invariant(plain(value) && Object.keys(value).every(key => ["model", "settings"].includes(key))
    && typeof value.model === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.model) && !/^[a-z]+:\/\//i.test(value.model)
    && (value.settings === undefined || plain(value.settings)), "PROFILE_CONFIGURATION_INVALID", "Pin a model and bounded non-secret settings");
  let entries = 0, bytes = 0;
  const visit = (item: unknown, depth: number): void => {
    invariant(++entries <= 256 && depth <= 6, "PROFILE_CONFIGURATION_INVALID", "Profile settings exceed structural limits");
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item);
      invariant(item.length <= 512 && !/[\u0000-\u001f\u007f]/.test(item) && !/^(?:[a-z]+:\/\/|\/|~\/)/i.test(item), "PROFILE_CONFIGURATION_INVALID", "Settings cannot contain host locations or URLs");
    } else if (item === null || typeof item === "boolean") bytes += 8;
    else if (typeof item === "number") invariant(Number.isFinite(item), "PROFILE_CONFIGURATION_INVALID", "Settings require finite numbers");
    else if (Array.isArray(item)) { invariant(item.length <= 64, "PROFILE_CONFIGURATION_INVALID", "Settings array exceeds its bound"); item.forEach(value => visit(value, depth + 1)); }
    else {
      invariant(plain(item) && Object.keys(item).length <= 64, "PROFILE_CONFIGURATION_INVALID", "Settings require bounded plain JSON objects");
      for (const [key, child] of Object.entries(item)) {
        invariant(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) && !privateKey.test(key) && !["constructor", "prototype"].includes(key),
          "PROFILE_CONFIGURATION_INVALID", "Credentials and host configuration do not belong in a profile");
        bytes += key.length; visit(child, depth + 1);
      }
    }
    invariant(bytes <= 8192, "PROFILE_CONFIGURATION_INVALID", "Profile settings exceed their byte limit");
  };
  if (value.settings !== undefined) visit(value.settings, 0);
  invariant(Buffer.byteLength(JSON.stringify(value)) <= 8192, "PROFILE_CONFIGURATION_INVALID", "Profile configuration exceeds its encoded byte limit");
}

/** Preserve exact legacy compiler arguments. New bindings are part of review/cache identity. */
export function providerProfileArguments(profile: ProviderProfile): JsonObject {
  invariant(profile && [profile.id, profile.revision, profile.adapter].every(value => typeof value === "string" && ID.test(value)), "PROFILE_INCOMPATIBLE", "Invalid profile identity");
  const base = { profileRevision: profile.revision, profileIdentity: profile.id, adapter: profile.adapter };
  if (profile.adapter === "fake" && profile.executionVersion === undefined && profile.configuration === undefined) return base;
  invariant(typeof profile.executionVersion === "string" && ID.test(profile.executionVersion), "PROFILE_INCOMPATIBLE", "New profiles must pin an execution contract version");
  configuration(profile.configuration);
  const pinned = structuredClone(profile.configuration);
  return { ...base, executionVersion: profile.executionVersion, profileConfiguration: pinned as unknown as JsonObject,
    profileDigest: digest({ id: profile.id, revision: profile.revision, kind: profile.kind,
      execution: { adapter: profile.adapter, version: profile.executionVersion }, configuration: pinned }) };
}
