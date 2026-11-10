"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Shield, Calculator, BarChart3, LineChart, Settings, Copy, Check, Key } from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();
  const [accessCode, setAccessCode] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    // 首次加载拉取或确认访问码
    fetch("/api/auth")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.accessCode) {
          setAccessCode(data.accessCode);
          localStorage.setItem("trade_discipline_code", data.accessCode);
        }
      })
      .catch((err) => console.warn("Failed to fetch auth session:", err));
  }, []);

  const handleCopyCode = () => {
    if (!accessCode) return;
    navigator.clipboard.writeText(accessCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const navItems = [
    { href: "/", label: "今日看板", icon: Shield },
    { href: "/calculator", label: "仓位计算器", icon: Calculator },
    { href: "/trades", label: "交易日志", icon: BarChart3 },
    { href: "/backtest", label: "点位回测", icon: LineChart },
    { href: "/settings", label: "系统设置", icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#111827]/90 backdrop-blur border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-lg text-white tracking-wide">持仓纪律</span>
                <span className="hidden sm:inline-block ml-2 text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                  实盘执行助手
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-gray-800 text-emerald-400 font-semibold"
                      : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: Access Code Badge */}
          <div className="flex items-center gap-2">
            {accessCode ? (
              <button
                onClick={handleCopyCode}
                title="点击复制访问码 (多设备同步使用)"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700 text-xs font-mono text-gray-300 transition-colors cursor-pointer"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">访问码:</span>
                <span className="text-gray-200 font-bold">{accessCode.substring(0, 9)}...</span>
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
            ) : null}
          </div>
        </div>

        {/* Mobile Nav Bar */}
        <div className="md:hidden flex items-center justify-around py-2 border-t border-gray-800/60 text-xs">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 py-1 px-2 rounded ${
                  isActive ? "text-emerald-400 font-semibold" : "text-gray-400"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
