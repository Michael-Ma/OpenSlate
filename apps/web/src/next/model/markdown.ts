/**
 * A small, safe Markdown reader for the Director's replies. Pure: text in, a tree of blocks and inlines out.
 * The view turns the tree into React elements, so nothing here is ever HTML: a `<b>` in a reply stays the
 * characters `<b>`. Links keep only http, https and mailto addresses; anything else (javascript:, data:, relative
 * paths) shows as plain words. Pictures are never loaded: `![alt](url)` becomes a link to the picture.
 * `#openslate-ref/...` links (the classic composer's references) become references the view can open.
 *
 * Covered: paragraphs (a single line break is kept as a line break, as the Director writes), ATX and setext
 * headings, bullet and numbered lists (nested by indentation), fenced code blocks, block quotes, rules, GitHub
 * tables, emphasis, strong, strikethrough, inline code, links, autolinks and bare web addresses, and backslash
 * escapes. Anything it does not understand stays as the text it was.
 */

export interface RefLink {
  projectId: string;
  kind: "project" | "scene" | "shot" | "image" | "video" | "audio";
  id: string;
  /** Empty for scenes, shots and the film. */
  sha256: string;
}

export type Inline =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "code"; text: string }
  | { type: "em" | "strong" | "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "ref"; ref: RefLink; label: string }
  /** A picture link: shown as a link (or plain words when its address is not safe), never loaded. */
  | { type: "image"; alt: string; href: string | null };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: "rule" };

/** Deeper nesting than this (lists in quotes in lists…, or emphasis in emphasis…) stays as plain text. */
const MAX_DEPTH = 12;
/** A reply longer than this is shown as plain paragraphs; the server caps one reply at 32,000 characters. */
const MAX_LENGTH = 40000;
/**
 * How far a code span, a link label or an emphasis looks for its end. Without a bound, text full of unmatched
 * openers ("[[[[…", "*a *a *a…") would take quadratic time; real spans are far shorter.
 */
const REACH = 1000;

// ---- addresses -----------------------------------------------------------------------------

const REF_KINDS = new Set<RefLink["kind"]>(["project", "scene", "shot", "image", "video", "audio"]);

/** `#openslate-ref/<project>/<kind>/<id>/<sha256>`, each part URI-encoded; null for anything else. */
export function parseRefLink(href: string): RefLink | null {
  if (!href.startsWith("#openslate-ref/")) return null;
  try {
    const parts = href.slice("#openslate-ref/".length).split("/").map(decodeURIComponent);
    if (parts.length !== 4) return null;
    const [projectId, kind, id, sha256] = parts as [string, string, string, string];
    if (!projectId || !id || !REF_KINDS.has(kind as RefLink["kind"])) return null;
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) return null;
    return { projectId, kind: kind as RefLink["kind"], id, sha256 };
  } catch {
    return null;
  }
}

export function refLink(ref: RefLink): string {
  return `#openslate-ref/${[ref.projectId, ref.kind, ref.id, ref.sha256].map(encodeURIComponent).join("/")}`;
}

/** Only web and mail addresses open; everything else is shown as words. */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!/^(?:https?:\/\/|mailto:)/i.test(trimmed)) return null;
  // No spaces or control characters inside an address.
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
    if (parsed.protocol !== "mailto:" && !parsed.hostname) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// ---- inlines ------------------------------------------------------------------------------

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

function runLength(text: string, at: number, char: string): number {
  let end = at;
  while (text[end] === char) end++;
  return end - at;
}

/** A code span starting at a backtick run: its text and where it ends, or null when the run is not closed. */
function codeSpan(text: string, at: number): { text: string; end: number } | null {
  const open = runLength(text, at, "`");
  let search = at + open;
  while (search < text.length) {
    const next = text.indexOf("`", search);
    if (next < 0 || next - at > REACH) return null;
    const run = runLength(text, next, "`");
    if (run === open) {
      let inner = text.slice(at + open, next).replace(/\n/g, " ");
      if (inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()) inner = inner.slice(1, -1);
      return { text: inner, end: next + run };
    }
    search = next + run;
  }
  return null;
}

/** `[label](url "title")` starting at `[`: the label, the url and where it ends. */
function linkAt(text: string, at: number): { label: string; url: string; end: number } | null {
  if (text[at] !== "[") return null;
  let depth = 0;
  let close = -1;
  for (let index = at; index < text.length && index - at <= REACH; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (char === "`") { const span = codeSpan(text, index); if (span) { index = span.end - 1; continue; } }
    if (char === "[") depth++;
    else if (char === "]" && --depth === 0) { close = index; break; }
  }
  if (close < 0 || text[close + 1] !== "(") return null;
  let parens = 0;
  let index = close + 2;
  while (index < text.length && text[index] === " ") index++;
  const start = index;
  let url = "";
  if (text[index] === "<") {
    const end = text.indexOf(">", index);
    if (end < 0 || text.slice(index + 1, end).includes("\n")) return null;
    url = text.slice(index + 1, end);
    index = end + 1;
  } else {
    for (; index < text.length; index++) {
      if (index - start > REACH) return null;
      const char = text[index]!;
      if (char === "\\" && index + 1 < text.length) { index++; continue; }
      if (char === "(") parens++;
      else if (char === ")") { if (parens === 0) break; parens--; }
      else if (/\s/.test(char)) break;
    }
    url = text.slice(start, index);
  }
  while (index < text.length && /[ \t]/.test(text[index]!)) index++;
  // An optional title in quotes is read and dropped.
  if (text[index] === '"' || text[index] === "'") {
    const quote = text[index]!;
    const end = text.indexOf(quote, index + 1);
    if (end < 0) return null;
    index = end + 1;
    while (index < text.length && /[ \t]/.test(text[index]!)) index++;
  }
  if (text[index] !== ")") return null;
  return { label: text.slice(at + 1, close), url: url.replace(/\\([!-/:-@[-`{-~])/g, "$1"), end: index + 1 };
}

/** A bare web address starting here, without the punctuation that usually ends a sentence after it. */
function bareUrl(text: string, at: number): string | null {
  const match = /^https?:\/\/[^\s<>"`]+/i.exec(text.slice(at));
  if (!match) return null;
  let url = match[0];
  for (;;) {
    const last = url.at(-1)!;
    if (/[.,;:!?'*_~]/.test(last)) { url = url.slice(0, -1); continue; }
    if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) { url = url.slice(0, -1); continue; }
    break;
  }
  return safeHref(url) && url.length > "https://".length ? url : null;
}

/** Emphasis, strong or strikethrough opening here: its kind, its inside and where it ends. */
function emphasisAt(text: string, at: number): { type: "em" | "strong" | "del"; inner: string; end: number } | null {
  const char = text[at]!;
  const run = runLength(text, at, char);
  if (char === "~" && run !== 2) return null;
  const size = char === "~" ? 2 : run >= 2 ? 2 : 1;
  const after = text[at + size];
  if (!after || /\s/.test(after)) return null;
  if (char === "_" && at > 0 && WORD.test(text[at - 1]!)) return null;
  let index = at + size;
  while (index < text.length && index - at <= REACH) {
    const current = text[index]!;
    if (current === "\\") { index += 2; continue; }
    if (current === "`") { const span = codeSpan(text, index); if (span) { index = span.end; continue; } }
    if (current === char) {
      const closing = runLength(text, index, char);
      const fits = size === 2 ? closing >= 2 : closing === 1 || closing >= 3;
      const before = text[index - 1]!;
      const end = index + closing;
      const closes = fits && !/\s/.test(before) && (char !== "_" || !WORD.test(text[end] ?? ""));
      if (closes && index > at + size) {
        const closeAt = end - size;
        return { type: char === "~" ? "del" : size === 2 ? "strong" : "em", inner: text.slice(at + size, closeAt), end };
      }
      index = end;
      continue;
    }
    index++;
  }
  return null;
}

/** The plain words of some inlines (a picture's alt text, a reference's label). */
export function plainText(inlines: readonly Inline[]): string {
  return inlines.map((inline) => {
    switch (inline.type) {
      case "text": return inline.text;
      case "br": return " ";
      case "code": return inline.text;
      case "ref": return inline.label;
      case "image": return inline.alt;
      default: return plainText(inline.children);
    }
  }).join("");
}

/** A link's label may not hold another link: inner links keep their words only. */
function unlink(inlines: Inline[]): Inline[] {
  return inlines.flatMap((inline): Inline[] => {
    if (inline.type === "link") return unlink(inline.children);
    if (inline.type === "ref") return [{ type: "text", text: inline.label }];
    if (inline.type === "em" || inline.type === "strong" || inline.type === "del") return [{ ...inline, children: unlink(inline.children) }];
    return [inline];
  });
}

function merge(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    const last = out.at(-1);
    if (inline.type === "text" && last?.type === "text") out[out.length - 1] = { type: "text", text: last.text + inline.text };
    else if (inline.type !== "text" || inline.text) out.push(inline);
  }
  return out;
}

export function parseInline(text: string, depth = 0): Inline[] {
  if (depth > MAX_DEPTH) return [{ type: "text", text }];
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => { if (buffer) out.push({ type: "text", text: buffer }); buffer = ""; };
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      const next = text[index + 1];
      if (next === "\n") { buffer = buffer.replace(/ +$/, ""); flush(); out.push({ type: "br" }); index += 2; continue; }
      if (next && PUNCTUATION.test(next)) { buffer += next; index += 2; continue; }
    }
    if (char === "\n") {
      buffer = buffer.replace(/ +$/, "");
      flush();
      out.push({ type: "br" });
      index++;
      while (text[index] === " " || text[index] === "\t") index++;
      continue;
    }
    if (char === "`") {
      const span = codeSpan(text, index);
      if (span) { flush(); out.push({ type: "code", text: span.text }); index = span.end; continue; }
      const run = runLength(text, index, "`");
      buffer += text.slice(index, index + run);
      index += run;
      continue;
    }
    if (char === "!" && text[index + 1] === "[") {
      const link = linkAt(text, index + 1);
      if (link) {
        flush();
        out.push({ type: "image", alt: plainText(parseInline(link.label, depth + 1)), href: safeHref(link.url) });
        index = link.end;
        continue;
      }
    }
    if (char === "[") {
      const link = linkAt(text, index);
      if (link) {
        flush();
        const ref = parseRefLink(link.url);
        const label = parseInline(link.label, depth + 1);
        const href = ref ? null : safeHref(link.url);
        if (ref) out.push({ type: "ref", ref, label: plainText(label) });
        else if (href) out.push({ type: "link", href, children: merge(unlink(label)) });
        else out.push(...label);
        index = link.end;
        continue;
      }
    }
    if (char === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(index));
      const href = auto ? safeHref(auto[1]!) : null;
      if (auto && href) { flush(); out.push({ type: "link", href, children: [{ type: "text", text: auto[1]!.replace(/^mailto:/i, "") }] }); index += auto[0].length; continue; }
    }
    if ((char === "h" || char === "H") && (index === 0 || /[\s(["'*_~]/.test(text[index - 1]!))) {
      const url = bareUrl(text, index);
      if (url) { flush(); out.push({ type: "link", href: url, children: [{ type: "text", text: url }] }); index += url.length; continue; }
    }
    if (char === "*" || char === "_" || char === "~") {
      const emphasis = emphasisAt(text, index);
      if (emphasis) {
        flush();
        out.push({ type: emphasis.type, children: parseInline(emphasis.inner, depth + 1) });
        index = emphasis.end;
        continue;
      }
      const run = runLength(text, index, char);
      buffer += text.slice(index, index + run);
      index += run;
      continue;
    }
    buffer += char;
    index++;
  }
  flush();
  return merge(out);
}

// ---- blocks -------------------------------------------------------------------------------

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|[ \t]*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_SEPARATOR = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const blank = (line: string) => !line.trim();
const indentOf = (line: string) => line.length - line.trimStart().length;

/** Table cells: split on pipes outside code spans and escapes, without the outer pipes. */
function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\\" && text[index + 1] === "|") { cell += "|"; index++; continue; }
    if (char === "`") {
      const span = codeSpan(text, index);
      if (span) { cell += text.slice(index, span.end); index = span.end - 1; continue; }
    }
    if (char === "|") { out.push(cell.trim()); cell = ""; continue; }
    cell += char;
  }
  out.push(cell.trim());
  return out;
}

function isTableStart(lines: readonly string[], at: number): boolean {
  const head = lines[at];
  const separator = lines[at + 1];
  if (!head || !separator || !head.includes("|") || !TABLE_SEPARATOR.test(separator) || !separator.includes("-")) return false;
  return cells(head).length === cells(separator).length;
}

function itemMarker(line: string): { indent: number; marker: string; ordered: boolean; start: number; content: string; contentIndent: number } | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const [, lead = "", marker = "", gap = "", rest = ""] = match;
  const ordered = /\d/.test(marker);
  // A gap of five or more spaces is code inside the item; one space then counts as the gap.
  const width = gap.length >= 5 ? 1 : Math.max(1, gap.length);
  const content = gap.length >= 5 ? `${" ".repeat(gap.length - 1)}${rest}` : rest;
  return { indent: lead.length, marker, ordered, start: ordered ? Number.parseInt(marker, 10) : 1, content, contentIndent: lead.length + marker.length + width };
}

/** Whether this line ends a paragraph by starting another block. */
function interrupts(lines: readonly string[], at: number): boolean {
  const line = lines[at]!;
  if (FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line)) return true;
  const item = itemMarker(line);
  // As in CommonMark: a numbered list interrupts a paragraph only when it starts at 1, and an empty item never does.
  if (item && item.content.trim() && (!item.ordered || item.start === 1)) return true;
  return isTableStart(lines, at);
}

function parseLines(lines: readonly string[], depth: number): Block[] {
  if (depth > MAX_DEPTH) return [{ type: "paragraph", inlines: [{ type: "text", text: lines.join("\n") }] }];
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (blank(line)) { index++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, lead = "", marks = "", lang = ""] = fence;
      const body: string[] = [];
      index++;
      while (index < lines.length) {
        const current = lines[index]!;
        const close = new RegExp(`^ {0,3}${marks[0] === "`" ? "`" : "~"}{${marks.length},}[ \\t]*$`);
        if (close.test(current)) { index++; break; }
        body.push(current.slice(Math.min(lead.length, indentOf(current))));
        index++;
      }
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, inlines: parseInline((heading[2] ?? "").trim(), depth + 1) });
      index++;
      continue;
    }

    if (RULE.test(line)) { blocks.push({ type: "rule" }); index++; continue; }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && !blank(lines[index]!)) {
        const current = lines[index]!;
        if (QUOTE.test(current)) inner.push(current.replace(QUOTE, ""));
        else if (inner.length && !interrupts(lines, index)) inner.push(current);
        else break;
        index++;
      }
      blocks.push({ type: "quote", blocks: parseLines(inner, depth + 1) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const head = cells(line);
      const align: Align[] = cells(lines[index + 1]!).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && !blank(lines[index]!) && lines[index]!.includes("|") && !FENCE.test(lines[index]!) && !HEADING.test(lines[index]!)) {
        const row = cells(lines[index]!);
        rows.push(head.map((_, column) => parseInline(row[column] ?? "", depth + 1)));
        index++;
      }
      blocks.push({ type: "table", align, head: head.map((cell) => parseInline(cell, depth + 1)), rows });
      continue;
    }

    const first = itemMarker(line);
    if (first) {
      const items: Block[][] = [];
      let marker = first;
      while (marker && marker.ordered === first.ordered && (first.ordered || marker.marker === first.marker)) {
        const body = [marker.content];
        const nestIndent = Math.min(marker.contentIndent, marker.indent + 2);
        index++;
        while (index < lines.length) {
          const current = lines[index]!;
          if (blank(current)) {
            // A blank line stays inside the item only when indented content follows it.
            let next = index + 1;
            while (next < lines.length && blank(lines[next]!)) next++;
            if (next < lines.length && indentOf(lines[next]!) >= nestIndent) { body.push(""); index++; continue; }
            break;
          }
          const indent = indentOf(current);
          if (indent >= nestIndent) { body.push(current.slice(Math.min(indent, marker.contentIndent))); index++; continue; }
          // A lazy line continues the item's paragraph.
          if (!blank(body.at(-1) ?? "") && !itemMarker(current) && !interrupts(lines, index)) { body.push(current.trimStart()); index++; continue; }
          break;
        }
        items.push(parseLines(body, depth + 1));
        // The list goes on past one blank line when the next item has the same kind of marker.
        let next = index;
        while (next < lines.length && blank(lines[next]!)) next++;
        const following = next < lines.length ? itemMarker(lines[next]!) : null;
        if (!following || following.indent > 3) break;
        index = next;
        marker = following;
      }
      blocks.push({ type: "list", ordered: first.ordered, start: first.start, items });
      continue;
    }

    // A paragraph: lines up to a blank line or another block. A following ===/--- line makes it a heading.
    const paragraph: string[] = [line.trim()];
    index++;
    let setext = 0;
    while (index < lines.length && !blank(lines[index]!)) {
      const current = lines[index]!;
      const underline = SETEXT.exec(current);
      if (underline) { setext = underline[1]!.startsWith("=") ? 1 : 2; index++; break; }
      if (interrupts(lines, index)) break;
      paragraph.push(current.trim());
      index++;
    }
    const inlines = parseInline(paragraph.join("\n"), depth + 1);
    blocks.push(setext ? { type: "heading", level: setext, inlines } : { type: "paragraph", inlines });
  }
  return blocks;
}

/** The blocks of a reply. Very long text is not parsed: it shows as plain paragraphs. */
export function parseMarkdown(text: string): Block[] {
  const normal = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  if (normal.length > MAX_LENGTH)
    return normal.split(/\n[ \t]*\n+/).map((part) => part.trim()).filter(Boolean).map((part) => ({ type: "paragraph", inlines: [{ type: "text", text: part }] }));
  return parseLines(normal.split("\n"), 0);
}
