import { Lot, MarketRegion, RuleConfig, DEFAULT_RULE_CONFIG } from "./types";

export interface OpenPositionInput {
  totalCapital: number;
  buyPrice: number;
  stopPrice: number;
  riskPercent?: number;             // 默认 1.0%
  market?: MarketRegion;
  lotSize?: number;                 // 港股每手股数，默认 100
  currentPortfolioRiskAmount?: number; // 现有持仓未实现风险合计
  config?: RuleConfig;
}

export interface OpenPositionResult {
  buyPrice: number;
  stopPrice: number;
  stopLossPercent: number;          // 止损百分比 (例如 -0.08)
  perShareRisk: number;             // 每股风险空间 (1R = buyPrice - stopPrice)
  targetRiskAmount: number;         // 目标单笔亏损额 (例如 1000 元)
  shares: number;                   // 建议买入股数 (向下取整到交易单位)
  positionAmount: number;           // 买入金额 (股数 × 买价)
  positionPercent: number;          // 占总资金比例 (例如 0.125)
  effectiveRiskAmount: number;      // 实际承担的 1R 风险金额 (股数 × 每股风险)
  r1Amount: number;                 // 1R 金额
  // 校验一：单只上限 25%
  isPositionOverweight: boolean;
  recommendedSharesAt25Limit: number;
  positionOverweightMessage?: string;
  // 校验二：总风险超闸 5%
  isTotalRiskExceeded: boolean;
  newTotalRiskPercent: number;
  totalRiskExceededMessage?: string;
  // 校验三：追涨/止损过远
  isRiskRewardPoor: boolean;
  riskRewardMessage?: string;
  // 风险额度连一个交易单位都买不起
  insufficientRiskBudgetMessage?: string;
}

export interface AddPositionInput {
  existingLots: Lot[];
  addPrice: number;
  keyLevel: number;                 // 关键支撑位 (如前高平台或均线)
  totalCapital: number;
  currentHardLine: number;
  avgAmplitude?: number;            // 近 20 日平均振幅，默认 0.02
  maPrice?: number;                 // 当前所选均线价格，用于距离检查
  market?: MarketRegion;
  lotSize?: number;
  config?: RuleConfig;
}

export interface AddPositionResult {
  addPrice: number;
  keyLevel: number;
  addStopPrice: number;             // 加仓止损位 = 关键位 × (1 - 振幅 × 0.5)
  addIndex: number;                 // 第几次加仓 (1 或 2)
  addRiskPercent: number;           // 加仓风险额度 (0.5% 或 0.25%)
  targetAddRiskAmount: number;      // 加仓目标风险金额
  requestedShares: number;          // 初始测算加仓股数
  finalShares: number;              // 经总账安全约束缩减后的最终加仓股数
  addAmount: number;                // 加仓买入金额
  combinedHardLine: number;         // 合并后的明日硬线 = max(当前硬线, 加仓止损位)
  // 总账核算
  oldLotsPnLAtCombinedStop: number; // 老仓在合并硬线处的盈亏
  addLotLossAtCombinedStop: number; // 加仓在合并硬线处的亏损
  totalLedgerAtCombinedStop: number;// 总账合计
  isTotalLedgerSafe: boolean;       // 总账是否安全 (不亏或亏损不超过 1%)
  totalSharesAfterAdd: number;      // 加仓后总股数
  newWeightedCost: number;          // 加仓后新的加权平均成本
  totalPositionAmountAfterAdd: number;// 加仓后总持仓金额
  totalPositionPercentAfterAdd: number;// 加仓后占总资金比例
  isExceeding25PercentLimit: boolean;  // 加仓后是否超过 25% 上限
  isFarFromMa: boolean;             // 是否离均线太远 (>8%)
  distanceToMaPercent: number;
  warningMessages: string[];
  isRejected: boolean;              // 是否被拒绝 (例如超过 2 次加仓)
  rejectReason?: string;
}

/**
 * 格式化交易步进单位
 */
export function getShareStep(market: MarketRegion = "a-share", lotSize: number = 100): number {
  if (market === "a-share") return 100;
  if (market === "hong-kong") return lotSize > 0 ? lotSize : 100;
  return 1; // 美股/日股
}

/**
 * 价格与止损百分比双向互算辅助函数
 */
export function stopPriceFromPercent(buyPrice: number, percentLoss: number): number {
  // percentLoss 应为正数 (如 0.08) 或负数 (如 -0.08)
  const absLoss = Math.abs(percentLoss);
  return Number((buyPrice * (1 - absLoss)).toFixed(2));
}

export function stopPercentFromPrice(buyPrice: number, stopPrice: number): number {
  if (buyPrice <= 0) return 0;
  return Number(((stopPrice - buyPrice) / buyPrice).toFixed(4));
}

/**
 * 严格按照《交易纪律.md》第 2、5、8 节与《开发文档.md》3.7 节实现开仓计算器。
 */
export function calculateOpenPosition(input: OpenPositionInput): OpenPositionResult {
  const config = input.config ?? DEFAULT_RULE_CONFIG;
  const riskPercent = input.riskPercent ?? config.defaultRiskPercent;
  const market = input.market ?? "a-share";
  const step = getShareStep(market, input.lotSize ?? 100);

  if (input.buyPrice <= 0 || input.stopPrice <= 0) {
    throw new Error("买入价和止损价必须大于 0");
  }

  if (input.stopPrice >= input.buyPrice) {
    throw new Error("止损价必须低于买入价");
  }

  const perShareRisk = Number((input.buyPrice - input.stopPrice).toFixed(4));
  const stopLossPercent = Number(((input.stopPrice - input.buyPrice) / input.buyPrice).toFixed(6));
  const stopDistancePercent = Math.abs(stopLossPercent);
  const targetRiskAmount = Number((input.totalCapital * (riskPercent / 100)).toFixed(2));

  // 股数 = 总资金 × 风险比例 ÷ 每股亏损空间，向下取整到交易单位 (加 1e-7 避免 624.9999999999994 精度向下误切)
  // 不够一个交易单位就是 0 股：硬凑一手会悄悄超过单笔风险上限
  const rawShares = (targetRiskAmount / perShareRisk) + 1e-7;
  const shares = Math.floor(rawShares / step) * step;
  let insufficientRiskBudgetMessage: string | undefined;
  if (shares <= 0) {
    insufficientRiskBudgetMessage = `按 ${riskPercent}% 风险额度 (${targetRiskAmount} 元) 和每股 ${perShareRisk.toFixed(2)} 元的止损空间，买不起一个交易单位 (${step} 股)。要么放近止损，要么放弃。`;
  }
  const positionAmount = Number((shares * input.buyPrice).toFixed(2));
  const positionPercent = Number((positionAmount / input.totalCapital).toFixed(4));
  const effectiveRiskAmount = Number((shares * perShareRisk).toFixed(2));
  const r1Amount = effectiveRiskAmount;

  // 校验一：仓位过重 (>25%)，止损放得太近
  const isPositionOverweight = positionPercent > (config.maxPositionPercent / 100);
  const maxAllowedAmount = input.totalCapital * (config.maxPositionPercent / 100);
  const recommendedSharesAt25Limit = Math.floor(maxAllowedAmount / input.buyPrice / step) * step;
  let positionOverweightMessage: string | undefined;
  if (isPositionOverweight) {
    positionOverweightMessage = `仓位占比 ${(positionPercent * 100).toFixed(1)}% 超过 ${config.maxPositionPercent}% 上限！止损放得太近，请按支撑图放远止损，或按上限减仓至 ${recommendedSharesAt25Limit} 股。`;
  }

  // 校验二：总持仓风险超闸 (>5%)
  const currentRisk = input.currentPortfolioRiskAmount ?? 0;
  const newTotalRiskAmount = currentRisk + effectiveRiskAmount;
  const newTotalRiskPercent = Number((newTotalRiskAmount / input.totalCapital * 100).toFixed(2));
  const isTotalRiskExceeded = newTotalRiskPercent > config.maxPortfolioRiskPercent;
  let totalRiskExceededMessage: string | undefined;
  if (isTotalRiskExceeded) {
    totalRiskExceededMessage = `加上此笔后总风险暴露达到 ${newTotalRiskPercent}%，超过 ${config.maxPortfolioRiskPercent}% 闸限！暂不开新仓，等老仓硬线挪到成本上方释放额度。`;
  }

  // 校验三：追涨/性价比差 (止损距离 >12% 或 仓位 <8%)
  const isRiskRewardPoor = stopDistancePercent > 0.12 || positionPercent < 0.08;
  let riskRewardMessage: string | undefined;
  if (stopDistancePercent > 0.12) {
    riskRewardMessage = `止损距离 ${(stopDistancePercent * 100).toFixed(1)}% 超过 12%，止损太远，性价比差，建议等待回调或放弃。`;
  } else if (positionPercent < 0.08) {
    riskRewardMessage = `按此止损反推仓位仅 ${(positionPercent * 100).toFixed(1)}% (低于 8%)，止损过宽仓位太轻，建议放弃。`;
  }

  return {
    buyPrice: input.buyPrice,
    stopPrice: input.stopPrice,
    stopLossPercent: Number(stopLossPercent.toFixed(4)),
    perShareRisk: Number(perShareRisk.toFixed(2)),
    targetRiskAmount: Number(targetRiskAmount.toFixed(2)),
    shares,
    positionAmount,
    positionPercent,
    effectiveRiskAmount,
    r1Amount,
    isPositionOverweight,
    recommendedSharesAt25Limit,
    positionOverweightMessage,
    isTotalRiskExceeded,
    newTotalRiskPercent,
    totalRiskExceededMessage,
    isRiskRewardPoor,
    riskRewardMessage,
    insufficientRiskBudgetMessage,
  };
}

/**
 * 严格按照《交易纪律.md》第 6 节与《开发文档.md》3.8 节实现回撤加仓计算器。
 */
export function calculateAddPosition(input: AddPositionInput): AddPositionResult {
  const config = input.config ?? DEFAULT_RULE_CONFIG;
  const market = input.market ?? "a-share";
  const step = getShareStep(market, input.lotSize ?? 100);
  const avgAmplitude = input.avgAmplitude ?? 0.02;
  const existingLots = input.existingLots;

  if (existingLots.length === 0) {
    throw new Error("加仓必须针对已有持仓计算");
  }

  // 统计加仓次数 (第 1 次、第 2 次，第 3 次拒绝)
  const addLotsCount = existingLots.filter((l) => l.type === "add").length;
  if (addLotsCount >= 2) {
    return {
      addPrice: input.addPrice,
      keyLevel: input.keyLevel,
      addStopPrice: 0,
      addIndex: addLotsCount + 1,
      addRiskPercent: 0,
      targetAddRiskAmount: 0,
      requestedShares: 0,
      finalShares: 0,
      addAmount: 0,
      combinedHardLine: input.currentHardLine,
      oldLotsPnLAtCombinedStop: 0,
      addLotLossAtCombinedStop: 0,
      totalLedgerAtCombinedStop: 0,
      isTotalLedgerSafe: false,
      totalSharesAfterAdd: 0,
      newWeightedCost: 0,
      totalPositionAmountAfterAdd: 0,
      totalPositionPercentAfterAdd: 0,
      isExceeding25PercentLimit: false,
      isFarFromMa: false,
      distanceToMaPercent: 0,
      warningMessages: ["已达到最多加仓 2 次限制，第三次以后风险额度太小且易摊薄利润，拒绝加仓。"],
      isRejected: true,
      rejectReason: "已达到最多加仓 2 次上限",
    };
  }

  const addIndex = addLotsCount + 1;
  // 风险额度减半规则：首仓 1%，第一次加仓 0.5%，第二次加仓 0.25%
  const addRiskPercent = addIndex === 1 ? 0.5 : 0.25;
  const targetAddRiskAmount = input.totalCapital * (addRiskPercent / 100);

  // 加仓止损位 = 关键位 × (1 - 振幅 × 0.5)
  const addStopPrice = Number((input.keyLevel * (1 - avgAmplitude * 0.5)).toFixed(2));
  if (addStopPrice >= input.addPrice) {
    throw new Error(`加仓止损位 (${addStopPrice}) 必须低于加仓价 (${input.addPrice})`);
  }

  const perShareRisk = input.addPrice - addStopPrice;
  let rawShares = targetAddRiskAmount / perShareRisk;
  let shares = Math.max(step, Math.floor(rawShares / step) * step);
  const requestedShares = shares;

  // 合并硬线 = max(当前硬线, 加仓止损位)
  const combinedHardLine = Number(Math.max(input.currentHardLine, addStopPrice).toFixed(2));

  // 总账检查逻辑：
  // 老仓在合并硬线处盈亏 + 加仓在合并硬线处亏损
  // 总账 < -总资金 × 1% 时按比例缩减加仓股数直到满足
  const maxAllowedLoss = -input.totalCapital * 0.01; // 不能亏超过 1%
  const warnings: string[] = [];

  let oldLotsPnL = 0;
  let existingTotalShares = 0;
  let existingTotalCost = 0;
  for (const lot of existingLots) {
    oldLotsPnL += lot.shares * (combinedHardLine - lot.price);
    existingTotalShares += lot.shares;
    existingTotalCost += lot.shares * lot.price;
  }

  let addLotPnL = shares * (combinedHardLine - input.addPrice);
  let totalLedger = oldLotsPnL + addLotPnL;

  // 若总账亏损超标，逐步缩减加仓股数
  if (totalLedger < maxAllowedLoss) {
    while (shares > step && totalLedger < maxAllowedLoss) {
      shares -= step;
      addLotPnL = shares * (combinedHardLine - input.addPrice);
      totalLedger = oldLotsPnL + addLotPnL;
    }
    warnings.push(`因总账风控约束（若合并硬线被击穿整笔亏损不得超 1%），加仓股数已从 ${requestedShares} 缩减至 ${shares} 股。`);
  }

  const finalShares = shares;
  const addAmount = Number((finalShares * input.addPrice).toFixed(2));
  const totalSharesAfterAdd = existingTotalShares + finalShares;
  const totalPositionAmountAfterAdd = Number((existingTotalCost + addAmount).toFixed(2));
  const newWeightedCost = Number((totalPositionAmountAfterAdd / totalSharesAfterAdd).toFixed(4));
  const totalPositionPercentAfterAdd = Number((totalPositionAmountAfterAdd / input.totalCapital).toFixed(4));

  // 校验一：加仓后总仓位不得超 25%
  const isExceeding25PercentLimit = totalPositionPercentAfterAdd > (config.maxPositionPercent / 100);
  if (isExceeding25PercentLimit) {
    warnings.push(`加仓后总仓位 ${(totalPositionPercentAfterAdd * 100).toFixed(1)}% 超过 ${config.maxPositionPercent}% 上限！`);
  }

  // 校验二：加仓价距均线不超过 8%
  let isFarFromMa = false;
  let distanceToMaPercent = 0;
  if (input.maPrice && input.maPrice > 0) {
    distanceToMaPercent = (input.addPrice - input.maPrice) / input.maPrice;
    if (distanceToMaPercent > 0.08) {
      isFarFromMa = true;
      warnings.push(`加仓价距均线偏离 ${(distanceToMaPercent * 100).toFixed(1)}% (超过 8%)，离均线太远等于追高！`);
    }
  }

  return {
    addPrice: input.addPrice,
    keyLevel: input.keyLevel,
    addStopPrice,
    addIndex,
    addRiskPercent,
    targetAddRiskAmount: Number(targetAddRiskAmount.toFixed(2)),
    requestedShares,
    finalShares,
    addAmount,
    combinedHardLine,
    oldLotsPnLAtCombinedStop: Number(oldLotsPnL.toFixed(2)),
    addLotLossAtCombinedStop: Number(addLotPnL.toFixed(2)),
    totalLedgerAtCombinedStop: Number(totalLedger.toFixed(2)),
    isTotalLedgerSafe: totalLedger >= maxAllowedLoss,
    totalSharesAfterAdd,
    newWeightedCost,
    totalPositionAmountAfterAdd,
    totalPositionPercentAfterAdd,
    isExceeding25PercentLimit,
    isFarFromMa,
    distanceToMaPercent: Number(distanceToMaPercent.toFixed(4)),
    warningMessages: warnings,
    isRejected: false,
  };
}
