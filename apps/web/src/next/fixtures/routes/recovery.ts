import { ApiError, type RequestOptions } from "../../api/client.ts";
import { RECOVERY_PATH, RELEASE_PATH, type RecoveryCounts, type RecoveryStatus, type ReleaseBody } from "../../model/recovery.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { DECLINE, type Decline } from "./types.ts";

/**
 * The installation's recovery review in the sample studio. The sample studio is never really restored: a `?recovery=` preset makes it look as if it had just been restored from a backup.
 *
 * - `quarantined`: in review. Reads work, every other request is refused with INSTALLATION_QUARANTINED (as the
 *   server does), the film is stopped under the restore's authority, and Finish recovery review releases it.
 * - `lost-reply`: as quarantined, but the connection drops on the first release before it reaches the studio, so its
 *   outcome is unknown to the page and the review stays in place: only Retry recovery decision (the same
 *   Idempotency-Key and body) finishes it. A release that was applied and then lost answers a resend with the same key
 *   with the saved release, and another key with RECOVERY_ALREADY_RELEASED, as the server does.
 * - `stale`: as quarantined, but one uncertain job resolves just before the first release, so the summary the person
 *   saw is out of date and the release is refused (RECOVERY_CONFLICT) until they look again.
 * - `released`: the review was finished in an earlier visit; the film is still stopped by the restore.
 *
 * Without a preset the studio is ordinary. Called first for every request (fixture-port.ts), because the release
 * needs its Idempotency-Key and the refusal must cover every write, the Director's messages included.
 */

export const RESTORE_ID = "restore-2026-10-14";
const BACKUP_CREATED_AT = "2026-10-14T18:20:00.000Z";
const RESTORED_AT = "2026-10-15T08:05:00.000Z";

type Preset = "quarantined" | "lost-reply" | "stale" | "released";
const PRESETS = new Set<string>(["quarantined", "lost-reply", "stale", "released"]);

interface RecoveryFixture {
  state: RecoveryStatus["state"];
  counts: RecoveryCounts;
  /** The release that finished the review: its key and body (a resend with them gets the same answer). */
  release: { key: string; body: ReleaseBody; releasedAt: string } | null;
  dropsFirstRelease: boolean;
  changesOnce: boolean;
}

const states = new WeakMap<FixtureWorld, RecoveryFixture>();

/** The `?recovery=` preset of the page (null in tests and normal use). */
export function recoveryPreset(): Preset | null {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? "").get("recovery");
    return value && PRESETS.has(value) ? (value as Preset) : null;
  } catch {
    return null;
  }
}

/** A 64-character lowercase hex stand-in for the server's digests (FNV-1a, eight salts). */
function hex(seed: string): string {
  let out = "";
  for (let salt = 0; salt < 8; salt++) {
    let hash = 0x811c9dc5 ^ salt;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += hash.toString(16).padStart(8, "0");
  }
  return out;
}

const COUNTS: RecoveryCounts = { projects: 1, knownJobs: 2, unknownJobs: 1, nativeRequests: 1, unusedAllowances: 0, preparingJobs: 1 };

/** Make the sample studio look restored (or not); tests call it directly, the page through the `?recovery=` preset. */
export function setFixtureRecovery(world: FixtureWorld, preset: Preset | null): RecoveryFixture {
  const fixture: RecoveryFixture = {
    state: preset === null ? "ordinary" : preset === "released" ? "released" : "quarantined",
    counts: preset === null ? { projects: 0, knownJobs: 0, unknownJobs: 0, nativeRequests: 0, unusedAllowances: 0, preparingJobs: 0 } : { ...COUNTS },
    release: null,
    dropsFirstRelease: preset === "lost-reply",
    changesOnce: preset === "stale",
  };
  if (preset === "released") fixture.release = { key: "earlier-visit", body: releaseFor(fixture), releasedAt: RESTORED_AT };
  states.set(world, fixture);
  if (preset !== null) {
    // The restore stopped every film under its own authority; Continue is up to the person after the review.
    world.overview = { ...world.overview, stopped: { stopId: RESTORE_ID, at: RESTORED_AT, sentJobs: 0, detachedJobs: 0 }, controlAuthorityId: RESTORE_ID };
    world.snapshot = { ...world.snapshot, control: { paused: true, authorityId: RESTORE_ID } };
  }
  return fixture;
}

function recoveryOf(world: FixtureWorld): RecoveryFixture {
  return states.get(world) ?? setFixtureRecovery(world, recoveryPreset());
}

const RECEIPT_DIGEST = hex(`receipt:${RESTORE_ID}`);
const summaryDigest = (fixture: RecoveryFixture) => hex(`summary:${RECEIPT_DIGEST}:${JSON.stringify(fixture.counts)}`);

function releaseFor(fixture: RecoveryFixture): ReleaseBody {
  return { restoreId: RESTORE_ID, expectedReceiptDigest: RECEIPT_DIGEST, expectedSummaryDigest: summaryDigest(fixture) };
}

function snapshot(fixture: RecoveryFixture): RecoveryStatus {
  if (fixture.state === "ordinary") return { state: "ordinary", receipt: null, receiptDigest: null, summaryDigest: null, counts: { ...fixture.counts } };
  return {
    state: fixture.state,
    receipt: { restoreId: RESTORE_ID, backupCreatedAt: BACKUP_CREATED_AT, restoredAt: RESTORED_AT },
    receiptDigest: RECEIPT_DIGEST,
    // The summary the release was bound to stays the one the server reports after it.
    summaryDigest: fixture.release?.body.expectedSummaryDigest ?? summaryDigest(fixture),
    counts: { ...fixture.counts },
  };
}

function release(world: FixtureWorld, fixture: RecoveryFixture, body: unknown, key: string | undefined): unknown {
  if (!key || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(key)) throw new ApiError("VALIDATION_ERROR", 400);
  if (fixture.dropsFirstRelease) {
    // The connection dropped before the studio got it: nothing changed here, and the page never heard back.
    fixture.dropsFirstRelease = false;
    throw new ApiError("NETWORK_ERROR");
  }
  const input = body as Partial<ReleaseBody> | undefined;
  if (fixture.state === "ordinary" || input?.restoreId !== RESTORE_ID) throw new ApiError("RECOVERY_CONFLICT", 409);
  if (fixture.release) {
    const saved = fixture.release;
    if (saved.key !== key || saved.body.expectedReceiptDigest !== input.expectedReceiptDigest || saved.body.expectedSummaryDigest !== input.expectedSummaryDigest)
      throw new ApiError("RECOVERY_ALREADY_RELEASED", 409);
    return { receipt: { ...saved.body, version: 1, commandId: key, principalId: "local-user", releasedAt: saved.releasedAt }, recovery: snapshot(fixture) };
  }
  if (fixture.changesOnce) {
    // One uncertain job answered while the person was reading: the summary they saw no longer holds.
    fixture.changesOnce = false;
    world.update(() => { fixture.counts = { ...fixture.counts, unknownJobs: fixture.counts.unknownJobs - 1, knownJobs: fixture.counts.knownJobs + 1 }; });
  }
  const current = releaseFor(fixture);
  if (input.expectedReceiptDigest !== current.expectedReceiptDigest || input.expectedSummaryDigest !== current.expectedSummaryDigest)
    throw new ApiError("RECOVERY_CONFLICT", 409);
  fixture.release = { key, body: current, releasedAt: new Date().toISOString() };
  fixture.state = "released";
  // Every film hears about it, as the server's installation.recovery_released event does.
  world.update(() => {});
  return { receipt: { ...current, version: 1, commandId: key, principalId: "local-user", releasedAt: fixture.release.releasedAt }, recovery: snapshot(fixture) };
}

/**
 * The recovery status and release, and the quarantine's refusal of every write. DECLINE passes the request
 * on to the views' routes and the Keyframes commands.
 */
export function recoveryRequest(world: FixtureWorld, method: string, path: string, options: RequestOptions): unknown | Decline {
  const fixture = recoveryOf(world);
  if (method === "GET" && path === RECOVERY_PATH) return snapshot(fixture);
  if (method === "POST" && path === RELEASE_PATH) return release(world, fixture, options.body, options.key);
  if (method !== "GET" && fixture.state === "quarantined") throw new ApiError("INSTALLATION_QUARANTINED", 409);
  return DECLINE;
}
