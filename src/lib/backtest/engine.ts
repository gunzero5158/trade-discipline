import { Candle } from "../market/indicators";
import { calculateEMA, calculateSMA } from "../rules/softLine";

export interface BacktestOptions {
  swingThreshold?: number;   // 波段涨幅阈值，默认 0.10 (10%)
  windowBars?: number;       // 观察窗口天数，默认 40 天
  maPeriods?: number[];      // 待测均线周期列表
  maType?: "EMA" | "MA";
}

export interface SupportRuleStat {
  period: number;
  maName: string;
  touches: number;           // 触碰测试次数
  bounces: number;           // 守住并反弹达标次数
  falseBreakdowns: number;   // 假跌破 (2天内收回并达标)
  trueBreakdowns: number;    // 真跌破 (连续2天破位下行)
  winRate: number;           // 守住胜率 ((bounces + falseBreakdowns) / touches)
  benchmarkWinRate: number;  // 同期随机买入基准胜率
  avgGain: number;           // 平均最大涨幅
  maxDrawdown: number;       // 达标前平均最大回撤
}

export interface CurrentPointStatus {
  currentPrice: number;
  nearestSupport: {
    name: string;
    price: number;
    distancePercent: number;
    winRate: number;
  } | null;
  nearestResistance: {
    name: string;
    price: number;
    distancePercent: number;
  } | null;
  triggeredRules: string[];
}

export interface BacktestResult {
  symbol: string;
  totalBars: number;
  startDate: string;
  endDate: string;
  swingCount: number;        // 识别出的历史有效上涨波段数
  supportRules: SupportRuleStat[];
  currentStatus: CurrentPointStatus;
}

/**
 * 严格按照《点位回测工具方案.md》实现历史走势规律挖掘与胜率统计
 */
export function runPointBacktest(
  symbol: string,
  candles: Candle[],
  options: BacktestOptions = {}
): BacktestResult {
  const {
    swingThreshold = 0.10,
    windowBars = 40,
    maPeriods = [5, 10, 20, 60, 120],
    maType = "EMA",
  } = options;

  if (candles.length < 60) {
    throw new Error("回测至少需要 60 根日 K 线数据");
  }

  const closes = candles.map((c) => c.close);
  const n = candles.length;
  const startDate = String(candles[0].date).substring(0, 10);
  const endDate = String(candles[n - 1].date).substring(0, 10);

  // 1. 基准胜率测算：随机买入在 windowBars 内涨幅达到 swingThreshold 的概率
  let randomSuccess = 0;
  let randomTotal = 0;
  for (let i = 0; i < n - windowBars; i++) {
    const buyP = closes[i];
    let maxP = buyP;
    for (let w = 1; w <= windowBars; w++) {
      if (candles[i + w].high > maxP) {
        maxP = candles[i + w].high;
      }
    }
    if ((maxP - buyP) / buyP >= swingThreshold) {
      randomSuccess++;
    }
    randomTotal++;
  }
  const benchmarkWinRate = randomTotal > 0 ? Number((randomSuccess / randomTotal).toFixed(4)) : 0.5;

  // 1b. 历史有效上涨波段数：从阶段低点起累计涨幅 ≥ 阈值算一次，之后以新低点重新起算
  let swingCount = 0;
  let swingLow = closes[0];
  let armed = true;
  for (let i = 1; i < n; i++) {
    const c = closes[i];
    if (c < swingLow) {
      swingLow = c;
      armed = true;
    } else if (armed && (c - swingLow) / swingLow >= swingThreshold) {
      swingCount++;
      armed = false; // 这一波已计数，等回落创出新低后再找下一波
      swingLow = c;
    } else if (!armed && c > swingLow) {
      swingLow = c; // 继续上涨时把"低点"抬上去，回落到它以下才算新一轮
    }
  }

  // 2. 均线计算与触碰反应统计
  const supportRules: SupportRuleStat[] = [];
  const maMap = new Map<number, number[]>();

  for (const period of maPeriods) {
    if (period >= n) continue;
    const series = maType === "EMA" ? calculateEMA(closes, period) : calculateSMA(closes, period);
    maMap.set(period, series);

    let touches = 0;
    let bounces = 0;
    let falseBreakdowns = 0;
    let trueBreakdowns = 0;
    let sumGain = 0;
    let sumDrawdown = 0;

    // 扫描历史触碰事件 (为了避免同一波回调重复记数，每次触碰后冷却 3 根 K 线)
    let lastTouchBar = -10;
    for (let i = period; i < n - windowBars; i++) {
      if (i - lastTouchBar < 3) continue;

      const ma = series[i];
      if (isNaN(ma)) continue;

      // 触碰判定：日内最低价探至均线附近 (MA ± 1.5%)
      const touchMargin = ma * 0.015;
      const isTouching = candles[i].low <= ma + touchMargin && candles[i].high >= ma - touchMargin;

      if (isTouching) {
        touches++;
        lastTouchBar = i;

        // 观察未来 windowBars 内的演化
        const entryPrice = closes[i];
        let maxFuturePrice = entryPrice;
        let minFuturePrice = entryPrice;
        let achievedTarget = false;
        let breakdownDays = 0;
        let isTrueBreak = false;

        for (let w = 1; w <= windowBars; w++) {
          const bar = candles[i + w];
          const barMa = series[i + w];

          if (bar.high > maxFuturePrice) maxFuturePrice = bar.high;
          if (bar.low < minFuturePrice) minFuturePrice = bar.low;

          // 达标
          if ((maxFuturePrice - entryPrice) / entryPrice >= swingThreshold) {
            achievedTarget = true;
            break;
          }

          // 破位判断：连续 2 天收在均线下方 1%
          if (!isNaN(barMa) && bar.close < barMa * 0.99) {
            breakdownDays++;
            if (breakdownDays >= 2) {
              isTrueBreak = true;
            }
          } else {
            breakdownDays = 0;
          }
        }

        const maxGain = (maxFuturePrice - entryPrice) / entryPrice;
        const maxDd = (entryPrice - minFuturePrice) / entryPrice;
        sumGain += maxGain;
        sumDrawdown += maxDd;

        if (achievedTarget) {
          if (isTrueBreak) {
            falseBreakdowns++; // 虽然跌破过但收回达标
          } else {
            bounces++; // 稳稳守住
          }
        } else {
          trueBreakdowns++;
        }
      }
    }

    if (touches > 0) {
      const winRate = Number(((bounces + falseBreakdowns) / touches).toFixed(4));
      supportRules.push({
        period,
        maName: `${maType}${period}`,
        touches,
        bounces,
        falseBreakdowns,
        trueBreakdowns,
        winRate,
        benchmarkWinRate,
        avgGain: Number((sumGain / touches).toFixed(4)),
        maxDrawdown: Number((sumDrawdown / touches).toFixed(4)),
      });
    }
  }

  // 3. 对照当前最新 K 线评估点位
  const latestCandle = candles[n - 1];
  const currentPrice = latestCandle.close;

  let nearestSupport: CurrentPointStatus["nearestSupport"] = null;
  let nearestResistance: CurrentPointStatus["nearestResistance"] = null;
  const triggeredRules: string[] = [];

  // 按胜率降序排序支持线
  supportRules.sort((a, b) => b.winRate - a.winRate);

  for (const rule of supportRules) {
    const series = maMap.get(rule.period);
    if (!series) continue;
    const currentMa = series[n - 1];
    if (isNaN(currentMa)) continue;

    const diffPercent = (currentPrice - currentMa) / currentPrice;

    // 当前在均线上方：作为支撑
    if (currentPrice >= currentMa) {
      if (!nearestSupport || Math.abs(diffPercent) < Math.abs(nearestSupport.distancePercent)) {
        nearestSupport = {
          name: rule.maName,
          price: Number(currentMa.toFixed(2)),
          distancePercent: Number(diffPercent.toFixed(4)),
          winRate: rule.winRate,
        };
      }
    } else {
      // 当前在均线下方：作为阻力
      if (!nearestResistance || Math.abs(diffPercent) < Math.abs(nearestResistance.distancePercent)) {
        nearestResistance = {
          name: rule.maName,
          price: Number(currentMa.toFixed(2)),
          distancePercent: Number(Math.abs(diffPercent).toFixed(4)),
        };
      }
    }

    // 检查是否刚好处于触碰区 (±1.5%)
    if (Math.abs(diffPercent) <= 0.015) {
      triggeredRules.push(
        `当前价格接近 ${rule.maName} (历史反弹胜率 ${(rule.winRate * 100).toFixed(1)}%)`
      );
    }
  }

  return {
    symbol,
    totalBars: n,
    startDate,
    endDate,
    swingCount,
    supportRules,
    currentStatus: {
      currentPrice,
      nearestSupport,
      nearestResistance,
      triggeredRules,
    },
  };
}
