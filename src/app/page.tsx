"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Plus,
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  ChevronRight,
  SlidersHorizontal,
  Flame,
  Search,
} from "lucide-react";
import CloseModal from "@/components/CloseModal";
import AddModal from "@/components/AddModal";

interface PositionItem {
  position: {
    id: string;
    symbol: string;
    name: string;
    market: string;
    initialStopPrice: number;
    maType: string;
    maPeriod: number;
    confirmDays: number;
    maxStage: number;
    stage3Trimmed: number;
  };
  lots: Array<{
    id: string;
    type: string;
    price: number;
    shares: number;
    stopPrice: number;
  }>;
  totalShares: number;
  weightedCost: number;
  totalCostAmount: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedRatio: number;
  unrealizedR: number;
  unreleasedRisk: number;
  snapshot: {
    id: string;
    date: string;
    closePrice: number;
    costPrice: number;
    maxGainRatio: number;
    stage: number;
    hardLinePrice: number;
    hardLineDistancePercent: number;
    maValue: number;
    softLinePrice: number;
    softLineTriggered: number;
    consecutiveTriggerDays: number;
    nextAction: string;
    actionReason: string;
  } | null;
  intraday: { price: number; hardLineHit: boolean } | null;
  isStale: boolean;
}

interface DashboardSummary {
  totalCapital: number;
  totalOpenRiskAmount: number;
  totalOpenRiskPercent: number;
  totalUnrealizedPnL: number;
  totalUnrealizedR: number;
  thisMonthRealizedPnL: number;
  thisMonthRealizedR: number;
  openPositionsCount: number;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [items, setItems] = useState<PositionItem[]>([]);
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // 弹窗状态
  const [closeTarget, setCloseTarget] = useState<PositionItem | null>(null);
  const [addTarget, setAddTarget] = useState<PositionItem | null>(null);

  const fetchDashboardData = async (refresh: boolean = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/positions${refresh ? "?refresh=true" : ""}`);
      const data = await res.json();
      if (data.success && data.data) {
        setSummary(data.data.summary);
        setItems(data.data.items);
      } else {
        setError(data.error || "获取持仓看板失败");
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(false);
  }, []);

  const filteredItems = items.filter((item) => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.position.symbol.toLowerCase().includes(q) ||
      item.position.name.toLowerCase().includes(q)
    );
  });

  // 动作徽标渲染辅助函数
  const renderActionBadge = (action: string | undefined, isViolated: boolean) => {
    if (isViolated || action === "SELL_ALL_HARD_STOP") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-red-950/80 text-red-300 border border-red-700 animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          明日开盘全卖 (破硬线)
        </span>
      );
    }
    if (action === "SELL_ALL_SOFT_LINE") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-red-950/80 text-red-300 border border-red-700">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          明日开盘全卖 (破软线确认)
        </span>
      );
    }
    if (action === "TRIM_ONE_THIRD") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-950/80 text-amber-300 border border-amber-600">
          <Flame className="w-3.5 h-3.5 text-amber-400" />
          明日开盘卖 1/3 落袋
        </span>
      );
    }
    if (action === "HOLD_PENDING_CONFIRM") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-yellow-950/70 text-yellow-300 border border-yellow-700">
          继续持有 (等明日收盘确认)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800">
        继续持有 (严格盯紧硬线)
      </span>
    );
  };

  const getStageBadge = (stage: number) => {
    switch (stage) {
      case 0:
        return <span className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">阶段0·初始</span>;
      case 1:
        return <span className="text-[11px] px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800">阶段1·保本</span>;
      case 2:
        return <span className="text-[11px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800">阶段2·跟踪</span>;
      case 3:
        return <span className="text-[11px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800">阶段3·落袋</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部风控总览卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 卡片 1: 账户总资金与在手持仓 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 relative overflow-hidden">
          <span className="text-xs text-gray-400 font-medium">账户总资金</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              ¥{summary?.totalCapital.toLocaleString() || "100,000"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            活跃持仓: <span className="text-gray-300 font-semibold">{summary?.openPositionsCount ?? 0}</span> 只
          </p>
        </div>

        {/* 卡片 2: 总持仓风险闸 (≤5%) */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-xs text-gray-400 font-medium">未实现风险敞口</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
              上限 5.0%
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                (summary?.totalOpenRiskPercent ?? 0) > 5.0 ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {summary?.totalOpenRiskPercent ?? 0}%
            </span>
            <span className="text-xs text-gray-400 font-mono">
              (¥{summary?.totalOpenRiskAmount?.toLocaleString() ?? 0})
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {(summary?.totalOpenRiskPercent ?? 0) > 5.0 ? "⚠️ 风险超闸，禁止新开仓" : "处于安全风控水位"}
          </p>
        </div>

        {/* 卡片 3: 在手持仓浮动盈亏 (三位一体) */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400 font-medium">持仓总浮动盈亏</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                (summary?.totalUnrealizedPnL ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(summary?.totalUnrealizedPnL ?? 0) >= 0
                ? `+¥${summary?.totalUnrealizedPnL?.toLocaleString()}`
                : `-¥${Math.abs(summary?.totalUnrealizedPnL ?? 0).toLocaleString()}`}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono text-gray-400 flex items-center gap-1.5">
            <span>总折算:</span>
            <span
              className={`font-bold ${
                (summary?.totalUnrealizedR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(summary?.totalUnrealizedR ?? 0) >= 0 ? `+${summary?.totalUnrealizedR}R` : `${summary?.totalUnrealizedR}R`}
            </span>
          </p>
        </div>

        {/* 卡片 4: 本月已实现盈亏 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400 font-medium">当月已实现盈亏</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                (summary?.thisMonthRealizedPnL ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(summary?.thisMonthRealizedPnL ?? 0) >= 0
                ? `+¥${summary?.thisMonthRealizedPnL?.toLocaleString()}`
                : `-¥${Math.abs(summary?.thisMonthRealizedPnL ?? 0).toLocaleString()}`}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono text-gray-400 flex items-center gap-1.5">
            <span>当月 R 收益:</span>
            <span
              className={`font-bold ${
                (summary?.thisMonthRealizedR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(summary?.thisMonthRealizedR ?? 0) >= 0 ? `+${summary?.thisMonthRealizedR}R` : `${summary?.thisMonthRealizedR}R`}
            </span>
          </p>
        </div>
      </div>

      {/* 提示与操作条 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-900/60 p-4 rounded-xl border border-gray-800">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="搜索代码或股票名称..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-hidden focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-medium text-gray-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-emerald-400" : ""}`} />
            <span>{refreshing ? "正在拉取行情..." : "刷新最新行情与计算"}</span>
          </button>

          <Link
            href="/calculator"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>开新仓</span>
          </Link>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-200 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 持仓列表卡片 / 表格 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">持仓监控表</h2>
            <span className="text-xs text-gray-400">
              (按“距硬线百分比”由近及远排列，最危险的在最上方)
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-500" />
            加载持仓与最新计算状态...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-gray-800 text-gray-500 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-300">当前没有在手持仓</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              点击上方“开新仓”按钮，输入买入价与按图设置的止损位，工具将自动算出仓位并每天跟踪硬线。
            </p>
            <Link
              href="/calculator"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
            >
              <Plus className="w-4 h-4" />
              去开仓计算器
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-800 overflow-x-auto">
            {filteredItems.map((item) => {
              const snap = item.snapshot;
              const hardDist = snap?.hardLineDistancePercent ?? 0;
              const isViolated = hardDist <= 0 || item.currentPrice < (snap?.hardLinePrice ?? item.position.initialStopPrice);
              const initialLot = item.lots.find((l) => l.type === "initial") || item.lots[0];
              const initial1R = initialLot ? initialLot.shares * (initialLot.price - initialLot.stopPrice) : 1000;

              return (
                <div
                  key={item.position.id}
                  className={`p-4 sm:p-5 hover:bg-gray-800/40 transition-colors ${
                    isViolated ? "bg-red-950/20" : ""
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* 左侧：股票基础信息与阶段 */}
                    <div className="flex items-start gap-3 min-w-[200px]">
                      <div className="pt-0.5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/position/${item.position.id}`}
                            className="font-bold text-white hover:text-emerald-400 text-base flex items-center gap-1"
                          >
                            <span>{item.position.name}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                          </Link>
                          {getStageBadge(snap?.stage ?? item.position.maxStage)}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                          <span className="font-mono">{item.position.symbol}</span>
                          <span>·</span>
                          <span>持仓 {item.totalShares} 股</span>
                          {item.lots.length > 1 && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-800">
                              含加仓 {item.lots.length - 1} 笔
                            </span>
                          )}
                          {item.isStale && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800">
                              上次快照
                            </span>
                          )}
                          {item.intraday && !item.intraday.hardLineHit && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-950/80 text-sky-300 border border-sky-800">
                              盘中 ¥{item.intraday.price.toFixed(2)}，规则按上一收盘算
                            </span>
                          )}
                          {item.intraday?.hardLineHit && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-950/80 text-red-300 border border-red-800 font-bold">
                              盘中 ¥{item.intraday.price.toFixed(2)} 已低于硬线，立即执行
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 中间：行情与盈亏三位一体并列展示 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs flex-1">
                      <div>
                        <span className="text-gray-500 block">{item.intraday ? "盘中价 / 成本" : "最新收盘 / 成本"}</span>
                        <div className="font-mono mt-0.5 font-bold text-white">
                          ¥{item.currentPrice.toFixed(2)}
                          <span className="text-gray-400 text-[11px] font-normal block">
                            均价 ¥{item.weightedCost.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-gray-500 block">浮动盈亏 (三位一体)</span>
                        <div
                          className={`font-mono font-bold mt-0.5 ${
                            item.unrealizedPnL >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {item.unrealizedPnL >= 0 ? `+¥${item.unrealizedPnL.toFixed(0)}` : `-¥${Math.abs(item.unrealizedPnL).toFixed(0)}`}
                          <span className="text-[11px] block font-medium">
                            {item.unrealizedRatio >= 0 ? `+${(item.unrealizedRatio * 100).toFixed(2)}%` : `${(item.unrealizedRatio * 100).toFixed(2)}%`}
                            {" | "}
                            {item.unrealizedR >= 0 ? `+${item.unrealizedR.toFixed(1)}R` : `${item.unrealizedR.toFixed(1)}R`}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-gray-500 block">明日硬线 (只升不降)</span>
                        <div className="font-mono mt-0.5">
                          <span className="text-sm font-bold text-amber-400">
                            ¥{snap?.hardLinePrice?.toFixed(2) ?? item.position.initialStopPrice.toFixed(2)}
                          </span>
                          <span
                            className={`text-[11px] block font-semibold ${
                              hardDist < 0.03 ? "text-red-400" : "text-gray-400"
                            }`}
                          >
                            距今 {(hardDist * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-gray-500 block">
                          软线 ({item.position.maType}{item.position.maPeriod})
                        </span>
                        <div className="font-mono mt-0.5 text-gray-300">
                          <span>¥{snap?.softLinePrice?.toFixed(2) ?? "—"}</span>
                          <span className="text-[11px] block text-gray-400">
                            {snap?.softLineTriggered
                              ? `已跌破 ${snap.consecutiveTriggerDays}/${item.position.confirmDays} 天`
                              : "运行在均线上方"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 右侧：明日动作结论与操作按钮 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between lg:justify-end gap-3 min-w-[240px]">
                      <div className="shrink-0">
                        {renderActionBadge(snap?.nextAction, isViolated)}
                        <p className="text-[11px] text-gray-400 max-w-[220px] mt-1 line-clamp-1" title={snap?.actionReason}>
                          {snap?.actionReason || "跟踪硬线"}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setAddTarget(item)}
                          className="px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors"
                        >
                          加仓
                        </button>
                        <button
                          onClick={() => setCloseTarget(item)}
                          className="px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors"
                        >
                          平仓
                        </button>
                        <Link
                          href={`/position/${item.position.id}`}
                          className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                          title="查看走势图与详细规则"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 平仓弹窗 */}
      {closeTarget && (
        <CloseModal
          positionId={closeTarget.position.id}
          symbol={closeTarget.position.symbol}
          name={closeTarget.position.name}
          currentPrice={closeTarget.currentPrice}
          weightedCost={closeTarget.weightedCost}
          totalShares={closeTarget.totalShares}
          initial1R={(() => {
            const initLot = closeTarget.lots.find((l) => l.type === "initial") || closeTarget.lots[0];
            return initLot ? (initLot.price - initLot.stopPrice) * initLot.shares : 1000;
          })()}
          suggestedAction={closeTarget.snapshot?.nextAction}
          onClose={() => setCloseTarget(null)}
          onSuccess={() => fetchDashboardData(true)}
        />
      )}

      {/* 加仓弹窗 */}
      {addTarget && (
        <AddModal
          positionId={addTarget.position.id}
          symbol={addTarget.position.symbol}
          name={addTarget.position.name}
          market={addTarget.position.market as any}
          currentPrice={addTarget.currentPrice}
          currentHardLine={addTarget.snapshot?.hardLinePrice ?? addTarget.position.initialStopPrice}
          lots={addTarget.lots.map((l) => ({
            id: l.id,
            positionId: addTarget.position.id,
            type: l.type as any,
            date: "",
            price: l.price,
            shares: l.shares,
            stopPrice: l.stopPrice,
            riskPercent: 1.0,
          }))}
          totalCapital={summary?.totalCapital || 100000}
          onClose={() => setAddTarget(null)}
          onSuccess={() => fetchDashboardData(true)}
        />
      )}
    </div>
  );
}
