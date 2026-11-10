"use client";

import { useEffect, useState, useRef } from "react";
import {
  Settings,
  Key,
  Copy,
  Check,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Save,
} from "lucide-react";
import { DEFAULT_RULE_CONFIG, RuleConfig } from "@/lib/rules/types";

export default function SettingsPage() {
  const [accessCode, setAccessCode] = useState<string>("");
  const [inputCode, setInputCode] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  const [totalCapital, setTotalCapital] = useState<number>(100000);
  const [config, setConfig] = useState<RuleConfig>(DEFAULT_RULE_CONFIG);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      if (data.success && data.account) {
        setAccessCode(data.accessCode);
        setTotalCapital(data.account.totalCapital || 100000);
        if (data.account.ruleConfig) {
          setConfig({ ...DEFAULT_RULE_CONFIG, ...data.account.ruleConfig });
        }
      }
    } catch (err) {
      console.warn("Failed to load settings:", err);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleCopyCode = () => {
    if (!accessCode) return;
    navigator.clipboard.writeText(accessCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 切换访问码
  const handleSwitchCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", accessCode: inputCode.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "已成功切换至新访问码，数据已同步！" });
        setInputCode("");
        fetchSettings();
      } else {
        setMessage({ type: "error", text: data.error || "切换失败" });
      }
    } catch (err: unknown) {
      setMessage({ type: "error", text: String(err) });
    }
  };

  // 保存参数设置
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalCapital,
          ruleConfig: config,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        setMessage({ type: "success", text: "系统规则参数已成功保存并全局生效！" });
      } else {
        setMessage({ type: "error", text: data.error || "保存失败" });
      }
    } catch (err: unknown) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  // 导出 JSON 备份
  const handleExportBackup = async () => {
    try {
      const res = await fetch("/api/auth/backup");
      const data = await res.json();
      if (data.success) {
        const jsonStr = JSON.stringify(data.data, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `trade-discipline-backup-${new Date().toISOString().substring(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert("导出备份失败: " + String(err));
    }
  };

  // 导入 JSON 恢复
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        const res = await fetch("/api/auth/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: parsed }),
        });
        const data = await res.json();
        if (data.success) {
          alert("数据恢复成功！");
          fetchSettings();
        } else {
          alert("恢复失败: " + (data.error || "文件格式不正确"));
        }
      } catch (err) {
        alert("解析备份文件失败: " + String(err));
      }
    };
    reader.readAsText(file);
  };

  // 清空数据
  const handleClearData = async () => {
    if (!confirm("⚠️ 危险操作：确定要清空该访问码下的所有持仓、批次、快照及交易日志吗？清空后不可恢复，建议先导出备份。")) {
      return;
    }

    try {
      const res = await fetch("/api/auth/backup", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        alert("账户数据已清空！");
        fetchSettings();
      }
    } catch (err) {
      alert("清空失败: " + String(err));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-emerald-400" />
          系统设置与数据安全
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          管理访问码认证凭证、风控参数模板及全量数据导入导出备份。
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center gap-2 ${
            message.type === "success"
              ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
              : "bg-red-950/60 border-red-800 text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* 模块 1: 访问码凭证管理 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400" />
          <h2 className="text-base font-bold text-white">免注册访问码 (跨设备同步凭证)</h2>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          工具采用 24 位高强度随机访问码代替繁琐的邮箱注册。所有持仓和交易记录挂载在此码的加密哈希下。换手机或电脑时只需输入此码即可同步全部数据。
        </p>

        {/* 当前访问码显示与复制 */}
        <div className="p-4 rounded-xl bg-gray-800/80 border border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[11px] text-gray-400 block">当前设备生效的访问码：</span>
            <span className="font-mono text-base font-bold text-emerald-400 tracking-wider">
              {accessCode || "正在生成..."}
            </span>
          </div>
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer w-fit"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? "已复制到剪贴板" : "复制完整访问码"}</span>
          </button>
        </div>

        {/* 切换已有访问码 */}
        <form onSubmit={handleSwitchCode} className="pt-2 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="粘贴其他设备的 24 位访问码..."
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-emerald-500 focus:outline-hidden"
          />
          <button
            type="submit"
            className="px-5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold border border-gray-700 transition-colors"
          >
            切换 / 同步此码
          </button>
        </form>
      </div>

      {/* 模块 2: 账户资金与风控参数模板 */}
      <form onSubmit={handleSaveConfig} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-bold text-white">账户总额与纪律规则模板</h2>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? "正在保存..." : "保存参数修改"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-gray-400 mb-1">账户总资金 (元)</label>
            <input
              type="number"
              step="1000"
              required
              value={totalCapital}
              onChange={(e) => setTotalCapital(parseFloat(e.target.value) || 0)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">首仓默认单笔风险比例 (%)</label>
            <input
              type="number"
              step="0.1"
              value={config.defaultRiskPercent}
              onChange={(e) => setConfig({ ...config, defaultRiskPercent: parseFloat(e.target.value) || 1.0 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">单只股票持仓上限 (%)</label>
            <input
              type="number"
              step="1"
              value={config.maxPositionPercent}
              onChange={(e) => setConfig({ ...config, maxPositionPercent: parseFloat(e.target.value) || 25.0 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">总持仓未实现风险闸限 (%)</label>
            <input
              type="number"
              step="0.5"
              value={config.maxPortfolioRiskPercent}
              onChange={(e) => setConfig({ ...config, maxPortfolioRiskPercent: parseFloat(e.target.value) || 5.0 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">阶段 1 保本门槛 (浮盈比例)</label>
            <input
              type="number"
              step="0.01"
              value={config.stage1Threshold}
              onChange={(e) => setConfig({ ...config, stage1Threshold: parseFloat(e.target.value) || 0.05 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">阶段 1 硬线位置 (成本上方比例)</label>
            <input
              type="number"
              step="0.01"
              value={config.stage1HardLineGain}
              onChange={(e) => setConfig({ ...config, stage1HardLineGain: parseFloat(e.target.value) || 0.02 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">阶段 2 跟踪门槛 (浮盈比例)</label>
            <input
              type="number"
              step="0.01"
              value={config.stage2Threshold}
              onChange={(e) => setConfig({ ...config, stage2Threshold: parseFloat(e.target.value) || 0.10 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">阶段 3 落袋门槛 (浮盈比例)</label>
            <input
              type="number"
              step="0.01"
              value={config.stage3Threshold}
              onChange={(e) => setConfig({ ...config, stage3Threshold: parseFloat(e.target.value) || 0.20 })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>
        </div>
      </form>

      {/* 模块 3: 全量数据备份与恢复 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <h2 className="text-base font-bold text-white">数据备份与迁移</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          定期导出全量数据 JSON 备份，防止因误删浏览器缓存导致数据丢失。导出的备份可在任何新设备上一键完整恢复。
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportBackup}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-semibold text-gray-200 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>导出全量数据 JSON</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-semibold text-gray-200 transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4 text-blue-400" />
            <span>从 JSON 恢复备份</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={handleClearData}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-xs font-semibold text-red-300 transition-colors cursor-pointer ml-auto"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>清空持仓与记录</span>
          </button>
        </div>
      </div>
    </div>
  );
}
