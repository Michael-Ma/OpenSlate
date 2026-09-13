import { DomainError } from "./common.js";
import type { LocalExecutionIdentity } from "./contracts.js";

/** Pin a supported local execution identity without retaining or evaluating caller properties. */
export function snapshotLocalExecution(value: unknown): Readonly<LocalExecutionIdentity> {
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      const keys = Reflect.ownKeys(value), properties = Object.getOwnPropertyDescriptors(value);
      if (keys.length === 2 && keys.every(key => key === "adapter" || key === "version")
        && properties.adapter?.enumerable && properties.version?.enumerable
        && properties.adapter.value === "local-media" && properties.version.value === "1") {
        return Object.freeze({ adapter: "local-media", version: "1" });
      }
    }
  } catch { /* Invalid host values receive the same bounded diagnostic. */ }
  throw new DomainError("LOCAL_EXECUTION_UNSUPPORTED", "Use the exact supported local-media execution identity");
}
