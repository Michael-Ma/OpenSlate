import test from "node:test";
import assert from "node:assert/strict";
import {
  appearanceMode,
  resolveAppearance,
  readAppearancePreference,
  persistAppearancePreference,
  appearanceHref,
  APPEARANCE_STORAGE_KEY,
} from "../src/appearance-model.ts";

test("direct review mode wins over saved preference without treating arbitrary values as modes", () => {
  assert.equal(resolveAppearance("?mode=night&view=frames", "day"), "night");
  assert.equal(resolveAppearance("?mode=day", "night"), "day");
  assert.equal(resolveAppearance("?mode=unexpected", "night"), "night");
  assert.equal(resolveAppearance("?mode=Night", null), "day");
  assert.equal(resolveAppearance("", "night"), "night");
  assert.equal(resolveAppearance("", "corrupted"), "day");
  for (const value of [undefined, null, false, 0, {}, "light", "dark"])
    assert.equal(appearanceMode(value), null);
});
test("mode updates preserve the workspace view, selected shot and unrelated launch context", () => {
  const href =
    "http://127.0.0.1:3001/?view=frames&shot=shot-02&project=film&launch=local-pairing-code#scene-2";
  const next = new URL(appearanceHref(href, "night"));
  assert.equal(next.searchParams.get("mode"), "night");
  for (const key of ["view", "shot", "project", "launch"])
    assert.equal(
      next.searchParams.get(key),
      new URL(href).searchParams.get(key),
    );
  assert.equal(next.hash, "#scene-2");
  const again = new URL(appearanceHref(next.href, "day"));
  assert.deepEqual(again.searchParams.getAll("mode"), ["day"]);
  assert.equal(again.pathname, "/");
});
test("a saved preference survives reload independently of the current project", () => {
  const items = new Map(),
    storage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, value),
    };
  assert.equal(persistAppearancePreference(storage, "night"), true);
  assert.equal(items.get(APPEARANCE_STORAGE_KEY), "night");
  assert.equal(readAppearancePreference(storage), "night");
  assert.equal(
    resolveAppearance(
      "?project=another&view=timeline",
      readAppearancePreference(storage),
    ),
    "night",
  );
  assert.deepEqual([...items.keys()], [APPEARANCE_STORAGE_KEY]);
});
test("blocked or invalid browser storage never prevents selecting a mode", () => {
  const unavailable = {
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Blocked");
    },
  };
  assert.equal(readAppearancePreference(unavailable), null);
  assert.equal(persistAppearancePreference(unavailable, "night"), false);
  assert.equal(readAppearancePreference(null), null);
  assert.equal(persistAppearancePreference(null, "day"), false);
  assert.equal(
    readAppearancePreference({ getItem: () => "{broken}", setItem() {} }),
    null,
  );
  assert.equal(
    resolveAppearance("?mode=night", readAppearancePreference(unavailable)),
    "night",
  );
});

// A visual preference must keep ordinary text/actions readable in every actual zone.
test("Day and Night text, links and primary actions retain readable contrast", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(
    new URL("../src/frame-theme.css", import.meta.url),
    "utf8",
  );
  const luminance = (hex) => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
    return (values[1] + 0.05) / (values[0] + 0.05);
  };
  for (const mode of ["day", "night"]) {
    const block = css
      .split(`html[data-theme="${mode}"] .radix-themes {`)[1]
      ?.split("}")[0];
    assert.ok(block, `Missing ${mode} palette`);
    const colors = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    for (const foreground of ["ink", "muted"]) {
      for (const background of [
        "zone-chat",
        "zone-canvas",
        "zone-inspector",
        "zone-shelf",
        "input-surface",
        "widget-surface",
        "user-bg",
        "soft",
      ]) {
        assert.ok(
          contrast(colors[foreground], colors[background]) >= 4.5,
          `${mode} ${foreground} on ${background}`,
        );
      }
    }
    assert.ok(contrast(colors.accent, colors.surface) >= 4.5, `${mode} link`);
    for (const background of [
      "action-fill",
      "action-hover",
      "success-fill",
      "success-fill-hover",
    ])
      assert.ok(
        contrast("#ffffff", colors[background]) >= 4.5,
        `${mode} action ${background}`,
      );
  }
});
