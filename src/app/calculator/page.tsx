"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calculator,
  Search,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  Percent,
  PlusCircle,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import {
  calculateOpenPosition,
  calculateAddPosition,
  stopPriceFromPercent,
  stopPercentFromPrice,
} from "@/lib/rules/calculator";
import { SymbolSuggestion } from "@/lib/market/client";

function CalculatorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<"open" | "add">("open");
  const [totalCapital, setTotalCapital] = useState<number>(100000);
  const [currentRiskAmount, setCurrentRiskAmount] = useState<number>(0);

  // 开仓表单状态
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [searching, setSearching] = useState<boolean>(false);

  const [symbol, setSymbol] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [market, setMarket] = useState<string>("a-share");
  const [buyPrice, setBuyPrice] = useState<number>(20);
  const [stopPrice, setStopPrice] = useState<number>(18.4);
  const [stopPercent, setStopPercent] = useState<number>(-8.0);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [maType, setMaType] = useState<string>("EMA");
  const [maPeriod, setMaPeriod] = useState<number>(20);
  const [confirmDays, setConfirmDays] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");

  const [savingPosition, setSavingPosition] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 加仓表单状态
  const [existingPositions, setExistingPositions] = useState<any[]>([]);
  const [selectedPosId, setSelectedPosId] = useState<string>("");
  const [addPrice, setAddPrice] = useState<number>(0);
  const [keyLevel, setKeyLevel] = useState<number>(0);
  const [addNotes, setAddNotes] = useState<string>("");
  const [savingAdd, setSavingAdd] = useState<boolean>(false);

  // 1. 读取账户信息与在手持仓
  useEffect(() => {
    fetch("/api/positions")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setTotalCapital(data.data.summary.totalCapital || 100000);
          setCurrentRiskAmount(data.data.summary.totalOpenRiskAmount || 0);
          setExistingPositions(data.data.items || []);
          if (data.data.items.length > 0) {
            setSelectedPosId(data.data.items[0].position.id);
            setAddPrice(data.data.items[0].currentPrice);
            setKeyLevel(Number((data.data.items[0].currentPrice * 0.96).toFixed(2)));
          }
        }
      })
      .catch((err) => console.warn("Failed to load positions for calculator:", err));
  }, []);

  // 2. 支持从 URL 参数预填 (与点位回测工具联动)
  useEffect(() => {
    const urlSymbol = searchParams.get("symbol");
    const urlEntry = searchParams.get("entry");
    const urlStop = searchParams.get("stop");
    const urlName = searchParams.get("name");
    const urlMaType = searchParams.get("maType");
    const urlMaPeriod = searchParams.get("maPeriod");
    const urlConfirm = searchParams.get("confirm");

    if (urlSymbol) setSymbol(urlSymbol);
    if (urlName) setName(urlName);
    if (urlEntry) {
      const p = parseFloat(urlEntry);
      if (p > 0) {
        setBuyPrice(p);
        if (urlStop) {
          const sp = parseFloat(urlStop);
          setStopPrice(sp);
          setStopPercent(Number(((sp - p) / p * 100).toFixed(2)));
        } else {
          setStopPrice(stopPriceFromPercent(p, -0.08));
          setStopPercent(-8.0);
        }
      }
    }
    if (urlMaType) setMaType(urlMaType === "MA" ? "MA" : "EMA");
    if (urlMaPeriod) setMaPeriod(parseInt(urlMaPeriod, 10) || 20);
    if (urlConfirm) setConfirmDays(parseInt(urlConfirm, 10) || 1);
  }, [searchParams]);

  // 搜索股票联想
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/market/search?q=${encodeURIComponent(searchQuery.trim())}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setSuggestions(data.items || []);
          }
        })
        .catch((err) => console.warn("Search error:", err))
        .finally(() => setSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 选中联想股票后拉取最新价格
  const handleSelectSuggestion = async (s: SymbolSuggestion) => {
    setSymbol(s.symbol);
    setName(s.name);
    setMarket(s.market);
    setSearchQuery("");
    setSuggestions([]);

    try {
      const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(s.symbol)}`);
      const data = await res.json();
      if (data.success && data.data && data.data.price > 0) {
        const p = data.data.price;
        setBuyPrice(p);
        const newStop = stopPriceFromPercent(p, stopPercent / 100);
        setStopPrice(newStop);
      }
    } catch (err) {
      console.warn("Quote fetch error:", err);
    }
  };

  // 止损价格与百分比双向联动
  const handlePriceChange = (newBuyPrice: number) => {
    setBuyPrice(newBuyPrice);
    if (newBuyPrice > 0) {
      setStopPrice(stopPriceFromPercent(newBuyPrice, stopPercent / 100));
    }
  };

  const handleStopPriceChange = (newStopPrice: number) => {
    setStopPrice(newStopPrice);
    if (buyPrice > 0 && newStopPrice > 0) {
      setStopPercent(Number((stopPercentFromPrice(buyPrice, newStopPrice) * 100).toFixed(2)));
    }
  };

  const handleStopPercentChange = (newPercent: number) => {
    setStopPercent(newPercent);
    if (buyPrice > 0) {
      setStopPrice(stopPriceFromPercent(buyPrice, newPercent / 100));
    }
  };

  // 开仓实时核算
  let openResult = null;
  let openError = null;
  if (buyPrice > 0 && stopPrice > 0 && stopPrice < buyPrice) {
    try {
      openResult = calculateOpenPosition({
        totalCapital,
        buyPrice,
        stopPrice,
        riskPercent,
        market: market as any,
        currentPortfolioRiskAmount: currentRiskAmount,
      });
    } catch (err: unknown) {
      openError = String(err);
    }
  }

  // 保存开仓转为持仓
  const handleCreatePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !openResult || openResult.shares <= 0) {
      setSaveError("请确认代码并确保仓位测算股数有效");
      return;
    }

    setSavingPosition(true);
    setSaveError(null);

    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          name: name || symbol,
          market,
          buyPrice,
          shares: openResult.shares,
          initialStopPrice: stopPrice,
          maType,
          maPeriod,
          confirmDays,
          notes,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSaveSuccess(true);
        setTimeout(() => {
          router.push("/");
        }, 1000);
      } else {
        setSaveError(data.error || "创建持仓失败");
      }
    } catch (err: unknown) {
      setSaveError(String(err));
    } finally {
      setSavingPosition(false);
    }
  };

  // 加仓实时核算
  const selectedPos = existingPositions.find((p) => p.position.id === selectedPosId);
  let addResult = null;
  let addError = null;
  if (selectedPos && addPrice > 0 && keyLevel > 0 && keyLevel < addPrice) {
    try {
      addResult = calculateAddPosition({
        existingLots: selectedPos.lots,
        addPrice,
        keyLevel,
        totalCapital,
        currentHardLine: selectedPos.snapshot?.hardLinePrice ?? selectedPos.position.initialStopPrice,
        avgAmplitude: 0.02,
        market: selectedPos.position.market,
      });
    } catch (err: unknown) {
      addError = String(err);
    }
  }

  // 提交加仓
  const handleAddLotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPos || !addResult || addResult.finalShares <= 0) {
      return;
    }

    setSavingAdd(true);
    try {
      const res = await fetch(`/api/positions/${selectedPos.position.id}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: addPrice,
          shares: addResult.finalShares,
          stopPrice: addResult.addStopPrice,
          date: new Date().toISOString().substring(0, 10),
          notes: addNotes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/");
      }
    } catch (err) {
      console.warn("Add lot error:", err);
    } finally {
      setSavingAdd(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 选项卡切换 */}
      <div className="flex border-b border-gray-800">
        <button
          onClick={() => setActiveTab("open")}
          className={`py-3 px-6 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === "open"
              ? "border-emerald-500 text-emerald-400 bg-gray-900/40"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          <Calculator className="w-4 h-4" />
          新开仓计算器 (先定止损，再反推仓位)
        </button>
        <button
          onClick={() => setActiveTab("add")}
          className={`py-3 px-6 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === "add"
              ? "border-emerald-500 text-emerald-400 bg-gray-900/40"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          回撤加仓计算器 (分步买入，总账不亏)
        </button>
      </div>

      {activeTab === "open" ? (
        /* 开仓计算器 */
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* 左侧：输入表单 */}
          <div className="md:col-span-7 bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              开仓参数输入
            </h2>

            {/* 股票搜索 */}
            <div className="relative">
              <label className="block text-xs text-gray-400 mb-1">股票代码 / 名称</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="如：600519、0700.HK、AAPL..."
                  value={searchQuery || symbol}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSymbol(e.target.value);
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-hidden focus:border-emerald-500"
                />
                {searching && (
                  <RefreshCw className="w-4 h-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>

              {/* 搜索联想下拉 */}
              {suggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-2xl max-h-56 overflow-y-auto">
                  {suggestions.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectSuggestion(item)}
                      className="px-4 py-2 hover:bg-gray-700 flex items-center justify-between cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{item.symbol}</span>
                        <span className="text-gray-300">{item.name}</span>
                      </div>
                      <span className="text-gray-500 text-[10px]">{item.typeDisp}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 价格与止损双向联动 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">买入价格 (元)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={buyPrice}
                  onChange={(e) => handlePriceChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  单笔风险比例 ({riskPercent}%)
                </label>
                <select
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-hidden focus:border-emerald-500"
                >
                  <option value={1.0}>1.0% (标准单笔风险)</option>
                  <option value={0.5}>0.5% (验证期 / 审慎开仓)</option>
                  <option value={0.75}>0.75%</option>
                  <option value={1.5}>1.5%</option>
                </select>
              </div>
            </div>

            {/* 止损位输入 (价格 vs 百分比实时双向互算) */}
            <div className="grid grid-cols-2 gap-4 p-3 rounded-xl bg-gray-800/40 border border-gray-700/60">
              <div>
                <label className="block text-xs text-gray-300 mb-1">
                  按图形放止损价 (元)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={stopPrice}
                  onChange={(e) => handleStopPriceChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-hidden focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-300 mb-1">
                  或填止损幅度 (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={stopPercent}
                    onChange={(e) => handleStopPercentChange(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-hidden focus:border-emerald-500"
                  />
                  <Percent className="w-3.5 h-3.5 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <p className="col-span-2 text-[11px] text-gray-500">
                💡 铁律：止损服从图形支撑，仓位服从止损。止损距离买点越近仓位越足，越远仓位自动缩小。
              </p>
            </div>

            {/* 软线均线个性化定制 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">软线类型</label>
                <select
                  value={maType}
                  onChange={(e) => setMaType(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
                >
                  <option value="EMA">EMA (指数平均)</option>
                  <option value="MA">MA (简单平均)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">均线周期</label>
                <input
                  type="number"
                  value={maPeriod}
                  onChange={(e) => setMaPeriod(parseInt(e.target.value, 10) || 20)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">确认天数</label>
                <select
                  value={confirmDays}
                  onChange={(e) => setConfirmDays(parseInt(e.target.value, 10))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
                >
                  <option value={1}>1 天 (收盘破即走)</option>
                  <option value={2}>连续 2 天确认</option>
                  <option value={3}>连续 3 天确认</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">开仓理由 (一句话，用于复盘)</label>
              <input
                type="text"
                placeholder="如：平台整理放量突破、回踩强支撑企稳"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          {/* 右侧：测算结果与三道风控检验 */}
          <div className="md:col-span-5 space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">开仓测算结论</h3>

              {openError ? (
                <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs">
                  {openError}
                </div>
              ) : openResult ? (
                <div className="space-y-3">
                  {/* 核心数字 */}
                  <div className="p-4 rounded-xl bg-gray-800/80 border border-gray-700 space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-gray-400">建议买入仓位：</span>
                      <span className="text-2xl font-bold font-mono text-emerald-400">
                        {openResult.shares.toLocaleString()} 股
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>占用买入金额：</span>
                      <span className="font-mono text-white font-semibold">
                        ¥{openResult.positionAmount.toLocaleString()} ({(openResult.positionPercent * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 pt-1 border-t border-gray-700/60">
                      <span>单笔 1R 刚性风险额：</span>
                      <span className="font-mono text-red-400 font-bold">
                        -¥{openResult.r1Amount.toFixed(0)} ({riskPercent}%)
                      </span>
                    </div>
                  </div>

                  {/* 三道风控校验 */}
                  <div className="space-y-2">
                    {/* 校验 1: 单只上限 25% */}
                    <div
                      className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                        openResult.isPositionOverweight
                          ? "bg-red-950/60 border-red-800 text-red-300"
                          : "bg-emerald-950/30 border-emerald-800/60 text-emerald-300"
                      }`}
                    >
                      {openResult.isPositionOverweight ? (
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">
                          {openResult.isPositionOverweight ? "单只持仓超限 (>25%)" : "单只仓位合规 (≤25%)"}
                        </div>
                        {openResult.isPositionOverweight && (
                          <div className="mt-1 text-[11px] leading-relaxed">
                            {openResult.positionOverweightMessage}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 校验 2: 总持仓未实现风险闸 5% */}
                    <div
                      className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                        openResult.isTotalRiskExceeded
                          ? "bg-red-950/60 border-red-800 text-red-300"
                          : "bg-emerald-950/30 border-emerald-800/60 text-emerald-300"
                      }`}
                    >
                      {openResult.isTotalRiskExceeded ? (
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">
                          {openResult.isTotalRiskExceeded ? "总风险超闸 (>5%)" : "账户总风险闸安全"}
                        </div>
                        {openResult.isTotalRiskExceeded && (
                          <div className="mt-1 text-[11px] leading-relaxed">
                            {openResult.totalRiskExceededMessage}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 校验 3: 追涨/性价比 */}
                    {openResult.isRiskRewardPoor && (
                      <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-800/70 text-amber-300 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                        <div>
                          <div className="font-semibold">追涨/止损过宽警示</div>
                          <div className="mt-1 text-[11px] leading-relaxed">
                            {openResult.riskRewardMessage}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {saveError && (
                    <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs">
                      {saveError}
                    </div>
                  )}

                  {saveSuccess && (
                    <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>开仓成功！正在跳转至今日看板...</span>
                    </div>
                  )}

                  {/* 一键存为持仓监控 */}
                  <button
                    type="button"
                    onClick={handleCreatePosition}
                    disabled={savingPosition || openResult.shares <= 0}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors shadow-lg cursor-pointer flex items-center justify-center gap-2"
                  >
                    {savingPosition ? "正在保存..." : "一键加入持仓纪律监控"}
                  </button>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500 text-xs">
                  输入买入价与止损价，即可实时获取开仓建议与风控校验
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* 回撤加仓计算器 */
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6 max-w-2xl mx-auto">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-400" />
              已有持仓回撤加仓
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              加仓原则：“算的时候分开算，管的时候合起来管”。老仓与加仓合并后只留一条更高硬线，总账确保不亏。
            </p>
          </div>

          {existingPositions.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              当前没有在手持仓，加仓需先有首仓。请先使用“新开仓计算器”录入第一笔仓位。
            </div>
          ) : (
            <form onSubmit={handleAddLotSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs text-gray-400 mb-1">选择在手持仓</label>
                <select
                  value={selectedPosId}
                  onChange={(e) => {
                    setSelectedPosId(e.target.value);
                    const pos = existingPositions.find((p) => p.position.id === e.target.value);
                    if (pos) {
                      setAddPrice(pos.currentPrice);
                      setKeyLevel(Number((pos.currentPrice * 0.96).toFixed(2)));
                    }
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  {existingPositions.map((item) => (
                    <option key={item.position.id} value={item.position.id}>
                      {item.position.symbol} {item.position.name} (已持 {item.totalShares} 股 · 成本 ¥{item.weightedCost})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">加仓买入价 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={addPrice}
                    onChange={(e) => setAddPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">关键支撑位 (如前高平台/均线)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={keyLevel}
                    onChange={(e) => setKeyLevel(parseFloat(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
              </div>

              {addResult && (
                <div className="p-4 rounded-xl bg-gray-800/80 border border-gray-700 space-y-2 text-xs">
                  <div className="flex justify-between text-gray-400">
                    <span>本次加仓序号与额度：</span>
                    <span className="font-mono text-white font-bold">
                      第 {addResult.addIndex} 次加仓 ({addResult.addRiskPercent}% 风险额度)
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>加仓止损位 (支撑下留余量)：</span>
                    <span className="font-mono text-white font-bold">¥{addResult.addStopPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>建议加仓股数：</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {addResult.finalShares} 股 (¥{addResult.addAmount.toFixed(0)})
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>合并后明日硬线 (取高者)：</span>
                    <span className="font-mono text-amber-400 font-bold">¥{addResult.combinedHardLine.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400 pt-1 border-t border-gray-700/60">
                    <span>总账核算 (若硬线击穿整笔合计盈亏)：</span>
                    <span className={`font-mono font-bold ${addResult.totalLedgerAtCombinedStop >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                      {addResult.totalLedgerAtCombinedStop >= 0 ? `+¥${addResult.totalLedgerAtCombinedStop.toFixed(0)}` : `-¥${Math.abs(addResult.totalLedgerAtCombinedStop).toFixed(0)}`}
                      {addResult.totalLedgerAtCombinedStop >= 0 ? " (不亏确定性)" : " (亏损控制在 1% 内)"}
                    </span>
                  </div>

                  {addResult.warningMessages.map((w, i) => (
                    <p key={i} className="text-amber-400 pt-1 text-[11px]">⚠️ {w}</p>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={savingAdd || !addResult || addResult.finalShares <= 0}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors cursor-pointer"
              >
                {savingAdd ? "正在保存..." : "确认追加仓位并更新硬线"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalculatorPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">加载计算器...</div>}>
      <CalculatorContent />
    </Suspense>
  );
}
