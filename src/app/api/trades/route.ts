import { NextRequest, NextResponse } from "next/server";
import { getSessionAccount } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq, desc, inArray } from "drizzle-orm";
import { calculateTradeStatistics } from "@/lib/rules/stats";
import { TradeRecord } from "@/lib/rules/types";

export async function GET(req: NextRequest) {
  const session = await getSessionAccount(req);
  if (!session) {
    return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  try {
    const db = await ensureDbReady();
    const accountId = session.account.id;

    // 获取该账户所有持仓 ID
    const userPositions = await db
      .select({ id: schema.positions.id, symbol: schema.positions.symbol, name: schema.positions.name })
      .from(schema.positions)
      .where(eq(schema.positions.accountId, accountId));

    const posMap = new Map<string, { symbol: string; name: string }>();
    userPositions.forEach((p) => posMap.set(p.id, { symbol: p.symbol, name: p.name }));

    const posIds = userPositions.map((p) => p.id);
    let rawTrades: typeof schema.trades.$inferSelect[] = [];

    if (posIds.length > 0) {
      rawTrades = await db
        .select()
        .from(schema.trades)
        .where(inArray(schema.trades.positionId, posIds))
        .orderBy(desc(schema.trades.exitDate));
    }

    const tradeRecords: TradeRecord[] = rawTrades.map((t) => {
      const posInfo = posMap.get(t.positionId) || { symbol: "未知", name: "未知" };
      return {
        id: t.id,
        positionId: t.positionId,
        symbol: posInfo.symbol,
        name: posInfo.name,
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
      };
    });

    // 计算统计指标与诊断
    const stats = calculateTradeStatistics(tradeRecords, session.account.totalCapital);

    // 如果请求 CSV 格式
    if (format === "csv") {
      const headers = [
        "交易ID",
        "代码",
        "名称",
        "出场日期",
        "出场价",
        "出场股数",
        "触发原因",
        "盈亏金额",
        "盈亏比例",
        "R倍数",
        "最高浮盈",
        "吐回比例",
        "备注",
      ];
      const rows = tradeRecords.map((t) => [
        t.id,
        t.symbol,
        `"${t.name.replace(/"/g, '""')}"`,
        t.exitDate,
        t.exitPrice.toFixed(2),
        t.shares,
        t.triggerReason,
        t.pnlAmount.toFixed(2),
        `${(t.pnlRatio * 100).toFixed(2)}%`,
        t.rMultiple.toFixed(2),
        `${(t.maxGainRatio * 100).toFixed(2)}%`,
        `${(t.givebackRatio * 100).toFixed(2)}%`,
        `"${(t.notes || "").replace(/"/g, '""')}"`,
      ]);

      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="trade-discipline-log-${new Date().toISOString().substring(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        stats,
        trades: tradeRecords,
      },
    });
  } catch (error: unknown) {
    console.error("Trades GET error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
