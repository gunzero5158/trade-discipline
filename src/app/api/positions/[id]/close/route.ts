import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { executePositionClose } from "@/lib/rules/closing";
import { Lot, TradeRecord } from "@/lib/rules/types";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const body = await req.json();
    const {
      exitPrice,
      sharesToClose,
      triggerReason = "manual",
      exitDate = new Date().toISOString().substring(0, 10),
      notes,
    } = body;

    if (!exitPrice || !sharesToClose) {
      return NextResponse.json({ success: false, error: "缺少出场价或平仓股数" }, { status: 400 });
    }

    const db = await ensureDbReady();
    const position = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.id, id))
      .limit(1);

    if (position.length === 0 || position[0].accountId !== session.account.id) {
      return NextResponse.json({ success: false, error: "持仓不存在" }, { status: 404 });
    }

    const pos = position[0];

    const rawLots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.positionId, id));

    const lots: Lot[] = rawLots.map((l) => ({
      id: l.id,
      positionId: l.positionId,
      type: l.type as any,
      date: l.date,
      price: l.price,
      shares: l.shares,
      stopPrice: l.stopPrice,
      riskPercent: l.riskPercent,
    }));

    const rawTrades = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.positionId, id));

    const previousTrades: TradeRecord[] = rawTrades.map((t) => ({
      id: t.id,
      positionId: t.positionId,
      symbol: pos.symbol,
      name: pos.name,
      exitDate: t.exitDate,
      exitPrice: t.exitPrice,
      shares: t.shares,
      triggerReason: t.triggerReason as any,
      pnlAmount: t.pnlAmount,
      pnlRatio: t.pnlRatio,
      rMultiple: t.rMultiple,
      maxGainRatio: t.maxGainRatio,
      givebackRatio: t.givebackRatio,
      notes: t.notes,
      createdAt: new Date(t.createdAt).toISOString(),
    }));

    // 获取持仓最高价
    const latestSnapshot = await db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.positionId, id))
      .orderBy(desc(schema.snapshots.date))
      .limit(1);

    const highPrice = latestSnapshot.length > 0 ? latestSnapshot[0].highPrice : Number(exitPrice);

    // 执行平仓核算
    const closeResult = executePositionClose({
      positionId: id,
      symbol: pos.symbol,
      name: pos.name,
      lots,
      previousTrades,
      exitDate,
      exitPrice: Number(exitPrice),
      sharesToClose: Number(sharesToClose),
      triggerReason: triggerReason as any,
      highPriceSinceEntry: highPrice,
      notes,
    });

    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(schema.trades).values({
      id: tradeId,
      positionId: id,
      exitDate,
      exitPrice: Number(exitPrice),
      shares: Number(sharesToClose),
      triggerReason,
      pnlAmount: closeResult.tradeRecord.pnlAmount,
      pnlRatio: closeResult.tradeRecord.pnlRatio,
      rMultiple: closeResult.tradeRecord.rMultiple,
      maxGainRatio: closeResult.tradeRecord.maxGainRatio,
      givebackRatio: closeResult.tradeRecord.givebackRatio,
      notes: notes || null,
      createdAt: Date.now(),
    });

    const positionUpdates: Partial<typeof schema.positions.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (closeResult.isFullClose) {
      positionUpdates.status = "closed";
    }

    if (triggerReason === "stage3-trim") {
      positionUpdates.stage3Trimmed = 1;
    }

    await db
      .update(schema.positions)
      .set(positionUpdates)
      .where(eq(schema.positions.id, id));

    // 如果是部分平仓 (如阶段 3 卖出 1/3 落袋)，同步更新最新快照的明日动作，避免看板继续提示卖出 1/3
    if (!closeResult.isFullClose && latestSnapshot.length > 0 && latestSnapshot[0].nextAction === "TRIM_ONE_THIRD") {
      await db
        .update(schema.snapshots)
        .set({
          nextAction: "HOLD",
          actionReason: "已完成阶段 3 的 1/3 仓位落袋，剩余仓位继续按硬线与软线跟踪。",
        })
        .where(eq(schema.snapshots.id, latestSnapshot[0].id));
    }

    return NextResponse.json({
      success: true,
      data: {
        tradeId,
        isFullClose: closeResult.isFullClose,
        remainingShares: closeResult.remainingShares,
        pnlAmount: closeResult.tradeRecord.pnlAmount,
        rMultiple: closeResult.tradeRecord.rMultiple,
        totalCompositeR: closeResult.totalCompositeR,
        totalRealizedPnL: closeResult.totalRealizedPnL,
      },
    });
  } catch (error: unknown) {
    console.error("Position close POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
