import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { fetchDailyCandles } from "@/lib/market/client";
import { evaluatePositionRules } from "@/lib/rules/engine";
import { Lot, Position as RulePosition } from "@/lib/rules/types";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
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

    const lots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.positionId, id))
      .orderBy(schema.lots.date);

    const snapshots = await db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.positionId, id))
      .orderBy(desc(schema.snapshots.createdAt))
      .limit(60);

    const trades = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.positionId, id))
      .orderBy(desc(schema.trades.exitDate));

    // 计算加权成本与剩余股数 (扣减已部分平仓股数)
    let totalBoughtShares = 0;
    let totalCostAmount = 0;
    for (const l of lots) {
      totalBoughtShares += l.shares;
      totalCostAmount += l.shares * l.price;
    }
    const alreadyClosedShares = trades.reduce((acc, t) => acc + t.shares, 0);
    const totalShares = Math.max(0, totalBoughtShares - alreadyClosedShares);
    const weightedCost = totalBoughtShares > 0 ? totalCostAmount / totalBoughtShares : 0;
    const currentCostAmount = totalShares * weightedCost;

    return NextResponse.json({
      success: true,
      data: {
        position: pos,
        lots,
        snapshots,
        trades,
        totalCapital: session.account.totalCapital,
        summary: {
          totalShares,
          weightedCost: Number(weightedCost.toFixed(2)),
          totalCostAmount: Number(currentCostAmount.toFixed(2)),
        },
      },
    });
  } catch (error: unknown) {
    console.error("Position detail GET error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function PATCH(
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

    // 获取最新快照以校验人工硬线不能低于当前硬线
    const latestSnapList = await db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.positionId, id))
      .orderBy(desc(schema.snapshots.createdAt))
      .limit(1);
    const currentHardLine = latestSnapList.length > 0 ? latestSnapList[0].hardLinePrice : pos.initialStopPrice;

    const updates: Partial<typeof schema.positions.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (body.manualStopPrice !== undefined) {
      if (body.manualStopPrice !== null) {
        const newManual = Number(body.manualStopPrice);
        if (newManual < currentHardLine) {
          return NextResponse.json(
            { success: false, error: `铁律限制：人工硬线 (${newManual}) 不能低于当前生效硬线 (${currentHardLine})，硬线只升不降！` },
            { status: 400 }
          );
        }
        updates.manualStopPrice = newManual;
      } else {
        updates.manualStopPrice = null;
      }
    }
    if (body.maType !== undefined) {
      updates.maType = body.maType === "MA" ? "MA" : "EMA";
    }
    if (body.maPeriod !== undefined) {
      updates.maPeriod = Number(body.maPeriod);
    }
    if (body.confirmDays !== undefined) {
      updates.confirmDays = Number(body.confirmDays);
    }
    if (body.targetPrice !== undefined) {
      updates.targetPrice = body.targetPrice !== null ? Number(body.targetPrice) : null;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes;
    }
    if (body.stage3Trimmed !== undefined) {
      updates.stage3Trimmed = body.stage3Trimmed ? 1 : 0;
    }
    if (body.accelerationLocked !== undefined) {
      updates.accelerationLocked = body.accelerationLocked ? 1 : 0;
    }

    await db
      .update(schema.positions)
      .set(updates)
      .where(eq(schema.positions.id, id));

    // 规则修改后立即重新评估并写入新快照
    try {
      const updatedPos = { ...pos, ...updates };
      const lots = await db.select().from(schema.lots).where(eq(schema.lots.positionId, id));
      const lotsForPos: Lot[] = lots.map((l) => ({
        id: l.id,
        positionId: l.positionId,
        type: l.type as any,
        date: l.date,
        price: l.price,
        shares: l.shares,
        stopPrice: l.stopPrice,
        riskPercent: l.riskPercent,
      }));

      const candles = await fetchDailyCandles(updatedPos.symbol, 120);
      if (candles.length > 0) {
        const rulePos: RulePosition = {
          id: updatedPos.id,
          accountId: updatedPos.accountId,
          symbol: updatedPos.symbol,
          name: updatedPos.name,
          market: updatedPos.market as any,
          status: updatedPos.status as any,
          initialStopPrice: updatedPos.initialStopPrice,
          maType: updatedPos.maType as any,
          maPeriod: updatedPos.maPeriod,
          confirmDays: updatedPos.confirmDays,
          manualStopPrice: updatedPos.manualStopPrice,
          maxStage: updatedPos.maxStage,
          stage3Trimmed: !!updatedPos.stage3Trimmed,
          targetPrice: updatedPos.targetPrice,
          accelerationLocked: !!updatedPos.accelerationLocked,
          lots: lotsForPos,
          createdAt: new Date(updatedPos.createdAt).toISOString(),
          updatedAt: new Date(updatedPos.updatedAt).toISOString(),
        };

        const evalSnapshot = evaluatePositionRules({
          position: rulePos,
          candles,
          yesterdayHardLine: currentHardLine,
          config: session.account.ruleConfig,
        });

        await db.insert(schema.snapshots).values({
          id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          positionId: id,
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
          dataSource: "rule_update",
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn("Failed to re-evaluate snapshot after PATCH:", err);
    }

    return NextResponse.json({ success: true, message: "持仓规则已更新并重新计算" });
  } catch (error: unknown) {
    console.error("Position detail PATCH error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const db = await ensureDbReady();
    const position = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.id, id))
      .limit(1);

    if (position.length === 0 || position[0].accountId !== session.account.id) {
      return NextResponse.json({ success: false, error: "持仓不存在" }, { status: 404 });
    }

    await db.delete(schema.lots).where(eq(schema.lots.positionId, id));
    await db.delete(schema.snapshots).where(eq(schema.snapshots.positionId, id));
    await db.delete(schema.trades).where(eq(schema.trades.positionId, id));
    await db.delete(schema.positions).where(eq(schema.positions.id, id));

    return NextResponse.json({ success: true, message: "持仓已删除" });
  } catch (error: unknown) {
    console.error("Position detail DELETE error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
