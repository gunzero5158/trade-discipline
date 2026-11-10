"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Download,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Percent,
  Calendar,
  Filter,
} from "lucide-react";
import { MonthlyStatsResult, TradeRecord } from "@/lib/rules/types";

export default function TradesPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<MonthlyStatsResult | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [selectedReason, setSelectedReason] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const fetchTradesData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trades");
      const data = await res.json();
      if (data.success && data.data) {
        setStats(data.data.stats);
        setTrades(data.data.trades);
      } else {
        setError(data.error || "获取交易日志失败");
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTradesData();
  }, []);

  const filteredTrades = trades.filter((t) => {
    if (selectedReason === "all") return true;
    return t.triggerReason === selectedReason;
  });

  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case "hard-line":
        return <span className="text-[11px] px-2 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-800">破硬线出场</span>;
      case "soft-line":
        return <span className="text-[11px] px-2 py-0.5 rounded bg-orange-950/80 text-orange-300 border border-orange-800">破软线确认</span>;
      case "stage3-trim":
        return <span className="text-[11px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800">阶段3落袋1/3</span>;
      default:
        return <span className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">手动平仓</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题与导出 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            交易日志与纪律复盘
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            严密核算每笔平仓的 R 倍数与最高浮盈吐回比例。对照《交易纪律》三大检查点自动复盘诊断。
          </p>
        </div>

        <a
          href="/api/trades?format=csv"
          download
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-medium text-gray-200 transition-colors w-fit"
        >
          <Download className="w-4 h-4 text-emerald-400" />
          <span>导出完整 CSV 账本</span>
        </a>
      </div>

      {/* 统计指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* 卡片 1: 胜率 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">总胜率 (已平 {stats?.totalTrades ?? 0} 笔)</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {stats ? `${(stats.winRate * 100).toFixed(1)}%` : "—"}
            </span>
            <span className="text-xs text-gray-400">
              ({stats?.winTrades}赢 / {stats?.lossTrades}输)
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">基准假设: 55%</p>
        </div>

        {/* 卡片 2: 平均盈亏比 (赢单R vs 输单R) */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">平均赢单 / 输单 R 数</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-bold font-mono text-emerald-400">
              +{stats?.avgWinR.toFixed(2) ?? "0"}R
            </span>
            <span className="text-gray-500">/</span>
            <span className="text-lg font-bold font-mono text-red-400">
              -{stats?.avgLossR.toFixed(2) ?? "0"}R
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">目标: 赢 2.5R / 输 1.0R</p>
        </div>

        {/* 卡片 3: 每笔期望 R */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">每笔数学期望 R</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                (stats?.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(stats?.expectancyR ?? 0) >= 0 ? `+${stats?.expectancyR}R` : `${stats?.expectancyR}R`}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {(stats?.expectancyR ?? 0) > 0 ? "正期望系统" : "需调优胜率或盈亏比"}
          </p>
        </div>

        {/* 卡片 4: 累计已实现盈亏 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">累计已实现盈亏</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                (stats?.totalPnLAmount ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {(stats?.totalPnLAmount ?? 0) >= 0
                ? `+¥${stats?.totalPnLAmount.toLocaleString()}`
                : `-¥${Math.abs(stats?.totalPnLAmount ?? 0).toLocaleString()}`}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono text-gray-400">
            累计: <span className="font-bold">{(stats?.totalR ?? 0) >= 0 ? `+${stats?.totalR}R` : `${stats?.totalR}R`}</span>
          </p>
        </div>

        {/* 卡片 5: 最大连亏 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">最大连亏 / 连赢</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-amber-400">
              {stats?.maxConsecutiveLosses ?? 0} 连亏
            </span>
            <span className="text-xs text-gray-500">/ {stats?.maxConsecutiveWins ?? 0} 连赢</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">单笔 1% 连亏5把掉5%</p>
        </div>
      </div>

      {/* 纪律自动诊断警报 Banner */}
      {stats && stats.diagnostics && stats.diagnostics.length > 0 && (
        <div className="space-y-3">
          {stats.diagnostics.map((diag, idx) => {
            const isError = diag.type === "error";
            const isWarning = diag.type === "warning";
            const isSuccess = diag.type === "success";

            return (
              <div
                key={idx}
                className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
                  isError
                    ? "bg-red-950/60 border-red-800 text-red-200"
                    : isWarning
                    ? "bg-amber-950/60 border-amber-800 text-amber-200"
                    : isSuccess
                    ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                    : "bg-gray-800 border-gray-700 text-gray-300"
                }`}
              >
                {isError ? (
                  <AlertTriangle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
                ) : isWarning ? (
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
                )}
                <div>
                  <h4 className="font-bold text-sm mb-0.5">{diag.title}</h4>
                  <p>{diag.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 过滤筛选条 */}
      <div className="flex items-center gap-2 bg-gray-900/60 p-3 rounded-xl border border-gray-800">
        <Filter className="w-4 h-4 text-gray-500 ml-1" />
        <span className="text-xs text-gray-400">出场原因过滤:</span>
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          {[
            { id: "all", label: "全部记录" },
            { id: "hard-line", label: "破硬线" },
            { id: "soft-line", label: "破软线" },
            { id: "stage3-trim", label: "阶段3落袋1/3" },
            { id: "manual", label: "手动平仓" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedReason(tab.id)}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                selectedReason === tab.id
                  ? "bg-emerald-600 text-white font-semibold"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 交易列表 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
          <h3 className="text-base font-bold text-white">平仓交易明细</h3>
          <span className="text-xs text-gray-400">共 {filteredTrades.length} 条</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500 text-sm">加载交易记录...</div>
        ) : filteredTrades.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-xs">
            暂无平仓交易记录。在持仓中执行“平仓”或“卖 1/3 落袋”后将自动记录到此。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-800/50 text-gray-400 uppercase text-[11px] border-b border-gray-800">
                <tr>
                  <th className="py-3 px-4">出场日期</th>
                  <th className="py-3 px-4">代码/名称</th>
                  <th className="py-3 px-4">平仓价格</th>
                  <th className="py-3 px-4">平仓股数</th>
                  <th className="py-3 px-4">出场原因</th>
                  <th className="py-3 px-4">盈亏金额</th>
                  <th className="py-3 px-4">盈亏比例</th>
                  <th className="py-3 px-4">折合 R 倍数</th>
                  <th className="py-3 px-4">最高浮盈</th>
                  <th className="py-3 px-4">吐回比例</th>
                  <th className="py-3 px-4">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredTrades.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-800/40 font-mono">
                    <td className="py-3 px-4 text-gray-400">{t.exitDate}</td>
                    <td className="py-3 px-4 font-sans">
                      <div className="font-bold text-white">{t.name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{t.symbol}</div>
                    </td>
                    <td className="py-3 px-4 text-white font-bold">¥{t.exitPrice.toFixed(2)}</td>
                    <td className="py-3 px-4 text-gray-300">{t.shares.toLocaleString()}</td>
                    <td className="py-3 px-4 font-sans">{getReasonBadge(t.triggerReason)}</td>
                    <td
                      className={`py-3 px-4 font-bold ${
                        t.pnlAmount >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.pnlAmount >= 0 ? `+¥${t.pnlAmount.toFixed(2)}` : `-¥${Math.abs(t.pnlAmount).toFixed(2)}`}
                    </td>
                    <td
                      className={`py-3 px-4 font-bold ${
                        t.pnlRatio >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.pnlRatio >= 0 ? `+${(t.pnlRatio * 100).toFixed(2)}%` : `${(t.pnlRatio * 100).toFixed(2)}%`}
                    </td>
                    <td
                      className={`py-3 px-4 text-sm font-bold ${
                        t.rMultiple >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.rMultiple >= 0 ? `+${t.rMultiple.toFixed(2)}R` : `${t.rMultiple.toFixed(2)}R`}
                    </td>
                    <td className="py-3 px-4 text-gray-400">
                      +{(t.maxGainRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-amber-400">
                      -{(t.givebackRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 font-sans text-gray-400 text-[11px]">
                      {t.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
