import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage } from '../../src/next/i18n/format.ts';
import { catalog } from '../../src/next/i18n/messages.ts';
import { errorMsg, translate } from '../../src/next/i18n/translate.ts';

test('placeholders and plurals format in both languages', () => {
  assert.equal(formatMessage('{n, plural, one {# shot} other {# shots}}', { n: 1 }), '1 shot');
  assert.equal(formatMessage('{n, plural, one {# shot} other {# shots}}', { n: 3 }), '3 shots');
  assert.equal(formatMessage('{n, plural, =0 {none} other {# left}}', { n: 0 }), 'none');
  assert.equal(formatMessage('Open {shot} · {n, plural, one {# frame of {total}} other {# frames of {total}}}', { shot: '2.2', n: 2, total: 3 }), 'Open 2.2 · 2 frames of 3');
  assert.equal(formatMessage('Hi {missing}'), 'Hi {missing}');
  assert.equal(formatMessage('{n, plural, other {# 个}}', { n: 1200 }, 'zh'), '1,200 个');
  assert.equal(translate('en', 'shell.counts', { scenes: 3, shots: 8 }), '3 scenes · 8 shots');
  assert.equal(translate('zh-CN', 'shell.counts', { scenes: 3, shots: 8 }), '3 场 · 8 个镜头');
});

test('every message has both languages and the same placeholders', () => {
  // A placeholder is {name} or {name, plural ...}; plural branches like =0 {next} or one {...} are not.
  const names = text => [...new Set([...text.matchAll(/(?<!(?:=\d+|zero|one|two|few|many|other)\s*)\{(\w+)(?=[,}])/g)].map(m => m[1]))].sort().join(',');
  for (const [id, entry] of Object.entries(catalog)) {
    assert.ok(entry.en.trim() && entry.zh.trim(), `${id} is missing a language`);
    assert.equal(names(entry.zh), names(entry.en), `${id} placeholders differ between en and zh`);
  }
});

test('the glossary terms the owner approved are used', () => {
  assert.equal(catalog['director.title'].zh, '导演');
  assert.equal(catalog['shell.tab.keyframes'].zh, '关键帧');
  assert.equal(catalog['card.opened'].zh, '已查看');
  assert.equal(catalog['inspector.takes'].zh, '版本');
});

test('server codes map to messages, unknown codes still name themselves', () => {
  assert.deepEqual(errorMsg('FRAME_STALE'), { id: 'error.FRAME_STALE' });
  assert.deepEqual(errorMsg('SOMETHING_NEW'), { id: 'error.unknown', values: { code: 'SOMETHING_NEW' } });
});
