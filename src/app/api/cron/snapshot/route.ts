import { NextRequest, NextResponse } from "next/server";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { fetchDailyCandles } from "@/lib/market/client";
import { evaluatePositionRules } from "@/lib/rules/engine";
import { Lot, Position as RulePosition } from "@/lib/rules/types";

export async function GET(req: NextRequest) {
  return handleCronSnapshot(req);
}

export async function POST(req: NextRequest) {
  return handleCronSnapshot(req);
}

async function handleCronSnapshot(req: NextRequest) {
  // 校验 CRON_SECRET 防止外人未经授权触发
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const authHeader = req.headers.get("authorization");
    const cronHeader = req.headers.get("x-cron-secret");
    const token = authHeader?.replace(/^Bearer\s+/i, "") || cronHeader;

    if (token !== expectedSecret) {
      return NextResponse.json({ success: false, error: "未授权 Cron 任务" }, { status: 401 });
    }
  }

  const db = await ensureDbReady();
  const startedAt = Date.now();

  try {
    const openPositions = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.status, "open"));

    let successful = 0;
    let failed = 0;
    const errors: Array<{ symbol: string; error: string }> = [];

    for (const pos of openPositions) {
      try {
        const lots = await db
          .select()
          .from(schema.lots)
          .where(eq(schema.lots.positionId, pos.id));

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

        // 获取昨日快照
        const lastSnap = await db
          .select()
          .from(schema.snapshots)
          .where(eq(schema.snapshots.positionId, pos.id))
          .orderBy(desc(schema.snapshots.date))
          .limit(1);

        const candles = await fetchDailyCandles(pos.symbol, 120);
        if (candles.length === 0) {
          throw new Error("No candles returned");
        }

        const rulePos: RulePosition = {
          id: pos.id,
          accountId: pos.accountId,
          symbol: pos.symbol,
          name: pos.name,
          market: pos.market as any,
          status: "open",
          initialStopPrice: pos.initialStopPrice,
          maType: pos.maType as any,
          maPeriod: pos.maPeriod,
          confirmDays: pos.confirmDays,
          manualStopPrice: pos.manualStopPrice,
          maxStage: pos.maxStage,
          stage3Trimmed: !!pos.stage3Trimmed,
          targetPrice: pos.targetPrice,
          accelerationLocked: !!pos.accelerationLocked,
          lots: lotsForPos,
          createdAt: new Date(pos.createdAt).toISOString(),
          updatedAt: new Date(pos.updatedAt).toISOString(),
        };

        const snapshot = evaluatePositionRules({
          position: rulePos,
          candles,
          yesterdayHardLine: lastSnap.length > 0 ? lastSnap[0].hardLinePrice : pos.initialStopPrice,
        });

        // 写入新快照
        const snapId = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await db.insert(schema.snapshots).values({
          id: snapId,
          positionId: pos.id,
          date: snapshot.date,
          closePrice: snapshot.closePrice,
          highPrice: snapshot.highPrice,
          costPrice: snapshot.costPrice,
          maxGainRatio: snapshot.maxGainRatio,
          stage: snapshot.stage,
          hardLinePrice: snapshot.hardLinePrice,
          hardLineDistancePercent: snapshot.hardLineDistancePercent,
          maValue: snapshot.maValue,
          softLinePrice: snapshot.softLinePrice,
          softLineTriggered: snapshot.softLineTriggered ? 1 : 0,
          consecutiveTriggerDays: snapshot.consecutiveTriggerDays,
          nextAction: snapshot.nextAction,
          actionReason: snapshot.actionReason,
          dataSource: "cron",
          createdAt: Date.now(),
        });

        // 状态更新
        if (snapshot.stage > pos.maxStage || snapshot.accelerationMode !== !!pos.accelerationLocked) {
          await db
            .update(schema.positions)
            .set({
              maxStage: Math.max(pos.maxStage, snapshot.stage),
              accelerationLocked: snapshot.accelerationMode ? 1 : 0,
              updatedAt: Date.now(),
            })
            .where(eq(schema.positions.id, pos.id));
        }

        successful++;
      } catch (err: unknown) {
        failed++;
        errors.push({ symbol: pos.symbol, error: String(err) });
        console.warn(`Cron snapshot failed for ${pos.symbol}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      processed: openPositions.length,
      successful,
      failed,
      errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    console.error("Cron snapshot job fatal error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
