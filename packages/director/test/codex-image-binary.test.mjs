import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCodexImageBinary } from '../dist/media/codex-image.js';

for (const layout of ['sibling', 'nested']) test(`Codex image resolves the official ${layout} optional native package without executing its launcher`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'openslate-image-npm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'node_modules/@openai/codex'), launcher = join(packageRoot, 'bin/codex.js');
  await mkdir(dirname(launcher), { recursive: true }); await writeFile(launcher, 'throw Error("Launcher must never execute");');
  const modules = layout === 'nested' ? join(packageRoot, 'node_modules') : join(root, 'node_modules');
  const optional = join(modules, `@openai/codex-${process.platform}-${process.arch}`);
  const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`;
  const binary = join(optional, 'vendor', triple, 'bin/codex');
  await mkdir(dirname(binary), { recursive: true }); await writeFile(binary, 'synthetic native bytes');
  await writeFile(join(optional, 'package.json'), JSON.stringify({ name: `@openai/codex-${process.platform}-${process.arch}`, version: '0.162.1' }));
  assert.equal(await resolveCodexImageBinary(launcher), await realpath(binary));
});

test('a directly selected native executable keeps its exact canonical identity', async () => {
  assert.equal(await resolveCodexImageBinary(process.execPath), await realpath(process.execPath));
});
