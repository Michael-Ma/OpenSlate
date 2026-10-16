import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { resolveRef } from "../model/director.ts";
import type { Block, Inline, RefLink } from "../model/markdown.ts";
import { useStudio } from "../store/react.tsx";
import { RefChip } from "./RefChip.tsx";

/**
 * A Director reply as Markdown (model/markdown.ts), built from React elements only: no HTML from the reply is
 * ever injected, links open in a new tab without access to this page, and pictures are links, never loaded.
 * Tables and code blocks scroll sideways inside their own box (focusable, so the keyboard can scroll them).
 */
export function Markdown({ blocks }: { blocks: Block[] }) {
  return <div className="dir-text md">{blocks.map((block, index) => <BlockView key={index} block={block} />)}</div>;
}

function BlockView({ block }: { block: Block }): ReactNode {
  const { t } = useI18n();
  switch (block.type) {
    case "paragraph":
      return <p><Inlines inlines={block.inlines} /></p>;
    case "heading":
      // Headings inside a reply are emphasis, not page structure: the column's headings stay the page's own.
      return <p className={`md-h md-h${Math.min(block.level, 3)}`}><strong><Inlines inlines={block.inlines} /></strong></p>;
    case "list": {
      const items = block.items.map((item, index) => <li key={index}>{item.map((child, inner) => <BlockView key={inner} block={child} />)}</li>);
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      // A named group, so the scroll box can take focus (long lines scroll by keyboard) and says what it is.
      return <pre className="md-pre" role="group" tabIndex={0} aria-label={t("director.md.code")} data-lang={block.lang || undefined}><code>{block.text}</code></pre>;
    case "quote":
      return <blockquote>{block.blocks.map((child, index) => <BlockView key={index} block={child} />)}</blockquote>;
    case "rule":
      return <hr />;
    case "table":
      return (
        <div className="md-table" role="region" tabIndex={0} aria-label={t("director.md.table")}>
          <table>
            <thead>
              <tr>{block.head.map((cell, index) => <th key={index} scope="col" style={block.align[index] ? { textAlign: block.align[index]! } : undefined}><Inlines inlines={cell} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, index) => <td key={index} style={block.align[index] ? { textAlign: block.align[index]! } : undefined}><Inlines inlines={cell} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return <>{inlines.map((inline, index) => <InlineView key={index} inline={inline} />)}</>;
}

function InlineView({ inline }: { inline: Inline }): ReactNode {
  const { t } = useI18n();
  switch (inline.type) {
    case "text":
      return inline.text;
    case "br":
      return <br />;
    case "code":
      return <code className="md-code">{inline.text}</code>;
    case "em":
      return <em><Inlines inlines={inline.children} /></em>;
    case "strong":
      return <strong><Inlines inlines={inline.children} /></strong>;
    case "del":
      return <del><Inlines inlines={inline.children} /></del>;
    case "link":
      return <ExternalLink href={inline.href}><Inlines inlines={inline.children} /></ExternalLink>;
    case "image": {
      // A picture in a reply is never fetched (no request to a host the Director named): it is a link to it.
      const label = inline.alt ? t("director.md.image", { alt: inline.alt }) : t("director.md.image_untitled");
      return inline.href ? <ExternalLink href={inline.href}>{label}</ExternalLink> : <span className="md-image">{label}</span>;
    }
    case "ref":
      return <ReplyRef refLink={inline.ref} label={inline.label} />;
  }
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-act="reply-link">
      {children}
      <span className="sr"> {t("director.md.new_tab")}</span>
    </a>
  );
}

/** A reference in a reply: a button that opens its scene or shot, or plain chip words when there is nothing to open. */
function ReplyRef({ refLink, label }: { refLink: RefLink; label: string }) {
  const overview = useStudio((s) => s.overview);
  const view = resolveRef(refLink, overview);
  return <RefChip label={label.replace(/^@/, "")} target={view.open} />;
}
