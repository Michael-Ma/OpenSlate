/**
 * The code-plan routes (docs/ai/code-plan/cards/P3a-routes.md), relative to a film's /api/projects/:projectId.
 * Only code projects (`project.planMode === "code"`) read or write them; graph projects never call them.
 * Shapes are the "Code-plan projects" section of packages/core/src/studio-api.ts.
 */

/** GET → CodePlanView. */
export const CODE_PLAN_PATH = "/code-plan";
/** POST CodePlanAnswerInput → CodePlanReceipt (Idempotency-Key). */
export const CODE_PLAN_CHOICES_PATH = "/code-plan/choices";
/** POST CodePlanCeilingInput → CodePlanReceipt (Idempotency-Key). */
export const CODE_PLAN_CEILING_PATH = "/code-plan/ceiling";
/** POST CodePlanSourceInput → CodePlanReceipt with the diff (Idempotency-Key). */
export const CODE_PLAN_SOURCE_PATH = "/code-plan/source";

/** GET → CodePlanSourceView. */
export const codePlanVersionPath = (version: number): string => `/code-plan/versions/${encodeURIComponent(String(version))}`;

/** The graph studio's artifact content route, which every other picture and clip uses. */
export const artifactContentPath = (projectId: string, artifactId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/content`;

/**
 * Where a code-plan step's media (CodePlanStepView.artifact, and media options of a choice) is read. P3a confirmed
 * that the existing authenticated artifact route serves artifacts no graph selection references. The bytes are
 * SHA-256 checked either way.
 */
export const codePlanArtifactContentPath = (projectId: string, artifactId: string): string =>
  artifactContentPath(projectId, artifactId);
