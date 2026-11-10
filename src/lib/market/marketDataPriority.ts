export type MarketRegion = "a-share" | "hong-kong" | "japan" | "united-states";

export type MarketDataProvider =
  | "eastmoney"
  | "tonghuashun"
  | "tencent"
  | "yahoo"
  | "yahoo-chart"
  | "kabutan"
  | "optional-provider";

const MARKET_DATA_PRIORITIES: Record<MarketRegion, readonly MarketDataProvider[]> = {
  "a-share": ["eastmoney", "tonghuashun", "tencent", "yahoo", "yahoo-chart", "optional-provider"],
  "hong-kong": ["eastmoney", "tencent", "yahoo", "yahoo-chart", "tonghuashun", "optional-provider"],
  japan: ["yahoo-chart", "yahoo", "kabutan", "optional-provider"],
  "united-states": ["yahoo", "yahoo-chart", "tencent", "eastmoney", "tonghuashun", "optional-provider"],
};

export function getMarketRegion(symbol: string): MarketRegion {
  const clean = symbol.trim().toUpperCase();
  if (/^\d{6}(?:\.(?:SS|SH|SZ))?$/.test(clean)) return "a-share";
  if (/^\d{1,5}\.HK$/.test(clean)) return "hong-kong";
  if (/^\d{3}[0-9A-Z]\.T$/.test(clean)) return "japan";
  return "united-states";
}

export function getMarketDataPriority(symbol: string): readonly MarketDataProvider[] {
  return MARKET_DATA_PRIORITIES[getMarketRegion(symbol)];
}

export function getRealtimeQuotePriority(symbol: string): readonly MarketDataProvider[] {
  return getMarketDataPriority(symbol).filter((provider) => provider !== "yahoo-chart");
}
