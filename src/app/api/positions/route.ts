import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, inArray, desc } from "drizzle-orm";
import { evaluateAndSnapshot, toLot, SnapshotRow } from "@/lib/server/positionSnapshot";
import { getInitialLot } from "@/lib/rules/lots";

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

    const rawPositions = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.accountId, accountId));

    const openPositions = rawPositions.filter((p) => p.status === "open");
    const posIds = openPositions.map((p) => p.id);
    const allUserPosIds = rawPositions.map((p) => p.id);

    let allLots: typeof schema.lots.$inferSelect[] = [];
    let allSnapshots: SnapshotRow[] = [];
    let userTrades: typeof schema.trades.$inferSelect[] = [];

    if (allUserPosIds.length > 0) {
      userTrades = await db
        .select()
        .from(schema.trades)
        .where(inArray(schema.trades.positionId, allUserPosIds));
    }

    if (posIds.length > 0) {
      allLots = await db
        .select()
        .from(schema.lots)
        .where(inArray(schema.lots.positionId, posIds));

      allSnapshots = await db
        .select()
        .from(schema.snapshots)
        .where(inArray(schema.snapshots.positionId, posIds))
        .orderBy(desc(schema.snapshots.date), desc(schema.snapshots.createdAt));
    }

    const items = [];
    let totalOpenRiskAmount = 0;
    let totalUnrealizedPnL = 0;
    let sumUnrealizedR = 0;

    for (const pos of openPositions) {
      const lotRows = allLots.filter((l) => l.positionId === pos.id);
      const lotsForPos = lotRows.map(toLot);
      const tradesForPos = userTrades.filter((t) => t.positionId === pos.id);
      const alreadyClosedShares = tradesForPos.reduce((acc, t) => acc + t.shares, 0);

      // 看板展示用的快照：默认取库里最新一条；刷新或没有快照时重新算
      let snapshot: Record<string, unknown> | null = allSnapshots.find((s) => s.positionId === pos.id) ?? null;
      let isStale = false;
      let intraday: { price: number; hardLineHit: boolean } | null = null;

      if (shouldRefresh || !snapshot) {
        try {
          const result = await evaluateAndSnapshot(db, pos, lotRows, {
            dataSource: "live",
            config: session.account.ruleConfig,
          });
          snapshot = { ...result.snapshot, softLineTriggered: result.snapshot.softLineTriggered ? 1 : 0 };
          if (result.isIntraday && result.snapshot.intradayPrice) {
            intraday = { price: result.snapshot.intradayPrice, hardLineHit: result.snapshot.intradayHardLineHit };
          }
        } catch (err) {
          console.warn(`Failed to live refresh ${pos.symbol}:`, err);
          isStale = true;
        }
      }

      // 持仓汇总 (扣减已部分平仓的股数)
      let totalBoughtShares = 0;
      let totalCostAmount = 0;
      for (const l of lotsForPos) {
        totalBoughtShares += l.shares;
        totalCostAmount += l.shares * l.price;
      }
      const weightedCost = totalBoughtShares > 0 ? totalCostAmount / totalBoughtShares : 0;
      const totalShares = Math.max(0, totalBoughtShares - alreadyClosedShares);
      const currentCostAmount = totalShares * weightedCost;
      const snapClose = typeof snapshot?.closePrice === "number" ? (snapshot.closePrice as number) : null;
      const currentPrice = intraday?.price ?? snapClose ?? weightedCost;
      const unrealizedPnL = totalShares * (currentPrice - weightedCost);
      const unrealizedRatio = weightedCost > 0 ? (currentPrice - weightedCost) / weightedCost : 0;

      // 未实现风险 = max(0, (成本 - 硬线) * 剩余股数)
      const hardLine = typeof snapshot?.hardLinePrice === "number" ? (snapshot.hardLinePrice as number) : pos.initialStopPrice;
      const unreleasedRisk = Math.max(0, (weightedCost - hardLine) * totalShares);
      totalOpenRiskAmount += unreleasedRisk;
      totalUnrealizedPnL += unrealizedPnL;

      const initialLot = getInitialLot(lotsForPos);
      const initial1R = initialLot ? initialLot.shares * (initialLot.price - initialLot.stopPrice) : 0;
      const unrealizedR = initial1R > 0 ? unrealizedPnL / initial1R : 0;
      sumUnrealizedR += unrealizedR;

      items.push({
        position: pos,
        lots: lotsForPos,
        totalShares,
        weightedCost: Number(weightedCost.toFixed(2)),
        totalCostAmount: Number(currentCostAmount.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(2)),
        unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
        unrealizedRatio: Number(unrealizedRatio.toFixed(4)),
        unrealizedR: Number(unrealizedR.toFixed(2)),
        unreleasedRisk: Number(unreleasedRisk.toFixed(2)),
        snapshot,
        intraday,
        isStale,
      });
    }

    // 按"距硬线百分比"升序排列 (最危险的在最上方)
    items.sort((a, b) => {
      const distA = (a.snapshot?.hardLineDistancePercent as number | undefined) ?? 999;
      const distB = (b.snapshot?.hardLineDistancePercent as number | undefined) ?? 999;
      return distA - distB;
    });

    const currentYearMonth = new Date().toISOString().substring(0, 7);
    let thisMonthRealizedPnL = 0;
    let thisMonthRealizedR = 0;
    for (const t of userTrades) {
      if (t.exitDate.startsWith(currentYearMonth)) {
        thisMonthRealizedPnL += t.pnlAmount;
        thisMonthRealizedR += t.rMultiple;
      }
    }

    const totalCapital = session.account.totalCapital;
    const totalOpenRiskPercent = Number((totalOpenRiskAmount / totalCapital * 100).toFixed(2));

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalCapital,
          totalOpenRiskAmount: Number(totalOpenRiskAmount.toFixed(2)),
          totalOpenRiskPercent,
          totalUnrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
          totalUnrealizedR: Number(sumUnrealizedR.toFixed(2)),
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

    if (Number(initialStopPrice) >= Number(buyPrice)) {
      return NextResponse.json({ success: false, error: "初始止损价必须低于买入价" }, { status: 400 });
    }

    const db = await ensureDbReady();
    const now = Date.now();
    const positionId = `pos_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const lotId = `lot_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const cleanSymbol = String(symbol).trim().toUpperCase();

    const positionRow: typeof schema.positions.$inferInsert = {
      id: positionId,
      accountId: session.account.id,
      symbol: cleanSymbol,
      name: name?.trim() || cleanSymbol,
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
    };
    await db.insert(schema.positions).values(positionRow);

    const perShareRisk = Number(buyPrice) - Number(initialStopPrice);
    const riskAmount = Number(shares) * perShareRisk;
    const riskPercent = Number(((riskAmount / session.account.totalCapital) * 100).toFixed(2));

    const lotRow: typeof schema.lots.$inferInsert = {
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
    };
    await db.insert(schema.lots).values(lotRow);

    // 立即拉行情生成首个快照 (失败不影响建仓，看板打开时会重算)
    try {
      const [posRow] = await db.select().from(schema.positions).where(eq(schema.positions.id, positionId)).limit(1);
      const lotRows = await db.select().from(schema.lots).where(eq(schema.lots.positionId, positionId));
      await evaluateAndSnapshot(db, posRow, lotRows, { dataSource: "init", config: session.account.ruleConfig });
    } catch (err) {
      console.warn("Initial snapshot creation failed (will retry on load):", err);
    }

    return NextResponse.json({ success: true, positionId });
  } catch (error: unknown) {
    console.error("Positions POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
