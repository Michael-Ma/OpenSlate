import { setTimeout as delay } from "node:timers/promises";

// Protocol assertions must survive concurrent builds/media tests starting other
// child processes. Tests of short deadlines override these fixture-only budgets.
export const PROTOCOL_FIXTURE_LIMITS = Object.freeze({
  requestTimeoutMs: 5000, runTimeoutMs: 15000, interruptGraceMs: 500,
  shutdownGraceMs: 500, eventTimeoutMs: 500,
});
export const FIXTURE_DEADLINE_MS = 30000;
export async function waitForFixture(check, description, signal) {
  const until = Date.now() + 10000;
  do { signal?.throwIfAborted(); if (await check()) return; await delay(25, undefined, { signal }); } while (Date.now() < until);
  throw new Error(`Fixture did not reach ${description}`);
}
