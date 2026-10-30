# P3a · Code-plan HTTP routes, project creation and media access

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then read `docs/ai/code-plan/DESIGN.md`, `apps/server/src/code-plan/port.ts` and the "Code-plan projects" section at the end of `packages/core/src/studio-api.ts`. Both are lead-owned contracts: build exactly these shapes and do not edit either file. The one exception is item 2's one-line `planMode` field. If either is wrong, say so under Open issues.

This card runs in parallel with P2b (which implements `CodePlanPort`) and P2a (the Director). Use a fake `CodePlanPort` in your tests. Line numbers are as of `078107d`.

## Change

1. **Routes**, in a new `apps/server/src/code-plan/routes.ts` registered from `app.ts`. Follow the existing patterns: the `registerDirectorReviewSetting` example (`apps/server/src/application/keyframe-review.ts:51-68`), Ajv schemas with `additionalProperties: false`, `requiredCommandKey` and `store.command` for replay, the studio session and CSRF checks from the preHandler (`app.ts:113-146`), and the quarantine check.
   - `GET /api/projects/:projectId/code-plan` → `CodePlanView`.
   - `GET /api/projects/:projectId/code-plan/versions/:version` → `CodePlanSourceView`.
   - `POST /api/projects/:projectId/code-plan/choices` (`CodePlanAnswerInput`) → `CodePlanReceipt`.
   - `POST /api/projects/:projectId/code-plan/ceiling` (`CodePlanCeilingInput`) → `CodePlanReceipt`.
   - `POST /api/projects/:projectId/code-plan/source` (`CodePlanSourceInput`): calls `submit` with author `user` and the request's Idempotency-Key as `invocationId`; returns `CodePlanReceipt` with the diff.

   The three POST routes require an `Idempotency-Key`; add them to the list at `app.ts:118`.

   **Errors:** map through the existing error mapping (`app.ts:102-112`). `CODE_PLAN_MODE` and `CODE_PLAN_REJECTED` are 409; add `diff` to the `details` allowlist at :109 so a rejection carries it.
2. **Project creation** accepts `planMode`.
   - `POST /api/projects` (`app.ts:205-213`): add `planMode: "graph" | "code"`, optional, to the schema at :206-208.
   - `service.createProject` (`service.ts:99-124`) stores it on the new project only when it is `code`. A graph project's record stays byte-identical to today.
   - If the browser contract has a create-project input type, add `planMode?: PlanMode` to it; that one line is allowed.
   - Do not touch `apps/web/**`.
3. **Media for code-plan steps.**
   - Check whether the existing authenticated media routes serve an `ArtifactRecord` that no graph selection references.
   - If they do, document which route the web should use for `CodePlanStepView.artifact`.
   - If they don't, add `GET /api/projects/:projectId/code-plan/artifacts/:artifactId/content`. It streams the owned file only when the artifact belongs to this project and to a code-plan attempt, after the same path-containment checks the ingester uses, with the right content type and range support if the existing video route has it.
4. **Wiring.**
   - Add `codePlans?: CodePlanPort` to `AppOptions` (`app.ts:56-75`). P2a adds the same field; keep the exact name.
   - Register the routes only when it is present.
   - In `index.ts`, pass the runtime as `codePlans`. Until P2b lands, a cast is fine; the lead fixes it at merge.
5. **Docs.** Add the routes to `docs/technical/APPLICATION-API.md` and add a `docs/implementation/STATUS.md` entry.

## Files you own

- `apps/server/src/code-plan/routes.ts` (new).
- In `app.ts`: route registration, `AppOptions`, the idempotency list, the error `details` allowlist and the project-create schema.
- `apps/server/src/application/service.ts`: only `createProject`.
- In `index.ts`: only the wiring.
- Tests.

Do not edit the code-plan runtime files (P2b), the Director files (P2a) or `apps/web/**`.

## Tests (minimum)

- **Routes:**
  - each route's success shape;
  - missing session or CSRF → 403;
  - a POST without an Idempotency-Key is refused;
  - an exact replay returns the saved receipt, and a changed body under the same key fails;
  - a graph project → 409 `CODE_PLAN_MODE`;
  - `CODE_PLAN_REJECTED` carries `details.diff`;
  - quarantine blocks the POSTs.
- **Project creation:**
  - `planMode: "code"` is stored;
  - omitted or `graph` leaves the record byte-identical to today;
  - an invalid value is 400.
- **Media:** a code-plan step artifact can be fetched; another project's artifact and a path outside the media directory are refused.

## Out of scope

- The runtime (P2b).
- The Director and `read_film` / `submit_plan` (P2a).
- The web (lead).
- Real providers (P4a).
