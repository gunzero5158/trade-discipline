import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import path from "path";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __tradeDisciplineDb?: Database;
  __tradeDisciplineClient?: ReturnType<typeof createClient>;
  __dbInitialized?: Promise<void>;
};

function createDbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    return createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  // 本地开发与测试默认自动回退至 SQLite 文件
  const file = process.env.DEV_DATABASE_FILE || path.join(process.cwd(), "dev.db");
  return createClient({ url: `file:${file}` });
}

export function getDb(): Database {
  if (!globalForDb.__tradeDisciplineDb) {
    globalForDb.__tradeDisciplineClient = createDbClient();
    globalForDb.__tradeDisciplineDb = drizzle(globalForDb.__tradeDisciplineClient, { schema });
  }
  return globalForDb.__tradeDisciplineDb;
}

/**
 * 自动建表初始化 (确保在本地开发、CI 或首次运行时无痛启动)
 */
export async function ensureDbReady(): Promise<Database> {
  const db = getDb();
  if (!globalForDb.__dbInitialized) {
    globalForDb.__dbInitialized = (async () => {
      const client = globalForDb.__tradeDisciplineClient;
      if (!client) return;

      // 幂等创建数据表
      await client.batch([
        `CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          access_code_hash TEXT NOT NULL UNIQUE,
          total_capital REAL NOT NULL DEFAULT 100000,
          rule_config_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS positions (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          name TEXT NOT NULL,
          market TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          initial_stop_price REAL NOT NULL,
          ma_type TEXT NOT NULL DEFAULT 'EMA',
          ma_period INTEGER NOT NULL DEFAULT 20,
          confirm_days INTEGER NOT NULL DEFAULT 1,
          manual_stop_price REAL,
          max_stage INTEGER NOT NULL DEFAULT 0,
          stage3_trimmed INTEGER NOT NULL DEFAULT 0,
          target_price REAL,
          acceleration_locked INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id)
        )`,
        `CREATE TABLE IF NOT EXISTS lots (
          id TEXT PRIMARY KEY,
          position_id TEXT NOT NULL,
          type TEXT NOT NULL,
          date TEXT NOT NULL,
          price REAL NOT NULL,
          shares INTEGER NOT NULL,
          stop_price REAL NOT NULL,
          risk_percent REAL NOT NULL DEFAULT 1.0,
          notes TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (position_id) REFERENCES positions(id)
        )`,
        `CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY,
          position_id TEXT NOT NULL,
          date TEXT NOT NULL,
          close_price REAL NOT NULL,
          high_price REAL NOT NULL,
          cost_price REAL NOT NULL,
          max_gain_ratio REAL NOT NULL,
          stage INTEGER NOT NULL,
          hard_line_price REAL NOT NULL,
          hard_line_distance_percent REAL NOT NULL,
          ma_value REAL NOT NULL,
          soft_line_price REAL NOT NULL,
          soft_line_triggered INTEGER NOT NULL DEFAULT 0,
          consecutive_trigger_days INTEGER NOT NULL DEFAULT 0,
          next_action TEXT NOT NULL,
          action_reason TEXT NOT NULL,
          data_source TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (position_id) REFERENCES positions(id)
        )`,
        `CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          position_id TEXT NOT NULL,
          exit_date TEXT NOT NULL,
          exit_price REAL NOT NULL,
          shares INTEGER NOT NULL,
          trigger_reason TEXT NOT NULL,
          pnl_amount REAL NOT NULL,
          pnl_ratio REAL NOT NULL,
          r_multiple REAL NOT NULL,
          max_gain_ratio REAL NOT NULL,
          giveback_ratio REAL NOT NULL,
          notes TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (position_id) REFERENCES positions(id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id)`,
        `CREATE INDEX IF NOT EXISTS idx_lots_position ON lots(position_id)`,
        `CREATE INDEX IF NOT EXISTS idx_snapshots_position ON snapshots(position_id)`,
        `CREATE INDEX IF NOT EXISTS idx_trades_position ON trades(position_id)`,
      ]);
    })().catch((err) => {
      globalForDb.__dbInitialized = undefined;
      console.error("Database initialization failed:", err);
      throw err;
    });
  }
  await globalForDb.__dbInitialized;
  return db;
}

export { schema };
