import { Candle } from "@/lib/market/indicators";
import { buildWeeklyCandles } from "@/lib/market/weeklyCandles";

const TONGHUASHUN_TIMEOUT_MS = 4500;
const MIN_REAL_DAILY_CANDLES = 20;

export interface TonghuashunQuote {
  price: number;
  changePercent: number;
  companyName?: string;
  source: "tonghuashun";
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
}

export interface TonghuashunMarketData extends TonghuashunQuote {
  dailyCandles: Candle[];
  weeklyCandles: Candle[];
  companyName: string;
}

interface TonghuashunLastPayload {
  name?: string;
  data?: string;
}

interface TonghuashunTodayRow {
  "1"?: string;
  "7"?: string | number;
  "8"?: string | number;
  "9"?: string | number;
  "11"?: string | number;
  "13"?: string | number;
  name?: string;
}

interface TonghuashunTodayCandle extends Candle {
  companyName?: string;
}

export function getTonghuashunSymbolCode(symbol: string): string | null {
  const clean = symbol.trim().toUpperCase();

  const aShare = clean.match(/^(\d{6})(?:\.(SS|SH|SZ))?$/);
  if (aShare) {
    return `hs_${aShare[1]}`;
  }

  const hk = clean.match(/^(\d{1,5})(?:\.HK)?$/);
  if (hk) {
    const numeric = Number.parseInt(hk[1], 10);
    if (!Number.isFinite(numeric)) return null;
    return `hk_HK${String(numeric).padStart(4, "0")}`;
  }

  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(clean)) {
    const base = clean.replace(/\.(?:US|OQ|N|A)$/, "");
    if (base.includes(".")) return null;
    return `usa_${base}`;
  }

  return null;
}

export async function fetchTonghuashunQuote(symbol: string): Promise<TonghuashunQuote | null> {
  const code = getTonghuashunSymbolCode(symbol);
  if (!code) return null;

  try {
    const [todayResult, lastResult] = await Promise.allSettled([
      fetchTonghuashunText(code, "today"),
      fetchTonghuashunText(code, "last"),
    ]);

    let today: TonghuashunTodayCandle | null = null;
    try {
      if (todayResult.status === "rejected") throw todayResult.reason;
      today = parseTonghuashunTodayResponse(todayResult.value);
    } catch (error: unknown) {
      console.warn(`Tonghuashun today quote failed for ${symbol}:`, error);
    }

    let last: { companyName: string; candles: Candle[] } = { companyName: "", candles: [] };
    try {
      if (lastResult.status === "rejected") throw lastResult.reason;
      last = parseTonghuashunLastResponse(lastResult.value);
    } catch (error: unknown) {
      console.warn(`Tonghuashun history quote failed for ${symbol}:`, error);
    }

    const latestHistory = last.candles[last.candles.length - 1];
    // This function feeds realtime quote chains. If today.js is unavailable or
    // stale, last.js is only historical data and must not masquerade as a live quote.
    if (!today || (latestHistory && today.date < String(latestHistory.date))) {
      return null;
    }
    const active = today;
    const prev = latestHistory?.date === active.date
      ? last.candles[last.candles.length - 2]
      : latestHistory;

    return {
      price: active.close,
      changePercent: prev?.close ? ((active.close - prev.close) / prev.close) * 100 : 0,
      companyName: today?.companyName || last.companyName,
      source: "tonghuashun",
      date: String(active.date),
      open: active.open,
      high: active.high,
      low: active.low,
      previousClose: prev?.close,
      volume: active.volume,
    };
  } catch (error: unknown) {
    console.warn(`Tonghuashun quote failed for ${symbol}:`, error);
    return null;
  }
}

export async function fetchTonghuashunMarketData(symbol: string): Promise<TonghuashunMarketData | null> {
  const code = getTonghuashunSymbolCode(symbol);
  if (!code) return null;

  try {
    const [lastResult, todayResult] = await Promise.allSettled([
      fetchTonghuashunText(code, "last"),
      fetchTonghuashunText(code, "today"),
    ]);
    if (lastResult.status === "rejected") {
      throw lastResult.reason;
    }

    const last = parseTonghuashunLastResponse(lastResult.value);
    let dailyCandles = last.candles;

    try {
      if (todayResult.status === "rejected") {
        throw todayResult.reason;
      }
      const today = parseTonghuashunTodayResponse(todayResult.value);
      dailyCandles = mergeTonghuashunTodayCandle(dailyCandles, today);
      if (today?.companyName) {
        last.companyName = today.companyName;
      }
    } catch (error: unknown) {
      console.warn(`Tonghuashun today candle failed for ${symbol}:`, error);
    }

    if (dailyCandles.length < MIN_REAL_DAILY_CANDLES) {
      return null;
    }

    const lastCandle = dailyCandles[dailyCandles.length - 1];
    const prevCandle = dailyCandles[dailyCandles.length - 2] || lastCandle;

    return {
      dailyCandles,
      weeklyCandles: buildWeeklyCandles(dailyCandles),
      price: lastCandle.close,
      changePercent: prevCandle.close ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0,
      companyName: last.companyName || symbol,
      source: "tonghuashun",
    };
  } catch (error: unknown) {
    console.warn(`Tonghuashun market data failed for ${symbol}:`, error);
    return null;
  }
}

export function parseTonghuashunLastResponse(text: string): { companyName: string; candles: Candle[] } {
  const payload = unwrapTonghuashunJson<TonghuashunLastPayload>(text);
  const rows = (payload.data || "").split(";").filter(Boolean);

  return {
    companyName: payload.name || "",
    candles: rows
      .map(parseTonghuashunHistoryRow)
      .filter((item): item is Candle => item !== null)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

export function parseTonghuashunTodayResponse(text: string): TonghuashunTodayCandle | null {
  const payload = unwrapTonghuashunJson<Record<string, TonghuashunTodayRow>>(text);
  const row = Object.values(payload)[0];
  if (!row) return null;

  const date = normalizeTonghuashunDate(row["1"]);
  const open = parseFiniteNumber(row["7"]);
  const high = parseFiniteNumber(row["8"]);
  const low = parseFiniteNumber(row["9"]);
  const close = parseFiniteNumber(row["11"]);

  if (!date || open === null || high === null || low === null || close === null) {
    return null;
  }

  return {
    date,
    open,
    high,
    low,
    close,
    volume: parseFiniteNumber(row["13"]) ?? 0,
    companyName: row.name,
  };
}

export function mergeTonghuashunTodayCandle(candles: Candle[], today: TonghuashunTodayCandle | null): Candle[] {
  if (!today || candles.length === 0) return candles;

  const last = candles[candles.length - 1];
  if (today.date < String(last.date)) return candles;
  if (today.date === String(last.date)) {
    return [...candles.slice(0, -1), stripCompanyName(today)];
  }

  return [...candles, stripCompanyName(today)];
}

async function fetchTonghuashunText(code: string, kind: "last" | "today"): Promise<string> {
  const res = await fetch(`https://d.10jqka.com.cn/v6/line/${encodeURIComponent(code)}/01/${kind}.js`, {
    signal: AbortSignal.timeout(TONGHUASHUN_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "*/*",
      "Referer": "https://stockpage.10jqka.com.cn/",
    },
  });

  if (!res.ok) {
    throw new Error(`Tonghuashun ${kind} request failed (${res.status})`);
  }

  return res.text();
}

function unwrapTonghuashunJson<T>(text: string): T {
  const jsonText = text.replace(/^[^(]+\(/, "").replace(/\);?$/, "");
  return JSON.parse(jsonText) as T;
}

function parseTonghuashunHistoryRow(row: string): Candle | null {
  const parts = row.split(",");
  const date = normalizeTonghuashunDate(parts[0]);
  const open = parseFiniteNumber(parts[1]);
  const high = parseFiniteNumber(parts[2]);
  const low = parseFiniteNumber(parts[3]);
  const close = parseFiniteNumber(parts[4]);

  if (!date || open === null || high === null || low === null || close === null) {
    return null;
  }

  return {
    date,
    open,
    high,
    low,
    close,
    volume: parseFiniteNumber(parts[5]) ?? 0,
  };
}

function normalizeTonghuashunDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseFiniteNumber(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripCompanyName(candle: TonghuashunTodayCandle): Candle {
  return {
    date: candle.date,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

