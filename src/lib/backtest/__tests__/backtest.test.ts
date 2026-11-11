import { describe, it, expect } from "vitest";
import { runPointBacktest } from "../engine";

describe("点位回测工具逻辑测试", () => {
  it("对具有明显波段特征的模拟序列正确回测出支撑线与胜率", () => {
    // 构造 150 根日线数据
    const candles = Array.from({ length: 150 }, (_, i) => {
      // 周期性正弦波向上爬升
      const trend = i * 0.2;
      const wave = Math.sin(i / 10) * 5;
      const base = 50 + trend + wave;
      return {
        date: `2025-01-${String(i + 1).padStart(3, "0")}`,
        open: base - 0.5,
        high: base + 1.5,
        low: base - 1.0,
        close: base + 0.2,
        volume: 200000,
      };
    });

    const report = runPointBacktest("600519", candles, {
      swingThreshold: 0.08,
      windowBars: 30,
      maPeriods: [10, 20],
      maType: "EMA",
    });

    expect(report.symbol).toBe("600519");
    expect(report.totalBars).toBe(150);
    expect(report.supportRules.length).toBeGreaterThan(0);
    expect(report.currentStatus.currentPrice).toBeGreaterThan(0);
  });

  it("有效上涨波段数按真实走势统计：两段从低点涨超阈值的行情算 2 次", () => {
    // 100 → 跌到 90 → 涨到 100 (+11%) → 跌到 95 → 涨到 106 (+11.6%)，其余横盘
    const path = [
      ...Array(60).fill(100),
      96, 93, 90, 93, 96, 99, 100, 100, 100, 98, 96, 95, 98, 101, 104, 106,
      ...Array(20).fill(106),
    ];
    const candles = path.map((c, i) => ({
      date: `2025-02-${String(i + 1).padStart(3, "0")}`,
      open: c, high: c, low: c, close: c, volume: 1000,
    }));
    const report = runPointBacktest("000001", candles, { swingThreshold: 0.10, windowBars: 10, maPeriods: [5] });
    expect(report.swingCount).toBe(2);
  });
});
