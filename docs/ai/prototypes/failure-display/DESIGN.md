# Generation progress and failures: design notes

Study: `index.html` (links the app's built `studio.css`, copied from `apps/web/dist`; serve the folder and open it). Sample content from The Last Ferry fixture, not real data. Static: no control works.

**Audience and job:** the person who asked the Director for keyframes or video, mid-conversation. They need to know what is done, what failed or is waiting, whether it cost money, and the one next step, without hunting shot by shot.

**Scope (three additions, nothing else changes):**
1. *Live progress* replaces the static `.gen-note` ("Started 2 keyframes…") under the reply that started the work. It has a header with the done/total count and the price (estimate while running, actual when done), a segmented bar, one chip per shot (done, making, queued, failed, waiting for the service) that opens the shot, and a next-step line with one Open button when something needs the person. When everything is done it collapses to one line. Stop shows only while work runs.
2. *Blocked line*, used when part of a Director request is refused (`ATTEMPT_EXISTS`, `STALE_PROMPT_INTENT`, …). It is rendered by the app from the refusal's recovery details, not from the Director's prose. Title: what it waits on. Second line: how to unblock it, including any money risk. Buttons do the next step: Open the shot with the recovery action leading, or "Ask the Director to update". The error code sits under Technical details. The parts that weren't blocked go ahead and show progress as usual.
3. *Needs attention*: a counted pill left of Synced, hidden at zero. It opens a film-wide list grouped by what to do (waiting for an answer, failed), with thumb, shot, state, charge, and Open. An item leaves the list when it resolves. Director recommendations stay in the thread and banner, not here. On narrow screens the pill shrinks to the count and the list opens from the bottom.

**Visual rules kept from the Last Ferry DESIGN.md:** failures are never red; they use neutral raised grey with a filled white "!". Amber stays the Director's. Green appears only for done or opened. Waiting uses a dashed or hollow mark. Copy says what to do next, in the same tone as T1/T2.

**Open decisions for the owner:** whether the "Ask the Director to update" button may send a message for them (it is a typed request in their name); and whether the attention list should also hold outdated media ("frame older than its prompt").
