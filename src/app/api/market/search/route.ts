import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/market/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  if (!q.trim()) {
    return NextResponse.json({ success: true, items: [] });
  }

  try {
    const items = await searchSymbols(q);
    return NextResponse.json({ success: true, items });
  } catch (error: unknown) {
    console.warn("Market search error:", error);
    return NextResponse.json({ success: false, items: [], error: String(error) });
  }
}
