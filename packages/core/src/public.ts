/** Browser-safe application identity; domain execution modules are server-only. */
export const APP_NAME = "OpenSlate";
export interface HealthResponse {
  name: typeof APP_NAME;
  status: "ok";
  stage: "foundation";
}
