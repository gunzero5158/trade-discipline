import { Lot, RuleConfig, DEFAULT_RULE_CONFIG } from "./types";

export interface HardLineCalculationInput {
  stage: number;
  costPrice: number;
  maxGainRatio: number;
  initialStopPrice: number;
  lots?: Lot[];
  yesterdayHardLine?: number | null;
  manualStopPrice?: number | null;
  config?: RuleConfig;
}

export interface HardLineResult {
  hardLinePrice: number;       // 明日硬线价格 (四舍五入保留2位小数)
  stageHardLine: number;       // 纯按当前阶段算出的硬线价格
  latestAddStopPrice: number;  // 最新加仓笔的止损价 (若有)
  manualStopPrice: number;     // 人工上调的硬线 (若有)
  yesterdayHardLine: number;   // 昨日硬线
  ratchetReason: string;       // 硬线取大来源说明
}

/**
 * 严格按照《交易纪律.md》第 3.3、3.4 节与《方案补充与讨论疑问.md》Bug 4 修正公式计算硬线。
 *
 * 阶段硬线公式：
 * - 阶段 0 (<5%): 初始止损位
 * - 阶段 1 (≥5%): 成本 × (1 + 2%)
 * - 阶段 2 (≥10%): 成本 × (1 + 最高浮盈 × 50%)
 * - 阶段 3 (≥20%): 成本 × (1 + 最高浮盈 × 60%) (即回撤 40%)
 *
 * 铁律：明日硬线 = max(昨日硬线, 当前阶段算出的硬线, 最新加仓止损位, 人工手动上调的硬线, 初始止损位)
 * 五者取最大，代码层面锁死“硬线只升不降”。
 */
export function calculateHardLine(input: HardLineCalculationInput): HardLineResult {
  const config = input.config ?? DEFAULT_RULE_CONFIG;
  const { stage, costPrice, maxGainRatio, initialStopPrice } = input;

  let stageHardLine: number;

  switch (stage) {
    case 0:
      stageHardLine = initialStopPrice;
      break;
    case 1:
      stageHardLine = costPrice * (1 + config.stage1HardLineGain);
      break;
    case 2:
      // 回撤 50%，锁定 50%
      stageHardLine = costPrice * (1 + maxGainRatio * (1 - config.stage2GivebackRatio));
      break;
    case 3:
      // 回撤 40%，锁定 60%
      stageHardLine = costPrice * (1 + maxGainRatio * (1 - config.stage3GivebackRatio));
      break;
    default:
      stageHardLine = initialStopPrice;
  }

  // 检查加仓笔止损位
  let latestAddStopPrice = 0;
  if (input.lots && input.lots.length > 1) {
    for (let i = 1; i < input.lots.length; i++) {
      if (input.lots[i].stopPrice > latestAddStopPrice) {
        latestAddStopPrice = input.lots[i].stopPrice;
      }
    }
  }

  const yesterdayHardLine = input.yesterdayHardLine ?? 0;
  const manualStopPrice = input.manualStopPrice ?? 0;

  // 严格执行五者取最大 (Bug 4 修正)
  let maxPrice = initialStopPrice;
  let reason = "初始止损位";

  if (stageHardLine > maxPrice) {
    maxPrice = stageHardLine;
    reason = `阶段 ${stage} 算法算出的硬线`;
  }
  if (latestAddStopPrice > maxPrice) {
    maxPrice = latestAddStopPrice;
    reason = "最新加仓笔止损位";
  }
  if (manualStopPrice > maxPrice) {
    maxPrice = manualStopPrice;
    reason = "人工手动上调硬线";
  }
  if (yesterdayHardLine > maxPrice) {
    maxPrice = yesterdayHardLine;
    reason = "昨日硬线 (锁定只升不降)";
  }

  // 价格保留两位小数（A股通用，港美股如需更小精度可通过小数位数处理，默认2位）
  const finalHardLine = Number(maxPrice.toFixed(2));

  return {
    hardLinePrice: finalHardLine,
    stageHardLine: Number(stageHardLine.toFixed(2)),
    latestAddStopPrice: Number(latestAddStopPrice.toFixed(2)),
    manualStopPrice: Number(manualStopPrice.toFixed(2)),
    yesterdayHardLine: Number(yesterdayHardLine.toFixed(2)),
    ratchetReason: reason,
  };
}

/**
 * 计算硬线距离当前收盘价的百分比与差额
 */
export function calculateHardLineDistance(
  currentClosePrice: number,
  hardLinePrice: number
): {
  distancePercent: number; // 例如 0.052 表示高于硬线 5.2%；负数表示已击穿
  isViolated: boolean;     // 收盘是否已低于硬线
  distanceAmount: number;  // 距硬线价差
} {
  const diff = currentClosePrice - hardLinePrice;
  const distancePercent = currentClosePrice > 0 ? diff / currentClosePrice : 0;
  return {
    distancePercent: Number(distancePercent.toFixed(6)),
    isViolated: currentClosePrice < hardLinePrice,
    distanceAmount: Number(diff.toFixed(2)),
  };
}
