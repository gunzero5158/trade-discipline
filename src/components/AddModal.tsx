"use client";

import { useState } from "react";
import { X, PlusCircle, AlertTriangle } from "lucide-react";
import { calculateAddPosition } from "@/lib/rules/calculator";
import { Lot } from "@/lib/rules/types";

interface AddModalProps {
  positionId: string;
  symbol: string;
  name: string;
  currentPrice: number;
  currentHardLine: number;
  lots: Lot[];
  totalCapital?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddModal({
  positionId,
  symbol,
  name,
  currentPrice,
  currentHardLine,
  lots,
  totalCapital = 100000,
  onClose,
  onSuccess,
}: AddModalProps) {
  const addLotsCount = lots.filter((l) => l.type === "add").length;
  const isMaxAddReached = addLotsCount >= 2;
  const addIndex = addLotsCount + 1;
  const riskPercent = addIndex === 1 ? 0.5 : 0.25;

  const [addPrice, setAddPrice] = useState<number>(currentPrice);
  const [keyLevel, setKeyLevel] = useState<number>(Number((currentPrice * 0.96).toFixed(2)));
  const [date, setDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 实时调用加仓计算引擎
  let calcResult = null;
  let calcError = null;
  if (!isMaxAddReached && addPrice > 0 && keyLevel > 0 && keyLevel < addPrice) {
    try {
      calcResult = calculateAddPosition({
        existingLots: lots,
        addPrice,
        keyLevel,
        totalCapital,
        currentHardLine,
        avgAmplitude: 0.02,
        market: "a-share",
      });
    } catch (err: unknown) {
      calcError = String(err);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calcResult || calcResult.finalShares <= 0) {
      setError("加仓测算股数必须大于 0");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/positions/${positionId}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: addPrice,
          shares: calcResult.finalShares,
          stopPrice: calcResult.addStopPrice,
          date,
          notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
      } else {
        setError(data.error || "加仓保存失败");
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-400" />
              回撤加仓测算
            </h3>
            <p className="text-xs text-gray-400">
              {symbol} · {name} (当前第 {addIndex} 次加仓，额度 {riskPercent}%)
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isMaxAddReached ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-gray-200">已达最多加仓 2 次限制</h4>
            <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
              根据《交易纪律》第六节，一只股票最多回撤加仓 2 次。第三次以后风险额度太小且易大幅摊薄老仓利润，应等待下一只新标的。
            </p>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold"
            >
              关闭
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
            {error && (
              <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {calcError && (
              <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-800/60 text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{calcError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">加仓买入价 (元)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={addPrice}
                  onChange={(e) => setAddPrice(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">关键支撑位 (如前高/均线)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={keyLevel}
                  onChange={(e) => setKeyLevel(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">加仓日期</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">加仓理由 / 备注</label>
                <input
                  type="text"
                  placeholder="如：回踩 20 日线企稳放量"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
            </div>

            {/* 测算核算面板 */}
            {calcResult && (
              <div className="p-4 rounded-xl bg-gray-800/80 border border-gray-700 space-y-2 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>加仓止损位 (支撑下留余量)：</span>
                  <span className="font-mono text-white font-bold">{calcResult.addStopPrice.toFixed(2)} 元</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>建议加仓股数：</span>
                  <span className="font-mono text-emerald-400 font-bold">{calcResult.finalShares} 股 ({calcResult.addAmount.toFixed(0)} 元)</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>合并后明日硬线 (取高者)：</span>
                  <span className="font-mono text-amber-400 font-bold">{calcResult.combinedHardLine.toFixed(2)} 元</span>
                </div>
                <div className="flex justify-between text-gray-400 pt-1 border-t border-gray-700/60">
                  <span>加仓后总账 (硬线击穿时合计损益)：</span>
                  <span className={`font-mono font-bold ${calcResult.totalLedgerAtCombinedStop >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                    {calcResult.totalLedgerAtCombinedStop >= 0 ? `+${calcResult.totalLedgerAtCombinedStop.toFixed(0)}` : calcResult.totalLedgerAtCombinedStop.toFixed(0)} 元
                    {calcResult.totalLedgerAtCombinedStop >= 0 ? " (不亏确定)" : " (亏损受控 <1%)"}
                  </span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>加仓后总持仓占比：</span>
                  <span className="font-mono text-white">{(calcResult.totalPositionPercentAfterAdd * 100).toFixed(1)}% / 25% 上限</span>
                </div>

                {calcResult.warningMessages.map((w, i) => (
                  <p key={i} className="text-[11px] text-amber-400 pt-1">⚠️ {w}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting || !calcResult || calcResult.finalShares <= 0}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {submitting ? "正在保存..." : "确认追加仓位"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
