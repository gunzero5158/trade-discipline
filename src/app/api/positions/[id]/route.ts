import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { fetchDailyCandles } from "@/lib/market/client";

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
      .orderBy(desc(schema.snapshots.date))
      .limit(60);

    const trades = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.positionId, id))
      .orderBy(desc(schema.trades.exitDate));

    // 计算加权成本与总股数
    let totalShares = 0;
    let totalCostAmount = 0;
    for (const l of lots) {
      totalShares += l.shares;
      totalCostAmount += l.shares * l.price;
    }
    const weightedCost = totalShares > 0 ? totalCostAmount / totalShares : 0;

    return NextResponse.json({
      success: true,
      data: {
        position: pos,
        lots,
        snapshots,
        trades,
        summary: {
          totalShares,
          weightedCost: Number(weightedCost.toFixed(2)),
          totalCostAmount: Number(totalCostAmount.toFixed(2)),
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

    const updates: Partial<typeof schema.positions.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (body.manualStopPrice !== undefined) {
      updates.manualStopPrice = body.manualStopPrice !== null ? Number(body.manualStopPrice) : null;
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

    return NextResponse.json({ success: true, message: "持仓规则已更新" });
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
