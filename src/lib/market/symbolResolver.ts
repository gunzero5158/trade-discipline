import { normalizeManualSymbolInput } from "./market";
import { aShareCodeToSuffixedSymbol } from "./symbolConversion";

const EAST_MONEY_SUGGEST_TOKEN = "D43BF722C8E33EFC408CAFD32D7DAD7C";
const EAST_MONEY_SUGGEST_TIMEOUT_MS = 2_500;

export interface EastMoneySuggestItem {
  Code?: string;
  Name?: string;
  QuoteID?: string;
  SecurityTypeName?: string;
  Classify?: string;
  JYS?: string;
}

interface EastMoneySuggestResponse {
  QuotationCodeTable?: {
    Data?: EastMoneySuggestItem[];
  };
}

export function isTickerLike(symbol: string): boolean {
  return (
    /^[A-Z]{1,5}$/.test(symbol) ||
    /^\d{3}[0-9A-Z](?:\.T)?$/.test(symbol) ||
    /^\d{4,5}(?:\.HK)?$/.test(symbol) ||
    /^\d{6}(?:\.(?:SS|SH|SZ))?$/.test(symbol)
  );
}

export function isSupportedEastMoneySuggestion(item: EastMoneySuggestItem): boolean {
  const classify = item.Classify || "";
  const type = item.SecurityTypeName || "";
  return (
    classify === "UsStock" ||
    classify === "HKStock" ||
    classify === "AStock" ||
    classify === "JPX" ||
    item.QuoteID?.startsWith("176.") ||
    type.includes("美股") ||
    type.includes("港股") ||
    type.includes("A股") ||
    type.includes("日本")
  );
}

export function normalizeEastMoneySymbol(item: EastMoneySuggestItem): string {
  const code = (item.Code || "").trim().toUpperCase();
  const quoteId = item.QuoteID || "";
  const classify = item.Classify || "";

  if (classify === "HKStock" || quoteId.startsWith("116.")) {
    const providerCode = /^\d+$/.test(code) ? String(Number(code)).padStart(4, "0") : code;
    return providerCode ? `${providerCode}.HK` : code;
  }
  if (classify === "JPX" || quoteId.startsWith("176.")) {
    return /^\d{3}[0-9A-Z]$/i.test(code) ? `${code}.T` : code;
  }
  if (classify === "AStock" || quoteId.startsWith("1.") || quoteId.startsWith("0.")) {
    return /^\d{6}$/.test(code) ? aShareCodeToSuffixedSymbol(code) : code;
  }
  return code;
}

export async function fetchEastMoneySymbolSuggestions(query: string): Promise<EastMoneySuggestItem[]> {
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=${EAST_MONEY_SUGGEST_TOKEN}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(EAST_MONEY_SUGGEST_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) return [];

    const data = await response.json() as EastMoneySuggestResponse;
    return data.QuotationCodeTable?.Data || [];
  } catch (error: unknown) {
    console.warn("EastMoney symbol search failed:", error);
    return [];
  }
}

export async function resolveInputSymbol(input: string): Promise<string> {
  const clean = input.trim().toUpperCase();
  const normalized = normalizeManualSymbolInput(clean);
  if (normalized !== clean) return normalized;
  if (isTickerLike(clean)) return clean;

  const match = (await fetchEastMoneySymbolSuggestions(clean)).find((item) =>
    item.Code && isSupportedEastMoneySuggestion(item),
  );
  return match ? normalizeEastMoneySymbol(match) : clean;
}
