import test from 'node:test';
import assert from 'node:assert/strict';
import { takeStudioLaunchCode } from '../src/studio-launch.ts';

test('launch code is removed before it is returned and other page state is preserved', () => {
  const code = 'a'.repeat(43), calls = [];
  assert.equal(takeStudioLaunchCode({ hash: `#connect=${code}`, pathname: '/', search: '?view=studio' }, { replaceState: (...args) => calls.push(args) }), code);
  assert.deepEqual(calls, [[null, '', '/?view=studio']]);
});
test('malformed launch data is cleared and rejected without permitting redirects', () => {
  const calls = [];
  assert.throws(() => takeStudioLaunchCode({ hash: '#connect=bad&redirect=https://evil.example', pathname: '/', search: '' }, { replaceState: (...args) => calls.push(args) }), /invalid/);
  assert.deepEqual(calls, [[null, '', '/']]);
  assert.equal(takeStudioLaunchCode({ hash: '#other', pathname: '/', search: '' }, { replaceState: () => assert.fail() }), undefined);
});
