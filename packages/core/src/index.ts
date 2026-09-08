export const APP_NAME = "OpenSlate";

/** Health only describes the application process, not unimplemented integrations. */
export interface HealthResponse {
  name: typeof APP_NAME;
  status: "ok";
  stage: "skeleton";
}
