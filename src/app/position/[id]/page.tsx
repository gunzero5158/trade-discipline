"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Settings,
  LineChart,
  PlusCircle,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  Flame,
  Trash2,
  RefreshCw,
} from "lucide-react";
import StockChart from "@/components/StockChart";
import CloseModal from "@/components/CloseModal";
import AddModal from "@/components/AddModal";
import { Candle, calculateEMA, calculateSMA, calculateAverageAmplitude } from "@/lib/rules/softLine";

export default function PositionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);

  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<any>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadingCandles, setLoadingCandles] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 弹窗状态
  const [showCloseModal, setShowCloseModal] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // 单股规则自定义状态
  const [manualStopPrice, setManualStopPrice] = useState<string>("");
  const [maType, setMaType] = useState<string>("EMA");
  const [maPeriod, setMaPeriod] = useState<number>(20);
  const [confirmDays, setConfirmDays] = useState<number>(1);
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [accelerationLocked, setAccelerationLocked] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [savingRules, setSavingRules] = useState<boolean>(false);
  const [rulesSuccess, setRulesSuccess] = useState<boolean>(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions/${id}`);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        const p = json.data.position;
        setManualStopPrice(p.manualStopPrice ? String(p.manualStopPrice) : "");
        setMaType(p.maType || "EMA");
        setMaPeriod(p.maPeriod || 20);
        setConfirmDays(p.confirmDays || 1);
        setTargetPrice(p.targetPrice ? String(p.targetPrice) : "");
        setAccelerationLocked(!!p.accelerationLocked);
        setNotes(p.notes || "");

        // 异步拉取 K 线
        fetchCandles(p.symbol);
      } else {
        setError(json.error || "获取持仓详情失败");
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchCandles = async (symbol: string) => {
    setLoadingCandles(true);
    try {
      const res = await fetch(`/api/market/kline?symbol=${encodeURIComponent(symbol)}&limit=150`);
      const json = await res.json();
      if (json.success && json.data) {
        setCandles(json.data);
      }
    } catch (err) {
      console.warn("Failed to fetch candles:", err);
    } finally {
      setLoadingCandles(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  // 保存单股自定义规则
  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRules(true);
    setRulesSuccess(false);
    setRulesError(null);

    try {
      const res = await fetch(`/api/positions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualStopPrice: manualStopPrice ? parseFloat(manualStopPrice) : null,
          maType,
          maPeriod,
          confirmDays,
          targetPrice: targetPrice ? parseFloat(targetPrice) : null,
          accelerationLocked,
          notes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setRulesSuccess(true);
        setTimeout(() => setRulesSuccess(false), 3000);
        fetchDetail();
      } else {
        setRulesError(json.error || "保存失败");
      }
    } catch (err) {
      setRulesError(String(err));
    } finally {
      setSavingRules(false);
    }
  };

  // 删除持仓
  const handleDeletePosition = async () => {
    if (!confirm("确定要删除这笔持仓记录吗？对应的加仓与快照记录将被一并清除。")) return;
    try {
      const res = await fetch(`/api/positions/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        router.push("/");
      }
    } catch (err) {
      alert("删除失败: " + String(err));
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-gray-500 text-sm">加载持仓详情...</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-sm">
        {error || "持仓不存在"}
      </div>
    );
  }

  const { position: pos, lots, snapshots, summary } = data;
  const latestSnap = snapshots.length > 0 ? snapshots[0] : null;
  const currentPrice = latestSnap?.closePrice ?? summary.weightedCost;
  const hardLine = latestSnap?.hardLinePrice ?? pos.initialStopPrice;
  const hardDist = latestSnap?.hardLineDistancePercent ?? 0;
  const pnlAmount = summary.totalShares * (currentPrice - summary.weightedCost);
  const pnlRatio = summary.weightedCost > 0 ? (currentPrice - summary.weightedCost) / summary.weightedCost : 0;
  const initialLot = lots.find((l: any) => l.type === "initial") || lots[0];
  const initial1R = initialLot ? initialLot.shares * (initialLot.price - initialLot.stopPrice) : 1000;
  const pnlR = initial1R > 0 ? pnlAmount / initial1R : 0;

  // 计算均线与软线 Series 用于图表
  let maSeries: { time: string; value: number }[] = [];
  let softLineSeries: { time: string; value: number }[] = [];
  if (candles.length > 0) {
    const closes = candles.map((c) => c.close);
    const maVals = maType === "EMA" ? calculateEMA(closes, maPeriod) : calculateSMA(closes, maPeriod);
    const avgAmp = calculateAverageAmplitude(candles, 20);
    const margin = avgAmp * 0.5;

    for (let i = 0; i < candles.length; i++) {
      const t = typeof candles[i].date === "string" ? String(candles[i].date).substring(0, 10) : new Date(candles[i].date).toISOString().substring(0, 10);
      if (!isNaN(maVals[i])) {
        maSeries.push({ time: t, value: Number(maVals[i].toFixed(2)) });
        softLineSeries.push({ time: t, value: Number((maVals[i] * (1 - margin)).toFixed(2)) });
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航与操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            title="返回今日看板"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{pos.name}</h1>
              <span className="font-mono text-sm text-gray-400">({pos.symbol})</span>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800">
                阶段 {latestSnap?.stage ?? pos.maxStage}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              首仓买入: {initialLot?.date || "—"} · 持仓 {summary.totalShares} 股 · 成本 ¥{summary.weightedCost.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-semibold text-gray-200 transition-colors flex items-center gap-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>加仓</span>
          </button>
          <button
            onClick={() => setShowCloseModal(true)}
            className="px-3.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-semibold text-gray-200 transition-colors"
          >
            平仓 / 减仓
          </button>
          <button
            onClick={handleDeletePosition}
            className="p-2 rounded-lg bg-gray-800 hover:bg-red-950/60 text-gray-400 hover:text-red-400 border border-gray-700 transition-colors"
            title="删除持仓"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 卡片 1: 今收与成本 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">最新价格 / 均价</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              ¥{currentPrice.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 font-mono">
            加权成本: ¥{summary.weightedCost.toFixed(2)}
          </p>
        </div>

        {/* 卡片 2: 浮动盈亏三位一体 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">当前浮动盈亏</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                pnlAmount >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {pnlAmount >= 0 ? `+¥${pnlAmount.toFixed(0)}` : `-¥${Math.abs(pnlAmount).toFixed(0)}`}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono font-medium text-gray-400">
            {pnlRatio >= 0 ? `+${(pnlRatio * 100).toFixed(2)}%` : `${(pnlRatio * 100).toFixed(2)}%`}
            {" · "}
            <span className={pnlR >= 0 ? "text-emerald-400" : "text-red-400"}>
              {pnlR >= 0 ? `+${pnlR.toFixed(1)}R` : `${pnlR.toFixed(1)}R`}
            </span>
          </p>
        </div>

        {/* 卡片 3: 明日硬线价格 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">明日硬线 (只升不降)</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-amber-400">
              ¥{hardLine.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono text-gray-400">
            距今: <span className="font-bold">{(hardDist * 100).toFixed(1)}%</span>
            {hardDist < 0.03 && <span className="text-red-400 ml-1">⚠️ 极度危险</span>}
          </p>
        </div>

        {/* 卡片 4: 软线均线 */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400">
            软线状态 ({pos.maType}{pos.maPeriod})
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-blue-400">
              ¥{latestSnap?.softLinePrice?.toFixed(2) ?? "—"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {latestSnap?.softLineTriggered
              ? `已跌破 ${latestSnap.consecutiveTriggerDays}/${pos.confirmDays} 天`
              : "站稳在均线上方"}
          </p>
        </div>
      </div>

      {/* K 线图与均线硬线叠加 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LineChart className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">走势图叠加硬线与趋势软线</h2>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
              明日硬线 ¥{hardLine.toFixed(2)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block"></span>
              {pos.maType}{pos.maPeriod}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
              软线阈值
            </span>
          </div>
        </div>

        {loadingCandles ? (
          <div className="h-[420px] flex items-center justify-center text-gray-500 text-xs">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            正在拉取历史 K 线并绘制...
          </div>
        ) : candles.length === 0 ? (
          <div className="h-[420px] flex items-center justify-center text-gray-500 text-xs">
            行情数据暂不可用
          </div>
        ) : (
          <StockChart
            candles={candles}
            hardLinePrice={hardLine}
            maSeries={maSeries}
            maLabel={`${pos.maType}${pos.maPeriod}`}
            softLineSeries={softLineSeries}
            lots={lots}
            height={420}
          />
        )}
      </div>

      {/* 两个板块：单股纪律规则个性化微调 + 持仓明细与历史快照 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：单股纪律微调 */}
        <div className="lg:col-span-5 bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <h3 className="text-base font-bold text-white">单股纪律规则个性化定制</h3>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            不同股票股性各异（有的贴 10 日线，有的踩 60 日线）。人拥有最高决定权，可根据图形单独定制。
          </p>

          <form onSubmit={handleSaveRules} className="space-y-4 text-xs">
            <div>
              <label className="block text-gray-400 mb-1">
                人工手动上调硬线 (元，绝对禁止往下调)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder={`当前硬线为 ${hardLine.toFixed(2)} 元`}
                value={manualStopPrice}
                onChange={(e) => setManualStopPrice(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-emerald-500 focus:outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 mb-1">软线均线类型</label>
                <select
                  value={maType}
                  onChange={(e) => setMaType(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="EMA">EMA (指数平均)</option>
                  <option value="MA">MA (简单平均)</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 mb-1">均线周期 (如 10/20/60)</label>
                <input
                  type="number"
                  value={maPeriod}
                  onChange={(e) => setMaPeriod(parseInt(e.target.value, 10) || 20)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 mb-1">破位确认天数</label>
                <select
                  value={confirmDays}
                  onChange={(e) => setConfirmDays(parseInt(e.target.value, 10))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value={1}>1 天 (破即走)</option>
                  <option value={2}>连续 2 天确认</option>
                  <option value={3}>连续 3 天确认</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 mb-1">目标止盈减仓位 (可选)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="如前期强压力位"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accelerationLocked}
                  onChange={(e) => setAccelerationLocked(e.target.checked)}
                  className="rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-0"
                />
                <span className="text-gray-300">
                  开启并锁定 5 日线加速段跟踪 (主升冲顶段专用)
                </span>
              </label>
            </div>

            <div>
              <label className="block text-gray-400 mb-1">持仓备注 / 逻辑</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-white"
              />
            </div>

            {rulesError && (
              <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{rulesError}</span>
              </div>
            )}

            {rulesSuccess && (
              <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>规则已成功更新并生效！</span>
              </div>
            )}

            <button
              type="submit"
              disabled={savingRules}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition-colors cursor-pointer"
            >
              {savingRules ? "正在保存..." : "保存个性化规则"}
            </button>
          </form>
        </div>

        {/* 右侧：持仓明细 Lots 表格与快照历史 */}
        <div className="lg:col-span-7 space-y-6">
          {/* 持仓批次明细 */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              持仓批次明细 (Lots)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-800/60 text-gray-400 uppercase text-[11px] border-b border-gray-800">
                  <tr>
                    <th className="py-2.5 px-3">类型</th>
                    <th className="py-2.5 px-3">买入日期</th>
                    <th className="py-2.5 px-3">买入价</th>
                    <th className="py-2.5 px-3">股数</th>
                    <th className="py-2.5 px-3">该笔止损位</th>
                    <th className="py-2.5 px-3">风险额度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 font-mono">
                  {lots.map((l: any) => (
                    <tr key={l.id} className="hover:bg-gray-800/40">
                      <td className="py-2.5 px-3 font-sans">
                        {l.type === "initial" ? (
                          <span className="text-emerald-400 font-semibold">首仓</span>
                        ) : (
                          <span className="text-purple-400 font-semibold">加仓</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-gray-400">{l.date}</td>
                      <td className="py-2.5 px-3 text-white font-bold">¥{l.price.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-gray-300">{l.shares.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-amber-400">¥{l.stopPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-gray-400">{l.riskPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 每日快照记录 (最近 10 条) */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              每日快照历史 (留痕记录)
            </h3>
            {snapshots.length === 0 ? (
              <p className="text-xs text-gray-500">尚无快照历史</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-800/60 text-gray-400 uppercase text-[11px] border-b border-gray-800">
                    <tr>
                      <th className="py-2.5 px-3">日期</th>
                      <th className="py-2.5 px-3">收盘价</th>
                      <th className="py-2.5 px-3">最高浮盈</th>
                      <th className="py-2.5 px-3">阶段</th>
                      <th className="py-2.5 px-3">明日硬线</th>
                      <th className="py-2.5 px-3">软线状态</th>
                      <th className="py-2.5 px-3 font-sans">明日动作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800 font-mono">
                    {snapshots.slice(0, 10).map((s: any) => (
                      <tr key={s.id} className="hover:bg-gray-800/40">
                        <td className="py-2.5 px-3 text-gray-400">{s.date}</td>
                        <td className="py-2.5 px-3 text-white">¥{s.closePrice.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-emerald-400">
                          +{(s.maxGainRatio * 100).toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-gray-300">阶段 {s.stage}</td>
                        <td className="py-2.5 px-3 text-amber-400 font-bold">
                          ¥{s.hardLinePrice.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-gray-400">
                          {s.softLineTriggered ? "跌破" : "正常"}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-[11px] text-gray-300">
                          {s.nextAction === "HOLD" ? "继续持有" : s.nextAction}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 弹窗 */}
      {showCloseModal && (
        <CloseModal
          positionId={id}
          symbol={pos.symbol}
          name={pos.name}
          currentPrice={currentPrice}
          weightedCost={summary.weightedCost}
          totalShares={summary.totalShares}
          initial1R={initial1R}
          suggestedAction={latestSnap?.nextAction}
          onClose={() => setShowCloseModal(false)}
          onSuccess={() => fetchDetail()}
        />
      )}

      {showAddModal && (
        <AddModal
          positionId={id}
          symbol={pos.symbol}
          name={pos.name}
          market={pos.market}
          currentPrice={currentPrice}
          currentHardLine={hardLine}
          lots={lots}
          totalCapital={data.totalCapital || 100000}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => fetchDetail()}
        />
      )}
    </div>
  );
}
