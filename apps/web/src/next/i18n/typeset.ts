/**
 * Typography for interface text in both languages: what may not break across a line, and how a list of shots is
 * joined. Pure string functions; the I18n hook applies `keepTogether` to every string it hands the interface.
 */

const NBSP = "\u00a0";

/** Han, kana, CJK punctuation and full-width forms: text that takes no ASCII space beside its own kind. */
const CJK = /[\u2e80-\u2fff\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
export const isCjk = (char: string | undefined): boolean => !!char && CJK.test(char);

/** Latin letters and digits: what Chinese text sets apart with a space ("第 2 场", "3.1 和 3.2"). */
const LATIN = /[A-Za-z0-9]/;

/**
 * A number and the unit after it ("6 s", "30 fps", "-18 dB", "1.2 MB", "8 秒", "3 场", "2 个"). The unit must end
 * there, so "2 shots" or "3 scenes" are left alone.
 */
const NUMBER_UNIT = /(\d) (?=(?:s|ms|min|fps|dB|KB|MB|GB|%|秒|分钟|帧\/秒|帧|场|个|段|张|条|次)(?![A-Za-z]))/g;
/** "第 2 场": the ordinal mark stays with its number. */
const ORDINAL = /第 (?=\d)/g;
/** "about $0.04", "About 3 s", "约 $0.50": the estimate stays with the amount it qualifies. */
const ABOUT = /(\b[Aa]bout|约) (?=[$€£¥]|\d)/g;

/**
 * No line break between a number and its unit, or between "about" / "约" and the price or length after it: the
 * space becomes a no-break space, which still reads and copies as a space.
 */
export function keepTogether(text: string): string {
  if (!text.includes(" ")) return text;
  return text.replace(NUMBER_UNIT, `$1${NBSP}`).replace(ORDINAL, `第${NBSP}`).replace(ABOUT, `$1${NBSP}`);
}

/**
 * "2.2 and 2.3", "2.1, 2.2, and 2.3"; in Chinese "3.1 和 3.2" and "2.1、2.2 和 2.3": the 和 / 或 that Intl puts
 * between items is set apart from a Latin or digit neighbour, as the catalogs write "第 2 场". `locale` is a BCP 47
 * tag ("en-US", "zh-CN").
 */
export function formatList(items: readonly string[], locale: string, type: "conjunction" | "disjunction" = "conjunction"): string {
  let parts: { type: "element" | "literal"; value: string }[];
  try {
    parts = new Intl.ListFormat(locale, { style: "long", type }).formatToParts(items);
  } catch {
    return items.join(", ");
  }
  return parts.map((part, index) => {
    if (part.type !== "literal" || !/^[和或]$/.test(part.value.trim())) return part.value;
    const before = parts[index - 1]?.value.at(-1);
    const after = parts[index + 1]?.value[0];
    const word = part.value.trim();
    return `${before && LATIN.test(before) ? " " : ""}${word}${after && LATIN.test(after) ? " " : ""}`;
  }).join("");
}
