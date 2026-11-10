import { Lot, TradeTriggerReason, TradeRecord } from "./types";

export interface CloseExecutionInput {
  positionId: string;
  symbol: string;
  name: string;
  lots: Lot[];
  previousTrades?: TradeRecord[]; // 该持仓已发生的部分平仓记录 (若有)
  exitDate: string;
  exitPrice: number;
  sharesToClose: number;
  triggerReason: TradeTriggerReason;
  highPriceSinceEntry: number;
  notes?: string | null;
}

export interface CloseExecutionResult {
  tradeRecord: TradeRecord;
  isFullClose: boolean;
  remainingShares: number;
  totalRealizedPnL: number;
  totalCompositeR: number; // 严格按照 Bug 3 修正后的总合成 R 倍数
  givebackRatio: number;   // 最高浮盈吐回比例
}

/**
 * 严格按照《开发文档.md》第 3.9 节与《方案补充与讨论疑问.md》Bug 3 修复实现平仓结算。
 *
 * 核心公式：
 * - 首仓初始 1R 风险金额 = 首仓股数 × (首仓买入价 − 首仓初始止损价)
 * - 整笔交易总 R 倍数 = (历次部分平仓盈亏金额之和 + 本次平仓盈亏金额) ÷ 首仓初始 1R 风险金额
 * - 分母始终锚定首仓最初承担的 1R 风险额，无论中途加仓或分批减仓，保证统计口径严格一致。
 */
export function executePositionClose(input: CloseExecutionInput): CloseExecutionResult {
  const { lots, previousTrades = [] } = input;

  if (lots.length === 0) {
    throw new Error("No lots provided for close execution");
  }

  const initialLot = lots.find((l) => l.type === "initial") || lots[0];
  const initial1RRiskAmount = initialLot.shares * (initialLot.price - initialLot.stopPrice);

  if (initial1RRiskAmount <= 0) {
    throw new Error("首仓 1R 风险金额必须大于 0");
  }

  // 加权平均成本
  let totalShares = 0;
  let totalCost = 0;
  for (const lot of lots) {
    totalShares += lot.shares;
    totalCost += lot.shares * lot.price;
  }

  // 扣减已平仓股数
  let alreadyClosedShares = 0;
  let alreadyRealizedPnL = 0;
  for (const pt of previousTrades) {
    alreadyClosedShares += pt.shares;
    alreadyRealizedPnL += pt.pnlAmount;
  }

  const currentHoldingShares = totalShares - alreadyClosedShares;
  if (input.sharesToClose > currentHoldingShares) {
    throw new Error(`平仓股数 (${input.sharesToClose}) 不能大于当前持仓股数 (${currentHoldingShares})`);
  }

  const weightedCost = totalCost / totalShares;
  const pnlAmount = Number((input.sharesToClose * (input.exitPrice - weightedCost)).toFixed(2));
  const pnlRatio = Number(((input.exitPrice - weightedCost) / weightedCost).toFixed(4));

  // 本次平仓对应的单笔 R
  const thisTradeR = Number((pnlAmount / initial1RRiskAmount).toFixed(2));

  // 历次累加的总实现盈亏与总合成 R
  const totalRealizedPnL = Number((alreadyRealizedPnL + pnlAmount).toFixed(2));
  const totalCompositeR = Number((totalRealizedPnL / initial1RRiskAmount).toFixed(2));

  // 最高浮盈与实际落袋对比
  const maxGainRatio = Number(((input.highPriceSinceEntry - weightedCost) / weightedCost).toFixed(4));
  const givebackRatio = Number(Math.max(0, maxGainRatio - pnlRatio).toFixed(4));

  const remainingShares = currentHoldingShares - input.sharesToClose;
  const isFullClose = remainingShares <= 0;

  const tradeRecord: TradeRecord = {
    id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    positionId: input.positionId,
    symbol: input.symbol,
    name: input.name,
    exitDate: input.exitDate,
    exitPrice: input.exitPrice,
    shares: input.sharesToClose,
    triggerReason: input.triggerReason,
    pnlAmount,
    pnlRatio,
    rMultiple: thisTradeR,
    maxGainRatio,
    givebackRatio,
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };

  return {
    tradeRecord,
    isFullClose,
    remainingShares,
    totalRealizedPnL,
    totalCompositeR,
    givebackRatio,
  };
}
