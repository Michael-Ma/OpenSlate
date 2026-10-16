# Browser check failures (run by the lead outside the sandbox)

Run: `node scripts/browser-check.mjs` at commit 5503b99 (after `pnpm build`). 155 of 165 passed. Each failing scenario saved a screenshot to `$TMPDIR/openslate-browser-check-<name>.png` (macOS: /var/folders/.../T/); scenario code is in `scripts/browser/`.

## next-director-pictures

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="Show the Director 2.1's keyframe">Show the Director</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-director-pictures-scope

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="Show the Director 2.1's keyframe">Show the Director</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-director-pictures-refused

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="Show the Director 2.1's keyframe">Show the Director</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-director-pictures-limit-and-ffmpeg

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="Show the Director 2.1's keyframe">Show the Director</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-director-pictures-no-ffmpeg

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="Show the Director 2.1's keyframe">Show the Director</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-director-draft

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="Show the Director 2.1's keyframe">Show the Director</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-director-parity-chinese

```
locator.click: Timeout 30000ms exceeded.
Call log:
- waiting for locator('.preview [data-act="show-director"]')
- locator resolved to <button type="button" class="pill sm pv-show" data-act="show-director" aria-label="把 2.1 的关键帧给导演看">给导演看</button>
- attempting click action
2 × waiting for element to be visible, enabled and stable
```

## next-film-export

```
Error: [data-act='last-export'] never matched /^Last export Today \d\d:\d\d · changed since: shot order, music\s*Download MP4\s*2 earlier in Assets$/; last text: "Last export Oct 15 23:51 · changed since: shot order, music\nDownload MP4\n2 earlier in Assets"
at expectText (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser/next-film.mjs:34:9)
at async Object.run (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser/next-film.mjs:311:7)
at async file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser-check.mjs:80:7
```

## next-film-chinese

```
Error: [data-act='last-export'] never matched /^上次导出 今天 \d\d:\d\d · 之后有改动：镜头顺序、音乐\s*下载 MP4\s*素材里还有 2 个$/; last text: "上次导出 10月15日 23:52 · 之后有改动：镜头顺序、音乐\n下载 MP4\n素材里还有 2 个"
at expectText (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser/next-film.mjs:34:9)
at async Object.run (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser/next-film.mjs:539:7)
at async file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser-check.mjs:80:7
```

## next-recovery-shell-disconnect-draft-live

```
Error: The first tab got the draft too: "Unsent draft about the fog"
at expect (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser/next-recovery-shell.mjs:18:25)
at Object.run (file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser/next-recovery-shell.mjs:219:7)
at async file:///Users/michael/SideProject/OpenSlate/.claude/worktrees/last-ferry/scripts/browser-check.mjs:80:7
```
