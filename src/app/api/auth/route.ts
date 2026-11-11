import { NextRequest, NextResponse } from "next/server";
import { generateAccessCode, getOrCreateAccount, findAccountByCode, hashAccessCode } from "@/lib/auth/accessCode";
import { getAccessCodeFromRequest, ACCESS_CODE_COOKIE } from "@/lib/auth/session";
import { ensureDbReady, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const COOKIE_OPTIONS = {
  path: "/",
  maxAge: 365 * 24 * 60 * 60,
  httpOnly: false, // 允许前端读取并展示
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

/**
 * GET：
 * - 没带访问码 → 生成一个新码并建账户 (这是唯一会新建账户的入口)
 * - 带了访问码且存在 → 返回账户
 * - 带了访问码但不存在 (数据库被重置等) → 401 + 清掉 cookie，前端再请求一次即可拿到新码
 */
export async function GET(req: NextRequest) {
  const existingCode = getAccessCodeFromRequest(req);

  try {
    if (existingCode) {
      const account = await findAccountByCode(existingCode);
      if (!account) {
        const res = NextResponse.json({ success: false, invalid: true, error: "访问码不存在" }, { status: 401 });
        res.cookies.delete(ACCESS_CODE_COOKIE);
        return res;
      }
      const res = NextResponse.json({ success: true, accessCode: existingCode, isNew: false, account });
      res.cookies.set(ACCESS_CODE_COOKIE, existingCode, COOKIE_OPTIONS);
      return res;
    }

    const accessCode = generateAccessCode();
    const account = await getOrCreateAccount(accessCode);
    const res = NextResponse.json({ success: true, accessCode, isNew: true, account });
    res.cookies.set(ACCESS_CODE_COOKIE, accessCode, COOKIE_OPTIONS);
    return res;
  } catch (error: unknown) {
    console.error("Auth GET error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, accessCode: inputCode, totalCapital, ruleConfig } = body;

    // 1. 切换 / 登录已有的访问码：必须真的存在，输错不会偷偷建新账户
    if (action === "login" && inputCode) {
      const code = String(inputCode).trim().toUpperCase();
      const account = await findAccountByCode(code);
      if (!account) {
        return NextResponse.json({ success: false, error: "访问码不存在，请核对后重试" }, { status: 404 });
      }
      const res = NextResponse.json({ success: true, accessCode: code, account });
      res.cookies.set(ACCESS_CODE_COOKIE, code, COOKIE_OPTIONS);
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
      .select({ id: schema.accounts.id })
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

    const updatedAccount = await findAccountByCode(currentCode);
    return NextResponse.json({ success: true, account: updatedAccount });
  } catch (error: unknown) {
    console.error("Auth POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
