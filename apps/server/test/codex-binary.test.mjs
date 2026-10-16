import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findLocalCodexBinary, supportedCodexInstall } from '../dist/application/codex-binary.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-binary-choice-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = (relative) => { const file = join(root, relative); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'fixture'); return realpathSync(file); };
  return { root, binary, environment: {}, home: join(root, 'home'), discovered: [], matches: () => { throw Error('Explicit or pinned binaries must be checked by setup, not discovery'); } };
}
test('configured Director then image-worker binary take priority over the supported install', t => {
  const f = fixture(t), director = f.binary('configured-director'), image = f.binary('configured-image');
  f.binary('home/.local/share/openslate-codex/node_modules/.bin/codex');
  assert.equal(findLocalCodexBinary({ ...f, environment: { OPENSLATE_CODEX_BINARY: director, OPENSLATE_CODEX_IMAGE_BINARY: image } }), director);
  assert.equal(findLocalCodexBinary({ ...f, environment: { OPENSLATE_CODEX_IMAGE_BINARY: image } }), image);
  const missing = join(f.root, 'missing-explicit');
  assert.equal(findLocalCodexBinary({ ...f, environment: { OPENSLATE_CODEX_BINARY: missing } }), missing, 'an explicit broken configuration stays visible for repair');
});
test('the pinned install is selected before app bundles or PATH and resolves executable aliases', t => {
  const f = fixture(t), installed = f.binary('actual/pinned-codex'), pinned = supportedCodexInstall(f.home);
  mkdirSync(dirname(pinned), { recursive: true }); symlinkSync(installed, pinned);
  assert.equal(findLocalCodexBinary({ ...f, discovered: [f.binary('app-codex')] }), installed);
});
test('discovery skips wrong app versions, disappearing programs and duplicate aliases before selecting a matching program', t => {
  const f = fixture(t), wrong = f.binary('app-alpha'), matching = f.binary('path-codex'), alias = join(f.root, 'alias'); symlinkSync(wrong, alias);
  const checked = [];
  assert.equal(findLocalCodexBinary({ ...f, discovered: [wrong, alias, join(f.root, 'missing'), matching], matches: file => { checked.push(file); return file === matching; } }), matching);
  assert.deepEqual(checked, [wrong, matching]);
  assert.equal(findLocalCodexBinary({ ...f, discovered: [wrong], matches: () => false }), '');
});
test('PATH fallback actually checks only --version with bounded local fake executables', t => {
  const f = fixture(t), executable = (name, version) => {
    const file = join(f.root, name); writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' 'codex-cli ${version}'\n`, { mode: 0o700 }); return realpathSync(file);
  };
  const wrong = executable('alpha', '0.162.0-alpha.4'), matching = executable('pinned', '0.153.4');
  const { matches, ...host } = f;
  assert.equal(findLocalCodexBinary({ ...host, discovered: [wrong, matching] }), matching);
});

test('fallback discovery has one total time budget across multiple slow binaries', t => {
  const f = fixture(t), paths = ['one', 'two', 'three', 'four', 'five'].map(f.binary), checked = [];
  let elapsed = 0;
  assert.equal(findLocalCodexBinary({ ...f, discovered: paths, now: () => elapsed,
    matches: file => { checked.push(file); elapsed += 1000; return false; } }), '');
  assert.deepEqual(checked, paths.slice(0, 3));
});
