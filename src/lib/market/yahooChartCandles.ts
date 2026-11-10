import type { Candle } from "./indicators";

export interface YahooChartMeta {
  longName?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  chartPreviousClose?: number;
}

export interface YahooChartQuoteSeries {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
}

function finite(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Converts Yahoo Chart arrays into candles, skipping incomplete rows.
 *
 * Yahoo often leaves the newest bar's close as null after the session ends
 * (e.g. the day after a US close) while meta.regularMarketPrice already holds
 * that close. Dropping the bar would make the latest price one session stale,
 * so the final bar is completed from meta when the quote falls inside it.
 */
export function buildYahooChartCandles(
  timestamps: number[],
  quote: YahooChartQuoteSeries,
  meta: YahooChartMeta = {},
): Candle[] {
  const candles: Candle[] = [];
  const lastIndex = timestamps.length - 1;

  for (let i = 0; i < timestamps.length; i++) {
    let open = finite(quote.open?.[i]);
    let high = finite(quote.high?.[i]);
    let low = finite(quote.low?.[i]);
    let close = finite(quote.close?.[i]);
    let volume = finite(quote.volume?.[i]);

    const metaPrice = finite(meta.regularMarketPrice);
    const metaTime = finite(meta.regularMarketTime);
    if (
      i === lastIndex &&
      close === undefined &&
      metaPrice !== undefined &&
      metaTime !== undefined &&
      metaTime >= timestamps[i]
    ) {
      close = metaPrice;
      open ??= metaPrice;
      high ??= finite(meta.regularMarketDayHigh);
      low ??= finite(meta.regularMarketDayLow);
      volume ??= finite(meta.regularMarketVolume) ?? 0;
      high = Math.max(high ?? metaPrice, open, close);
      low = Math.min(low ?? metaPrice, open, close);
    }

    if (
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    ) {
      continue;
    }

    candles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return candles;
}
