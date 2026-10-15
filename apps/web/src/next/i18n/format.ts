/**
 * A small ICU-style formatter: `{name}` placeholders and
 * `{count, plural, =0 {...} one {...} other {...}}` with `#` for the number.
 * Branches may contain placeholders. Missing values render as the placeholder name in braces.
 */
export type MessageValues = Readonly<Record<string, string | number>>;

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return index;
  }
  throw new Error(`Unbalanced braces in message: ${text}`);
}

function plural(body: string, value: number, locale: string, values: MessageValues): string {
  const branches = new Map<string, string>();
  let index = 0;
  while (index < body.length) {
    const open = body.indexOf("{", index);
    if (open < 0) break;
    const key = body.slice(index, open).trim();
    const close = matchBrace(body, open);
    branches.set(key, body.slice(open + 1, close));
    index = close + 1;
  }
  const category = new Intl.PluralRules(locale).select(value);
  const branch = branches.get(`=${value}`) ?? branches.get(category) ?? branches.get("other") ?? "";
  // Replace # before filling placeholders so a value containing "#" is left alone.
  return formatMessage(branch.replaceAll("#", new Intl.NumberFormat(locale).format(value)), values, locale);
}

export function formatMessage(template: string, values: MessageValues = {}, locale = "en"): string {
  let out = "";
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf("{", index);
    if (open < 0) { out += template.slice(index); break; }
    out += template.slice(index, open);
    const close = matchBrace(template, open);
    const inner = template.slice(open + 1, close);
    const comma = inner.indexOf(",");
    if (comma >= 0 && inner.slice(comma + 1).trimStart().startsWith("plural")) {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1).trimStart().slice("plural".length).replace(/^\s*,/, "");
      const value = Number(values[name] ?? 0);
      out += plural(rest, value, locale, values);
    } else {
      const name = inner.trim();
      out += name in values ? String(values[name]) : `{${name}}`;
    }
    index = close + 1;
  }
  return out;
}
