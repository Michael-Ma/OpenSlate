import { ApiError, type StudioApi } from "./api.ts";
import { pendingCommandsFor, type PendingCommand } from "./pending-command.ts";
import { runSceneConfirmation, SceneConfirmationError } from "./scene-confirmation-model.ts";
import { sceneContinuationFor } from "./scene-continuation-cache.ts";

class SceneLocalBlock extends Error {}

/** The command outlives its dialog. A tab claims the UI synchronously, then checks the latest durable record under the project lock. */
export function startSceneCommand(api: StudioApi, projectId: string, command: PendingCommand) {
  const registry = pendingCommandsFor(api, "conversation-scenes");
  const before = registry.snapshot(projectId);
  if (before.running || before.command && before.command !== command) return false;
  const cache = sceneContinuationFor(api);
  const uncertain = (cause: unknown) => cause instanceof SceneLocalBlock ||
    !(cause instanceof ApiError || cause instanceof SceneConfirmationError) ||
    ["NETWORK_ERROR", "REQUEST_FAILED", "INTERNAL_ERROR"].includes(cause.code);
  void registry.run(projectId, command, async saved => {
    const send = () => saved.path.endsWith("/confirm")
      ? runSceneConfirmation(api, saved, text => registry.reportProgress(projectId, saved.key, text))
      : api.request(saved.path, { method: "POST", body: saved.body, key: saved.key, timeoutMs: 180000 });
    if (!cache.namespace) return send();
    if (typeof navigator === "undefined" || !navigator.locks?.request)
      throw new SceneLocalBlock("This browser cannot lock scene recovery across tabs. Use a browser with Web Locks to check this request.");
    return navigator.locks.request(
      `openslate:scene:${cache.namespace}:${projectId}`,
      { mode: "exclusive", ifAvailable: true },
      async lock => {
        if (!lock) throw new SceneLocalBlock("Another tab is handling this project. Check it there or retry after it finishes.");
        if (!cache.currentMatches(projectId, saved))
          throw new SceneLocalBlock("A different scene request was saved in another tab. Reload and check that request before continuing.");
        cache.write(projectId, { command: saved, flow: cache.read(projectId)?.flow ?? null });
        if (cache.mustPauseBeforePost)
          throw new SceneLocalBlock("Local scene recovery could not protect this request. Check browser storage before continuing.");
        try {
          const result = await send();
          cache.write(projectId, null);
          return result;
        } catch (cause) {
          if (!uncertain(cause)) cache.write(projectId, null);
          throw cause;
        }
      },
    );
  }, uncertain,
  { deferSceneCheckpoint: !!cache.namespace });
  return true;
}
