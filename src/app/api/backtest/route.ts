import { NextRequest, NextResponse } from "next/server";
import { fetchDailyCandles } from "@/lib/market/client";
import { runPointBacktest } from "@/lib/backtest/engine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "";
  const years = parseInt(searchParams.get("years") || "2", 10);
  const swing = parseFloat(searchParams.get("swing") || "0.10");
  const maType = (searchParams.get("maType") || "EMA") as "EMA" | "MA";

  if (!symbol.trim()) {
    return NextResponse.json({ success: false, error: "缺少股票代码" }, { status: 400 });
  }

  try {
    const barLimit = Math.min(1200, Math.max(100, years * 250));
    const candles = await fetchDailyCandles(symbol, barLimit);

    if (candles.length < 60) {
      return NextResponse.json({ success: false, error: "历史行情数据不足 60 根，无法回测" }, { status: 400 });
    }

    const report = runPointBacktest(symbol, candles, {
      swingThreshold: swing,
      windowBars: 40,
      maPeriods: [5, 10, 20, 60, 120],
      maType,
    });

    return NextResponse.json({ success: true, data: report });
  } catch (error: unknown) {
    console.error("Backtest API error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
