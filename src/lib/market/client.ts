import { Candle } from "./indicators";
import { getMarketRegion, getMarketDataPriority, MarketDataProvider, MarketRegion } from "./marketDataPriority";
import {
  getEastMoneySecidCandidates,
  convertSymbolToEastMoneyAShareSecid,
  aShareCodeToSuffixedSymbol,
} from "./symbolConversion";
import { buildEastMoneyKlineUrl, fetchEastMoneyJson } from "./eastmoneyHttp";
import { fetchTonghuashunMarketData, fetchTonghuashunQuote } from "./tonghuashun";
import { fetchTencentMarketData, fetchTencentQuote } from "./tencent";
import { fetchAShareRealtimeQuote } from "./ashareRealtime";
import { fetchEastMoneySymbolSuggestions, isSupportedEastMoneySuggestion, normalizeEastMoneySymbol } from "./symbolResolver";
import { ProviderCircuitBreaker } from "./providerCircuitBreaker";
import YahooFinance from "yahoo-finance2";

const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface RealtimeQuote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  date?: string;
  source: string;
}

export interface SymbolSuggestion {
  symbol: string;
  name: string;
  market: MarketRegion;
  typeDisp: string;
}

const EAST_MONEY_KLINE_HOSTS = [
  "push2his.eastmoney.com",
  "push2.eastmoney.com",
  "63.push2his.eastmoney.com",
  "82.push2his.eastmoney.com",
];
const EAST_MONEY_TIMEOUT_MS = 3500;
const circuitBreaker = new ProviderCircuitBreaker();

/**
 * 从东方财富拉取 K 线 (带多 Host 重试)
 */
async function fetchEastMoneyKlines(secid: string, limit: number = 300): Promise<Candle[]> {
  let lastError: unknown = null;
  for (const host of EAST_MONEY_KLINE_HOSTS) {
    try {
      const url = buildEastMoneyKlineUrl({ host, secid, klt: "101", limit });
      const data = await fetchEastMoneyJson<{ data?: { klines?: string[] } }>(url, EAST_MONEY_TIMEOUT_MS);
      const klines = data?.data?.klines;
      if (!klines || klines.length === 0) continue;

      return klines.map((item: string) => {
        const parts = item.split(",");
        return {
          date: parts[0],
          open: parseFloat(parts[1]),
          close: parseFloat(parts[2]),
          high: parseFloat(parts[3]),
          low: parseFloat(parts[4]),
          volume: parseInt(parts[5], 10) || 0,
        };
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`EastMoney kline failed for ${secid}`);
}

/**
 * 从 Yahoo Finance 拉取历史日线
 */
async function fetchYahooKlines(symbol: string, limit: number = 300): Promise<Candle[]> {
  const period1 = new Date();
  period1.setDate(period1.getDate() - Math.max(limit * 2, 400));

  const result = await yahoo.chart(symbol, {
    period1,
    interval: "1d",
  });

  const quotes = result.quotes || [];
  return quotes
    .filter((q) => q.close !== null && q.open !== null && q.high !== null && q.low !== null)
    .map((q) => ({
      date: q.date instanceof Date ? q.date.toISOString().substring(0, 10) : String(q.date).substring(0, 10),
      open: q.open ?? 0,
      high: q.high ?? 0,
      low: q.low ?? 0,
      close: q.close ?? 0,
      volume: q.volume ?? 0,
    }));
}

/**
 * 统一获取股票历史日 K 线数据
 * 按市场类型顺序尝试主力与备用数据源，带有熔断机制
 */
export async function fetchDailyCandles(symbol: string, limit: number = 300): Promise<Candle[]> {
  const clean = symbol.trim().toUpperCase();
  const priority = getMarketDataPriority(clean);
  let lastError: unknown = null;

  for (const provider of priority) {
    if (!circuitBreaker.shouldAttempt(provider as any, false)) continue;

    try {
      if (provider === "eastmoney") {
        for (const secid of getEastMoneySecidCandidates(clean)) {
          try {
            const candles = await fetchEastMoneyKlines(secid, limit);
            if (candles.length > 5) {
              circuitBreaker.recordSuccess("eastmoney");
              return candles.slice(-limit);
            }
          } catch {
            // try next candidate
          }
        }
      } else if (provider === "tonghuashun") {
        const ths = await fetchTonghuashunMarketData(clean);
        if (ths && ths.dailyCandles.length > 5) {
          circuitBreaker.recordSuccess("tonghuashun");
          return ths.dailyCandles.slice(-limit);
        }
      } else if (provider === "tencent") {
        const tencent = await fetchTencentMarketData(clean);
        if (tencent && tencent.dailyCandles.length > 5) {
          circuitBreaker.recordSuccess("tencent");
          return tencent.dailyCandles.slice(-limit);
        }
      } else if (provider === "yahoo" || provider === "yahoo-chart") {
        const yCandles = await fetchYahooKlines(clean, limit);
        if (yCandles.length > 5) {
          circuitBreaker.recordSuccess("yahoo");
          return yCandles.slice(-limit);
        }
      }
    } catch (error) {
      lastError = error;
      circuitBreaker.recordFailure(provider as any);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch daily candles for ${symbol}`);
}

/**
 * 统一获取盘中实时行情
 */
export async function fetchRealtimeQuote(symbol: string): Promise<RealtimeQuote> {
  const clean = symbol.trim().toUpperCase();
  const region = getMarketRegion(clean);

  // A 股优先走 A 股专属实时多源
  if (region === "a-share") {
    try {
      const quote = await fetchAShareRealtimeQuote(clean);
      if (quote) {
        return {
          symbol: clean,
          name: quote.name || clean,
          price: quote.price,
          changePercent: quote.changePercent,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          previousClose: quote.previousClose,
          volume: quote.volume,
          date: quote.date,
          source: quote.source,
        };
      }
    } catch {
      // fallback to tencent or ths
    }
  }

  // 腾讯备用源实时行情
  try {
    const tencent = await fetchTencentQuote(clean);
    if (tencent) {
      return {
        symbol: clean,
        name: tencent.companyName || clean,
        price: tencent.price,
        changePercent: tencent.changePercent,
        open: tencent.open,
        high: tencent.high,
        low: tencent.low,
        previousClose: tencent.previousClose,
        volume: tencent.volume,
        date: tencent.date,
        source: "tencent",
      };
    }
  } catch {
    // continue
  }

  // 同花顺备用源实时行情
  try {
    const ths = await fetchTonghuashunQuote(clean);
    if (ths) {
      return {
        symbol: clean,
        name: ths.companyName || clean,
        price: ths.price,
        changePercent: ths.changePercent,
        open: ths.open,
        high: ths.high,
        low: ths.low,
        previousClose: ths.previousClose,
        volume: ths.volume,
        date: ths.date,
        source: "tonghuashun",
      };
    }
  } catch {
    // continue
  }

  // 美股/港股/日股通过 Yahoo Finance 获取
  try {
    const yQuote = await yahoo.quote(clean);
    if (yQuote && yQuote.regularMarketPrice !== undefined) {
      return {
        symbol: clean,
        name: yQuote.longName || yQuote.shortName || clean,
        price: yQuote.regularMarketPrice,
        changePercent: yQuote.regularMarketChangePercent || 0,
        open: yQuote.regularMarketOpen,
        high: yQuote.regularMarketDayHigh,
        low: yQuote.regularMarketDayLow,
        previousClose: yQuote.regularMarketPreviousClose,
        volume: yQuote.regularMarketVolume,
        date: yQuote.regularMarketTime?.toISOString(),
        source: "yahoo",
      };
    }
  } catch {
    // continue
  }

  throw new Error(`Realtime quote unavailable for ${symbol}`);
}

/**
 * 输入股票代码或名称联想搜索
 */
export async function searchSymbols(query: string): Promise<SymbolSuggestion[]> {
  const clean = query.trim();
  if (!clean) return [];

  const raw = await fetchEastMoneySymbolSuggestions(clean);
  const results: SymbolSuggestion[] = [];

  for (const item of raw) {
    if (!isSupportedEastMoneySuggestion(item)) continue;
    const normalizedSymbol = normalizeEastMoneySymbol(item);
    results.push({
      symbol: normalizedSymbol,
      name: item.Name || normalizedSymbol,
      market: getMarketRegion(normalizedSymbol),
      typeDisp: item.SecurityTypeName || "股票",
    });
  }

  return results;
}
