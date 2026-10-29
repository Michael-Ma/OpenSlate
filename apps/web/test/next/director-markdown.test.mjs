import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, parseRefLink, refLink, safeHref, plainText } from '../../src/next/model/markdown.ts';

const text = (value) => ({ type: 'text', text: value });

test('paragraphs keep single line breaks and split on blank lines; HTML stays text', () => {
  const blocks = parseMarkdown('First line\nsecond line\n\n<b>bold?</b> <script>alert(1)</script>');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { type: 'paragraph', inlines: [text('First line'), { type: 'br' }, text('second line')] });
  assert.deepEqual(blocks[1], { type: 'paragraph', inlines: [text('<b>bold?</b> <script>alert(1)</script>')] });
});

test('emphasis, strong, strikethrough and inline code; snake_case and lone stars stay words', () => {
  assert.deepEqual(parseInline('**strong** and *em* and _em_ and __strong__ and ~~gone~~ and `a*b*c`'), [
    { type: 'strong', children: [text('strong')] }, text(' and '),
    { type: 'em', children: [text('em')] }, text(' and '),
    { type: 'em', children: [text('em')] }, text(' and '),
    { type: 'strong', children: [text('strong')] }, text(' and '),
    { type: 'del', children: [text('gone')] }, text(' and '),
    { type: 'code', text: 'a*b*c' },
  ]);
  assert.deepEqual(parseInline('a snake_case_name and 5 * 3 and * alone'), [text('a snake_case_name and 5 * 3 and * alone')]);
  assert.deepEqual(parseInline('*a **b** c*'), [{ type: 'em', children: [text('a '), { type: 'strong', children: [text('b')] }, text(' c')] }]);
  assert.deepEqual(parseInline('\\*not em\\*'), [text('*not em*')]);
});

test('links keep only web and mail addresses; anything else is shown as its words', () => {
  assert.deepEqual(parseInline('[docs](https://example.com/a?b=1)'), [{ type: 'link', href: 'https://example.com/a?b=1', children: [text('docs')] }]);
  assert.deepEqual(parseInline('[mail](mailto:me@example.com)'), [{ type: 'link', href: 'mailto:me@example.com', children: [text('mail')] }]);
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '/relative/path', 'file:///etc/passwd', '//evil.example'])
    assert.deepEqual(parseInline(`[click](${bad})`), [text('click')], bad);
  assert.equal(safeHref('https://exa mple.com'), null);
  assert.equal(safeHref('https://example.com'), 'https://example.com');
  // A link's label never holds another link.
  assert.deepEqual(parseInline('[see [inner](https://b.example)](https://a.example)'), [{ type: 'link', href: 'https://a.example', children: [text('see inner')] }]);
});

test('bare and angle-bracket web addresses become links, without the sentence punctuation after them', () => {
  assert.deepEqual(parseInline('Read https://example.com/guide. Then <https://example.org>'), [
    text('Read '), { type: 'link', href: 'https://example.com/guide', children: [text('https://example.com/guide')] },
    text('. Then '), { type: 'link', href: 'https://example.org', children: [text('https://example.org')] },
  ]);
  assert.deepEqual(parseInline('(see https://example.com/a_(b))'), [text('(see '), { type: 'link', href: 'https://example.com/a_(b)', children: [text('https://example.com/a_(b)')] }, text(')')]);
});

test('pictures are never loaded: they become a link with their alt text, or words when the address is unsafe', () => {
  assert.deepEqual(parseInline('![the harbour](https://cdn.example/harbour.png)'), [{ type: 'image', alt: 'the harbour', href: 'https://cdn.example/harbour.png' }]);
  assert.deepEqual(parseInline('![x](javascript:alert(1))'), [{ type: 'image', alt: 'x', href: null }]);
});

test('#openslate-ref links become references; malformed ones are words', () => {
  const ref = { projectId: 'last-ferry', kind: 'shot', id: 'shot-2-3', sha256: '' };
  assert.deepEqual(parseRefLink(refLink(ref)), ref);
  assert.deepEqual(parseInline(`Look at [@2.3](${refLink(ref)}).`), [text('Look at '), { type: 'ref', ref, label: '@2.3' }, text('.')]);
  assert.equal(parseRefLink('#openslate-ref/p/elephant/x/'), null);
  assert.equal(parseRefLink('#openslate-ref/p/image/x/not-a-sha'), null);
  assert.equal(parseRefLink('#openslate-ref/p/shot'), null);
  const image = { projectId: 'p', kind: 'image', id: 'art-ref', sha256: 'a'.repeat(64) };
  assert.deepEqual(parseRefLink(refLink(image)), image);
});

test('bullet and numbered lists, nested by indentation, with lazy continuation lines', () => {
  const [list, numbered] = parseMarkdown('- one\n- two\n  - nested\ncontinued\n- three\n\n3. c\n4. d');
  assert.equal(list.type, 'list');
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[1][1], { type: 'list', ordered: false, start: 1, items: [[{ type: 'paragraph', inlines: [text('nested'), { type: 'br' }, text('continued')] }]] });
  assert.deepEqual([numbered.type, numbered.ordered, numbered.start, numbered.items.length], ['list', true, 3, 2]);
  // A numbered list under a paragraph starts only at 1 (a sentence like "In 2026. we" stays a paragraph).
  assert.equal(parseMarkdown('Shots:\n1. wide\n2. close').length, 2);
  assert.equal(parseMarkdown('We met in\n2026. It rained.').length, 1);
});

test('fenced code keeps its text exactly and is never parsed further', () => {
  const [code] = parseMarkdown('```js\nconst a = "<b>**x**</b>";\n  indented\n```');
  assert.deepEqual(code, { type: 'code', lang: 'js', text: 'const a = "<b>**x**</b>";\n  indented' });
  const [open] = parseMarkdown('~~~\nnever closed');
  assert.deepEqual(open, { type: 'code', lang: '', text: 'never closed' });
});

test('GitHub tables with alignment; short rows are padded and long ones cut to the header', () => {
  const [table] = parseMarkdown('| Shot | Now | After |\n| --- | ---: | :-: |\n| 3.1 | 8 s | 9 s |\n| 3.2 |\n| a | b | c | d |');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.align, [null, 'right', 'center']);
  assert.deepEqual(table.head.map(plainText), ['Shot', 'Now', 'After']);
  assert.deepEqual(table.rows.map(row => row.map(plainText)), [['3.1', '8 s', '9 s'], ['3.2', '', ''], ['a', 'b', 'c']]);
  // Pipes inside code spans and escaped pipes stay in their cell.
  const [code] = parseMarkdown('| a | b |\n|---|---|\n| `x|y` | c\\|d |');
  assert.deepEqual(code.rows[0].map(plainText), ['x|y', 'c|d']);
  // Without a separator line it is a paragraph.
  assert.equal(parseMarkdown('a | b\nc | d')[0].type, 'paragraph');
});

test('headings, quotes and rules', () => {
  const blocks = parseMarkdown('# Plan #\nSubtitle\n---\n> quoted\n> more\n\n***');
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'heading', 'quote', 'rule']);
  assert.deepEqual([blocks[0].level, plainText(blocks[0].inlines)], [1, 'Plan']);
  assert.deepEqual([blocks[1].level, plainText(blocks[1].inlines)], [2, 'Subtitle']);
  assert.equal(blocks[2].blocks[0].type, 'paragraph');
});

test('deep nesting and very long replies degrade to plain text instead of failing', () => {
  const deep = '>'.repeat(40) + ' deep';
  assert.doesNotThrow(() => parseMarkdown(deep));
  const stars = '*'.repeat(5000) + 'x';
  assert.doesNotThrow(() => parseInline(stars));
  const long = parseMarkdown('word '.repeat(9000) + '\n\n**second**');
  assert.deepEqual(long.map(b => b.type), ['paragraph', 'paragraph']);
  assert.deepEqual(long[1].inlines, [text('**second**')]);
});
