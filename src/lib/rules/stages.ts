import { Lot, RuleConfig, DEFAULT_RULE_CONFIG } from "./types";

export interface StageCalculationInput {
  lots: Lot[];
  highPriceSinceEntry: number;
  currentClosePrice: number;
  previousMaxStage?: number;
  config?: RuleConfig;
}

export interface StageCalculationResult {
  costPrice: number;          // 加权平均成本
  totalShares: number;        // 总股数
  totalCost: number;          // 总成本金额
  highPrice: number;          // 持仓以来最高价
  maxGainRatio: number;       // 持仓以来最高浮盈 ((highPrice / costPrice) - 1)
  currentGainRatio: number;   // 当前收盘浮盈 ((currentClosePrice / costPrice) - 1)
  calculatedStage: number;    // 根据当前浮盈算出的阶段
  effectiveStage: number;     // 经过 maxStage 保护后的最终生效阶段 (绝不降级)
  stageName: string;          // 阶段名称
}

export const STAGE_NAMES = [
  "阶段 0 (初始止损)",
  "阶段 1 (保本跟踪)",
  "阶段 2 (锁定跟踪)",
  "阶段 3 (落袋保护)",
] as const;

/**
 * 严格按照《交易纪律.md》与《方案补充与讨论疑问.md》计算持仓浮盈与阶段。
 *
 * 核心机制与 Bug 修复：
 * - 加权成本 = sum(price * shares) / sum(shares)
 * - 最高浮盈 = highPrice / costPrice - 1
 * - Bug 1 修复：加仓摊高平均成本会导致最高浮盈缩水，但阶段强制执行
 *   effectiveStage = max(previousMaxStage, calculatedStage)，绝不倒退。
 */
export function calculateStage(input: StageCalculationInput): StageCalculationResult {
  const config = input.config ?? DEFAULT_RULE_CONFIG;
  const lots = input.lots;

  if (!lots || lots.length === 0) {
    throw new Error("Cannot calculate stage for empty lots");
  }

  let totalShares = 0;
  let totalCost = 0;

  for (const lot of lots) {
    totalShares += lot.shares;
    totalCost += lot.shares * lot.price;
  }

  if (totalShares <= 0) {
    throw new Error("Total shares must be greater than zero");
  }

  const costPrice = totalCost / totalShares;
  const highPrice = Math.max(input.highPriceSinceEntry, costPrice, input.currentClosePrice);
  const maxGainRatio = Number(((highPrice / costPrice) - 1).toFixed(6));
  const currentGainRatio = Number(((input.currentClosePrice / costPrice) - 1).toFixed(6));

  // 基础阶段计算 (使用高精度四舍五入后的浮点数避免 0.19999999999999996 导致的精度陷阱)
  let calculatedStage = 0;
  if (maxGainRatio >= config.stage3Threshold - 1e-6) {
    calculatedStage = 3;
  } else if (maxGainRatio >= config.stage2Threshold - 1e-6) {
    calculatedStage = 2;
  } else if (maxGainRatio >= config.stage1Threshold - 1e-6) {
    calculatedStage = 1;
  } else {
    calculatedStage = 0;
  }

  // 铁律：阶段只升不降 (Bug 1 修补)
  const previousMaxStage = input.previousMaxStage ?? 0;
  const effectiveStage = Math.max(previousMaxStage, calculatedStage);

  return {
    costPrice: Number(costPrice.toFixed(4)),
    totalShares,
    totalCost: Number(totalCost.toFixed(2)),
    highPrice: Number(highPrice.toFixed(4)),
    maxGainRatio: Number(maxGainRatio.toFixed(6)),
    currentGainRatio: Number(currentGainRatio.toFixed(6)),
    calculatedStage,
    effectiveStage,
    stageName: STAGE_NAMES[effectiveStage] ?? `阶段 ${effectiveStage}`,
  };
}
