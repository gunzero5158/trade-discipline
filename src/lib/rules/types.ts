export type MarketRegion = "a-share" | "hong-kong" | "united-states" | "japan";

export type PositionStatus = "open" | "closed";

export type LotType = "initial" | "add";

export type MovingAverageType = "EMA" | "MA";

export type ActionType =
  | "SELL_ALL_HARD_STOP"       // 今天收盘已破明天硬线：明日开盘全部卖出 (红色警报)
  | "SELL_ALL_SOFT_LINE"       // 软线跌破满足确认天数：明日开盘全部卖出 (红色警报)
  | "TRIM_ONE_THIRD"           // 首次进入阶段 3：明日开盘卖出 1/3 (橙色提示)
  | "HOLD_PENDING_CONFIRM"     // 软线今日跌破但未满足连续确认天数：继续持有，明日收盘再看一次 (黄色预警)
  | "HOLD";                    // 正常持有，显示硬线价格 (绿色/正常)

export type TradeTriggerReason =
  | "hard-line"
  | "soft-line"
  | "stage3-trim"
  | "manual";

export interface Lot {
  id: string;
  positionId: string;
  type: LotType;
  date: string;              // YYYY-MM-DD
  price: number;             // 买入价格
  shares: number;            // 股数
  stopPrice: number;         // 该笔初始止损价
  riskPercent: number;       // 该笔风险比例 (例如 1.0, 0.5, 0.25)
  notes?: string | null;
}

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  market: MarketRegion;
  status: PositionStatus;
  initialStopPrice: number;   // 首仓初始止损价
  maType: MovingAverageType;  // EMA 或 MA
  maPeriod: number;           // 均线周期 (默认 20，可自选 5/10/20/30/60/120)
  confirmDays: number;        // 软线跌破确认天数 (默认 1 天)
  manualStopPrice?: number | null; // 人工手动上调硬线
  maxStage: number;           // 历史已达最高阶段 (0, 1, 2, 3)，永不降级保证
  stage3Trimmed: boolean;     // 阶段 3 是否已执行卖出 1/3 落袋，避免每日重复提示
  targetPrice?: number | null;// 自定义目标止盈/减仓位
  accelerationLocked?: boolean;// 加速段锁定 5 日线
  notes?: string | null;
  lots: Lot[];
  createdAt: string;
  updatedAt: string;
}

export interface DailySnapshot {
  id?: string;
  positionId: string;
  date: string;               // YYYY-MM-DD
  closePrice: number;
  highPrice: number;          // 持仓以来最高价
  costPrice: number;          // 加权平均成本
  maxGainRatio: number;       // 最高浮盈比例
  currentGainRatio: number;   // 当前浮盈比例
  stage: number;              // 当前阶段 (0: 初始, 1: 保本, 2: 跟踪, 3: 落袋)
  stageName: string;
  hardLinePrice: number;      // 明日硬线价格
  hardLineDistancePercent: number; // 明日硬线距今收盘百分比 ((close - hardLine) / close)
  currentHardLineViolated: boolean; // 今日收盘是否低于明日硬线
  maType: MovingAverageType;
  maPeriod: number;
  maValue: number;            // 今日对应均线值
  margin: number;             // 振幅余量比例 (例如 0.015 即 1.5%)
  softLinePrice: number;      // 软线价格 (maValue * (1 - margin))
  softLineTriggered: boolean; // 今日收盘是否跌破软线
  consecutiveTriggerDays: number; // 连续跌破天数
  nextAction: ActionType;
  actionReason: string;
  accelerationMode: boolean;  // 是否进入加速段 (5 日线)
  dataSource?: string;
}

export interface TradeRecord {
  id: string;
  positionId: string;
  symbol: string;
  name: string;
  exitDate: string;           // 出场日期
  exitPrice: number;          // 出场价格
  shares: number;             // 出场股数
  triggerReason: TradeTriggerReason;
  pnlAmount: number;          // 盈亏金额
  pnlRatio: number;           // 盈亏比例
  rMultiple: number;          // 该笔交易折合 R 倍数
  maxGainRatio: number;       // 持仓期间最高浮盈
  givebackRatio: number;      // 吐回比例 (最高浮盈 - 实际落袋浮盈)
  notes?: string | null;
  createdAt: string;
}

export interface RuleConfig {
  totalCapital: number;       // 账户总资金 (例如 100,000)
  defaultRiskPercent: number; // 单笔首仓风险比例 (默认 1.0%)
  maxPositionPercent: number; // 单只股票最大仓位上限 (默认 25.0%)
  maxPortfolioRiskPercent: number; // 总持仓未实现风险上限闸 (默认 5.0%)
  stage1Threshold: number;    // 阶段 1 进入门槛 (默认 0.05 即 +5%)
  stage1HardLineGain: number; // 阶段 1 硬线浮盈比例 (默认 0.02 即成本 +2%)
  stage2Threshold: number;    // 阶段 2 进入门槛 (默认 0.10 即 +10%)
  stage2GivebackRatio: number;// 阶段 2 回撤比例 (默认 0.50 即回撤 50%，锁住 50%)
  stage3Threshold: number;    // 阶段 3 进入门槛 (默认 0.20 即 +20%)
  stage3GivebackRatio: number;// 阶段 3 回撤比例 (默认 0.40 即回撤 40%，锁住 60%)
  stage3TrimRatio: number;    // 阶段 3 减仓比例 (默认 1/3)
  amplitudePeriod: number;    // 计算平均振幅的 K 线天数 (默认 20 日)
  marginMultiplier: number;   // 振幅折算余量乘数 (默认 0.5)
  accelerationMaDistance: number; // 加速段偏离均线门槛 (默认 0.08 即高于 10 日线 8%)
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  totalCapital: 100000,
  defaultRiskPercent: 1.0,
  maxPositionPercent: 25.0,
  maxPortfolioRiskPercent: 5.0,
  stage1Threshold: 0.05,
  stage1HardLineGain: 0.02,
  stage2Threshold: 0.10,
  stage2GivebackRatio: 0.50,
  stage3Threshold: 0.20,
  stage3GivebackRatio: 0.40,
  stage3TrimRatio: 1 / 3,
  amplitudePeriod: 20,
  marginMultiplier: 0.5,
  accelerationMaDistance: 0.08,
};

export type { MonthlyStatsResult } from "./stats";
