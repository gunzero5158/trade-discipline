import { describe, it, expect, beforeEach } from "vitest";
import { ensureDbReady, schema } from "@/lib/db";
import { getOrCreateAccount, generateAccessCode } from "@/lib/auth/accessCode";
import { executePositionClose } from "@/lib/rules/closing";
import { calculateTradeStatistics } from "@/lib/rules/stats";
import { calculateOpenPosition, calculateAddPosition } from "@/lib/rules/calculator";
import { evaluatePositionRules } from "@/lib/rules/engine";
import { Lot, Position } from "@/lib/rules/types";
import { eq } from "drizzle-orm";

describe("系统数据库与端到端核心业务集成测试", () => {
  let testCode: string;
  let accountId: string;

  beforeEach(async () => {
    testCode = generateAccessCode();
    const account = await getOrCreateAccount(testCode);
    accountId = account.id;
  });

  it("访问码生成与账户自动持久化", async () => {
    const db = await ensureDbReady();
    const acc = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    expect(acc.length).toBe(1);
    expect(acc[0].totalCapital).toBe(100000);
  });

  it("完整业务链路：开仓 -> 加仓 -> 卖1/3落袋 -> 全部平仓 -> 月度复盘", async () => {
    const db = await ensureDbReady();
    const posId = `pos_test_${Date.now()}`;
    const lotId1 = `lot_1_${Date.now()}`;

    // 1. 开仓：20 元买 600 股，止损 18.4 (-8%)
    const openCalc = calculateOpenPosition({
      totalCapital: 100000,
      buyPrice: 20,
      stopPrice: 18.4,
      riskPercent: 1.0,
      market: "a-share",
    });

    expect(openCalc.shares).toBe(600);
    expect(openCalc.isPositionOverweight).toBe(false);

    await db.insert(schema.positions).values({
      id: posId,
      accountId,
      symbol: "600519",
      name: "贵州茅台",
      market: "a-share",
      status: "open",
      initialStopPrice: 18.4,
      maType: "EMA",
      maPeriod: 20,
      confirmDays: 1,
      maxStage: 0,
      stage3Trimmed: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await db.insert(schema.lots).values({
      id: lotId1,
      positionId: posId,
      type: "initial",
      date: "2026-10-01",
      price: 20,
      shares: 600,
      stopPrice: 18.4,
      riskPercent: 1.0,
      createdAt: Date.now(),
    });

    // 2. 模拟股价上涨至 23 元，进行第一次回撤加仓
    const addCalc = calculateAddPosition({
      existingLots: [
        { id: lotId1, positionId: posId, type: "initial", date: "2026-10-01", price: 20, shares: 600, stopPrice: 18.4, riskPercent: 1.0 },
      ],
      addPrice: 23,
      keyLevel: 22,
      totalCapital: 100000,
      currentHardLine: 21.0,
      avgAmplitude: 0.02,
      market: "a-share",
    });

    expect(addCalc.finalShares).toBe(400);
    expect(addCalc.combinedHardLine).toBeGreaterThanOrEqual(21.0);

    const lotId2 = `lot_2_${Date.now()}`;
    await db.insert(schema.lots).values({
      id: lotId2,
      positionId: posId,
      type: "add",
      date: "2026-10-10",
      price: 23,
      shares: 400,
      stopPrice: addCalc.addStopPrice,
      riskPercent: 0.5,
      createdAt: Date.now(),
    });

    // 检查加权成本：(600*20 + 400*23) / 1000 = 21.2 元
    const allLots = await db.select().from(schema.lots).where(eq(schema.lots.positionId, posId));
    expect(allLots.length).toBe(2);
    const totalCost = allLots.reduce((acc, l) => acc + l.price * l.shares, 0);
    const totalShares = allLots.reduce((acc, l) => acc + l.shares, 0);
    expect(totalCost / totalShares).toBe(21.2);

    // 3. 股价突破 26 元 (+22.6%) 达到阶段 3，执行卖出 1/3 落袋 (300 股) 在 26 元
    const trimRes = executePositionClose({
      positionId: posId,
      symbol: "600519",
      name: "贵州茅台",
      lots: allLots.map((l) => ({ ...l, type: l.type as any })),
      exitDate: "2026-10-15",
      exitPrice: 26,
      sharesToClose: 300,
      triggerReason: "stage3-trim",
      highPriceSinceEntry: 26,
    });

    // 首仓 1R = 600 * (20 - 18.4) = 960 元
    // 卖 300 股在 26 元：300 * (26 - 21.2) = 1440 元
    // R = 1440 / 960 = 1.5R
    expect(trimRes.tradeRecord.pnlAmount).toBe(1440);
    expect(trimRes.tradeRecord.rMultiple).toBe(1.5);
    expect(trimRes.remainingShares).toBe(700);

    await db.insert(schema.trades).values({
      id: trimRes.tradeRecord.id,
      positionId: posId,
      exitDate: trimRes.tradeRecord.exitDate,
      exitPrice: trimRes.tradeRecord.exitPrice,
      shares: trimRes.tradeRecord.shares,
      triggerReason: trimRes.tradeRecord.triggerReason,
      pnlAmount: trimRes.tradeRecord.pnlAmount,
      pnlRatio: trimRes.tradeRecord.pnlRatio,
      rMultiple: trimRes.tradeRecord.rMultiple,
      maxGainRatio: trimRes.tradeRecord.maxGainRatio,
      givebackRatio: trimRes.tradeRecord.givebackRatio,
      createdAt: Date.now(),
    });

    // 4. 随后股价回撤触碰硬线，在 24 元全部平仓剩余 700 股
    const finalRes = executePositionClose({
      positionId: posId,
      symbol: "600519",
      name: "贵州茅台",
      lots: allLots.map((l) => ({ ...l, type: l.type as any })),
      previousTrades: [trimRes.tradeRecord],
      exitDate: "2026-10-22",
      exitPrice: 24,
      sharesToClose: 700,
      triggerReason: "hard-line",
      highPriceSinceEntry: 26,
    });

    // 剩余 700 股在 24 元：700 * (24 - 21.2) = 1960 元
    // 总实现盈亏 = 1440 + 1960 = 3400 元
    // 总合成 R 倍数 = 3400 / 960 ≈ 3.54R
    expect(finalRes.isFullClose).toBe(true);
    expect(finalRes.totalRealizedPnL).toBe(3400);
    expect(finalRes.totalCompositeR).toBe(3.54);

    await db.insert(schema.trades).values({
      id: finalRes.tradeRecord.id,
      positionId: posId,
      exitDate: finalRes.tradeRecord.exitDate,
      exitPrice: finalRes.tradeRecord.exitPrice,
      shares: finalRes.tradeRecord.shares,
      triggerReason: finalRes.tradeRecord.triggerReason,
      pnlAmount: finalRes.tradeRecord.pnlAmount,
      pnlRatio: finalRes.tradeRecord.pnlRatio,
      rMultiple: finalRes.tradeRecord.rMultiple,
      maxGainRatio: finalRes.tradeRecord.maxGainRatio,
      givebackRatio: finalRes.tradeRecord.givebackRatio,
      createdAt: Date.now(),
    });

    await db
      .update(schema.positions)
      .set({ status: "closed", updatedAt: Date.now() })
      .where(eq(schema.positions.id, posId));

    // 5. 校验月度复盘统计
    const allTrades = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.positionId, posId));

    const stats = calculateTradeStatistics(
      allTrades.map((t) => ({
        id: t.id,
        positionId: t.positionId,
        symbol: "600519",
        name: "贵州茅台",
        exitDate: t.exitDate,
        exitPrice: t.exitPrice,
        shares: t.shares,
        triggerReason: t.triggerReason as any,
        pnlAmount: t.pnlAmount,
        pnlRatio: t.pnlRatio,
        rMultiple: t.rMultiple,
        maxGainRatio: t.maxGainRatio,
        givebackRatio: t.givebackRatio,
        createdAt: new Date(t.createdAt).toISOString(),
      })),
      100000
    );

    expect(stats.totalTrades).toBe(2);
    expect(stats.winTrades).toBe(2);
    expect(stats.winRate).toBe(1.0);
    expect(stats.totalPnLAmount).toBe(3400);
    expect(stats.totalR).toBeCloseTo(3.54, 1);
  });
});
