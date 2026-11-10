import crypto from "crypto";
import { ensureDbReady, schema } from "../db";
import { eq } from "drizzle-orm";
import { DEFAULT_RULE_CONFIG, RuleConfig } from "../rules/types";

const SALT = process.env.ACCESS_CODE_SALT || "trade-discipline-salt-2026-secure";

// 排除易混淆字符 (0/O, 1/I, L) 的 32 字符安全字典
const CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * 生成 24 位易读的访问码 (6 组 4 字符，格式：XXXX-XXXX-XXXX-XXXX-XXXX-XXXX)
 */
export function generateAccessCode(): string {
  const parts: string[] = [];
  for (let g = 0; g < 6; g++) {
    let group = "";
    for (let c = 0; c < 4; c++) {
      const idx = crypto.randomInt(0, CHARSET.length);
      group += CHARSET[idx];
    }
    parts.push(group);
  }
  return parts.join("-");
}

/**
 * 对访问码进行加盐哈希，用于数据库存储与比对
 */
export function hashAccessCode(code: string): string {
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return crypto.createHash("sha256").update(clean + SALT).digest("hex");
}

export interface AccountData {
  id: string;
  totalCapital: number;
  ruleConfig: RuleConfig;
  createdAt: number;
  updatedAt: number;
}

/**
 * 根据访问码获取或初始化账户
 */
export async function getOrCreateAccount(accessCode: string): Promise<AccountData> {
  const db = await ensureDbReady();
  const codeHash = hashAccessCode(accessCode);

  const existing = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.accessCodeHash, codeHash))
    .limit(1);

  if (existing.length > 0) {
    const acc = existing[0];
    let ruleConfig = DEFAULT_RULE_CONFIG;
    if (acc.ruleConfigJson) {
      try {
        ruleConfig = { ...DEFAULT_RULE_CONFIG, ...JSON.parse(acc.ruleConfigJson) };
      } catch {
        // fallback
      }
    }
    return {
      id: acc.id,
      totalCapital: acc.totalCapital,
      ruleConfig,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    };
  }

  // 创建新账户
  const now = Date.now();
  const id = `acc_${now}_${crypto.randomBytes(4).toString("hex")}`;
  const initialConfig = JSON.stringify(DEFAULT_RULE_CONFIG);

  await db.insert(schema.accounts).values({
    id,
    accessCodeHash: codeHash,
    totalCapital: 100000,
    ruleConfigJson: initialConfig,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    totalCapital: 100000,
    ruleConfig: DEFAULT_RULE_CONFIG,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 校验访问码是否存在
 */
export async function verifyAccessCode(accessCode: string): Promise<boolean> {
  const db = await ensureDbReady();
  const codeHash = hashAccessCode(accessCode);

  const existing = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.accessCodeHash, codeHash))
    .limit(1);

  return existing.length > 0;
}
