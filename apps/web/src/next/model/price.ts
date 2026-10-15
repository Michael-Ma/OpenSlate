import type { PriceQuote } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

/** "$1.50" from integer micro-dollars. Sub-cent amounts keep two significant decimals ("$0.004"). */
export function formatMicros(micros: string | number, locale: string): string {
  const dollars = Number(micros) / 1_000_000;
  const fractionDigits = dollars > 0 && dollars < 0.01 ? 3 : 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(dollars);
}

/** Prices are host-configured estimates (plan decision D15): "about $1.50", or "no price set". Never "$0.00". */
export function priceMsg(quote: PriceQuote, locale: string): Msg {
  if (quote.priceUnknown || Number(quote.micros) === 0) return msg("price.unknown");
  if (quote.units > 1) return msg("price.about_each", { total: formatMicros(quote.micros, locale), count: quote.units, each: formatMicros(quote.unitMicros, locale) });
  return msg("price.about", { total: formatMicros(quote.micros, locale) });
}
