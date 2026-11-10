import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  try {
    const db = await ensureDbReady();
    const accountId = session.account.id;

    const userPositions = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.accountId, accountId));

    const posIds = userPositions.map((p) => p.id);
    let userLots: typeof schema.lots.$inferSelect[] = [];
    let userSnapshots: typeof schema.snapshots.$inferSelect[] = [];
    let userTrades: typeof schema.trades.$inferSelect[] = [];

    if (posIds.length > 0) {
      userLots = await db
        .select()
        .from(schema.lots)
        .where(inArray(schema.lots.positionId, posIds));

      userSnapshots = await db
        .select()
        .from(schema.snapshots)
        .where(inArray(schema.snapshots.positionId, posIds));

      userTrades = await db
        .select()
        .from(schema.trades)
        .where(inArray(schema.trades.positionId, posIds));
    }

    const backupData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      account: session.account,
      positions: userPositions,
      lots: userLots,
      snapshots: userSnapshots,
      trades: userTrades,
    };

    return NextResponse.json({ success: true, data: backupData });
  } catch (error: unknown) {
    console.error("Backup export error:", error);
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
    const { data } = body;
    if (!data || !Array.isArray(data.positions)) {
      return NextResponse.json({ success: false, error: "备份文件格式不正确" }, { status: 400 });
    }

    const db = await ensureDbReady();
    const accountId = session.account.id;

    // 清理旧持仓与明细
    const oldPositions = await db
      .select({ id: schema.positions.id })
      .from(schema.positions)
      .where(eq(schema.positions.accountId, accountId));

    const oldPosIds = oldPositions.map((p) => p.id);
    if (oldPosIds.length > 0) {
      await db.delete(schema.lots).where(inArray(schema.lots.positionId, oldPosIds));
      await db.delete(schema.snapshots).where(inArray(schema.snapshots.positionId, oldPosIds));
      await db.delete(schema.trades).where(inArray(schema.trades.positionId, oldPosIds));
      await db.delete(schema.positions).where(eq(schema.positions.accountId, accountId));
    }

    // 导入账户设置
    if (data.account) {
      await db
        .update(schema.accounts)
        .set({
          totalCapital: data.account.totalCapital ?? 100000,
          ruleConfigJson: JSON.stringify(data.account.ruleConfig ?? {}),
          updatedAt: Date.now(),
        })
        .where(eq(schema.accounts.id, accountId));
    }

    // 映射并插入持仓
    for (const p of data.positions) {
      await db.insert(schema.positions).values({
        ...p,
        accountId, // 绑定到当前账户
      });
    }

    // 映射并插入 Lots
    if (Array.isArray(data.lots) && data.lots.length > 0) {
      for (const l of data.lots) {
        await db.insert(schema.lots).values(l);
      }
    }

    // 插入 Snapshots
    if (Array.isArray(data.snapshots) && data.snapshots.length > 0) {
      for (const s of data.snapshots) {
        await db.insert(schema.snapshots).values(s);
      }
    }

    // 插入 Trades
    if (Array.isArray(data.trades) && data.trades.length > 0) {
      for (const t of data.trades) {
        await db.insert(schema.trades).values(t);
      }
    }

    return NextResponse.json({ success: true, message: "数据恢复成功" });
  } catch (error: unknown) {
    console.error("Backup import error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  try {
    const db = await ensureDbReady();
    const accountId = session.account.id;

    const oldPositions = await db
      .select({ id: schema.positions.id })
      .from(schema.positions)
      .where(eq(schema.positions.accountId, accountId));

    const oldPosIds = oldPositions.map((p) => p.id);
    if (oldPosIds.length > 0) {
      await db.delete(schema.lots).where(inArray(schema.lots.positionId, oldPosIds));
      await db.delete(schema.snapshots).where(inArray(schema.snapshots.positionId, oldPosIds));
      await db.delete(schema.trades).where(inArray(schema.trades.positionId, oldPosIds));
      await db.delete(schema.positions).where(eq(schema.positions.accountId, accountId));
    }

    return NextResponse.json({ success: true, message: "账户持仓与交易记录已全部清空" });
  } catch (error: unknown) {
    console.error("Backup delete error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
