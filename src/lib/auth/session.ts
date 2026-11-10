import { NextRequest } from "next/server";
import { getOrCreateAccount, AccountData } from "./accessCode";

export const ACCESS_CODE_COOKIE = "trade_discipline_code";

/**
 * 从请求 Header 或 Cookie 中解析出当前用户的访问码
 */
export function getAccessCodeFromRequest(req: NextRequest): string | null {
  const headerCode = req.headers.get("x-access-code");
  if (headerCode && headerCode.trim().length >= 10) {
    return headerCode.trim();
  }

  const cookieCode = req.cookies.get(ACCESS_CODE_COOKIE)?.value;
  if (cookieCode && cookieCode.trim().length >= 10) {
    return cookieCode.trim();
  }

  return null;
}

/**
 * 校验并获取当前请求对应的账户对象
 */
export async function getSessionAccount(req: NextRequest): Promise<{ account: AccountData; accessCode: string } | null> {
  const code = getAccessCodeFromRequest(req);
  if (!code) return null;

  try {
    const account = await getOrCreateAccount(code);
    return { account, accessCode: code };
  } catch (err) {
    console.error("Session account error:", err);
    return null;
  }
}
