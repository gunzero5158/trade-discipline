import { describe, it, expect } from "vitest";
import { calculateStage } from "../stages";
import { calculateHardLine, calculateHardLineDistance } from "../hardLine";
import { calculateSoftLine, calculateAverageAmplitude } from "../softLine";
import { determineNextAction } from "../actions";
import {
  calculateOpenPosition,
  calculateAddPosition,
  stopPriceFromPercent,
  stopPercentFromPrice,
} from "../calculator";
import { executePositionClose } from "../closing";
import { calculateTradeStatistics } from "../stats";
import { evaluatePositionRules } from "../engine";
import { Lot, Position } from "../types";

describe("交易纪律规则引擎测试集", () => {
  describe("1. 仓位与开仓计算器 (对应《交易纪律.md》第二节)", () => {
    it("10万本金、20元买入、18.4元止损(-8%)算例", () => {
      // 100,000 本金，单笔 1% 风险 = 1,000 元
      // 每股亏损空间 = 20 - 18.4 = 1.6 元/股
      // 美股不按100股整除时为 625 股
      const usResult = calculateOpenPosition({
        totalCapital: 100000,
        buyPrice: 20,
        stopPrice: 18.4,
        riskPercent: 1.0,
        market: "united-states",
      });

      expect(usResult.shares).toBe(625);
      expect(usResult.perShareRisk).toBe(1.6);
      expect(usResult.targetRiskAmount).toBe(1000);
      expect(usResult.positionAmount).toBe(12500); // 约 12,500 元
      expect(usResult.positionPercent).toBe(0.125); // 12.5% < 25%
      expect(usResult.isPositionOverweight).toBe(false);
      expect(usResult.isTotalRiskExceeded).toBe(false);

      // A 股按 100 股一手向下取整为 600 股
      const aShareResult = calculateOpenPosition({
        totalCapital: 100000,
        buyPrice: 20,
        stopPrice: 18.4,
        riskPercent: 1.0,
        market: "a-share",
      });

      expect(aShareResult.shares).toBe(600);
      expect(aShareResult.positionAmount).toBe(12000);
    });

    it("双向互算辅助函数正确性", () => {
      expect(stopPriceFromPercent(20, -0.08)).toBe(18.4);
      expect(stopPercentFromPrice(20, 18.4)).toBe(-0.08);
    });

    it("风控校验一：仓位超过 25% 触发告警", () => {
      // 止损太近：20 元买入，19.8 止损 (亏 1%)
      // 1000 / 0.2 = 5000 股 = 100,000 元 (100% 仓位 > 25%)
      const res = calculateOpenPosition({
        totalCapital: 100000,
        buyPrice: 20,
        stopPrice: 19.8,
        riskPercent: 1.0,
        market: "a-share",
      });

      expect(res.isPositionOverweight).toBe(true);
      expect(res.recommendedSharesAt25Limit).toBe(1200); // 1200股 × 20 = 24000 <= 25000
      expect(res.positionOverweightMessage).toContain("超过 25% 上限");
    });

    it("风控校验二：总持仓风险超闸 (>5%)", () => {
      const res = calculateOpenPosition({
        totalCapital: 100000,
        buyPrice: 20,
        stopPrice: 18.4,
        riskPercent: 1.0,
        currentPortfolioRiskAmount: 4500, // 已占 4.5% 风险
        market: "a-share",
      });

      // 4500 + 960 = 5460 > 5000 (5%)
      expect(res.isTotalRiskExceeded).toBe(true);
      expect(res.totalRiskExceededMessage).toContain("超过 5% 闸限");
    });

    it("风控校验三：止损距离过远 (>12%) 性价比差提示", () => {
      const res = calculateOpenPosition({
        totalCapital: 100000,
        buyPrice: 20,
        stopPrice: 17.0, // -15% > 12%
        riskPercent: 1.0,
        market: "a-share",
      });

      expect(res.isRiskRewardPoor).toBe(true);
      expect(res.riskRewardMessage).toContain("超过 12%");
    });
  });

  describe("2. 浮盈分段跟踪算例 (对应《交易纪律.md》第四节)", () => {
    const initialLots: Lot[] = [
      {
        id: "lot_1",
        positionId: "pos_1",
        type: "initial",
        date: "2026-10-01",
        price: 20,
        shares: 625,
        stopPrice: 18.4,
        riskPercent: 1.0,
      },
    ];

    it("股价走到 21 元 (+5%) -> 阶段 1，硬线挪到 20.4 元 (成本上方 2%)", () => {
      const stage = calculateStage({
        lots: initialLots,
        highPriceSinceEntry: 21,
        currentClosePrice: 21,
      });

      expect(stage.effectiveStage).toBe(1);
      expect(stage.maxGainRatio).toBeCloseTo(0.05, 4);

      const hardLine = calculateHardLine({
        stage: stage.effectiveStage,
        costPrice: stage.costPrice,
        maxGainRatio: stage.maxGainRatio,
        initialStopPrice: 18.4,
      });

      expect(hardLine.hardLinePrice).toBe(20.4); // 20 * 1.02 = 20.4
    });

    it("股价走到 22 元 (+10%) -> 阶段 2，硬线挪到 21.0 元 (成本上方 5%，回撤 50%)", () => {
      const stage = calculateStage({
        lots: initialLots,
        highPriceSinceEntry: 22,
        currentClosePrice: 22,
      });

      expect(stage.effectiveStage).toBe(2);
      expect(stage.maxGainRatio).toBeCloseTo(0.10, 4);

      const hardLine = calculateHardLine({
        stage: stage.effectiveStage,
        costPrice: stage.costPrice,
        maxGainRatio: stage.maxGainRatio,
        initialStopPrice: 18.4,
        yesterdayHardLine: 20.4,
      });

      expect(hardLine.hardLinePrice).toBe(21.0); // 20 * (1 + 0.10 * 0.5) = 21.0
    });

    it("股价走到 23.2 元 (+16%) -> 阶段 2，硬线挪到 21.6 元 (成本上方 8%，回撤 50%)", () => {
      const stage = calculateStage({
        lots: initialLots,
        highPriceSinceEntry: 23.2,
        currentClosePrice: 23.2,
      });

      expect(stage.effectiveStage).toBe(2);
      expect(stage.maxGainRatio).toBeCloseTo(0.16, 4);

      const hardLine = calculateHardLine({
        stage: stage.effectiveStage,
        costPrice: stage.costPrice,
        maxGainRatio: stage.maxGainRatio,
        initialStopPrice: 18.4,
        yesterdayHardLine: 21.0,
      });

      expect(hardLine.hardLinePrice).toBe(21.6); // 20 * (1 + 0.16 * 0.5) = 21.6
    });

    it("股价走到 24 元 (+20%) -> 阶段 3，硬线挪到 22.4 元 (回撤 40%，锁定 60%) 且提示卖出 1/3", () => {
      const stage = calculateStage({
        lots: initialLots,
        highPriceSinceEntry: 24,
        currentClosePrice: 24,
      });

      expect(stage.effectiveStage).toBe(3);
      expect(stage.maxGainRatio).toBeCloseTo(0.20, 4);

      const hardLine = calculateHardLine({
        stage: stage.effectiveStage,
        costPrice: stage.costPrice,
        maxGainRatio: stage.maxGainRatio,
        initialStopPrice: 18.4,
        yesterdayHardLine: 21.6,
      });

      expect(hardLine.hardLinePrice).toBe(22.4); // 20 * (1 + 0.20 * 0.6) = 22.4

      // 检查动作提示：首次进入阶段 3 卖 1/3
      const action = determineNextAction({
        currentClosePrice: 24,
        hardLinePrice: hardLine.hardLinePrice,
        isSoftLineTriggered: false,
        isSoftLineConfirmed: false,
        stage: stage.effectiveStage,
        stage3Trimmed: false,
        consecutiveTriggerDays: 0,
        confirmDays: 1,
      });

      expect(action.action).toBe("TRIM_ONE_THIRD");
      expect(action.badgeText).toContain("卖出 1/3");
    });
  });

  describe("3. 回撤加仓算例 (对应《交易纪律.md》第六节)", () => {
    const existingLots: Lot[] = [
      {
        id: "lot_1",
        positionId: "pos_1",
        type: "initial",
        date: "2026-10-01",
        price: 20,
        shares: 625,
        stopPrice: 18.4,
        riskPercent: 1.0,
      },
    ];

    it("股价涨到 24 回落到 23，在 22 元支撑位上方加仓算例完整核算", () => {
      // 10万本金，老仓硬线已在 22 元
      // 关键位 22 元，振幅 2%，加仓止损 22 * (1 - 0.01) = 21.78 ≈ 21.8
      // 加仓风险 500 元 (0.5%)，买入量 500 / 1.2 ≈ 416 股，美股 416 或 A股 400
      const addRes = calculateAddPosition({
        existingLots,
        addPrice: 23,
        keyLevel: 22,
        totalCapital: 100000,
        currentHardLine: 22,
        avgAmplitude: 0.02,
        market: "united-states",
      });

      expect(addRes.addRiskPercent).toBe(0.5);
      expect(addRes.addStopPrice).toBe(21.78);
      expect(addRes.combinedHardLine).toBe(22.0); // max(22, 21.78) = 22
      expect(addRes.isTotalLedgerSafe).toBe(true);

      // A 股 400 股算例检验
      const aShareAdd = calculateAddPosition({
        existingLots,
        addPrice: 23,
        keyLevel: 22,
        totalCapital: 100000,
        currentHardLine: 22,
        avgAmplitude: 0.02,
        market: "a-share",
      });

      expect(aShareAdd.finalShares).toBe(400);
      // 老仓在 22 处收益：625 * (22 - 20) = 1250
      // 加仓在 22 处亏损：400 * (22 - 23) = -400
      // 合计总账 = +850 元 > 0
      expect(aShareAdd.oldLotsPnLAtCombinedStop).toBe(1250);
      expect(aShareAdd.addLotLossAtCombinedStop).toBe(-400);
      expect(aShareAdd.totalLedgerAtCombinedStop).toBe(850);
      expect(aShareAdd.totalSharesAfterAdd).toBe(1025);
      expect(aShareAdd.totalPositionAmountAfterAdd).toBe(21700); // 12500 + 9200
      expect(aShareAdd.isExceeding25PercentLimit).toBe(false);
    });

    it("加仓次数限制：最多 2 次，第 3 次拒绝", () => {
      const threeLots: Lot[] = [
        { id: "1", positionId: "p", type: "initial", date: "2026-10-01", price: 20, shares: 600, stopPrice: 18.4, riskPercent: 1.0 },
        { id: "2", positionId: "p", type: "add", date: "2026-10-10", price: 23, shares: 300, stopPrice: 22, riskPercent: 0.5 },
        { id: "3", positionId: "p", type: "add", date: "2026-10-15", price: 25, shares: 100, stopPrice: 24, riskPercent: 0.25 },
      ];

      const res = calculateAddPosition({
        existingLots: threeLots,
        addPrice: 27,
        keyLevel: 26,
        totalCapital: 100000,
        currentHardLine: 25,
      });

      expect(res.isRejected).toBe(true);
      expect(res.rejectReason).toContain("最多加仓 2 次");
    });
  });

  describe("4. 方案补充 4 处必修 Bug 验证 (对应《方案补充与讨论疑问.md》)", () => {
    it("Bug 1 验证：加仓抬高成本后，阶段绝不倒退 (maxStage 保护)", () => {
      // 首仓 20 元买 600 股，涨到 22.5 元 (最高浮盈 +12.5%，阶段 2)
      // 随后回调至 22 元加仓 400 股，加权平均成本 = (600*20 + 400*22) / 1000 = 20.8 元
      // 此时 22.5 / 20.8 - 1 = +8.17% (按原公式掉回阶段 1)
      const lots: Lot[] = [
        { id: "1", positionId: "p", type: "initial", date: "2026-10-01", price: 20, shares: 600, stopPrice: 18.4, riskPercent: 1.0 },
        { id: "2", positionId: "p", type: "add", date: "2026-10-10", price: 22, shares: 400, stopPrice: 21, riskPercent: 0.5 },
      ];

      const stage = calculateStage({
        lots,
        highPriceSinceEntry: 22.5,
        currentClosePrice: 22.0,
        previousMaxStage: 2, // 历史已达最高阶段为 2
      });

      expect(stage.costPrice).toBe(20.8);
      expect(stage.calculatedStage).toBe(1); // 纯按当前浮盈 8.17% 是阶段 1
      expect(stage.effectiveStage).toBe(2);  // 经过 maxStage 保护后强制维持阶段 2，绝不倒退！
    });

    it("Bug 2 验证：阶段 3 卖出 1/3 状态标记 (stage3Trimmed)", () => {
      // 未减仓时提示 TRIM_ONE_THIRD
      const promptAction = determineNextAction({
        currentClosePrice: 25,
        hardLinePrice: 23,
        isSoftLineTriggered: false,
        isSoftLineConfirmed: false,
        stage: 3,
        stage3Trimmed: false,
        consecutiveTriggerDays: 0,
        confirmDays: 1,
      });
      expect(promptAction.action).toBe("TRIM_ONE_THIRD");

      // 减仓后标记为 true，不再重复提示减仓，转为正常持有
      const trimmedAction = determineNextAction({
        currentClosePrice: 25,
        hardLinePrice: 23,
        isSoftLineTriggered: false,
        isSoftLineConfirmed: false,
        stage: 3,
        stage3Trimmed: true,
        consecutiveTriggerDays: 0,
        confirmDays: 1,
      });
      expect(trimmedAction.action).toBe("HOLD");
    });

    it("Bug 3 验证：分批平仓后总 R 倍数始终锚定首仓初始 1R 风险金额", () => {
      const lots: Lot[] = [
        { id: "1", positionId: "p", type: "initial", date: "2026-10-01", price: 20, shares: 600, stopPrice: 18.4, riskPercent: 1.0 },
      ];
      // 初始 1R = 600 * (20 - 18.4) = 960 元

      // 第一次减仓 1/3 (200 股) 在 24 元落袋 (+20%)
      const trimRes = executePositionClose({
        positionId: "p",
        symbol: "600519",
        name: "测试股票",
        lots,
        exitDate: "2026-10-15",
        exitPrice: 24,
        sharesToClose: 200,
        triggerReason: "stage3-trim",
        highPriceSinceEntry: 24,
      });

      // 盈亏 = 200 * (24 - 20) = 800 元，R = 800 / 960 ≈ 0.83R
      expect(trimRes.tradeRecord.pnlAmount).toBe(800);
      expect(trimRes.tradeRecord.rMultiple).toBe(0.83);
      expect(trimRes.remainingShares).toBe(400);

      // 第二次最终平仓 (400 股) 在 22.4 元硬线出场
      const finalRes = executePositionClose({
        positionId: "p",
        symbol: "600519",
        name: "测试股票",
        lots,
        previousTrades: [trimRes.tradeRecord],
        exitDate: "2026-10-20",
        exitPrice: 22.4,
        sharesToClose: 400,
        triggerReason: "hard-line",
        highPriceSinceEntry: 24,
      });

      // 第二次盈亏 = 400 * (22.4 - 20) = 960 元
      // 总盈亏 = 800 + 960 = 1760 元
      // 总合成 R 倍数 = 1760 / 960 = 1.83R
      expect(finalRes.tradeRecord.pnlAmount).toBe(960);
      expect(finalRes.totalRealizedPnL).toBe(1760);
      expect(finalRes.totalCompositeR).toBe(1.83);
      expect(finalRes.isFullClose).toBe(true);
    });

    it("Bug 4 验证：明日硬线五者取大只升不降铁律", () => {
      const res = calculateHardLine({
        stage: 0,
        costPrice: 20,
        maxGainRatio: 0.02,
        initialStopPrice: 18.4,
        yesterdayHardLine: 21.0, // 假设昨日硬线已在 21 元
        manualStopPrice: 21.5,   // 人工手动上调到 21.5 元
      });

      expect(res.hardLinePrice).toBe(21.5); // 五者取最大
    });
  });

  describe("5. 软线破位与连续确认机制", () => {
    it("单日破线但未确认时为 HOLD_PENDING_CONFIRM，连续 2 天跌破时确认卖出", () => {
      // 设定 confirmDays = 2
      const day1Pending = determineNextAction({
        currentClosePrice: 19.5,
        hardLinePrice: 18.4,
        isSoftLineTriggered: true,
        isSoftLineConfirmed: false,
        stage: 1,
        stage3Trimmed: false,
        consecutiveTriggerDays: 1,
        confirmDays: 2,
      });

      expect(day1Pending.action).toBe("HOLD_PENDING_CONFIRM");
      expect(day1Pending.badgeVariant).toBe("warning");

      const day2Confirmed = determineNextAction({
        currentClosePrice: 19.2,
        hardLinePrice: 18.4,
        isSoftLineTriggered: true,
        isSoftLineConfirmed: true,
        stage: 1,
        stage3Trimmed: false,
        consecutiveTriggerDays: 2,
        confirmDays: 2,
      });

      expect(day2Confirmed.action).toBe("SELL_ALL_SOFT_LINE");
      expect(day2Confirmed.badgeVariant).toBe("danger");
    });

    it("默认 20 日均线在阶段 2 自动切 10 日线，但用户自定义周期 (如 60 日线) 在阶段 2 保持 60 日不变", () => {
      const candles = Array.from({ length: 70 }, (_, i) => {
        const p = 20 + i * 0.1;
        return {
          date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
          open: p,
          high: p + 0.2,
          low: p - 0.2,
          close: p,
          volume: 10000,
        };
      });

      const defaultMaRes = calculateSoftLine({
        candles,
        maType: "EMA",
        maPeriod: 20,
        confirmDays: 1,
        stage: 2,
      });
      expect(defaultMaRes.effectiveMaPeriod).toBe(10);

      const customMaRes = calculateSoftLine({
        candles,
        maType: "EMA",
        maPeriod: 60,
        confirmDays: 1,
        stage: 2,
      });
      expect(customMaRes.effectiveMaPeriod).toBe(60);
    });
  });

  describe("6. 规则引擎端到端集成 (evaluatePositionRules)", () => {
    it("输入真实日线序列输出完整快照数据", () => {
      const pos: Position = {
        id: "pos_test",
        accountId: "acc_1",
        symbol: "600519",
        name: "贵州茅台",
        market: "a-share",
        status: "open",
        initialStopPrice: 18.4,
        maType: "EMA",
        maPeriod: 20,
        confirmDays: 1,
        maxStage: 0,
        stage3Trimmed: false,
        lots: [
          {
            id: "lot_1",
            positionId: "pos_test",
            type: "initial",
            date: "2026-10-01",
            price: 20,
            shares: 600,
            stopPrice: 18.4,
            riskPercent: 1.0,
          },
        ],
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
      };

      // 模拟 25 天 K 线，从 20 涨到 22.5
      const candles = Array.from({ length: 25 }, (_, i) => {
        const p = 20 + i * 0.1;
        return {
          date: `2026-10-${String(i + 1).padStart(2, "0")}`,
          open: p - 0.05,
          high: p + 0.15,
          low: p - 0.1,
          close: p,
          volume: 100000,
        };
      });

      const snapshot = evaluatePositionRules({
        position: pos,
        candles,
      });

      expect(snapshot.closePrice).toBe(22.4);
      expect(snapshot.costPrice).toBe(20);
      expect(snapshot.stage).toBe(2); // 浮盈 12% 属于阶段 2
      expect(snapshot.hardLinePrice).toBeGreaterThan(20);
      expect(snapshot.nextAction).toBe("HOLD");
    });
  });

  describe("7. 月度复盘与三大检查点诊断 (stats.ts)", () => {
    it("正确识别三大纪律偏差并给出诊断提醒", () => {
      // 场景 A：输单平均超过 1R 触发警告
      const badStopTrades = [
        { id: "1", positionId: "p", symbol: "A", name: "A", exitDate: "2026-10-01", exitPrice: 17, shares: 100, triggerReason: "hard-line" as const, pnlAmount: -1200, pnlRatio: -0.15, rMultiple: -1.25, maxGainRatio: 0.02, givebackRatio: 0.17, createdAt: "" },
        { id: "2", positionId: "p", symbol: "B", name: "B", exitDate: "2026-10-02", exitPrice: 17, shares: 100, triggerReason: "hard-line" as const, pnlAmount: -1100, pnlRatio: -0.14, rMultiple: -1.15, maxGainRatio: 0.01, givebackRatio: 0.15, createdAt: "" },
        { id: "3", positionId: "p", symbol: "C", name: "C", exitDate: "2026-10-03", exitPrice: 17, shares: 100, triggerReason: "hard-line" as const, pnlAmount: -1300, pnlRatio: -0.16, rMultiple: -1.30, maxGainRatio: 0.03, givebackRatio: 0.19, createdAt: "" },
        { id: "4", positionId: "p", symbol: "D", name: "D", exitDate: "2026-10-04", exitPrice: 22, shares: 100, triggerReason: "soft-line" as const, pnlAmount: 1500, pnlRatio: 0.15, rMultiple: 1.5, maxGainRatio: 0.20, givebackRatio: 0.05, createdAt: "" },
      ];

      const statsA = calculateTradeStatistics(badStopTrades, 100000);
      expect(statsA.avgLossR).toBeGreaterThan(1.05);
      const stopDiag = statsA.diagnostics.find((d) => d.title.includes("止损执行不严"));
      expect(stopDiag).toBeDefined();

      // 场景 B：纪律优良标本 (胜率 55%, 赢单 2.5R, 输单 1.0R)
      const goodTrades = [
        { id: "1", positionId: "p", symbol: "W1", name: "W1", exitDate: "2026-10-01", exitPrice: 25, shares: 100, triggerReason: "soft-line" as const, pnlAmount: 2500, pnlRatio: 0.25, rMultiple: 2.5, maxGainRatio: 0.28, givebackRatio: 0.03, createdAt: "" },
        { id: "2", positionId: "p", symbol: "W2", name: "W2", exitDate: "2026-10-02", exitPrice: 25, shares: 100, triggerReason: "soft-line" as const, pnlAmount: 2700, pnlRatio: 0.27, rMultiple: 2.7, maxGainRatio: 0.30, givebackRatio: 0.03, createdAt: "" },
        { id: "3", positionId: "p", symbol: "L1", name: "L1", exitDate: "2026-10-03", exitPrice: 18.4, shares: 100, triggerReason: "hard-line" as const, pnlAmount: -1000, pnlRatio: -0.08, rMultiple: -1.0, maxGainRatio: 0.01, givebackRatio: 0.09, createdAt: "" },
      ];
      const statsB = calculateTradeStatistics(goodTrades, 100000);
      expect(statsB.avgWinR).toBe(2.6);
      expect(statsB.avgLossR).toBe(1.0);
      expect(statsB.expectancyR).toBeGreaterThan(0.5);
    });
  });
});
