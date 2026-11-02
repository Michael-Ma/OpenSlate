import { invariant } from "@openslate/core";
import type { FastifyRequest } from "fastify";

export function requiredCommandKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  invariant(typeof key === "string" && key.trim().length > 0 && key.length <= 160,
    "IDEMPOTENCY_KEY_REQUIRED", "Provide one bounded Idempotency-Key for this command");
  return key;
}
