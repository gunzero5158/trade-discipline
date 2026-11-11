import { TradeRecord } from "./types";

export interface MonthlyStatsResult {
  totalTrades: number;          // 完整交易笔数 (一只股票从开仓到全部平仓算一笔，中途减仓合并进去)
  winTrades: number;
  lossTrades: number;
  breakevenTrades: number;
  winRate: number;              // 胜率 (例如 0.55 即 55%)
  totalPnLAmount: number;       // 全部记录的盈亏金额合计 (含尚未全部平仓的减仓落袋)
  totalR: number;               // 累计盈亏 R 倍数
  month?: string;               // 月度红线所看的月份 (YYYY-MM)
  monthPnLAmount: number;       // 该月已实现盈亏
  avgWinR: number;              // 平均赢单 R 数
  avgLossR: number;             // 平均输单 R 数 (取正数绝对值便于展示，如 1.05R)
  expectancyR: number;          // 每笔期望 R = 胜率 × 赢单R - 输率 × 输单R
  maxConsecutiveLosses: number; // 最大连续亏损次数
  maxConsecutiveWins: number;   // 最大连续盈利次数
  triggerCounts: {
    hardLine: number;
    softLine: number;
    stage3Trim: number;
    manual: number;
  };
  diagnostics: Array<{
    type: "error" | "warning" | "info" | "success";
    title: string;
    message: string;
  }>;
}

export interface TradeStatisticsOptions {
  month?: string; // YYYY-MM，月度 6% 红线按这个月算；不传则按全部记录算
}

/**
 * 一笔完整交易 = 同一持仓的全部平仓记录合并：以全部平仓那条 (hard-line / soft-line / manual) 为准，
 * 它之前同一持仓的减仓 (stage3-trim) 盈亏与 R 并进去。只有减仓、尚未全部平仓的持仓不计入笔数。
 * 对应《方案补充》Bug 3：R 倍数分母始终是首仓 1R，所以各记录的 rMultiple 可以直接相加。
 */
interface CompletedTrade {
  positionId: string;
  rMultiple: number;
  pnlAmount: number;
  triggerReason: TradeRecord["triggerReason"];
  exitDate: string;
}

function groupCompletedTrades(trades: TradeRecord[]): CompletedTrade[] {
  const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.createdAt.localeCompare(b.createdAt));
  const pending = new Map<string, { r: number; pnl: number }>();
  const completed: CompletedTrade[] = [];
  for (const t of sorted) {
    const acc = pending.get(t.positionId) ?? { r: 0, pnl: 0 };
    acc.r += t.rMultiple;
    acc.pnl += t.pnlAmount;
    if (t.triggerReason === "stage3-trim") {
      pending.set(t.positionId, acc);
      continue;
    }
    completed.push({ positionId: t.positionId, rMultiple: acc.r, pnlAmount: acc.pnl, triggerReason: t.triggerReason, exitDate: t.exitDate });
    pending.delete(t.positionId);
  }
  return completed;
}

/**
 * 严格按照《交易纪律.md》第八节与《开发文档.md》3.10 节实现月度交易复盘统计与诊断。
 */
export function calculateTradeStatistics(
  trades: TradeRecord[],
  totalCapital: number = 100000,
  options: TradeStatisticsOptions = {}
): MonthlyStatsResult {
  const month = options.month;
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      breakevenTrades: 0,
      winRate: 0,
      totalPnLAmount: 0,
      totalR: 0,
      month,
      monthPnLAmount: 0,
      avgWinR: 0,
      avgLossR: 0,
      expectancyR: 0,
      maxConsecutiveLosses: 0,
      maxConsecutiveWins: 0,
      triggerCounts: { hardLine: 0, softLine: 0, stage3Trim: 0, manual: 0 },
      diagnostics: [
        {
          type: "info",
          title: "暂无交易记录",
          message: "完成第一笔平仓后，将自动开始核算胜率、盈亏比与复盘诊断建议。",
        },
      ],
    };
  }

  let winTrades = 0;
  let lossTrades = 0;
  let breakevenTrades = 0;
  let totalPnLAmount = 0;
  let totalWinR = 0;
  let totalLossR = 0;
  let totalR = 0;

  let currentConsecutiveLoss = 0;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveWin = 0;
  let maxConsecutiveWins = 0;

  const triggerCounts = {
    hardLine: 0,
    softLine: 0,
    stage3Trim: 0,
    manual: 0,
  };

  // 金额与触发原因按每条记录如实累计
  let monthPnLAmount = 0;
  for (const t of trades) {
    totalPnLAmount += t.pnlAmount;
    totalR += t.rMultiple;
    if (!month || t.exitDate.startsWith(month)) monthPnLAmount += t.pnlAmount;
    if (t.triggerReason === "hard-line") triggerCounts.hardLine++;
    else if (t.triggerReason === "soft-line") triggerCounts.softLine++;
    else if (t.triggerReason === "stage3-trim") triggerCounts.stage3Trim++;
    else triggerCounts.manual++;
  }

  // 胜率、盈亏比按"完整交易"算
  const completedTrades = groupCompletedTrades(trades);
  for (const trade of completedTrades) {
    if (trade.rMultiple > 0.05) {
      winTrades++;
      totalWinR += trade.rMultiple;
      currentConsecutiveWin++;
      currentConsecutiveLoss = 0;
      if (currentConsecutiveWin > maxConsecutiveWins) {
        maxConsecutiveWins = currentConsecutiveWin;
      }
    } else if (trade.rMultiple < -0.05) {
      lossTrades++;
      totalLossR += Math.abs(trade.rMultiple);
      currentConsecutiveLoss++;
      currentConsecutiveWin = 0;
      if (currentConsecutiveLoss > maxConsecutiveLosses) {
        maxConsecutiveLosses = currentConsecutiveLoss;
      }
    } else {
      breakevenTrades++;
      currentConsecutiveLoss = 0;
      currentConsecutiveWin = 0;
    }
  }

  const totalTrades = completedTrades.length;
  const winRate = totalTrades > 0 ? winTrades / totalTrades : 0;
  const lossRate = totalTrades > 0 ? lossTrades / totalTrades : 0;
  const avgWinR = winTrades > 0 ? Number((totalWinR / winTrades).toFixed(2)) : 0;
  const avgLossR = lossTrades > 0 ? Number((totalLossR / lossTrades).toFixed(2)) : 0;
  const expectancyR = Number(((winRate * avgWinR) - (lossRate * avgLossR)).toFixed(3));

  // 三大核心检查点与月度止损闸
  const diagnostics: MonthlyStatsResult["diagnostics"] = [];

  // 检查点 1：输单平均超过 1R -> 止损执行不严
  if (lossTrades >= 3 && avgLossR > 1.05) {
    diagnostics.push({
      type: "error",
      title: "止损执行不严 (输单平均超过 1R)",
      message: `平均每笔输单亏损为 ${avgLossR.toFixed(2)}R，超过了设定的 1R 刚性红线！请检查是否存在盘中已达硬线却犹豫观望、甚至向下挪动止损的不纪律行为。`,
    });
  }

  // 检查点 2：赢单平均不到 2R -> 止盈偏早
  if (winTrades >= 3 && avgWinR < 2.0) {
    diagnostics.push({
      type: "warning",
      title: "止盈偏早 (赢单平均不到 2R)",
      message: `平均每笔赢单仅获得 +${avgWinR.toFixed(2)}R 收益，未达 2.5R 目标。请检查软线均线是否设置得过于紧贴，或存在主观频繁早跑的情况。`,
    });
  }

  // 检查点 3：胜率低于 40% -> 检查买点
  if (totalTrades >= 5 && winRate < 0.40) {
    diagnostics.push({
      type: "warning",
      title: "买点胜率偏低 (检查买入逻辑)",
      message: `当前胜率仅为 ${(winRate * 100).toFixed(1)}% (低于 40%)。请重点检查追涨买入的个股是否已偏离均线过远，或建仓时突破平台的放量有效性不足。`,
    });
  }

  // 月度止损闸：当月亏损达到总资金 6%
  if (monthPnLAmount <= -totalCapital * 0.06) {
    diagnostics.push({
      type: "error",
      title: "月度风控红线已触发 (-6%)",
      message: `${month ? month + " " : ""}当月累计亏损金额已达 ${Math.abs(monthPnLAmount).toFixed(0)} 元 (超过总资金 6%)！按铁律必须停手至下月初，次月单笔风险额度减半至 0.5% 重新开始，连续盈利一个月后方可恢复 1%。`,
    });
  }

  if (diagnostics.length === 0 && totalTrades === 0) {
    diagnostics.push({
      type: "info",
      title: "尚无完整交易",
      message: "已有减仓落袋记录，但还没有一笔从开仓到全部平仓的完整交易，胜率与盈亏比暂不统计。",
    });
  } else if (diagnostics.length === 0) {
    diagnostics.push({
      type: "success",
      title: "纪律执行良好",
      message: `胜率 ${(winRate * 100).toFixed(1)}%，平均盈亏比 ${avgLossR > 0 ? (avgWinR / avgLossR).toFixed(2) : "优秀"}，单笔数学期望为 +${expectancyR}R。继续保持知行合一！`,
    });
  }

  return {
    totalTrades,
    winTrades,
    lossTrades,
    breakevenTrades,
    winRate: Number(winRate.toFixed(4)),
    totalPnLAmount: Number(totalPnLAmount.toFixed(2)),
    totalR: Number(totalR.toFixed(2)),
    month,
    monthPnLAmount: Number(monthPnLAmount.toFixed(2)),
    avgWinR,
    avgLossR,
    expectancyR,
    maxConsecutiveLosses,
    maxConsecutiveWins,
    triggerCounts,
    diagnostics,
  };
}
