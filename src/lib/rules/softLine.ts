import { MovingAverageType, RuleConfig, DEFAULT_RULE_CONFIG } from "./types";

export interface Candle {
  date: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SoftLineInput {
  candles: Candle[];             // 日线序列，最新的一根在最后 (按日期升序)
  maType: MovingAverageType;     // EMA 或 MA
  maPeriod: number;              // 均线周期 (如 5, 10, 20, 30, 60, 120)
  confirmDays: number;           // 确认天数 (默认 1 或 2)
  stage: number;                 // 当前阶段 (0, 1, 2, 3)
  accelerationLocked?: boolean;  // 是否已被加速段锁定
  config?: RuleConfig;
}

export interface SoftLineResult {
  effectiveMaType: MovingAverageType;
  effectiveMaPeriod: number;
  maValue: number;               // 今日对应均线值
  margin: number;                // 动态余量比例 (例如 0.015)
  softLinePrice: number;         // 软线价格 (maValue * (1 - margin))
  isTriggered: boolean;          // 今日收盘是否低于软线
  consecutiveTriggerDays: number;// 连续跌破天数
  isConfirmed: boolean;          // 是否满足连续确认天数 (达到即需卖出)
  accelerationMode: boolean;     // 是否触发或锁定了 5 日线加速段
  avgAmplitude: number;          // 近 20 日平均振幅
}

/**
 * 计算简单移动平均线 (SMA / MA)
 */
export function calculateSMA(closes: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) {
      sum -= closes[i - period];
    }
    if (i >= period - 1) {
      result.push(Number((sum / period).toFixed(4)));
    } else {
      result.push(NaN);
    }
  }
  return result;
}

/**
 * 计算指数移动平均线 (EMA)
 */
export function calculateEMA(closes: number[], period: number): number[] {
  const result: number[] = [];
  if (closes.length === 0) return result;

  const k = 2 / (period + 1);
  let currentEma = 0;

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      currentEma = closes[0];
      result.push(Number(currentEma.toFixed(4)));
    } else {
      currentEma = closes[i] * k + currentEma * (1 - k);
      result.push(Number(currentEma.toFixed(4)));
    }
  }
  return result;
}

/**
 * 计算近 N 日平均日内振幅：mean((high - low) / prevClose)
 */
export function calculateAverageAmplitude(candles: Candle[], period: number = 20): number {
  if (candles.length < 2) return 0.02; // 默认 2% 振幅兜底

  const startIndex = Math.max(1, candles.length - period);
  let sumAmp = 0;
  let count = 0;

  for (let i = startIndex; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    if (prevClose > 0) {
      const amp = (candles[i].high - candles[i].low) / prevClose;
      sumAmp += amp;
      count++;
    }
  }

  if (count === 0) return 0.02;
  return Number((sumAmp / count).toFixed(6));
}

/**
 * 严格按照《交易纪律.md》第 3.5、3.3 节与《方案补充与讨论疑问.md》第 1.2、1.3、疑问 5 实现软线计算。
 *
 * 核心逻辑：
 * 1. 均线周期选择：
 *    - 用户默认或定制周期 (阶段 0, 1 使用用户选定如 20 日)
 *    - 阶段 2、3 默认切换为 10 日线 (除非用户单股定制指定)
 *    - 阶段 3 加速段：若满足加速条件或已锁定，切换为 5 日线
 * 2. 动态余量：
 *    余量 = 近 20 日平均振幅 × 0.5 (例如振幅 2% 余量 1%，振幅 5% 余量 2.5%)
 * 3. 软线价格 = maValue × (1 - 余量)
 * 4. 今日跌破：今日收盘 < 软线价格
 * 5. 确认：连续跌破天数 ≥ 设定确认天数
 */
export function calculateSoftLine(input: SoftLineInput): SoftLineResult {
  const config = input.config ?? DEFAULT_RULE_CONFIG;
  const candles = input.candles;

  if (!candles || candles.length === 0) {
    throw new Error("Candles array cannot be empty for soft line calculation");
  }

  const closes = candles.map((c) => c.close);
  const avgAmplitude = calculateAverageAmplitude(candles, config.amplitudePeriod);
  const margin = Number((avgAmplitude * config.marginMultiplier).toFixed(6));

  // 1. 均线周期判断
  let effectiveMaType = input.maType;
  let effectivePeriod = input.maPeriod;
  let accelerationMode = !!input.accelerationLocked;

  // 阶段 2 与阶段 3 的均线规则
  if (input.stage === 2) {
    // 阶段 2 默认 10 日线
    effectivePeriod = 10;
  } else if (input.stage >= 3) {
    effectivePeriod = 10;

    // 检查加速段条件 (文档 3.3 节与疑问 5 修复)
    // 条件：最近 3 个交易日每天收盘涨幅都超过近 20 日平均振幅，且收盘价高于 10 日线 8% 以上
    if (candles.length >= 4) {
      const ma10Series = effectiveMaType === "EMA" ? calculateEMA(closes, 10) : calculateSMA(closes, 10);
      const latestClose = closes[closes.length - 1];
      const latestMa10 = ma10Series[ma10Series.length - 1];

      let consecutiveGainsExceedAmp = true;
      for (let i = candles.length - 3; i < candles.length; i++) {
        const prev = closes[i - 1];
        const gain = (closes[i] - prev) / prev;
        if (gain <= avgAmplitude) {
          consecutiveGainsExceedAmp = false;
          break;
        }
      }

      const aboveMa10Threshold = !isNaN(latestMa10) && (latestClose - latestMa10) / latestMa10 >= config.accelerationMaDistance;

      if (consecutiveGainsExceedAmp && aboveMa10Threshold) {
        accelerationMode = true; // 触发加速段并锁定
      }
    }

    if (accelerationMode) {
      effectivePeriod = 5; // 切 5 日线
    }
  }

  // 2. 计算所选均线序列
  const maSeries =
    effectiveMaType === "EMA"
      ? calculateEMA(closes, effectivePeriod)
      : calculateSMA(closes, effectivePeriod);

  const latestMaValue = maSeries[maSeries.length - 1];
  const maValue = isNaN(latestMaValue) ? closes[closes.length - 1] : latestMaValue;
  const softLinePrice = Number((maValue * (1 - margin)).toFixed(2));

  // 3. 计算连续跌破天数
  let consecutiveTriggerDays = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const historicalMa = maSeries[i];
    if (isNaN(historicalMa)) break;
    const historicalSoftLine = historicalMa * (1 - margin);
    if (closes[i] < historicalSoftLine) {
      consecutiveTriggerDays++;
    } else {
      break;
    }
  }

  const isTriggered = consecutiveTriggerDays > 0;
  const isConfirmed = consecutiveTriggerDays >= input.confirmDays;

  return {
    effectiveMaType,
    effectiveMaPeriod: effectivePeriod,
    maValue: Number(maValue.toFixed(2)),
    margin,
    softLinePrice,
    isTriggered,
    consecutiveTriggerDays,
    isConfirmed,
    accelerationMode,
    avgAmplitude,
  };
}
