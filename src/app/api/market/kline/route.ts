import { NextRequest, NextResponse } from "next/server";
import { fetchDailyCandles } from "@/lib/market/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "";
  const limit = parseInt(searchParams.get("limit") || "200", 10);

  if (!symbol.trim()) {
    return NextResponse.json({ success: false, error: "缺少代码参数" }, { status: 400 });
  }

  try {
    const candles = await fetchDailyCandles(symbol, limit);
    return NextResponse.json({ success: true, data: candles });
  } catch (error: unknown) {
    console.warn("Market kline error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
