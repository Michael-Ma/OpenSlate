import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPromptParts } from '../dist/public.js';

for (const punctuation of ['.', '!', '?', '…', '。', '！', '？']) {
  test(`prompt joins preserve terminal ${punctuation} without adding a stop`, () => {
    assert.equal(joinPromptParts([`  First${punctuation}  `, ' Next ']), `First${punctuation} Next`);
    assert.equal(joinPromptParts(['First', `Next${punctuation}`]), `First. Next${punctuation}`);
  });
}

test('prompt joins trim parts and skip empty or whitespace-only parts', () => {
  assert.equal(joinPromptParts(['', '  First  ', '\t', ' Second\n', '  ']), 'First. Second');
  assert.equal(joinPromptParts([]), '');
  assert.equal(joinPromptParts(['', ' \n\t']), '');
  assert.equal(joinPromptParts(['  Only one  ']), 'Only one');
});

test('prompt joins preserve Chinese text and its terminal punctuation', () => {
  assert.equal(joinPromptParts([' 一盏灯亮着。 ', ' 店员拉下卷帘！', '还在等谁？', ' 静静地等… ', '柜台上方的低角度广角']),
    '一盏灯亮着。 店员拉下卷帘！ 还在等谁？ 静静地等… 柜台上方的低角度广角');
});

test('a prompt without doubled separators remains byte-for-byte unchanged', () => {
  assert.equal(joinPromptParts(['Mara pays', 'She slides coins', 'Medium', 'Camera movement: Slow push-in']),
    'Mara pays. She slides coins. Medium. Camera movement: Slow push-in');
});

test('prompt joins preserve internal whitespace and punctuation supplied in a part', () => {
  assert.equal(joinPromptParts(['Keep  two spaces..', 'Line one\nLine two;', 'Final:']),
    'Keep  two spaces.. Line one\nLine two;. Final:');
});
