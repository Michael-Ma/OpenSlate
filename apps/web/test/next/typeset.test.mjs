import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage } from '../../src/next/i18n/format.ts';
import { translate } from '../../src/next/i18n/translate.ts';
import { formatList, keepTogether } from '../../src/next/i18n/typeset.ts';
import { previewCaption } from '../../src/next/model/keyframes-stage.ts';

const NB = '\u00a0';
const shown = (locale, id, values) => keepTogether(translate(locale, id, values));

test('a number never breaks from its unit, in either language', () => {
  assert.equal(keepTogether('The 2.3 line runs 7.4 s but the shot is 6 s.'), `The 2.3 line runs 7.4${NB}s but the shot is 6${NB}s.`);
  assert.equal(keepTogether('48 s · 30 fps · -18 dB · 1.2 MB · 820 KB · 50 %'), `48${NB}s · 30${NB}fps · -18${NB}dB · 1.2${NB}MB · 820${NB}KB · 50${NB}%`);
  assert.equal(keepTogether('影片 48 秒 → 50 秒 · 30 帧/秒'), `影片 48${NB}秒 → 50${NB}秒 · 30${NB}帧/秒`);
  assert.equal(keepTogether('3 场 · 8 个镜头 · 第 2 场'), `3${NB}场 · 8${NB}个镜头 · 第${NB}2${NB}场`);
  // Counted nouns are not units: "2 shots" and "3 scenes" may still break where they like.
  assert.equal(keepTogether('3 scenes · 8 shots · 2 minutes'), '3 scenes · 8 shots · 2 minutes');
  // Through the catalog, as the interface shows it.
  assert.equal(shown('en', 'note.proposal.film_length', { now: 48, after: 50 }), `Film 48${NB}s → 50${NB}s`);
  assert.equal(shown('zh-CN', 'shell.meta', { seconds: 48, fps: 30 }), `48${NB}秒 · 30${NB}帧/秒`);
});

test('"about" and 约 stay on the line of the price or length they qualify', () => {
  assert.equal(keepTogether('Make 2 keyframes · about $0.08'), `Make 2 keyframes · about${NB}$0.08`);
  assert.equal(keepTogether('About 3.3 s (an estimate)'), `About${NB}3.3${NB}s (an estimate)`);
  assert.equal(keepTogether('确认画面并生成 1 段视频 · 约 $0.50'), `确认画面并生成 1${NB}段视频 · 约${NB}$0.50`);
  assert.equal(keepTogether('Ask about the harbour'), 'Ask about the harbour');
  assert.equal(shown('zh-CN', 'price.about', { total: '$0.04' }), `约${NB}$0.04`);
  // Already kept together: applying it twice changes nothing.
  assert.equal(keepTogether(keepTogether('about $1.50 · 6 s')), `about${NB}$1.50 · 6${NB}s`);
});

test('a list of shots sets 和 apart from the labels in Chinese, as the catalogs write 第 2 场', () => {
  assert.equal(formatList(['3.1', '3.2'], 'zh-CN'), '3.1 和 3.2');
  assert.equal(formatList(['2.1', '2.2', '2.3'], 'zh-CN'), '2.1、2.2 和 2.3');
  assert.equal(formatList(['第 2 场', '第 3 场'], 'zh-CN'), '第 2 场和第 3 场');
  assert.equal(formatList(['标题', '画面描述'], 'zh-CN'), '标题和画面描述');
  assert.equal(formatList(['2.2', '2.3'], 'en-US'), '2.2 and 2.3');
  assert.equal(formatList(['2.1', '2.2', '2.3'], 'en'), '2.1, 2.2, and 2.3');
  assert.equal(formatList(['2.2'], 'zh-CN'), '2.2');
});

test('a Chinese template drops its space before or after a value that is itself Chinese', () => {
  assert.equal(formatMessage('视频改用 {model}？', { model: '示例视频' }, 'zh'), '视频改用示例视频？');
  assert.equal(formatMessage('视频改用 {model}？', { model: 'MiniMax Hailuo' }, 'zh'), '视频改用 MiniMax Hailuo？');
  assert.equal(formatMessage('{name} 没有导入。', { name: '照片' }, 'zh'), '照片没有导入。');
  assert.equal(formatMessage('{name} 没有导入。', { name: 'harbour.png' }, 'zh'), 'harbour.png 没有导入。');
  assert.equal(formatMessage('占用着 {shots}', { shots: '3.1 和 3.2' }, 'zh'), '占用着 3.1 和 3.2');
  // English keeps its spaces, whatever the value.
  assert.equal(formatMessage('Use {model} for video?', { model: '示例视频' }, 'en'), 'Use 示例视频 for video?');
  assert.equal(translate('zh-CN', 'set.impact.title.video', { model: '示例视频' }), '视频改用示例视频？');
});

test('the preview caption stops between framing and prompt in their own script', () => {
  assert.deepEqual(previewCaption('Wide', 'The empty harbour at dawn.'), { id: 'preview.caption', values: { framing: 'Wide', prompt: 'The empty harbour at dawn.' } });
  assert.deepEqual(previewCaption('近景', '售票员盖章。'), { id: 'preview.caption_cjk', values: { framing: '近景', prompt: '售票员盖章。' } });
  // From the first real run: a framing that already ends in a stop gets no second one, and a framing written as a
  // whole sentence is left to the inspector (the caption is the prompt alone).
  assert.deepEqual(previewCaption('Close-up.', 'A white paper boat.'), { id: 'preview.caption_plain', values: { text: 'Close-up. A white paper boat.' } });
  assert.deepEqual(previewCaption('Wide view of the puddle and surrounding wet pavement.', 'Wide view of a white paper boat.'), { id: 'preview.caption_plain', values: { text: 'Wide view of a white paper boat.' } });
  assert.deepEqual(previewCaption('', 'A boat.'), { id: 'preview.caption_plain', values: { text: 'A boat.' } });
  const caption = (locale, framing, prompt) => translate(locale, previewCaption(framing, prompt).id, previewCaption(framing, prompt).values);
  assert.equal(caption('zh-CN', 'Wide', 'The empty harbour at dawn.'), 'Wide. The empty harbour at dawn.');
  assert.equal(caption('en', '近景', '售票员盖章。'), '近景。售票员盖章。');
  assert.equal(caption('en', 'Close-up', 'The clerk stamps the ticket.'), 'Close-up. The clerk stamps the ticket.');
});
