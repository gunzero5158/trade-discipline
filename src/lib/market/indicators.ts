export interface Candle {
  date: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculates the Exponential Moving Average (EMA) of a series.
 */
export function calculateEMA(candles: Candle[], period: number): number[] {
  const ema: number[] = [];
  if (candles.length === 0) return ema;

  const k = 2 / (period + 1);
  // Start with SMA as the initial EMA value
  let sum = 0;
  for (let i = 0; i < Math.min(period, candles.length); i++) {
    sum += candles[i].close;
  }
  let currentEma = sum / Math.min(period, candles.length);

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      ema.push(NaN); // Not enough data
    } else if (i === period - 1) {
      ema.push(Number(currentEma.toFixed(4)));
    } else {
      currentEma = candles[i].close * k + currentEma * (1 - k);
      ema.push(Number(currentEma.toFixed(4)));
    }
  }
  return ema;
}

/**
 * Calculates Bollinger Bands (BOLL).
 */
export function calculateBOLL(
  candles: Candle[],
  period: number = 20,
  multiplier: number = 2
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      middle.push(NaN);
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    // Calculate SMA for middle band
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const sma = sum / period;
    middle.push(Number(sma.toFixed(4)));

    // Calculate Standard Deviation
    let varianceSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      varianceSum += Math.pow(candles[j].close - sma, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);

    upper.push(Number((sma + multiplier * stdDev).toFixed(4)));
    lower.push(Number((sma - multiplier * stdDev).toFixed(4)));
  }

  return { middle, upper, lower };
}

/**
 * Calculates Moving Average Convergence Divergence (MACD).
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { dif: number[]; dea: number[]; hist: number[] } {
  const dif: number[] = [];
  const dea: number[] = [];
  const hist: number[] = [];

  if (candles.length === 0) return { dif, dea, hist };

  // Calculate EMA 12 and EMA 26
  const emaFast = calculateEMA(candles, fastPeriod);
  const emaSlow = calculateEMA(candles, slowPeriod);

  // DIF = EMA(12) - EMA(26)
  for (let i = 0; i < candles.length; i++) {
    if (isNaN(emaFast[i]) || isNaN(emaSlow[i])) {
      dif.push(NaN);
    } else {
      dif.push(Number((emaFast[i] - emaSlow[i]).toFixed(4)));
    }
  }

  // DEA = EMA(DIF, 9)
  // To calculate EMA of DIF, we must handle NaNs at the start of DIF
  const firstValidDifIndex = dif.findIndex(v => !isNaN(v));
  if (firstValidDifIndex === -1) {
    return { dif, dea: dif.map(() => NaN), hist: dif.map(() => NaN) };
  }

  const k = 2 / (signalPeriod + 1);
  let currentDea = 0;
  
  // Initialize DEA with SMA of the first signalPeriod DIF values
  let sum = 0;
  let count = 0;
  for (let i = firstValidDifIndex; i < Math.min(firstValidDifIndex + signalPeriod, dif.length); i++) {
    sum += dif[i];
    count++;
  }
  currentDea = sum / count;

  for (let i = 0; i < candles.length; i++) {
    if (i < firstValidDifIndex + signalPeriod - 1) {
      dea.push(NaN);
      hist.push(NaN);
    } else if (i === firstValidDifIndex + signalPeriod - 1) {
      dea.push(Number(currentDea.toFixed(4)));
      hist.push(Number(((dif[i] - currentDea) * 2).toFixed(4)));
    } else {
      currentDea = dif[i] * k + currentDea * (1 - k);
      dea.push(Number(currentDea.toFixed(4)));
      hist.push(Number(((dif[i] - currentDea) * 2).toFixed(4)));
    }
  }

  return { dif, dea, hist };
}

/**
 * Calculates KDJ indicator.
 */
export function calculateKDJ(
  candles: Candle[],
  n: number = 9,
  m1: number = 3,
  m2: number = 3
): { k: number[]; d: number[]; j: number[] } {
  const kArr: number[] = [];
  const dArr: number[] = [];
  const jArr: number[] = [];

  let lastK = 50;
  let lastD = 50;

  for (let i = 0; i < candles.length; i++) {
    if (i < n - 1) {
      kArr.push(NaN);
      dArr.push(NaN);
      jArr.push(NaN);
      continue;
    }

    // Find High(n) and Low(n)
    let hn = -Infinity;
    let ln = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (candles[j].high > hn) hn = candles[j].high;
      if (candles[j].low < ln) ln = candles[j].low;
    }

    const cn = candles[i].close;
    let rsv = 0;
    if (hn !== ln) {
      rsv = ((cn - ln) / (hn - ln)) * 100;
    } else {
      rsv = 50;
    }

    const k = (1 / m1) * rsv + ((m1 - 1) / m1) * lastK;
    const d = (1 / m2) * k + ((m2 - 1) / m2) * lastD;
    const j = 3 * k - 2 * d;

    kArr.push(Number(k.toFixed(4)));
    dArr.push(Number(d.toFixed(4)));
    jArr.push(Number(j.toFixed(4)));

    lastK = k;
    lastD = d;
  }

  return { k: kArr, d: dArr, j: jArr };
}

/**
 * Calculates Relative Strength Index (RSI).
 */
export function calculateRSI(candles: Candle[], period: number = 14): number[] {
  const rsi: number[] = [];
  if (candles.length < 2) return candles.map(() => NaN);

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;

  // Initialize averages
  for (let i = 0; i < Math.min(period, gains.length); i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      rsi.push(NaN);
    } else if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(Number((100 - 100 / (1 + rs)).toFixed(4)));
    } else {
      const idx = i - 1;
      avgGain = (avgGain * (period - 1) + gains[idx]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[idx]) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(Number((100 - 100 / (1 + rs)).toFixed(4)));
    }
  }

  return rsi;
}

/**
 * Calculates Average True Range (ATR).
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  const atr: number[] = [];
  if (candles.length === 0) return atr;

  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
  }

  let currentAtr = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) {
    currentAtr += tr[i];
  }
  currentAtr /= period;

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      atr.push(NaN);
    } else if (i === period - 1) {
      atr.push(Number(currentAtr.toFixed(4)));
    } else {
      currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
      atr.push(Number(currentAtr.toFixed(4)));
    }
  }

  return atr;
}

export interface IchimokuResult {
  tenkanSen: number[];
  kijunSen: number[];
  senkouSpanA: number[];
  senkouSpanB: number[];
  chikouSpan: number[];
  cloudSignal: "bullish" | "bearish" | "neutral";
  cloudDescription: string;
}

function midpointOfRange(candles: Candle[], endIndex: number, period: number): number {
  if (endIndex < period - 1) return NaN;

  let high = -Infinity;
  let low = Infinity;
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    high = Math.max(high, candles[i].high);
    low = Math.min(low, candles[i].low);
  }

  return Number(((high + low) / 2).toFixed(4));
}

/**
 * Calculates Ichimoku Cloud lines without forward-shifting spans.
 * Keeping arrays aligned to candle indexes makes scoring/reporting cheap and deterministic.
 */
export function calculateIchimoku(candles: Candle[]): IchimokuResult {
  const tenkanSen: number[] = [];
  const kijunSen: number[] = [];
  const senkouSpanA: number[] = [];
  const senkouSpanB: number[] = [];
  const chikouSpan: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const tenkan = midpointOfRange(candles, i, 9);
    const kijun = midpointOfRange(candles, i, 26);
    const spanB = midpointOfRange(candles, i, 52);

    tenkanSen.push(tenkan);
    kijunSen.push(kijun);
    senkouSpanA.push(Number.isFinite(tenkan) && Number.isFinite(kijun) ? Number(((tenkan + kijun) / 2).toFixed(4)) : NaN);
    senkouSpanB.push(spanB);
    chikouSpan.push(i >= 26 ? candles[i - 26].close : NaN);
  }

  const latestIdx = candles.length - 1;
  const price = candles[latestIdx]?.close ?? NaN;
  const tenkan = tenkanSen[latestIdx];
  const kijun = kijunSen[latestIdx];
  const spanA = senkouSpanA[latestIdx];
  const spanB = senkouSpanB[latestIdx];
  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);

  let cloudSignal: IchimokuResult["cloudSignal"] = "neutral";
  let cloudDescription = "Ichimoku data is insufficient for a clear cloud signal.";

  if ([price, tenkan, kijun, spanA, spanB].every(Number.isFinite)) {
    if (price > cloudTop && tenkan >= kijun && spanA >= spanB) {
      cloudSignal = "bullish";
      cloudDescription = `Price is above the cloud, Tenkan is above Kijun, and the cloud bias is bullish. Cloud support zone: ${cloudBottom.toFixed(2)}-${cloudTop.toFixed(2)}.`;
    } else if (price < cloudBottom && tenkan <= kijun && spanA <= spanB) {
      cloudSignal = "bearish";
      cloudDescription = `Price is below the cloud, Tenkan is below Kijun, and the cloud bias is bearish. Cloud resistance zone: ${cloudBottom.toFixed(2)}-${cloudTop.toFixed(2)}.`;
    } else {
      cloudDescription = `Price is interacting with the Ichimoku cloud or the signals are mixed. Cloud zone: ${cloudBottom.toFixed(2)}-${cloudTop.toFixed(2)}.`;
    }
  }

  return {
    tenkanSen,
    kijunSen,
    senkouSpanA,
    senkouSpanB,
    chikouSpan,
    cloudSignal,
    cloudDescription,
  };
}
