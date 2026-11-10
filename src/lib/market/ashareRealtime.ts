import { Candle } from "@/lib/market/indicators";
import { fetchEastMoneyJson } from "@/lib/market/eastmoneyHttp";
import { convertSymbolToEastMoneyAShareSecid } from "@/lib/market/symbolConversion";
import { fetchTonghuashunQuote } from "@/lib/market/tonghuashun";
import { fetchTencentQuote } from "@/lib/market/tencent";

export { convertSymbolToEastMoneyAShareSecid };

const EAST_MONEY_REALTIME_TIMEOUT_MS = 2000;
const A_SHARE_REALTIME_CACHE_TTL_MS = 30 * 1000;

export type AShareRealtimeSource = "eastmoney-realtime" | "tonghuashun" | "tencent" | "quote-api";

export interface AShareRealtimeQuote {
  source: AShareRealtimeSource;
  price: number;
  changePercent: number;
  name?: string;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  date?: string;
}

interface EastMoneyRealtimeResponse {
  data?: {
    f43?: number | string;
    f44?: number | string;
    f45?: number | string;
    f46?: number | string;
    f47?: number | string;
    f58?: string;
    f60?: number | string;
    f86?: number | string;
    f170?: number | string;
  };
}

interface AShareRealtimeStore {
  cache: Map<string, { timestamp: number; quote: AShareRealtimeQuote }>;
  inflight: Map<string, Promise<AShareRealtimeQuote | null>>;
}

const globalRealtimeScope = globalThis as typeof globalThis & {
  __zenithAShareRealtimeStore?: AShareRealtimeStore;
};
const realtimeStore = globalRealtimeScope.__zenithAShareRealtimeStore ??= {
  cache: new Map(),
  inflight: new Map(),
};

export function parseEastMoneyRealtimeQuote(response: EastMoneyRealtimeResponse): AShareRealtimeQuote | null {
  const data = response.data;
  if (!data) return null;

  const price = normalizeEastMoneyPrice(data.f43);
  if (!price) return null;

  const previousClose = normalizeEastMoneyPrice(data.f60);
  const pctFromApi = normalizeEastMoneyPercent(data.f170);
  const changePercent = pctFromApi ?? (
    previousClose ? ((price - previousClose) / previousClose) * 100 : 0
  );

  return {
    source: "eastmoney-realtime",
    name: normalizeName(data.f58),
    price,
    open: normalizeEastMoneyPrice(data.f46),
    high: normalizeEastMoneyPrice(data.f44),
    low: normalizeEastMoneyPrice(data.f45),
    previousClose,
    volume: parsePositiveNumber(data.f47),
    date: parseEastMoneyTradeDate(data.f86),
    changePercent,
  };
}

export async function fetchAShareRealtimeQuote(symbol: string): Promise<AShareRealtimeQuote | null> {
  const secid = convertSymbolToEastMoneyAShareSecid(symbol);
  if (!secid) return null;

  const cacheKey = symbol.trim().toUpperCase();
  const cached = realtimeStore.cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < A_SHARE_REALTIME_CACHE_TTL_MS) {
    return cached.quote;
  }

  const existing = realtimeStore.inflight.get(cacheKey);
  if (existing) return existing;

  const request = fetchFreshAShareRealtimeQuote(symbol, secid);
  realtimeStore.inflight.set(cacheKey, request);
  try {
    const quote = await request;
    if (quote) {
      realtimeStore.cache.set(cacheKey, { timestamp: Date.now(), quote });
    }
    return quote;
  } finally {
    realtimeStore.inflight.delete(cacheKey);
  }
}

export async function fetchEastMoneyAShareRealtimeQuote(symbol: string): Promise<AShareRealtimeQuote | null> {
  const secid = convertSymbolToEastMoneyAShareSecid(symbol);
  if (!secid) return null;
  return fetchEastMoneyRealtimeQuote(secid);
}

async function fetchFreshAShareRealtimeQuote(symbol: string, secid: string): Promise<AShareRealtimeQuote | null> {
  try {
    const eastMoneyQuote = await fetchEastMoneyRealtimeQuote(secid);
    if (eastMoneyQuote) return eastMoneyQuote;
  } catch (error: unknown) {
    console.warn(`EastMoney realtime quote failed for ${symbol}:`, error);
  }

  const tonghuashunQuote = await fetchTonghuashunQuote(symbol);
  if (tonghuashunQuote) {
    return {
      source: "tonghuashun",
      name: tonghuashunQuote.companyName,
      price: tonghuashunQuote.price,
      open: tonghuashunQuote.open,
      high: tonghuashunQuote.high,
      low: tonghuashunQuote.low,
      previousClose: tonghuashunQuote.previousClose,
      volume: tonghuashunQuote.volume,
      date: tonghuashunQuote.date,
      changePercent: tonghuashunQuote.changePercent,
    };
  }

  const tencentQuote = await fetchTencentQuote(symbol);
  if (tencentQuote) {
    return {
      source: "tencent",
      name: tencentQuote.companyName,
      price: tencentQuote.price,
      open: tencentQuote.open,
      high: tencentQuote.high,
      low: tencentQuote.low,
      previousClose: tencentQuote.previousClose,
      volume: tencentQuote.volume,
      date: tencentQuote.date,
      changePercent: tencentQuote.changePercent,
    };
  }

  return null;
}

/** Normalizes a candle date (Date object or string) to a "YYYY-MM-DD" key for comparison. */
function toIsoDateKey(date: Date | string): string {
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

export function mergeRealtimeQuoteIntoDailyCandles(candles: Candle[], quote: AShareRealtimeQuote): Candle[] {
  if (!quote.date || candles.length === 0) return candles;

  // Candles from the Yahoo path carry Date objects while quote.date is a string;
  // comparing them directly never matches and duplicated the latest candle.
  const last = candles[candles.length - 1];
  const lastDateKey = toIsoDateKey(last.date);
  if (quote.date < lastDateKey) return candles;

  const realtimeCandle = buildRealtimeCandle(last, quote);
  if (quote.date === lastDateKey) {
    return [...candles.slice(0, -1), realtimeCandle];
  }

  return [...candles, realtimeCandle];
}

async function fetchEastMoneyRealtimeQuote(secid: string): Promise<AShareRealtimeQuote | null> {
  const fields = "f43,f44,f45,f46,f47,f58,f60,f86,f170";
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${fields}`;
  const data = await fetchEastMoneyJson<EastMoneyRealtimeResponse>(url, EAST_MONEY_REALTIME_TIMEOUT_MS);
  return parseEastMoneyRealtimeQuote(data);
}

function buildRealtimeCandle(previous: Candle, quote: AShareRealtimeQuote): Candle {
  const open = quote.open || quote.previousClose || previous.close || quote.price;
  const close = quote.price;
  const high = Math.max(quote.high || close, open, close);
  const low = Math.min(quote.low || close, open, close);

  return {
    date: quote.date || previous.date,
    open,
    high,
    low,
    close,
    volume: Math.round(quote.volume || 0),
  };
}

function normalizeEastMoneyPrice(value: number | string | undefined): number | undefined {
  const raw = parsePositiveNumber(value);
  return raw ? raw / 100 : undefined;
}

function normalizeEastMoneyPercent(value: number | string | undefined): number | undefined {
  const raw = parseNumber(value);
  return raw === undefined ? undefined : raw / 100;
}

function parseEastMoneyTradeDate(value: number | string | undefined): string | undefined {
  const text = String(value || "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeName(value: string | undefined): string | undefined {
  const text = (value || "").trim();
  return text || undefined;
}

function parsePositiveNumber(value: number | string | undefined): number | undefined {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;

  const text = value.trim();
  if (!text || text === "-") return undefined;

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
