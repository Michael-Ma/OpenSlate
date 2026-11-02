# Project settings and live updates

The current studio has a Settings page with Models, Director, voices, This computer and language. It is implemented in `apps/web/src/next`; earlier compact-dialog/source-path descriptions are historical. The [UI reference](../technical/REVIEW-UI.md) covers mode-specific views.

## Director choices

Codex **0.162.1** defaults to **gpt-6.1-sol**. Its picker uses actual compatible models returned by the configured runtime/account; read-only refresh saves no selection and starts no model turn. A failed list retains the saved/current ID and explains readiness. Existing films keep their model, and a verified supported side-by-side binary can replace an old effective launch path with a notice without rewriting history.

Code films additionally offer **Claude Code · Opus 5.5** and **Sonnet 5.5**, using a local Claude subscription login (2.1.312 or later 2.x). Storyboard films cannot select Claude. The demo Director remains available. Director accounts are separate from media accounts; Claude directing a film does not replace Codex image login. See [runtime/setup](../technical/DIRECTOR-RUNTIME.md).

Saving a Director choice uses its own durable command and setup checks; changes apply to eligible idle work. Unknown results retain their exact original command. Current/earlier result copy is bound to the saved selection, and later human changes cannot borrow an older save's authority.

## Media choices and spend limits

For storyboard films, **Save media models** produces an exact server preview. An explicit Save can automatically apply a current zero-impact preview using its retained identity; actual unfinished-work effects require review. Completed results, in-flight work, protected dependencies and separately reviewed audio stay pinned. Changed work still needs current generation decisions; no separate usage allowance is added.

Code films pin their installed media definitions at creation, including additional ready video/music models. A catalog edit does not silently add models to an existing film. [Catalog](PROVIDER-CATALOG.md) and [providers](../technical/PROVIDERS-ARTIFACTS.md) describe exact selection boundaries.

**This film's spend limit** is durable code-film state, also editable in the run strip. Charged, unknown and in-flight liabilities set its minimum. **Spend limit for new films** defaults to $4 and is a browser preference, as is **Developer mode**, which reveals Code and filtered call parameters. These controls do not create a storyboard project budget or erase existing liability.

## Saved commands, guidance and refresh

Director/media saves have separate identities. Pending commands preserve exact request bodies across uncertain replies; check the original saved request before starting another. Draft recovery is not authority or automatic submission. Provider credentials stay server-side; custom voice IDs and consent are distinct from unimplemented voice-clone enrollment.

Fresh eligible storyboard Director turns upgrade verified shipped guidance to the latest release (**8.1.0 / 7.1.0**), preserving already-bound epochs and historical bytes. Code films use their separate current **0.3.0** guidance; older contracts and journals keep compatibility behavior. Normal Settings does not expose a manual tool-version update. [Guidance compatibility](DIRECTOR-TOOLS-UPGRADE.md).

Authenticated SSE invalidates current projections with bounded reconnect/refresh. Reads and status displays do not grant media authority. Stop, request epochs, original-command replay and recovery quarantine remain authoritative.

Source: [ModelsPanel](../../apps/web/src/next/views/settings/ModelsPanel.tsx), [DirectorPanel](../../apps/web/src/next/views/settings/DirectorPanel.tsx), [Director selection model](../../apps/web/src/next/model/settings-director.ts), [local controller](../../apps/server/src/application/local-director.ts), [media settings](../../apps/server/src/application/project-model-settings.ts) and [code ceilings](../../apps/server/src/code-plan/settings.ts). Current [status](STATUS.md) links actual checks. The [October 3 report](OCTOBER-3-REFINEMENT-REVIEW.md) retains evidence for its earlier UI/runtime checkpoint.
