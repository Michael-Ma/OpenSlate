import { digest } from "@openslate/core";
import type { ControlInput } from "@openslate/core/public";
import type { ProductionService } from "./service.js";

/**
 * The person's whole-film Stop / Continue command. The studio route, a Director stop and a confirmed Director
 * resume card all run this one function, so they produce the same stop record, revoked epochs and receipts.
 */
export function executionControlCommand(service: ProductionService, projectId: string, input: ControlInput, key: string) {
  // Continue changes control state only; it never drives a worker or Director tick.
  return service.store.command(`local-user:${projectId}:control`, key, digest(input), () => {
    const actor = service.beginRequest(projectId, "local-user", input.action === "stop" ? "Stop the current conversation and new generation." : input.action,
      { source: "app", editing: false, key: `control:${key}` });
    return { ...service.control(projectId, actor, input.action, input.action === "resume" ? input.expectedAuthorityId : undefined), requestId: actor.requestId };
  });
}
