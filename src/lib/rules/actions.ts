import { ActionType } from "./types";

export interface DecisionInput {
  currentClosePrice: number;
  hardLinePrice: number;
  isSoftLineTriggered: boolean;
  isSoftLineConfirmed: boolean;
  stage: number;
  stage3Trimmed: boolean;
  consecutiveTriggerDays: number;
  confirmDays: number;
}

export interface DecisionResult {
  action: ActionType;
  actionReason: string;
  badgeVariant: "danger" | "warning" | "amber" | "success";
  badgeText: string;
}

/**
 * 严格按照《开发文档.md》第 3.6 节判定顺序（从上到下，命中第一条就停）：
 *
 * 1. 今天收盘已经低于明天硬线：明日开盘卖出全部（硬线已穿，应已出场，请核对）。标红
 * 2. 软线满足确认：明日开盘卖出全部。标红
 * 3. 首次进入阶段 3 且未 trimmed：明日开盘卖出三分之一，剩余继续跟踪。标橙
 * 4. 软线今天触发但未满确认天数：继续持有，明日收盘再看一次。标黄
 * 5. 其他：继续持有，显示硬线价格。标绿
 */
export function determineNextAction(input: DecisionInput): DecisionResult {
  // 1. 硬线穿透 (盘中已到或收盘跌破硬线)
  if (input.currentClosePrice < input.hardLinePrice) {
    return {
      action: "SELL_ALL_HARD_STOP",
      actionReason: "收盘低于明日硬线，硬线已穿，应已出场，请核对。明日开盘全部卖出！",
      badgeVariant: "danger",
      badgeText: "明日开盘卖出 (破硬线)",
    };
  }

  // 2. 软线确认 (趋势破位)
  if (input.isSoftLineConfirmed) {
    return {
      action: "SELL_ALL_SOFT_LINE",
      actionReason: `软线跌破已连续 ${input.consecutiveTriggerDays} 天，满足确认条件。趋势转弱，明日开盘全部卖出！`,
      badgeVariant: "danger",
      badgeText: "明日开盘卖出 (破软线)",
    };
  }

  // 3. 首次进入阶段 3 减仓 1/3 (Bug 2 修复：依赖 stage3Trimmed 标记，未处理则提示，处理后不再重复)
  if (input.stage >= 3 && !input.stage3Trimmed) {
    return {
      action: "TRIM_ONE_THIRD",
      actionReason: "浮盈达到 20% 首次进入阶段 3。明日开盘卖出 1/3 落袋锁定确定性收益，剩余仓位继续跟踪。",
      badgeVariant: "amber",
      badgeText: "明日开盘卖出 1/3 落袋",
    };
  }

  // 4. 软线今日触发但未满确认天数
  if (input.isSoftLineTriggered && !input.isSoftLineConfirmed) {
    return {
      action: "HOLD_PENDING_CONFIRM",
      actionReason: `今日收盘跌破均线软线 (第 ${input.consecutiveTriggerDays}/${input.confirmDays} 天)，尚未满足确认天数。继续持有，明日收盘再看一次。`,
      badgeVariant: "warning",
      badgeText: "继续持有 (等明日收盘确认)",
    };
  }

  // 5. 正常持有
  return {
    action: "HOLD",
    actionReason: "处于安全运行区间，硬线与均线均未跌破。继续持有，严格盯住明日硬线。",
    badgeVariant: "success",
    badgeText: "继续持有",
  };
}
