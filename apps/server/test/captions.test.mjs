import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { layoutCaptions, systemCaptionFont } from '../dist/media/captions.js';
import { findCjkCaptionFont } from '../../../scripts/test-toolchain.mjs';

function fonts(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-cjk-fonts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, bytes = `font fixture: ${name}`) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return path;
  };
  return { root, put };
}
function catalog(families = [], register = () => ({})) {
  const available = new Set(families), calls = [];
  return {
    calls,
    has: name => available.has(name),
    registerFromPath(path, alias) {
      calls.push({ path, alias });
      const result = register(path);
      if (result) available.add(alias);
      return result;
    },
  };
}

// The server and preflight cannot import each other's resolver. Exercise both with the same behavior cases.
for (const [side, lookup] of [
  ['server', options => systemCaptionFont(true, options)?.family],
  ['preflight', findCjkCaptionFont],
]) {
  test(`${side}: Linux registers an uncatalogued TTC once, preferring Regular across font roots`, t => {
    const f = fonts(t), native = catalog();
    f.put('system/NotoSansCJK-Bold.ttc');
    const path = f.put('local/opentype/noto/NotoSansCJK-Regular.ttc');
    const options = { platform: 'linux', catalog: native, roots: [join(f.root, 'missing'), join(f.root, 'system'), join(f.root, 'local')] };
    assert.equal(lookup(options), 'Noto Sans CJK SC');
    assert.equal(lookup(options), 'Noto Sans CJK SC');
    assert.deepEqual(native.calls, [{ path, alias: 'Noto Sans CJK SC' }]);
  });

  test(`${side}: Linux accepts the Noto Sans SC prefix and all three font file extensions`, t => {
    const f = fonts(t);
    for (const name of ['NotoSansSC-Regular.otf', 'NotoSansSC-Regular.ttf', 'NotoSansCJKsc-Regular.ttc']) {
      const path = f.put(`${name}/nested/${name}`), native = catalog();
      assert.equal(lookup({ platform: 'linux', catalog: native, roots: [join(f.root, name)] }), 'Noto Sans CJK SC');
      assert.deepEqual(native.calls, [{ path, alias: 'Noto Sans CJK SC' }]);
    }
  });

  test(`${side}: existing Linux catalog families need no registration`, t => {
    const f = fonts(t);
    f.put('NotoSansCJK-Regular.ttc');
    for (const family of ['Noto Sans CJK SC', 'Noto Sans CJK', 'Noto Sans SC']) {
      const native = catalog([family]);
      assert.equal(lookup({ platform: 'linux', catalog: native, roots: [f.root] }), family);
      assert.equal(native.calls.length, 0);
    }
  });

  test(`${side}: an absent CJK file is cached and unrelated fonts or symlinks cannot qualify`, t => {
    const f = fonts(t), native = catalog(['DejaVu Sans']);
    f.put('scanned/NotoSerifCJK-Regular.ttc');
    f.put('scanned/NotoSansCJK-Regular.woff');
    const outside = f.put('outside/NotoSansCJK-Regular.ttc');
    symlinkSync(outside, join(f.root, 'scanned/NotoSansCJK-Regular.ttc'));
    symlinkSync(join(f.root, 'outside'), join(f.root, 'scanned/linked-directory'));
    const options = { platform: 'linux', catalog: native, roots: [join(f.root, 'scanned')] };
    assert.equal(lookup(options), undefined);
    f.put('scanned/NotoSansSC-Regular.otf');
    assert.equal(lookup(options), undefined, 'A missing file does not trigger another scan in this process');
    assert.equal(native.calls.length, 0);
  });

  test(`${side}: invalid fonts do not mask another candidate and a failed registration stays unavailable`, t => {
    const f = fonts(t);
    const first = f.put('NotoSansCJK-Regular.ttc'), second = f.put('NotoSansSC-Regular.otf'), bold = f.put('NotoSansCJK-Bold.ttf');
    const native = catalog([], path => {
      if (path === first) return null;
      if (path === second) throw new Error('Unreadable font');
      return {};
    });
    const options = { platform: 'linux', catalog: native, roots: [f.root] };
    assert.equal(lookup(options), 'Noto Sans CJK SC');
    assert.deepEqual(native.calls.map(call => call.path), [first, second, bold]);
    const rejected = catalog([], () => null);
    assert.equal(lookup({ ...options, catalog: rejected }), undefined);
    assert.equal(lookup({ ...options, catalog: rejected }), undefined);
    assert.equal(rejected.calls.length, 3, 'Failed registration is not repeated');
  });

  test(`${side}: Linux scans at most five subdirectory levels`, t => {
    const f = fonts(t), native = catalog();
    f.put('one/two/three/four/five/six/NotoSansCJK-Regular.ttc');
    assert.equal(lookup({ platform: 'linux', catalog: native, roots: [f.root] }), undefined);
    const path = f.put('one/two/three/four/five/NotoSansCJK-Regular.ttc'), fresh = catalog();
    assert.equal(lookup({ platform: 'linux', catalog: fresh, roots: [f.root] }), 'Noto Sans CJK SC');
    assert.deepEqual(fresh.calls, [{ path, alias: 'Noto Sans CJK SC' }]);
  });

  test(`${side}: the 4000-entry scan budget applies across roots`, t => {
    const f = fonts(t), native = catalog();
    for (let i = 0; i < 4000; i++) f.put(`first/a${String(i).padStart(4, '0')}`);
    f.put('second/NotoSansCJK-Regular.ttc');
    assert.equal(lookup({ platform: 'linux', catalog: native, roots: [join(f.root, 'first'), join(f.root, 'second')] }), undefined);
    assert.equal(native.calls.length, 0);
  });

  test(`${side}: macOS and Windows keep their preferred families and never register Linux fonts`, t => {
    const f = fonts(t);
    f.put('NotoSansCJK-Regular.ttc');
    for (const [platform, families] of [['darwin', ['PingFang SC', 'Hiragino Sans GB', 'Heiti SC']], ['win32', ['Microsoft YaHei']]]) {
      for (const family of families) {
        const native = catalog([family, 'Noto Sans CJK SC']);
        assert.equal(lookup({ platform, catalog: native, roots: [f.root] }), family);
        assert.equal(native.calls.length, 0);
      }
      const absent = catalog(['Noto Sans CJK SC', 'Arial']);
      assert.equal(lookup({ platform, catalog: absent, roots: [f.root] }), undefined);
      assert.equal(absent.calls.length, 0);
    }
  });
}

test('caption receipts digest the exact registered Regular file on repeated lookups', t => {
  const f = fonts(t), native = catalog(), bytes = Buffer.from('registered regular collection');
  f.put('NotoSansCJK-Bold.ttc', 'a different font');
  f.put('NotoSansCJK-Regular.ttc', bytes);
  const options = { platform: 'linux', catalog: native, roots: [f.root] };
  const expected = { family: 'Noto Sans CJK SC', sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(systemCaptionFont(true, options), expected);
  assert.deepEqual(systemCaptionFont(false, options), expected);
  assert.deepEqual(systemCaptionFont(true, options), expected);
  assert.equal(native.calls.length, 1);
});

test('an absent Linux CJK font preserves the clear caption error and English fallback', t => {
  const f = fonts(t), native = catalog(['DejaVu Sans']);
  const options = { platform: 'linux', catalog: native, roots: [f.root] };
  assert.deepEqual(systemCaptionFont(false, options), { family: 'DejaVu Sans' });
  assert.equal(systemCaptionFont(true, options), undefined);
  assert.throws(() => layoutCaptions([{ text: '你好', atFrame: 0, durationFrames: 30 }], 360, 640,
    cjk => systemCaptionFont(cjk, options)), /Caption 1: no CJK system font is available/);
});
