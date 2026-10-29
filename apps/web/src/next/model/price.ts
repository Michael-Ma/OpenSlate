import type { GenerationOverview, PriceQuote } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

/**
 * "$1.50" from integer micro-dollars. Sub-cent amounts keep three decimals ("$0.004"); amounts under a tenth of
 * a cent keep two significant digits ("$0.0001"), so a real price never reads as "$0.000".
 */
export function formatMicros(micros: string | number, locale: string): string {
  const dollars = Number(micros) / 1_000_000;
  // narrowSymbol: "$" in every locale (zh-CN would otherwise print "US$").
  const base = { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" } as const;
  if (dollars > 0 && dollars < 0.001) return new Intl.NumberFormat(locale, { ...base, maximumSignificantDigits: 2 }).format(dollars);
  const fractionDigits = dollars > 0 && dollars < 0.01 ? 3 : 2;
  return new Intl.NumberFormat(locale, { ...base, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(dollars);
}

/** Host estimates and subscription use can coexist (Codex frames plus a per-call voice line). Never "$0.00". */
export function priceMsg(quote: PriceQuote, locale: string): Msg {
  if (quote.subscription === "codex") {
    if (quote.priceUnknown) return msg("price.codex_unknown");
    if (Number(quote.micros) > 0) return msg("price.codex_about", { total: formatMicros(quote.micros, locale) });
    return msg("price.codex");
  }
  if (quote.priceUnknown || Number(quote.micros) === 0) return msg("price.unknown");
  // A mixed quote (clips plus voice lines) has no single unit price; show only the total.
  if (quote.units > 1 && Number(quote.unitMicros) > 0) return msg("price.about_each", { total: formatMicros(quote.micros, locale), count: quote.units, each: formatMicros(quote.unitMicros, locale) });
  return msg("price.about", { total: formatMicros(quote.micros, locale) });
}

/** The same selected-shot total for a regeneration label and its expected-price fence. */
/** A new clip for saved shots: the sum of each shot's own remake quote (exact; the voice lines are reused). */
export function clipRemakeEstimate(shotIds: readonly string[], overview: GenerationOverview): Pick<PriceQuote, "micros" | "priceUnknown"> | null {
  if (!shotIds.length) return null;
  let total = 0n;
  let priceUnknown = false;
  for (const id of new Set(shotIds)) {
    const quote = overview.shots[id]?.quotes?.remakeClip;
    if (!quote || !/^\d+$/.test(quote.micros)) return null;
    total += BigInt(quote.micros);
    priceUnknown ||= quote.priceUnknown || BigInt(quote.micros) === 0n;
  }
  return { micros: String(total), priceUnknown };
}

export function keyframeEstimate(shotIds: readonly string[], overview: GenerationOverview): Pick<PriceQuote, "micros" | "priceUnknown" | "subscription"> | null {
  if (!shotIds.length) return null;
  let total = 0n;
  let priceUnknown = false;
  let subscription = false;
  for (const id of new Set(shotIds)) {
    const shot = overview.shots[id];
    if (!shot) return null;
    const scene = overview.scenes.find((row) => row.sceneId === shot.sceneId);
    // A scene fallback is supplied only when every shot has this same exact quote.
    const quote = shot.quotes?.regenerateKeyframe ?? scene?.quotes.regenerateKeyframe;
    if (!quote || !/^\d+$/.test(quote.micros)) return null;
    const micros = BigInt(quote.micros);
    total += micros;
    priceUnknown ||= quote.priceUnknown || (micros === 0n && !quote.subscription);
    subscription ||= quote.subscription === "codex";
  }
  return { micros: String(total), priceUnknown, ...(subscription ? { subscription: "codex" as const } : {}) };
}
