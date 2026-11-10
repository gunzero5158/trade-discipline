import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, inArray, desc } from "drizzle-orm";
import { fetchDailyCandles, fetchRealtimeQuote } from "@/lib/market/client";
import { evaluatePositionRules } from "@/lib/rules/engine";
import { Lot, Position as RulePosition } from "@/lib/rules/types";
import { calculateStage } from "@/lib/rules/stages";
import { calculateHardLine, calculateHardLineDistance } from "@/lib/rules/hardLine";
import { determineNextAction } from "@/lib/rules/actions";

export async function GET(req: NextRequest) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const shouldRefresh = searchParams.get("refresh") === "true";

  try {
    const db = await ensureDbReady();
    const accountId = session.account.id;

    // 获取该账户所有未平仓持仓
    const rawPositions = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.accountId, accountId));

    const openPositions = rawPositions.filter((p) => p.status === "open");
    const posIds = openPositions.map((p) => p.id);

    let allLots: typeof schema.lots.$inferSelect[] = [];
    let allSnapshots: typeof schema.snapshots.$inferSelect[] = [];

    if (posIds.length > 0) {
      allLots = await db
        .select()
        .from(schema.lots)
        .where(inArray(schema.lots.positionId, posIds));

      allSnapshots = await db
        .select()
        .from(schema.snapshots)
        .where(inArray(schema.snapshots.positionId, posIds))
        .orderBy(desc(schema.snapshots.createdAt));
    }

    // 组装持仓对象
    const items = [];
    let totalOpenRiskAmount = 0;
    let totalUnrealizedPnL = 0;
    let totalInitialRisk = 0;

    for (const pos of openPositions) {
      const lotsForPos: Lot[] = allLots
        .filter((l) => l.positionId === pos.id)
        .map((l) => ({
          id: l.id,
          positionId: l.positionId,
          type: l.type as "initial" | "add",
          date: l.date,
          price: l.price,
          shares: l.shares,
          stopPrice: l.stopPrice,
          riskPercent: l.riskPercent,
          notes: l.notes,
        }));

      // 最新快照
      let latestSnapshot = allSnapshots.find((s) => s.positionId === pos.id);
      let isStale = false;

      // 如果请求显式刷新或尚无快照，实时拉取行情并计算
      if (shouldRefresh || !latestSnapshot) {
        try {
          const candles = await fetchDailyCandles(pos.symbol, 120);
          if (candles.length > 0) {
            // 可选：补充最新实时价
            try {
              const realtime = await fetchRealtimeQuote(pos.symbol);
              if (realtime && realtime.price > 0) {
                const last = candles[candles.length - 1];
                last.close = realtime.price;
                last.high = Math.max(last.high, realtime.price);
                last.low = Math.min(last.low, realtime.price);
              }
            } catch {
              // 实时价失败不阻断日K
            }

            const rulePos: RulePosition = {
              id: pos.id,
              accountId: pos.accountId,
              symbol: pos.symbol,
              name: pos.name,
              market: pos.market as any,
              status: pos.status as any,
              initialStopPrice: pos.initialStopPrice,
              maType: pos.maType as any,
              maPeriod: pos.maPeriod,
              confirmDays: pos.confirmDays,
              manualStopPrice: pos.manualStopPrice,
              maxStage: pos.maxStage,
              stage3Trimmed: !!pos.stage3Trimmed,
              targetPrice: pos.targetPrice,
              accelerationLocked: !!pos.accelerationLocked,
              notes: pos.notes,
              lots: lotsForPos,
              createdAt: new Date(pos.createdAt).toISOString(),
              updatedAt: new Date(pos.updatedAt).toISOString(),
            };

            const evalSnapshot = evaluatePositionRules({
              position: rulePos,
              candles,
              yesterdayHardLine: latestSnapshot?.hardLinePrice,
              config: session.account.ruleConfig,
            });

            // 存储新快照
            const snapId = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            await db.insert(schema.snapshots).values({
              id: snapId,
              positionId: pos.id,
              date: evalSnapshot.date,
              closePrice: evalSnapshot.closePrice,
              highPrice: evalSnapshot.highPrice,
              costPrice: evalSnapshot.costPrice,
              maxGainRatio: evalSnapshot.maxGainRatio,
              stage: evalSnapshot.stage,
              hardLinePrice: evalSnapshot.hardLinePrice,
              hardLineDistancePercent: evalSnapshot.hardLineDistancePercent,
              maValue: evalSnapshot.maValue,
              softLinePrice: evalSnapshot.softLinePrice,
              softLineTriggered: evalSnapshot.softLineTriggered ? 1 : 0,
              consecutiveTriggerDays: evalSnapshot.consecutiveTriggerDays,
              nextAction: evalSnapshot.nextAction,
              actionReason: evalSnapshot.actionReason,
              dataSource: "live",
              createdAt: Date.now(),
            });

            // 如果阶段升级或加速段锁定，更新持仓状态
            if (evalSnapshot.stage > pos.maxStage || evalSnapshot.accelerationMode !== !!pos.accelerationLocked) {
              await db
                .update(schema.positions)
                .set({
                  maxStage: Math.max(pos.maxStage, evalSnapshot.stage),
                  accelerationLocked: evalSnapshot.accelerationMode ? 1 : 0,
                  updatedAt: Date.now(),
                })
                .where(eq(schema.positions.id, pos.id));
              pos.maxStage = Math.max(pos.maxStage, evalSnapshot.stage);
            }

            latestSnapshot = {
              id: snapId,
              positionId: pos.id,
              date: evalSnapshot.date,
              closePrice: evalSnapshot.closePrice,
              highPrice: evalSnapshot.highPrice,
              costPrice: evalSnapshot.costPrice,
              maxGainRatio: evalSnapshot.maxGainRatio,
              stage: evalSnapshot.stage,
              hardLinePrice: evalSnapshot.hardLinePrice,
              hardLineDistancePercent: evalSnapshot.hardLineDistancePercent,
              maValue: evalSnapshot.maValue,
              softLinePrice: evalSnapshot.softLinePrice,
              softLineTriggered: evalSnapshot.softLineTriggered ? 1 : 0,
              consecutiveTriggerDays: evalSnapshot.consecutiveTriggerDays,
              nextAction: evalSnapshot.nextAction,
              actionReason: evalSnapshot.actionReason,
              dataSource: "live",
              createdAt: Date.now(),
            };
          }
        } catch (err) {
          console.warn(`Failed to live refresh ${pos.symbol}:`, err);
          isStale = true;
        }
      }

      // 计算该持仓汇总
      let totalShares = 0;
      let totalCostAmount = 0;
      for (const l of lotsForPos) {
        totalShares += l.shares;
        totalCostAmount += l.shares * l.price;
      }
      const weightedCost = totalShares > 0 ? totalCostAmount / totalShares : 0;
      const currentPrice = latestSnapshot?.closePrice ?? weightedCost;
      const unrealizedPnL = totalShares * (currentPrice - weightedCost);
      const unrealizedRatio = weightedCost > 0 ? (currentPrice - weightedCost) / weightedCost : 0;

      // 未实现风险 = max(0, (成本 - 硬线) * 股数)
      const hardLine = latestSnapshot?.hardLinePrice ?? pos.initialStopPrice;
      const unreleasedRisk = Math.max(0, (weightedCost - hardLine) * totalShares);
      totalOpenRiskAmount += unreleasedRisk;
      totalUnrealizedPnL += unrealizedPnL;

      const initialLot = lotsForPos.find((l) => l.type === "initial") || lotsForPos[0];
      const initial1R = initialLot ? initialLot.shares * (initialLot.price - initialLot.stopPrice) : 1000;
      totalInitialRisk += initial1R;
      const unrealizedR = initial1R > 0 ? unrealizedPnL / initial1R : 0;

      items.push({
        position: pos,
        lots: lotsForPos,
        totalShares,
        weightedCost: Number(weightedCost.toFixed(2)),
        totalCostAmount: Number(totalCostAmount.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(2)),
        unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
        unrealizedRatio: Number(unrealizedRatio.toFixed(4)),
        unrealizedR: Number(unrealizedR.toFixed(2)),
        unreleasedRisk: Number(unreleasedRisk.toFixed(2)),
        snapshot: latestSnapshot,
        isStale,
      });
    }

    // 按照“距硬线百分比”升序排列 (最危险的在最上方)
    items.sort((a, b) => {
      const distA = a.snapshot?.hardLineDistancePercent ?? 999;
      const distB = b.snapshot?.hardLineDistancePercent ?? 999;
      return distA - distB;
    });

    // 统计当月已实现盈亏
    const userTrades = await db
      .select()
      .from(schema.trades);

    // 过滤属于该用户持仓的平仓记录
    const allUserPosIds = rawPositions.map((p) => p.id);
    const matchedTrades = userTrades.filter((t) => allUserPosIds.includes(t.positionId));

    const currentYearMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    let thisMonthRealizedPnL = 0;
    let thisMonthRealizedR = 0;
    for (const t of matchedTrades) {
      if (t.exitDate.startsWith(currentYearMonth)) {
        thisMonthRealizedPnL += t.pnlAmount;
        thisMonthRealizedR += t.rMultiple;
      }
    }

    const totalCapital = session.account.totalCapital;
    const totalOpenRiskPercent = Number((totalOpenRiskAmount / totalCapital * 100).toFixed(2));
    const totalUnrealizedR = totalInitialRisk > 0 ? Number((totalUnrealizedPnL / (totalInitialRisk / (items.length || 1))).toFixed(2)) : 0;

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalCapital,
          totalOpenRiskAmount: Number(totalOpenRiskAmount.toFixed(2)),
          totalOpenRiskPercent,
          totalUnrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
          totalUnrealizedR,
          thisMonthRealizedPnL: Number(thisMonthRealizedPnL.toFixed(2)),
          thisMonthRealizedR: Number(thisMonthRealizedR.toFixed(2)),
          openPositionsCount: items.length,
        },
        items,
      },
    });
  } catch (error: unknown) {
    console.error("Positions GET error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      symbol,
      name,
      market = "a-share",
      buyDate = new Date().toISOString().substring(0, 10),
      buyPrice,
      shares,
      initialStopPrice,
      maType = "EMA",
      maPeriod = 20,
      confirmDays = 1,
      targetPrice,
      notes,
    } = body;

    if (!symbol || !buyPrice || !shares || !initialStopPrice) {
      return NextResponse.json({ success: false, error: "缺少必要字段" }, { status: 400 });
    }

    if (initialStopPrice >= buyPrice) {
      return NextResponse.json({ success: false, error: "初始止损价必须低于买入价" }, { status: 400 });
    }

    const db = await ensureDbReady();
    const now = Date.now();
    const positionId = `pos_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const lotId = `lot_${now}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. 插入新持仓
    await db.insert(schema.positions).values({
      id: positionId,
      accountId: session.account.id,
      symbol: symbol.trim().toUpperCase(),
      name: name?.trim() || symbol.trim().toUpperCase(),
      market,
      status: "open",
      initialStopPrice: Number(initialStopPrice),
      maType,
      maPeriod: Number(maPeriod) || 20,
      confirmDays: Number(confirmDays) || 1,
      maxStage: 0,
      stage3Trimmed: 0,
      targetPrice: targetPrice ? Number(targetPrice) : null,
      accelerationLocked: 0,
      notes: notes || null,
      createdAt: now,
      updatedAt: now,
    });

    // 2. 插入首仓 Lot
    const perShareRisk = Number(buyPrice) - Number(initialStopPrice);
    const riskAmount = Number(shares) * perShareRisk;
    const riskPercent = Number(((riskAmount / session.account.totalCapital) * 100).toFixed(2));

    await db.insert(schema.lots).values({
      id: lotId,
      positionId,
      type: "initial",
      date: buyDate,
      price: Number(buyPrice),
      shares: Number(shares),
      stopPrice: Number(initialStopPrice),
      riskPercent,
      notes: notes || null,
      createdAt: now,
    });

    // 3. 立即尝试拉取行情生成首个快照
    try {
      const candles = await fetchDailyCandles(symbol, 60);
      if (candles.length > 0) {
        const rulePos: RulePosition = {
          id: positionId,
          accountId: session.account.id,
          symbol,
          name: name || symbol,
          market,
          status: "open",
          initialStopPrice: Number(initialStopPrice),
          maType,
          maPeriod: Number(maPeriod),
          confirmDays: Number(confirmDays),
          maxStage: 0,
          stage3Trimmed: false,
          lots: [
            {
              id: lotId,
              positionId,
              type: "initial",
              date: buyDate,
              price: Number(buyPrice),
              shares: Number(shares),
              stopPrice: Number(initialStopPrice),
              riskPercent,
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const evalSnapshot = evaluatePositionRules({
          position: rulePos,
          candles,
          yesterdayHardLine: Number(initialStopPrice),
          config: session.account.ruleConfig,
        });

        await db.insert(schema.snapshots).values({
          id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          positionId,
          date: evalSnapshot.date,
          closePrice: evalSnapshot.closePrice,
          highPrice: evalSnapshot.highPrice,
          costPrice: evalSnapshot.costPrice,
          maxGainRatio: evalSnapshot.maxGainRatio,
          stage: evalSnapshot.stage,
          hardLinePrice: evalSnapshot.hardLinePrice,
          hardLineDistancePercent: evalSnapshot.hardLineDistancePercent,
          maValue: evalSnapshot.maValue,
          softLinePrice: evalSnapshot.softLinePrice,
          softLineTriggered: evalSnapshot.softLineTriggered ? 1 : 0,
          consecutiveTriggerDays: evalSnapshot.consecutiveTriggerDays,
          nextAction: evalSnapshot.nextAction,
          actionReason: evalSnapshot.actionReason,
          dataSource: "init",
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn("Initial snapshot creation failed (will retry on load):", err);
    }

    return NextResponse.json({ success: true, positionId });
  } catch (error: unknown) {
    console.error("Positions POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
