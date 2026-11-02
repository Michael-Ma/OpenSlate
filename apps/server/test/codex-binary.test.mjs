import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findLocalCodexBinary, selectLocalCodexBinary, resolveConfiguredCodexBinary, supportedCodexInstall } from '../dist/application/codex-binary.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-binary-choice-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = (relative) => { const file = join(root, relative); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'fixture'); return realpathSync(file); };
  return { root, binary, environment: {}, home: join(root, 'home'), discovered: [], matches: () => { throw Error('Explicit or pinned binaries must be checked by setup, not discovery'); } };
}
test('a supported configured Director then image-worker binary take priority over the supported install', t => {
  const f = fixture(t), director = f.binary('configured-director'), image = f.binary('configured-image');
  f.binary('home/.local/share/openslate-codex-0.162.1/node_modules/.bin/codex');
  f.version = () => '0.162.1';
  assert.equal(findLocalCodexBinary({ ...f, environment: { OPENSLATE_CODEX_BINARY: director, OPENSLATE_CODEX_IMAGE_BINARY: image } }), director);
  assert.equal(findLocalCodexBinary({ ...f, environment: { OPENSLATE_CODEX_IMAGE_BINARY: image } }), image);
  const missing = join(f.root, 'missing-explicit');
  assert.equal(findLocalCodexBinary({ ...f, version: () => null, environment: { OPENSLATE_CODEX_BINARY: missing } }), missing, 'a broken pinned install cannot replace a broken configuration');
});
test('both configured 0.153.4 paths fall back to the side-by-side pin with an actionable notice', t => {
  const f = fixture(t), old = f.binary('old-codex'), pinned = f.binary('home/.local/share/openslate-codex-0.162.1/node_modules/.bin/codex');
  const version = file => file === old ? '0.153.4' : '0.162.1';
  for (const variable of ['OPENSLATE_CODEX_BINARY', 'OPENSLATE_CODEX_IMAGE_BINARY']) {
    const selected = selectLocalCodexBinary({ ...f, version, environment: { [variable]: old } });
    assert.equal(selected.binaryPath, pinned);
    assert.deepEqual(selected.diagnostic, { code: 'DIRECTOR_CODEX_VERSION_MISMATCH', expectedVersion: '0.162.1', foundVersion: '0.153.4', binaryPath: old, installPath: supportedCodexInstall(f.home) });
  }
  assert.equal(resolveConfiguredCodexBinary(old, { home: f.home, version }).binaryPath, pinned);
});
test('a missing supported install preserves the mismatched configured path for setup refusal', t => {
  const f = fixture(t), old = f.binary('old-codex');
  assert.deepEqual(selectLocalCodexBinary({ ...f, version: () => '0.153.4', environment: { OPENSLATE_CODEX_BINARY: old } }), { binaryPath: old });
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
  const wrong = executable('alpha', '0.162.0-alpha.4'), matching = executable('pinned', '0.162.1');
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
