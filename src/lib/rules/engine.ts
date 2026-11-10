import { Position, DailySnapshot, RuleConfig, DEFAULT_RULE_CONFIG } from "./types";
import { calculateStage } from "./stages";
import { calculateHardLine, calculateHardLineDistance } from "./hardLine";
import { calculateSoftLine, Candle } from "./softLine";
import { determineNextAction } from "./actions";

export interface EvaluationInput {
  position: Position;
  candles: Candle[];             // 日线序列，最新一根为当天收盘
  yesterdayHardLine?: number | null;
  config?: RuleConfig;
}

/**
 * 规则引擎统一入口：
 * 接收持仓信息与截至今日的日线序列，完整评估出当前阶段、明日硬线、软线状态、连续破位天数以及明日决策动作。
 */
export function evaluatePositionRules(input: EvaluationInput): DailySnapshot {
  const { position, candles } = input;
  const config = input.config ?? DEFAULT_RULE_CONFIG;

  if (!candles || candles.length === 0) {
    throw new Error(`No candle data available for position ${position.symbol}`);
  }

  const latestCandle = candles[candles.length - 1];
  const currentClosePrice = latestCandle.close;

  // 1. 获取买入日期之后的最高价
  // 首仓日期
  const initialLot = position.lots.find((l) => l.type === "initial") || position.lots[0];
  const entryDate = initialLot ? new Date(initialLot.date).getTime() : 0;

  let highPriceSinceEntry = currentClosePrice;
  for (const c of candles) {
    const candleTime = new Date(c.date).getTime();
    if (candleTime >= entryDate) {
      if (c.high > highPriceSinceEntry) {
        highPriceSinceEntry = c.high;
      }
    }
  }

  // 2. 阶段计算 (含 maxStage 永不降级保证)
  const stageRes = calculateStage({
    lots: position.lots,
    highPriceSinceEntry,
    currentClosePrice,
    previousMaxStage: position.maxStage,
    config,
  });

  // 3. 硬线计算 (含五者取最大只升不降铁律)
  const hardLineRes = calculateHardLine({
    stage: stageRes.effectiveStage,
    costPrice: stageRes.costPrice,
    maxGainRatio: stageRes.maxGainRatio,
    initialStopPrice: position.initialStopPrice,
    lots: position.lots,
    yesterdayHardLine: input.yesterdayHardLine ?? position.initialStopPrice,
    manualStopPrice: position.manualStopPrice,
    config,
  });

  const hardLineDist = calculateHardLineDistance(currentClosePrice, hardLineRes.hardLinePrice);

  // 4. 软线计算 (EMA/MA 任意周期 + 动态余量 + 连续确认 + 加速段锁定)
  const softLineRes = calculateSoftLine({
    candles,
    maType: position.maType,
    maPeriod: position.maPeriod,
    confirmDays: position.confirmDays,
    stage: stageRes.effectiveStage,
    accelerationLocked: position.accelerationLocked,
    config,
  });

  // 5. 判定明日动作 (严格按 5 级优先级，命中首条即停)
  const actionRes = determineNextAction({
    currentClosePrice,
    hardLinePrice: hardLineRes.hardLinePrice,
    isSoftLineTriggered: softLineRes.isTriggered,
    isSoftLineConfirmed: softLineRes.isConfirmed,
    stage: stageRes.effectiveStage,
    stage3Trimmed: position.stage3Trimmed,
    consecutiveTriggerDays: softLineRes.consecutiveTriggerDays,
    confirmDays: position.confirmDays,
  });

  const snapshot: DailySnapshot = {
    positionId: position.id,
    date: typeof latestCandle.date === "string" ? latestCandle.date.substring(0, 10) : new Date(latestCandle.date).toISOString().substring(0, 10),
    closePrice: currentClosePrice,
    highPrice: stageRes.highPrice,
    costPrice: stageRes.costPrice,
    maxGainRatio: stageRes.maxGainRatio,
    currentGainRatio: stageRes.currentGainRatio,
    stage: stageRes.effectiveStage,
    stageName: stageRes.stageName,
    hardLinePrice: hardLineRes.hardLinePrice,
    hardLineDistancePercent: hardLineDist.distancePercent,
    currentHardLineViolated: hardLineDist.isViolated,
    maType: softLineRes.effectiveMaType,
    maPeriod: softLineRes.effectiveMaPeriod,
    maValue: softLineRes.maValue,
    margin: softLineRes.margin,
    softLinePrice: softLineRes.softLinePrice,
    softLineTriggered: softLineRes.isTriggered,
    consecutiveTriggerDays: softLineRes.consecutiveTriggerDays,
    nextAction: actionRes.action,
    actionReason: actionRes.actionReason,
    accelerationMode: softLineRes.accelerationMode,
  };

  return snapshot;
}
