/** Browser-safe application identity; domain execution modules are server-only. */
export const APP_NAME = "OpenSlate";
export { joinPromptParts } from "./prompt-parts.js";
export interface HealthResponse {
  name: typeof APP_NAME;
  status: "ok";
  stage: "foundation";
}
export type * from "./studio-api.js";
