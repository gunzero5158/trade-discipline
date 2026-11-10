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
});
