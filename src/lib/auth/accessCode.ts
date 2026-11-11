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
 * 按访问码查账户；不存在返回 null，绝不顺手新建。
 * 登录、读持仓等所有带码请求都走这里，防止输错的码或任意请求头把数据库灌满空账户。
 */
export async function findAccountByCode(accessCode: string): Promise<AccountData | null> {
  const db = await ensureDbReady();
  const codeHash = hashAccessCode(accessCode);

  const existing = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.accessCodeHash, codeHash))
    .limit(1);

  if (existing.length === 0) return null;

  const acc = existing[0];
  let ruleConfig = DEFAULT_RULE_CONFIG;
  if (acc.ruleConfigJson) {
    try {
      ruleConfig = { ...DEFAULT_RULE_CONFIG, ...JSON.parse(acc.ruleConfigJson) };
    } catch {
      // 配置损坏则用默认值
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

/**
 * 根据访问码获取或初始化账户。只有"生成新访问码"这一个入口应该调用它。
 */
export async function getOrCreateAccount(accessCode: string): Promise<AccountData> {
  const existing = await findAccountByCode(accessCode);
  if (existing) return existing;

  const db = await ensureDbReady();
  const codeHash = hashAccessCode(accessCode);

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
