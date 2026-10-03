import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '../src/ChatMarkdown.ts';
const render = (text, messageId = 'test') => renderToStaticMarkup(createElement(ChatMarkdown, { text, messageId }));
test('chat renders actual blocker Markdown as paragraphs, bold labels and a list', () => {
  const html = render('Two blockers remain:\n\n- **Storyboard generation:** review the plan.\n- **Shot narration:** save `shot.narration`.');
  assert.match(html, /<p>Two blockers remain:<\/p>/); assert.match(html, /<ul>/);
  assert.match(html, /<strong>Storyboard generation:<\/strong>/); assert.match(html, /<code>shot.narration<\/code>/);
  assert.doesNotMatch(html, /\*\*Storyboard/);
});
test('code, GFM tables, task lists and links retain their semantics', () => {
  const html = render('```ts\nconst frame = 180;\n```\n\n| Shot | Time |\n| --- | --- |\n| 1.1 | 6s |\n\n- [x] Reviewed\n\n[Guide](https://example.com/guide)');
  assert.match(html, /<pre><code class="language-ts">/); assert.match(html, /<table>/); assert.match(html, /<th>Shot<\/th>/);
  assert.match(html, /type="checkbox"/); assert.match(html, /rel="noopener noreferrer"/);
});
test('raw HTML and unsafe URLs do not become executable content or image requests', () => {
  const html = render('<script>alert(1)</script>\n\n[Bad](javascript:alert%281%29)\n\n![Preview](https://external.example/track.png)');
  assert.doesNotMatch(html, /<script>|href="javascript:|<img/); assert.match(html, /external\.example\/track\.png/);
});
test('footnote identities belong to their message and cannot jump into another message', () => {
  const text = 'A note[^1].\n\n[^1]: Details';
  assert.match(render(text, 'first'), /chat-first-fn-/); assert.match(render(text, 'second'), /chat-second-fn-/);
});
