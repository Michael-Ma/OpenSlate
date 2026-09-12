import { createHash, randomUUID } from "node:crypto";

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: unknown = undefined) {
    super(message);
    this.name = "DomainError";
  }
}

export function invariant(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new DomainError(code, message);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "VALIDATION_ERROR", "Non-finite numbers are not supported");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  invariant(typeof value === "object" && value !== null, "VALIDATION_ERROR", "Value must be JSON-compatible");
  const object = value as Record<string, unknown>;
  invariant(Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null, "VALIDATION_ERROR", "Expected a plain object");
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function newId(): string { return randomUUID(); }

export function moneyMicros(value: string): bigint {
  invariant(/^(0|[1-9][0-9]*)$/.test(value), "VALIDATION_ERROR", "Money must be a nonnegative integer decimal string");
  const result = BigInt(value);
  invariant(result <= 9223372036854775807n, "VALIDATION_ERROR", "Money exceeds SQLite integer capacity");
  return result;
}
