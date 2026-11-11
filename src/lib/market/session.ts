import { MarketRegion } from "./marketDataPriority";

const MARKET_TZ: Record<MarketRegion, string> = {
  "a-share": "Asia/Shanghai",
  "hong-kong": "Asia/Hong_Kong",
  japan: "Asia/Tokyo",
  "united-states": "America/New_York",
};

// 交易时段 (含收盘后 15 分钟缓冲：数据源在收盘后几分钟内才把当日 K 线定稿)
const MARKET_HOURS: Record<MarketRegion, { open: string; close: string }> = {
  "a-share": { open: "09:15", close: "15:15" },
  "hong-kong": { open: "09:00", close: "16:25" },
  japan: { open: "08:45", close: "15:45" },
  "united-states": { open: "09:30", close: "16:15" },
};

function localDateTime(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

/**
 * 最后一根 K 线是不是"今天还没收盘的那根"。
 * 判定：K 线日期等于该市场时区的今天，且当前时间在交易时段内。
 * 是的话，这根 K 线的收盘价只是盘中价，不能拿来判软线、算最高价。
 */
export function isLastBarLive(region: MarketRegion, lastBarDate: string | Date, now: Date = new Date()): boolean {
  const barDate = typeof lastBarDate === "string" ? lastBarDate.substring(0, 10) : lastBarDate.toISOString().substring(0, 10);
  const { date, time } = localDateTime(now, MARKET_TZ[region]);
  if (barDate !== date) return false;
  const { open, close } = MARKET_HOURS[region];
  return time >= open && time <= close;
}
