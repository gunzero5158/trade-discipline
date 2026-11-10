"use client";

import { useState } from "react";
import { X, AlertTriangle, CheckCircle2 } from "lucide-react";

interface CloseModalProps {
  positionId: string;
  symbol: string;
  name: string;
  currentPrice: number;
  weightedCost: number;
  totalShares: number;
  initial1R: number;
  suggestedAction?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CloseModal({
  positionId,
  symbol,
  name,
  currentPrice,
  weightedCost,
  totalShares,
  initial1R,
  suggestedAction,
  onClose,
  onSuccess,
}: CloseModalProps) {
  // 默认平仓股数：如果是落袋三分之一建议，默认填 1/3，否则全平
  const isTrimAction = suggestedAction === "TRIM_ONE_THIRD" || suggestedAction?.includes("1/3");
  const defaultShares = isTrimAction
    ? Math.max(100, Math.floor((totalShares / 3) / 100) * 100 || Math.floor(totalShares / 3))
    : totalShares;

  const [exitPrice, setExitPrice] = useState<number>(currentPrice);
  const [sharesToClose, setSharesToClose] = useState<number>(defaultShares);
  const [triggerReason, setTriggerReason] = useState<string>(
    isTrimAction ? "stage3-trim" : "hard-line"
  );
  const [exitDate, setExitDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 实时预算平仓盈亏与 R
  const pnlAmount = sharesToClose * (exitPrice - weightedCost);
  const pnlRatio = weightedCost > 0 ? (exitPrice - weightedCost) / weightedCost : 0;
  const rMultiple = initial1R > 0 ? pnlAmount / initial1R : 0;
  const isFullClose = sharesToClose >= totalShares;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sharesToClose <= 0 || sharesToClose > totalShares) {
      setError(`平仓股数必须在 1 到 ${totalShares} 之间`);
      return;
    }
    if (exitPrice <= 0) {
      setError("出场价格必须大于 0");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/positions/${positionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exitPrice,
          sharesToClose,
          triggerReason,
          exitDate,
          notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
      } else {
        setError(data.error || "平仓处理失败");
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
              平仓 / 减仓落袋
            </h3>
            <p className="text-xs text-gray-400">
              {symbol} · {name} (当前持仓 {totalShares} 股 · 成本 {weightedCost.toFixed(2)} 元)
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Quick buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSharesToClose(totalShares);
                setTriggerReason("hard-line");
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${
                isFullClose
                  ? "bg-red-950/80 border-red-700 text-red-200"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
              }`}
            >
              全部平仓 ({totalShares} 股)
            </button>
            <button
              type="button"
              onClick={() => {
                const s = Math.max(100, Math.floor((totalShares / 3) / 100) * 100 || Math.floor(totalShares / 3));
                setSharesToClose(s);
                setTriggerReason("stage3-trim");
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${
                !isFullClose
                  ? "bg-amber-950/80 border-amber-700 text-amber-200"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
              }`}
            >
              卖 1/3 落袋 (阶段 3)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">平仓价格 (元)</label>
              <input
                type="number"
                step="0.01"
                required
                value={exitPrice}
                onChange={(e) => setExitPrice(parseFloat(e.target.value) || 0)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">平仓股数</label>
              <input
                type="number"
                step="1"
                required
                max={totalShares}
                value={sharesToClose}
                onChange={(e) => setSharesToClose(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">出场原因</label>
              <select
                value={triggerReason}
                onChange={(e) => setTriggerReason(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500"
              >
                <option value="hard-line">破硬线 (盘中触碰出场)</option>
                <option value="soft-line">破软线 (收盘跌破均线确认)</option>
                <option value="stage3-trim">阶段 3 卖 1/3 落袋</option>
                <option value="manual">人工主观平仓</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">出场日期</label>
              <input
                type="date"
                required
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">复盘备注 (可选)</label>
            <input
              type="text"
              placeholder="如：次日开盘按纪律竞价出场、执行果断"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500 text-xs"
            />
          </div>

          {/* 实时盈亏与 R 倍数预算卡片 */}
          <div className="p-4 rounded-xl bg-gray-800/70 border border-gray-700/80 space-y-2">
            <div className="text-xs text-gray-400 flex justify-between">
              <span>本次实现盈亏金额：</span>
              <span className={`font-mono font-bold ${pnlAmount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {pnlAmount >= 0 ? `+${pnlAmount.toFixed(2)}` : pnlAmount.toFixed(2)} 元
              </span>
            </div>
            <div className="text-xs text-gray-400 flex justify-between">
              <span>盈亏比例：</span>
              <span className={`font-mono font-bold ${pnlRatio >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {pnlRatio >= 0 ? `+${(pnlRatio * 100).toFixed(2)}%` : `${(pnlRatio * 100).toFixed(2)}%`}
              </span>
            </div>
            <div className="text-xs text-gray-400 flex justify-between items-center pt-1 border-t border-gray-700/60">
              <span className="font-semibold text-gray-300">折合 1R 倍数 (锚定首仓)：</span>
              <span className={`text-base font-mono font-bold ${rMultiple >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {rMultiple >= 0 ? `+${rMultiple.toFixed(2)}R` : `${rMultiple.toFixed(2)}R`}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 pt-1">
              {isFullClose ? "本次为全部平仓，持仓将归档至交易日志。" : `减仓后剩余仓位：${totalShares - sharesToClose} 股，继续按硬线/软线跟踪。`}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {submitting ? "正在归档..." : isFullClose ? "确认全部平仓" : "确认卖 1/3 落袋"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
