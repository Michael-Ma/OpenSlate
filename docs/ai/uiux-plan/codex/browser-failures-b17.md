# Browser check failures after B17 (run by the lead outside the sandbox)

158 of 163 passed. Screenshots: $TMPDIR/openslate-browser-check-<name>.png (/var/folders/th/qdj8_39j7wx062tcx9pvccb40000gn/T/). Scenario code: scripts/browser/.

## next-keyframes-parity-live-lost-reply-and-takes

```
Error: .insp [data-act="regen"]:not([disabled]) never matched /^Regenerate keyframe$/; last text: "Regenerate keyframe · A new take costs about $0.0001."
at expectText (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser/next-keyframes-parity.mjs:35:9)
at async Object.run (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser/next-keyframes-parity.mjs:449:7)
at async file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser-check.mjs:80:7
```

## next-keyframes-narrow

```
page.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('[data-act="scene"][data-scene="scene-3"]')
- locator resolved to <button disabled class="pill" type="button" data-act="scene" aria-pressed="false" data-scene="scene-3" title="Save or cancel the edit to 2.3 first">3 Departure · not started</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-narration-closed-while-sending

```
page.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.card [data-act="open-shot"][data-shot="shot-2-3"]')
- locator resolved to <button disabled class="hit" type="button" data-act="open-shot" data-shot="shot-2-3" aria-pressed="false" aria-label="Open shot 2.3, Close-up" title="Save or cancel the edit to 2.2 first"></button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-shell-no-sideways-scroll

```
Error: A note's link wraps onto the picture at 1366: 37
at expect (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser/next-shell.mjs:26:25)
at Object.run (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser/next-shell.mjs:444:9)
at async file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser-check.mjs:80:7
```

## next-start-first-run-demo

```
Error: .toast never matched /Made Demo film\. The stand-in Director is filling it in; nothing is charged\./; last text: ""
at expectText (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser/next-start.mjs:28:9)
at async Object.run (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser/next-start.mjs:331:7)
at async file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-b17/scripts/browser-check.mjs:80:7
```
