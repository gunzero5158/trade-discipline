import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { evaluateAndSnapshot } from "@/lib/server/positionSnapshot";

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
    if (Number(stopPrice) >= Number(price)) {
      return NextResponse.json({ success: false, error: "加仓止损价必须低于加仓价" }, { status: 400 });
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

    const existingLots = await db
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.positionId, id));

    const addLotsCount = existingLots.filter((l) => l.type === "add").length;
    if (addLotsCount >= 2) {
      return NextResponse.json({ success: false, error: "已达到最多加仓 2 次限制，拒绝加仓" }, { status: 400 });
    }

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

    // 加仓后重新评估：硬线会与加仓止损位取大，且不低于昨日硬线
    try {
      const lotRows = await db.select().from(schema.lots).where(eq(schema.lots.positionId, id));
      await evaluateAndSnapshot(db, pos, lotRows, { dataSource: "add_lot", config: session.account.ruleConfig });
    } catch (err) {
      console.warn("Failed to generate snapshot on lot add:", err);
    }

    return NextResponse.json({ success: true, lotId, message: "加仓记录已成功保存" });
  } catch (error: unknown) {
    console.error("Position add POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
