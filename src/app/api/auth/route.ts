import { NextRequest, NextResponse } from "next/server";
import { generateAccessCode, getOrCreateAccount, hashAccessCode } from "@/lib/auth/accessCode";
import { getAccessCodeFromRequest, ACCESS_CODE_COOKIE } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  let accessCode = getAccessCodeFromRequest(req);
  let isNew = false;

  if (!accessCode) {
    accessCode = generateAccessCode();
    isNew = true;
  }

  try {
    const account = await getOrCreateAccount(accessCode);
    const response = NextResponse.json({
      success: true,
      accessCode,
      isNew,
      account,
    });

    // 自动在 Cookie 中维持访问码
    response.cookies.set(ACCESS_CODE_COOKIE, accessCode, {
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
      httpOnly: false, // 允许前端读取
      sameSite: "lax",
    });

    return response;
  } catch (error: unknown) {
    console.error("Auth GET error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, accessCode: inputCode, totalCapital, ruleConfig } = body;

    // 1. 切换 / 登录已有的访问码
    if (action === "login" && inputCode) {
      const code = String(inputCode).trim().toUpperCase();
      const account = await getOrCreateAccount(code);
      const res = NextResponse.json({ success: true, accessCode: code, account });
      res.cookies.set(ACCESS_CODE_COOKIE, code, {
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
        httpOnly: false,
        sameSite: "lax",
      });
      return res;
    }

    // 2. 更新账户配置 (总资金或规则参数)
    const currentCode = getAccessCodeFromRequest(req);
    if (!currentCode) {
      return NextResponse.json({ success: false, error: "未登录访问码" }, { status: 401 });
    }

    const db = await ensureDbReady();
    const codeHash = hashAccessCode(currentCode);
    const existing = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.accessCodeHash, codeHash))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: "账户不存在" }, { status: 404 });
    }

    const updates: Partial<typeof schema.accounts.$inferInsert> = {
      updatedAt: Date.now(),
    };
    if (typeof totalCapital === "number" && totalCapital > 0) {
      updates.totalCapital = totalCapital;
    }
    if (ruleConfig && typeof ruleConfig === "object") {
      updates.ruleConfigJson = JSON.stringify(ruleConfig);
    }

    await db
      .update(schema.accounts)
      .set(updates)
      .where(eq(schema.accounts.accessCodeHash, codeHash));

    const updatedAccount = await getOrCreateAccount(currentCode);
    return NextResponse.json({ success: true, account: updatedAccount });
  } catch (error: unknown) {
    console.error("Auth POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
