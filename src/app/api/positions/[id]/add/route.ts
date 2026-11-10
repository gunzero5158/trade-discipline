import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { fetchDailyCandles } from "@/lib/market/client";
import { evaluatePositionRules } from "@/lib/rules/engine";
import { Lot, Position as RulePosition } from "@/lib/rules/types";

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
      price,
      shares,
      stopPrice,
      date = new Date().toISOString().substring(0, 10),
      notes,
    } = body;

    if (!price || !shares || !stopPrice) {
      return NextResponse.json({ success: false, error: "缺少加仓价格、股数或止损价" }, { status: 400 });
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

    // 获取现有 lots
    const existingLots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.positionId, id));

    const addLotsCount = existingLots.filter((l) => l.type === "add").length;
    if (addLotsCount >= 2) {
      return NextResponse.json({ success: false, error: "已达到最多加仓 2 次限制，拒绝加仓" }, { status: 400 });
    }

    // 获取最新快照硬线，防止加仓摊高成本后硬线倒退 (Bug 4 修复)
    const lastSnapList = await db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.positionId, id))
      .orderBy(desc(schema.snapshots.createdAt))
      .limit(1);
    const yesterdayHardLine = lastSnapList.length > 0 ? lastSnapList[0].hardLinePrice : pos.initialStopPrice;

    const addIndex = addLotsCount + 1;
    const riskPercent = addIndex === 1 ? 0.5 : 0.25;

    const lotId = `lot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(schema.lots).values({
      id: lotId,
      positionId: id,
      type: "add",
      date,
      price: Number(price),
      shares: Number(shares),
      stopPrice: Number(stopPrice),
      riskPercent,
      notes: notes || null,
      createdAt: Date.now(),
    });

    // 重新计算并保存快照
    try {
      const allLots: Lot[] = [
        ...existingLots.map((l) => ({
          id: l.id,
          positionId: l.positionId,
          type: l.type as any,
          date: l.date,
          price: l.price,
          shares: l.shares,
          stopPrice: l.stopPrice,
          riskPercent: l.riskPercent,
        })),
        {
          id: lotId,
          positionId: id,
          type: "add",
          date,
          price: Number(price),
          shares: Number(shares),
          stopPrice: Number(stopPrice),
          riskPercent,
        },
      ];

      const candles = await fetchDailyCandles(pos.symbol, 120);
      if (candles.length > 0) {
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
          lots: allLots,
          createdAt: new Date(pos.createdAt).toISOString(),
          updatedAt: new Date(pos.updatedAt).toISOString(),
        };

        const evalSnapshot = evaluatePositionRules({
          position: rulePos,
          candles,
          yesterdayHardLine,
          config: session.account.ruleConfig,
        });

        // 插入新快照
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
          dataSource: "add_lot",
          createdAt: Date.now(),
        });

        // 更新 maxStage 保护
        if (evalSnapshot.stage > pos.maxStage) {
          await db
            .update(schema.positions)
            .set({ maxStage: evalSnapshot.stage, updatedAt: Date.now() })
            .where(eq(schema.positions.id, id));
        }
      }
    } catch (err) {
      console.warn("Failed to generate snapshot on lot add:", err);
    }

    return NextResponse.json({ success: true, lotId, message: "加仓记录已成功保存" });
  } catch (error: unknown) {
    console.error("Position add POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
