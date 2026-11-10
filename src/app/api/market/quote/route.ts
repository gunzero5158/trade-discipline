import { NextRequest, NextResponse } from "next/server";
import { fetchRealtimeQuote } from "@/lib/market/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "";

  if (!symbol.trim()) {
    return NextResponse.json({ success: false, error: "缺少代码参数" }, { status: 400 });
  }

  try {
    const quote = await fetchRealtimeQuote(symbol);
    return NextResponse.json({ success: true, data: quote });
  } catch (error: unknown) {
    console.warn("Market quote error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
