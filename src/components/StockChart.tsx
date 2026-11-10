"use client";

import React, { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
} from "lightweight-charts";
import { Candle } from "@/lib/rules/softLine";
import { Lot, TradeRecord } from "@/lib/rules/types";

interface StockChartProps {
  candles: Candle[];
  hardLinePrice?: number;
  maSeries?: { time: string; value: number }[];
  maLabel?: string;
  softLineSeries?: { time: string; value: number }[];
  lots?: Lot[];
  trades?: TradeRecord[];
  height?: number;
}

export default function StockChart({
  candles,
  hardLinePrice,
  maSeries,
  maLabel = "均线",
  softLineSeries,
  lots = [],
  trades = [],
  height = 420,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: "#111827" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f293d" },
        horzLines: { color: "#1f293d" },
      },
      crosshair: {
        mode: 1,
      },
      timeScale: {
        borderColor: "#1f293d",
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: "#1f293d",
      },
    });
    chartRef.current = chart;

    // 1. K 线 Series (国内习惯：红涨绿跌)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#ef4444",
      downColor: "#10b981",
      borderVisible: false,
      wickUpColor: "#ef4444",
      wickDownColor: "#10b981",
    });

    const formattedCandles = candles.map((c) => ({
      time: typeof c.date === "string" ? c.date.substring(0, 10) : new Date(c.date).toISOString().substring(0, 10),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(formattedCandles);

    // 2. 成交量 Volume Series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const formattedVolumes = candles.map((c) => ({
      time: typeof c.date === "string" ? c.date.substring(0, 10) : new Date(c.date).toISOString().substring(0, 10),
      value: c.volume,
      color: c.close >= c.open ? "rgba(239, 68, 68, 0.3)" : "rgba(16, 185, 129, 0.3)",
    }));
    volumeSeries.setData(formattedVolumes);

    // 3. 均线 (MA/EMA) Line Series
    if (maSeries && maSeries.length > 0) {
      const maLine = chart.addSeries(LineSeries, {
        color: "#38bdf8", // 天蓝色
        lineWidth: 2,
        title: maLabel,
      });
      maLine.setData(maSeries);
    }

    // 4. 软线 (均线 - 余量) Line Series
    if (softLineSeries && softLineSeries.length > 0) {
      const softLine = chart.addSeries(LineSeries, {
        color: "#f59e0b", // 琥珀黄色虚线
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "软线阈值",
      });
      softLine.setData(softLineSeries);
    }

    // 5. 明日硬线水平价格线
    if (hardLinePrice && hardLinePrice > 0) {
      candleSeries.createPriceLine({
        price: hardLinePrice,
        color: "#f43f5e", // 亮红实线/虚线
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `明日硬线 ${hardLinePrice.toFixed(2)}`,
      });
    }

    chart.timeScale().fitContent();

    // 响应窗口尺寸变化
    const handleResize = () => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [candles, hardLinePrice, maSeries, maLabel, softLineSeries, height]);

  return (
    <div className="w-full relative rounded-xl overflow-hidden border border-gray-800 bg-gray-900">
      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  );
}
