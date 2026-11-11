import { NextRequest, NextResponse } from "next/server";
import { ensureDbReady, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { evaluateAndSnapshot } from "@/lib/server/positionSnapshot";
import { DEFAULT_RULE_CONFIG, RuleConfig } from "@/lib/rules/types";

export async function GET(req: NextRequest) {
  return handleCronSnapshot(req);
}

export async function POST(req: NextRequest) {
  return handleCronSnapshot(req);
}

/**
 * 每日收盘后的快照任务。Vercel Cron 会带 `Authorization: Bearer <CRON_SECRET>` 调用 (见 vercel.json)。
 * 密钥只接受请求头，不接受网址参数，避免进访问日志。
 */
async function handleCronSnapshot(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ success: false, error: "服务端未配置 CRON_SECRET，拒绝执行" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret");
  if (token !== expectedSecret) {
    return NextResponse.json({ success: false, error: "未授权 Cron 任务" }, { status: 401 });
  }

  const db = await ensureDbReady();
  const startedAt = Date.now();

  try {
    const openPositions = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.status, "open"));

    const allAccounts = await db.select().from(schema.accounts);
    const accountConfigMap = new Map<string, RuleConfig>();
    for (const acc of allAccounts) {
      if (acc.ruleConfigJson) {
        try {
          accountConfigMap.set(acc.id, { ...DEFAULT_RULE_CONFIG, ...JSON.parse(acc.ruleConfigJson) });
        } catch {
          // 配置损坏则用默认值
        }
      }
    }

    let successful = 0;
    let skippedIntraday = 0;
    let failed = 0;
    const errors: Array<{ symbol: string; error: string }> = [];

    for (const pos of openPositions) {
      try {
        const lotRows = await db.select().from(schema.lots).where(eq(schema.lots.positionId, pos.id));
        const result = await evaluateAndSnapshot(db, pos, lotRows, {
          dataSource: "cron",
          config: accountConfigMap.get(pos.accountId),
        });
        if (result.persisted) successful++;
        else skippedIntraday++;
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
      skippedIntraday,
      failed,
      errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    console.error("Cron snapshot job fatal error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
