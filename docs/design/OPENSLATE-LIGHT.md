# Earlier Studio Day / Night design

The October 7 Frame Studio Day/Night workbench has been retired on this branch. Its Radix controls, resizable conversation, inline tool cards, purple-blue actions and browser-owned scene sequence describe the earlier UI. Dated verification remains in the [October 7 review](../implementation/OCTOBER-7-DAY-NIGHT-REVIEW.md) and [October 9 authority/recovery review](AUTHORITY-AND-WORKFLOW-REVIEW.md); those checks do not verify the replacement UI.

The current source is `apps/web/src/next`, booted directly from `apps/web/src/main.tsx`. It follows the [Last Ferry design](../ai/prototypes/last-ferry/DESIGN.md) and [UI implementation plan](../ai/UIUX-IMPLEMENTATION-PLAN.md), with delivery recorded in [status](../implementation/STATUS.md).

Current presentation uses a dark token palette, local Inter, plain React controls, message-ID English/Chinese catalogs, a 52 px header and 392 px Director column with a narrow-screen drawer. White identifies the selected/primary action, amber identifies Director notes/proposals, and green identifies opened frames. Tokens and shared styles live in [studio.css](../../apps/web/src/next/ui/studio.css), with view-specific styles beside their components. The current tree does not use Radix Themes.

Plan, Keyframes, Assets, Film, Start and Settings all use the next tree. Explicit @ scope does not follow preview selection. Generation comes from the server overview and durable scene confirm rather than client checkpoints. Narration fit, takes, notes, proposals, storyboard exports and installation status use the [current application routes](../technical/APPLICATION-API.md).

See the [current studio guide](STORYBOARD-STUDIO.md) and [UI component reference](../technical/REVIEW-UI.md) for behavior and source boundaries. The original artifact remains historical design input, not the current UI contract.
