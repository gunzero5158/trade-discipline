import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { evaluateAndSnapshot, getLatestSnapshot } from "@/lib/server/positionSnapshot";

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
      .orderBy(desc(schema.snapshots.date), desc(schema.snapshots.createdAt))
      .limit(60);

    const trades = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.positionId, id))
      .orderBy(desc(schema.trades.exitDate));

    // 加权成本与剩余股数 (扣减已部分平仓股数)
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
          alreadyClosedShares,
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

    // 人工硬线不能低于当前生效硬线
    const latestSnap = await getLatestSnapshot(db, id);
    const currentHardLine = latestSnap?.hardLinePrice ?? pos.initialStopPrice;

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

    // 规则修改后立即重新评估
    try {
      const [updatedPos] = await db.select().from(schema.positions).where(eq(schema.positions.id, id)).limit(1);
      const lotRows = await db.select().from(schema.lots).where(eq(schema.lots.positionId, id));
      await evaluateAndSnapshot(db, updatedPos, lotRows, { dataSource: "rule_update", config: session.account.ruleConfig });
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
