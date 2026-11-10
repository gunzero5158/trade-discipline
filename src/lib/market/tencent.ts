import { Candle } from "@/lib/market/indicators";
import { buildWeeklyCandles } from "@/lib/market/weeklyCandles";

export interface TencentMarketData {
  dailyCandles: Candle[];
  weeklyCandles: Candle[];
  price: number;
  changePercent: number;
  companyName: string;
  source: "tencent";
}

export interface TencentQuote {
  price: number;
  changePercent: number;
  companyName?: string;
  source: "tencent";
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
}

interface TencentKlineResponse {
  code?: number;
  msg?: string;
  data?: Record<string, {
    day?: TencentKlineRow[];
    week?: TencentKlineRow[];
    qfqday?: TencentKlineRow[];
    qfqweek?: TencentKlineRow[];
    qt?: Record<string, Array<string | number>>;
  }>;
}

type TencentKlineRow = Array<string | number | Record<string, unknown>>;

const TENCENT_TIMEOUT_MS = 4500;
const MIN_REAL_DAILY_CANDLES = 20;

export async function fetchTencentQuote(symbol: string): Promise<TencentQuote | null> {
  const candidates = getTencentQuoteCandidates(symbol);

  for (const code of candidates) {
    try {
      const quote = await fetchTencentRealtimeQuote(code);
      if (quote) {
        return quote;
      }
    } catch (error: unknown) {
      console.warn(`Tencent quote failed for ${code}:`, error);
    }
  }

  return null;
}

export async function fetchTencentMarketData(symbol: string): Promise<TencentMarketData | null> {
  const candidates = getTencentSymbolCandidates(symbol);

  for (const code of candidates) {
    try {
      const [daily, weekly] = await Promise.all([
        fetchTencentKlines(code, "day", 300),
        fetchTencentKlines(code, "week", 170),
      ]);

      if (daily.candles.length < MIN_REAL_DAILY_CANDLES) {
        continue;
      }

      const last = daily.candles[daily.candles.length - 1];
      const prev = daily.candles[daily.candles.length - 2] || last;

      return {
        dailyCandles: daily.candles,
        weeklyCandles: weekly.candles.length > 0 ? weekly.candles : buildWeeklyCandles(daily.candles),
        price: last.close,
        changePercent: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
        companyName: daily.companyName || weekly.companyName || symbol,
        source: "tencent",
      };
    } catch (error: unknown) {
      console.warn(`Tencent market data failed for ${code}:`, error);
    }
  }

  return null;
}

function getTencentSymbolCandidates(symbol: string): string[] {
  const clean = symbol.trim().toUpperCase();
  const cn = clean.match(/^(\d{6})(?:\.(SS|SH|SZ))?$/);
  if (cn) {
    const market = cn[2] === "SZ" || (!cn[2] && /^[023]/.test(cn[1])) ? "sz" : "sh";
    return [`${market}${cn[1]}`];
  }

  const hk = clean.match(/^(\d{1,5})(?:\.HK)?$/);
  if (hk) {
    return [`hk${hk[1].padStart(5, "0")}`];
  }

  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(clean)) {
    const base = clean.replace(/\.US$/, "");
    if (base.includes(".")) {
      return [`us${base}`];
    }
    return [`us${base}.OQ`, `us${base}.N`, `us${base}.A`];
  }

  return [];
}

function getTencentQuoteCandidates(symbol: string): string[] {
  const clean = symbol.trim().toUpperCase();
  const hk = clean.match(/^(\d{1,5})(?:\.HK)?$/);
  if (hk) {
    return [`hk${hk[1].padStart(5, "0")}`];
  }

  const cn = clean.match(/^(\d{6})(?:\.(SS|SH|SZ))?$/);
  if (cn) {
    const market = cn[2] === "SZ" || (!cn[2] && /^[023]/.test(cn[1])) ? "sz" : "sh";
    return [`${market}${cn[1]}`];
  }

  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(clean)) {
    const base = clean.replace(/\.(?:US|OQ|N|A)$/, "");
    return [`us${base}`];
  }

  return [];
}

async function fetchTencentRealtimeQuote(tencentCode: string): Promise<TencentQuote | null> {
  const url = `https://qt.gtimg.cn/q=${encodeURIComponent(tencentCode)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TENCENT_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://gu.qq.com/",
    },
  });

  if (!res.ok) {
    throw new Error(`Tencent quote request failed (${res.status})`);
  }

  const text = decodeTencentText(await res.arrayBuffer());
  if (!text || text.includes("none_match")) {
    return null;
  }

  const fields = (text.split("\"")[1] || "").split("~");
  const price = parseNumber(fields[3]);
  if (price === null) {
    return null;
  }

  const prevClose = parseNumber(fields[4]);
  const changePercent = parseNumber(fields[32])
    ?? (prevClose ? ((price - prevClose) / prevClose) * 100 : 0);
  const result: TencentQuote = {
    price,
    changePercent,
    companyName: fields[1] || undefined,
    source: "tencent",
  };
  if (!/^(?:sh|sz)/.test(tencentCode)) {
    return result;
  }
  const open = parseNumber(fields[5]);
  const high = parseNumber(fields[33]);
  const low = parseNumber(fields[34]);
  const rawVolume = parseNumber(fields[6]);
  const date = String(fields[30] || "").replace(/\D/g, "").slice(0, 8);
  if (prevClose !== null) result.previousClose = prevClose;
  if (open !== null) result.open = open;
  if (high !== null) result.high = high;
  if (low !== null) result.low = low;
  if (rawVolume !== null) {
    result.volume = rawVolume * 100;
  }
  if (/^\d{8}$/.test(date)) {
    result.date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return result;
}

async function fetchTencentKlines(
  tencentCode: string,
  interval: "day" | "week",
  outputSize: number
): Promise<{ companyName: string; candles: Candle[] }> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(tencentCode)},${interval},,,${outputSize},qfq`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TENCENT_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Referer": "https://gu.qq.com/",
    },
  });

  if (!res.ok) {
    throw new Error(`Tencent request failed (${res.status})`);
  }

  const data = await res.json() as TencentKlineResponse;
  const item = data.data?.[tencentCode];
  if (!item) {
    return { companyName: "", candles: [] };
  }

  const rows = item[interval] || item[`qfq${interval}` as "qfqday" | "qfqweek"] || [];
  const qt = item.qt?.[tencentCode] || [];

  return {
    companyName: typeof qt[1] === "string" ? qt[1] : "",
    candles: rows
      .map(parseTencentCandle)
      .filter((candle): candle is Candle => candle !== null)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

function parseTencentCandle(row: TencentKlineRow): Candle | null {
  const [date, open, close, high, low, volume] = row;
  const parsedOpen = parseNumber(open);
  const parsedClose = parseNumber(close);
  const parsedHigh = parseNumber(high);
  const parsedLow = parseNumber(low);

  if (typeof date !== "string" || parsedOpen === null || parsedClose === null || parsedHigh === null || parsedLow === null) {
    return null;
  }

  return {
    date,
    open: parsedOpen,
    close: parsedClose,
    high: parsedHigh,
    low: parsedLow,
    volume: parseNumber(volume) ?? 0,
  };
}

function parseNumber(value: string | number | Record<string, unknown> | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeTencentText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return new TextDecoder().decode(buffer);
  }
}

