import { and, desc, eq } from "drizzle-orm";
import { Database, schema } from "../db";
import { fetchDailyCandles } from "../market/client";
import { isLastBarLive } from "../market/session";
import { evaluatePositionRules } from "../rules/engine";
import { DailySnapshot, Lot, MarketRegion, MovingAverageType, Position as RulePosition, RuleConfig } from "../rules/types";

type PositionRow = typeof schema.positions.$inferSelect;
type LotRow = typeof schema.lots.$inferSelect;
export type SnapshotRow = typeof schema.snapshots.$inferSelect;

// 一次拉多少根日线：要够算 120 日均线并留出振幅/加速段的历史
export const CANDLE_LIMIT = 250;

export function toLot(row: LotRow): Lot {
  return {
    id: row.id,
    positionId: row.positionId,
    type: row.type as Lot["type"],
    date: row.date,
    price: row.price,
    shares: row.shares,
    stopPrice: row.stopPrice,
    riskPercent: row.riskPercent,
    notes: row.notes,
  };
}

export function toRulePosition(row: PositionRow, lots: Lot[]): RulePosition {
  return {
    id: row.id,
    accountId: row.accountId,
    symbol: row.symbol,
    name: row.name,
    market: row.market as MarketRegion,
    status: row.status as RulePosition["status"],
    initialStopPrice: row.initialStopPrice,
    maType: row.maType as MovingAverageType,
    maPeriod: row.maPeriod,
    confirmDays: row.confirmDays,
    manualStopPrice: row.manualStopPrice,
    maxStage: row.maxStage,
    stage3Trimmed: !!row.stage3Trimmed,
    targetPrice: row.targetPrice,
    accelerationLocked: !!row.accelerationLocked,
    notes: row.notes,
    lots,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function getLatestSnapshot(db: Database, positionId: string): Promise<SnapshotRow | null> {
  const rows = await db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.positionId, positionId))
    .orderBy(desc(schema.snapshots.date), desc(schema.snapshots.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export interface EvaluateOptions {
  dataSource: string;
  config?: RuleConfig;
}

export interface EvaluateResult {
  snapshot: DailySnapshot;
  /** 最后一根 K 线还在盘中：规则按前一收盘算，盘中价只用于硬线触碰提示，不落库 */
  isIntraday: boolean;
  persisted: boolean;
}

/**
 * 拉行情 → 跑规则引擎 → (收盘后) 落快照并更新持仓状态。
 * 所有需要"重新算一遍"的入口 (看板刷新、建仓、改规则、加仓、定时任务) 都走这里。
 */
export async function evaluateAndSnapshot(
  db: Database,
  posRow: PositionRow,
  lotRows: LotRow[],
  opts: EvaluateOptions
): Promise<EvaluateResult> {
  const lots = lotRows.map(toLot);
  const position = toRulePosition(posRow, lots);

  const candles = await fetchDailyCandles(position.symbol, CANDLE_LIMIT);
  if (candles.length === 0) {
    throw new Error(`No candles returned for ${position.symbol}`);
  }

  const lastBar = candles[candles.length - 1];
  const isIntraday = isLastBarLive(position.market, lastBar.date);
  const closedCandles = isIntraday ? candles.slice(0, -1) : candles;
  if (closedCandles.length === 0) {
    throw new Error(`Only an in-progress bar is available for ${position.symbol}`);
  }

  const latest = await getLatestSnapshot(db, posRow.id);
  const yesterdayHardLine = latest?.hardLinePrice ?? posRow.initialStopPrice;

  const snapshot = evaluatePositionRules({
    position,
    candles: closedCandles,
    yesterdayHardLine,
    intradayPrice: isIntraday ? lastBar.close : null,
    config: opts.config,
  });
  snapshot.dataSource = isIntraday ? `${opts.dataSource}-intraday` : opts.dataSource;

  if (isIntraday) {
    return { snapshot, isIntraday, persisted: false };
  }

  // 同一持仓同一天只保留一条：先删同日旧行再插
  await db
    .delete(schema.snapshots)
    .where(and(eq(schema.snapshots.positionId, posRow.id), eq(schema.snapshots.date, snapshot.date)));

  const now = Date.now();
  await db.insert(schema.snapshots).values({
    id: `snap_${now}_${Math.random().toString(36).substring(2, 6)}`,
    positionId: posRow.id,
    date: snapshot.date,
    closePrice: snapshot.closePrice,
    highPrice: snapshot.highPrice,
    costPrice: snapshot.costPrice,
    maxGainRatio: snapshot.maxGainRatio,
    stage: snapshot.stage,
    hardLinePrice: snapshot.hardLinePrice,
    hardLineDistancePercent: snapshot.hardLineDistancePercent,
    maValue: snapshot.maValue,
    softLinePrice: snapshot.softLinePrice,
    softLineTriggered: snapshot.softLineTriggered ? 1 : 0,
    consecutiveTriggerDays: snapshot.consecutiveTriggerDays,
    nextAction: snapshot.nextAction,
    actionReason: snapshot.actionReason,
    dataSource: snapshot.dataSource,
    createdAt: now,
  });

  const newMaxStage = Math.max(posRow.maxStage, snapshot.stage);
  const newAccel = snapshot.accelerationMode ? 1 : 0;
  if (newMaxStage !== posRow.maxStage || newAccel !== posRow.accelerationLocked) {
    await db
      .update(schema.positions)
      .set({ maxStage: newMaxStage, accelerationLocked: newAccel, updatedAt: now })
      .where(eq(schema.positions.id, posRow.id));
    posRow.maxStage = newMaxStage;
    posRow.accelerationLocked = newAccel;
  }

  return { snapshot, isIntraday, persisted: true };
}
