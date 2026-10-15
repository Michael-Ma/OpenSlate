import type { PriceQuote } from "@openslate/core/public";
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

/** Prices are host-configured estimates (plan decision D15): "about $1.50", or "no price set". Never "$0.00". */
export function priceMsg(quote: PriceQuote, locale: string): Msg {
  if (quote.priceUnknown || Number(quote.micros) === 0) return msg("price.unknown");
  // A mixed quote (clips plus voice lines) has no single unit price; show only the total.
  if (quote.units > 1 && Number(quote.unitMicros) > 0) return msg("price.about_each", { total: formatMicros(quote.micros, locale), count: quote.units, each: formatMicros(quote.unitMicros, locale) });
  return msg("price.about", { total: formatMicros(quote.micros, locale) });
}
