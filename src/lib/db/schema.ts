import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accessCodeHash: text("access_code_hash").notNull().unique(),
  totalCapital: real("total_capital").notNull().default(100000),
  ruleConfigJson: text("rule_config_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const positions = sqliteTable("positions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull(), // 'a-share' | 'hong-kong' | 'united-states' | 'japan'
  status: text("status").notNull().default("open"), // 'open' | 'closed'
  initialStopPrice: real("initial_stop_price").notNull(),
  maType: text("ma_type").notNull().default("EMA"), // 'EMA' | 'MA'
  maPeriod: integer("ma_period").notNull().default(20),
  confirmDays: integer("confirm_days").notNull().default(1),
  manualStopPrice: real("manual_stop_price"),
  maxStage: integer("max_stage").notNull().default(0), // Bug 1 修复：永不降级保证
  stage3Trimmed: integer("stage3_trimmed").notNull().default(0), // Bug 2 修复：已落袋标记 0/1
  targetPrice: real("target_price"),
  accelerationLocked: integer("acceleration_locked").notNull().default(0),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const lots = sqliteTable("lots", {
  id: text("id").primaryKey(),
  positionId: text("position_id").notNull().references(() => positions.id),
  type: text("type").notNull(), // 'initial' | 'add'
  date: text("date").notNull(), // YYYY-MM-DD
  price: real("price").notNull(),
  shares: integer("shares").notNull(),
  stopPrice: real("stop_price").notNull(),
  riskPercent: real("risk_percent").notNull().default(1.0),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
});

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  positionId: text("position_id").notNull().references(() => positions.id),
  date: text("date").notNull(), // YYYY-MM-DD
  closePrice: real("close_price").notNull(),
  highPrice: real("high_price").notNull(),
  costPrice: real("cost_price").notNull(),
  maxGainRatio: real("max_gain_ratio").notNull(),
  stage: integer("stage").notNull(),
  hardLinePrice: real("hard_line_price").notNull(),
  hardLineDistancePercent: real("hard_line_distance_percent").notNull(),
  maValue: real("ma_value").notNull(),
  softLinePrice: real("soft_line_price").notNull(),
  softLineTriggered: integer("soft_line_triggered").notNull().default(0),
  consecutiveTriggerDays: integer("consecutive_trigger_days").notNull().default(0),
  nextAction: text("next_action").notNull(),
  actionReason: text("action_reason").notNull(),
  dataSource: text("data_source"),
  createdAt: integer("created_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  positionId: text("position_id").notNull().references(() => positions.id),
  exitDate: text("exit_date").notNull(), // YYYY-MM-DD
  exitPrice: real("exit_price").notNull(),
  shares: integer("shares").notNull(),
  triggerReason: text("trigger_reason").notNull(), // 'hard-line' | 'soft-line' | 'stage3-trim' | 'manual'
  pnlAmount: real("pnl_amount").notNull(),
  pnlRatio: real("pnl_ratio").notNull(),
  rMultiple: real("r_multiple").notNull(),
  maxGainRatio: real("max_gain_ratio").notNull(),
  givebackRatio: real("giveback_ratio").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
});
