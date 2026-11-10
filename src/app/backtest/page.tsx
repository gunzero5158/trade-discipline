"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Search,
  Sparkles,
  ArrowUpRight,
  TrendingUp,
  Percent,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import StockChart from "@/components/StockChart";
import { BacktestResult } from "@/lib/backtest/engine";

export default function BacktestPage() {
  const router = useRouter();

  const [symbol, setSymbol] = useState<string>("600519");
  const [years, setYears] = useState<number>(2);
  const [swing, setSwing] = useState<number>(0.10);
  const [maType, setMaType] = useState<string>("EMA");

  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunBacktest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!symbol.trim()) return;

    setRunning(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/backtest?symbol=${encodeURIComponent(symbol.trim())}&years=${years}&swing=${swing}&maType=${maType}`
      );
      const json = await res.json();
      if (json.success && json.data) {
        setResult(json.data);
      } else {
        setError(json.error || "回测分析失败");
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  // 一键带入开仓计算器
  const handleApplyToCalculator = () => {
    if (!result || !result.currentStatus) return;
    const { currentPrice, nearestSupport } = result.currentStatus;
    const stopP = nearestSupport ? nearestSupport.price : (currentPrice * 0.92);
    const maPeriod = nearestSupport ? nearestSupport.name.replace(/[^0-9]/g, "") : "20";

    const query = new URLSearchParams({
      symbol: result.symbol,
      entry: currentPrice.toFixed(2),
      stop: stopP.toFixed(2),
      maType,
      maPeriod,
      confirm: "2",
    });

    router.push(`/calculator?${query.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* 头部介绍 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <LineChart className="w-5 h-5 text-emerald-400" />
            点位回测工具 (历史规律挖掘与胜率统计)
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            独立规律挖掘模块。输入股票代码与周期，回测历史上每次触碰各均线后的真实反弹胜率与假跌破特征，对照当前点位给出参考。
          </p>
        </div>
      </div>

      {/* 参数输入与回测触发 */}
      <form onSubmit={handleRunBacktest} className="p-5 bg-gray-900 border border-gray-800 rounded-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">股票代码</label>
            <input
              type="text"
              required
              placeholder="如 600519、0700.HK、AAPL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">回测周期</label>
            <select
              value={years}
              onChange={(e) => setYears(parseInt(e.target.value, 10))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-hidden"
            >
              <option value={1}>最近 1 年</option>
              <option value={2}>最近 2 年 (推荐)</option>
              <option value={3}>最近 3 年</option>
              <option value={5}>最近 5 年</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">有效波段涨幅阈值</label>
            <select
              value={swing}
              onChange={(e) => setSwing(parseFloat(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-hidden"
            >
              <option value={0.05}>+5% (短线波段)</option>
              <option value={0.08}>+8%</option>
              <option value={0.10}>+10% (标准有效波段)</option>
              <option value={0.15}>+15% (大波段)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">均线体系</label>
            <select
              value={maType}
              onChange={(e) => setMaType(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-hidden"
            >
              <option value="EMA">EMA (指数平均，更贴近实盘)</option>
              <option value="MA">MA (简单移动平均)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500">
            逐日扫描历史触碰事件，严格区分“稳守反弹”、“假跌破收回”与“真破位创新低”。
          </span>
          <button
            type="submit"
            disabled={running}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{running ? "正在回测验算..." : "运行点位回测"}</span>
          </button>
        </div>
      </form>

      {/* 错误提示 */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* 回测结论展示 */}
      {result && (
        <div className="space-y-6">
          {/* 当前行情点位对照卡片 */}
          <div className="p-6 bg-gradient-to-r from-gray-900 to-gray-850 border border-gray-800 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs text-gray-400">最新收盘价</span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-2xl font-bold font-mono text-white">
                    ¥{result.currentStatus.currentPrice.toFixed(2)}
                  </span>
                  <span className="text-xs text-gray-500">
                    (回测样本: {result.startDate} 至 {result.endDate}，共 {result.totalBars} 根K线)
                  </span>
                </div>
              </div>

              <button
                onClick={handleApplyToCalculator}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-lg cursor-pointer w-fit"
              >
                <span>一键将点位带入开仓计算器</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/80 space-y-1">
                <span className="text-xs text-gray-400">历史高胜率参考强支撑位</span>
                {result.currentStatus.nearestSupport ? (
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold font-mono text-emerald-400">
                        ¥{result.currentStatus.nearestSupport.price.toFixed(2)}
                      </span>
                      <span className="text-xs font-semibold text-gray-300">
                        ({result.currentStatus.nearestSupport.name})
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      距当前价偏离: <span className="font-mono text-white">{(result.currentStatus.nearestSupport.distancePercent * 100).toFixed(1)}%</span> · 历史反弹胜率: <span className="font-bold text-emerald-400">{(result.currentStatus.nearestSupport.winRate * 100).toFixed(1)}%</span>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">当前价格低于所有均线，暂无下方支撑均线</p>
                )}
              </div>

              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/80 space-y-1">
                <span className="text-xs text-gray-400">上方参考均线阻力位</span>
                {result.currentStatus.nearestResistance ? (
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold font-mono text-red-400">
                        ¥{result.currentStatus.nearestResistance.price.toFixed(2)}
                      </span>
                      <span className="text-xs font-semibold text-gray-300">
                        ({result.currentStatus.nearestResistance.name})
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      距当前价上方: <span className="font-mono text-white">{(result.currentStatus.nearestResistance.distancePercent * 100).toFixed(1)}%</span>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-400 font-medium">当前价格位于所有均线上方，处于多头格局</p>
                )}
              </div>
            </div>

            {result.currentStatus.triggeredRules.length > 0 && (
              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{result.currentStatus.triggeredRules.join("；")}</span>
              </div>
            )}
          </div>

          {/* 均线支撑历史胜率榜 */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                均线支撑反应规律榜 (事后诸葛亮找共性 + 全历史逐日验算)
              </h3>
              <span className="text-xs text-gray-400">
                同期随机买入基准胜率: {(result.supportRules[0]?.benchmarkWinRate * 100).toFixed(1)}%
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-gray-800/60 text-gray-400 uppercase text-[11px] border-b border-gray-800 font-sans">
                  <tr>
                    <th className="py-3 px-4">均线</th>
                    <th className="py-3 px-4">历史触碰次数</th>
                    <th className="py-3 px-4">守住反弹</th>
                    <th className="py-3 px-4">假跌破收回</th>
                    <th className="py-3 px-4">真破位创新低</th>
                    <th className="py-3 px-4 font-bold">真实反弹胜率</th>
                    <th className="py-3 px-4">超额胜率 (对比基准)</th>
                    <th className="py-3 px-4">触碰后平均涨幅</th>
                    <th className="py-3 px-4">达标前平均回撤</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {result.supportRules.map((rule) => {
                    const edge = rule.winRate - rule.benchmarkWinRate;
                    const isHighWin = rule.winRate >= 0.70;

                    return (
                      <tr key={rule.period} className="hover:bg-gray-800/40">
                        <td className="py-3 px-4 font-sans font-bold text-white text-sm">
                          {rule.maName}
                        </td>
                        <td className="py-3 px-4 text-gray-300">{rule.touches} 次</td>
                        <td className="py-3 px-4 text-emerald-400">{rule.bounces} 次</td>
                        <td className="py-3 px-4 text-amber-400">{rule.falseBreakdowns} 次</td>
                        <td className="py-3 px-4 text-red-400">{rule.trueBreakdowns} 次</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded font-bold ${
                              isHighWin
                                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700"
                                : "text-white"
                            }`}
                          >
                            {(rule.winRate * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td
                          className={`py-3 px-4 font-bold ${
                            edge >= 0 ? "text-emerald-400" : "text-gray-500"
                          }`}
                        >
                          {edge >= 0 ? `+${(edge * 100).toFixed(1)}%` : `${(edge * 100).toFixed(1)}%`}
                        </td>
                        <td className="py-3 px-4 text-gray-300">
                          +{(rule.avgGain * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 px-4 text-amber-400">
                          -{(rule.maxDrawdown * 100).toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
