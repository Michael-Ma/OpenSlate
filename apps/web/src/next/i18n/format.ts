import { isCjk } from "./typeset.ts";

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

/**
 * Chinese templates put a space between Chinese and a placeholder ("改用 {model}", "{shot} 的配音") because the value
 * is usually a shot label or a Latin name. When the value itself starts (or ends) with Chinese, that space would sit
 * between two Chinese characters, so it is left out: "改用示例视频", not "改用 示例视频".
 */
function joinsChinese(locale: string): boolean {
  return locale.startsWith("zh");
}

export function formatMessage(template: string, values: MessageValues = {}, locale = "en"): string {
  const chinese = joinsChinese(locale);
  let out = "";
  let index = 0;
  /** The value just inserted ended in Chinese, so a space that follows in the template before Chinese is dropped. */
  let afterChinese = false;
  const literal = (text: string) => {
    out += afterChinese && text[0] === " " && isCjk(text[1]) ? text.slice(1) : text;
    afterChinese = false;
  };
  while (index < template.length) {
    const open = template.indexOf("{", index);
    if (open < 0) { literal(template.slice(index)); break; }
    if (open > index) literal(template.slice(index, open));
    const close = matchBrace(template, open);
    const inner = template.slice(open + 1, close);
    const comma = inner.indexOf(",");
    if (comma >= 0 && inner.slice(comma + 1).trimStart().startsWith("plural")) {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1).trimStart().slice("plural".length).replace(/^\s*,/, "");
      const value = Number(values[name] ?? 0);
      out += plural(rest, value, locale, values);
      afterChinese = false;
    } else {
      const name = inner.trim();
      const value = name in values ? String(values[name]) : `{${name}}`;
      if (chinese && isCjk(value[0]) && out.endsWith(" ") && isCjk(out.at(-2))) out = out.slice(0, -1);
      out += value;
      afterChinese = chinese && isCjk(value.at(-1));
    }
    index = close + 1;
  }
  return out;
}
