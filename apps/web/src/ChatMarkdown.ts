import { createElement } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ href, children }) => href
    ? createElement('a', { href, ...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' }) }, children)
    : createElement('span', null, children),
  // Chat text must not cause an automatic request to a model-supplied image host.
  // Owned image attachments continue through the verified asset viewer.
  img: ({ src, alt }) => src
    ? createElement('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, alt || 'Image reference')
    : createElement('span', null, alt || 'Image reference'),
  table: ({ children }) => createElement('div', { className: 'chat-table-scroll' }, createElement('table', null, children)),
};

export function ChatMarkdown({ text, messageId }: { text: string; messageId: string }) {
  const prefix = `chat-${messageId.replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  return createElement('div', { className: 'message-markdown' }, createElement(Markdown, {
    children: text, remarkPlugins: [remarkGfm], components,
    urlTransform: defaultUrlTransform, remarkRehypeOptions: { clobberPrefix: prefix },
  }));
}
