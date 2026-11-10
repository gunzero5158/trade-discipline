import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "持仓纪律工具 - 每日收盘自动计算出场线",
  description: "把每天收盘后的两步手工计算交给程序，人只负责看结论与知行合一。不下单，不选股，管好每一笔交易风险。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-[#0a0e17] text-gray-100 min-h-screen flex flex-col antialiased">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
        <footer className="border-t border-gray-800 py-6 text-center text-xs text-gray-500">
          <p>持仓纪律工具 · 止损要硬，止盈要慢 · 胜率靠数，知行合一</p>
        </footer>
      </body>
    </html>
  );
}
