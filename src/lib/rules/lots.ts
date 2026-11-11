import { Lot } from "./types";

/**
 * 首仓笔：优先取 type=initial，没有则取日期最早的一笔。
 */
export function getInitialLot(lots: Lot[]): Lot | undefined {
  const initial = lots.find((l) => l.type === "initial");
  if (initial) return initial;
  return [...lots].sort((a, b) => a.date.localeCompare(b.date))[0];
}

/**
 * 把已平仓的股数按先买先卖从各笔里扣掉，返回"仍在手里"的各笔。
 * 加仓计算器、总账检查等需要用剩余股数而不是历史买入股数时使用。
 */
export function applyClosedShares(lots: Lot[], closedShares: number): Lot[] {
  if (closedShares <= 0) return lots;
  let remainingToDeduct = closedShares;
  const ordered = [...lots].sort((a, b) => a.date.localeCompare(b.date));
  const result = ordered.map((lot) => {
    const deduct = Math.min(lot.shares, remainingToDeduct);
    remainingToDeduct -= deduct;
    return { ...lot, shares: lot.shares - deduct };
  });
  // 保持传入顺序
  return lots.map((orig) => result.find((r) => r.id === orig.id) ?? orig);
}
