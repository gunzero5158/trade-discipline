import { describe, it, expect } from "vitest";
import { getMarketRegion, getMarketDataPriority } from "../marketDataPriority";
import {
  isShanghaiAShareCode,
  aShareCodeToSuffixedSymbol,
  convertSymbolToEastMoneySecid,
} from "../symbolConversion";
import { normalizeManualSymbolInput } from "../market";

describe("行情模块代码转换与市场优先级测试", () => {
  it("A 股、港股、美股、日股市场分类判断", () => {
    expect(getMarketRegion("600519")).toBe("a-share");
    expect(getMarketRegion("600519.SS")).toBe("a-share");
    expect(getMarketRegion("000001.SZ")).toBe("a-share");
    expect(getMarketRegion("0700.HK")).toBe("hong-kong");
    expect(getMarketRegion("9988.HK")).toBe("hong-kong");
    expect(getMarketRegion("AAPL")).toBe("united-states");
    expect(getMarketRegion("TSLA")).toBe("united-states");
    expect(getMarketRegion("7203.T")).toBe("japan");
  });

  it("上海 A 股与深圳 A 股后缀规则", () => {
    expect(isShanghaiAShareCode("600519")).toBe(true);
    expect(isShanghaiAShareCode("688001")).toBe(true);
    expect(isShanghaiAShareCode("000001")).toBe(false);
    expect(isShanghaiAShareCode("300750")).toBe(false);

    expect(aShareCodeToSuffixedSymbol("600519")).toBe("600519.SS");
    expect(aShareCodeToSuffixedSymbol("000001")).toBe("000001.SZ");
  });

  it("东财 Secid 转换", () => {
    expect(convertSymbolToEastMoneySecid("600519")).toBe("1.600519");
    expect(convertSymbolToEastMoneySecid("000001")).toBe("0.000001");
    expect(convertSymbolToEastMoneySecid("0700.HK")).toBe("116.00700");
    expect(convertSymbolToEastMoneySecid("AAPL")).toBe("105.AAPL");
  });

  it("手动代码输入归一化", () => {
    expect(normalizeManualSymbolInput("600519")).toBe("600519.SS");
    expect(normalizeManualSymbolInput("000001")).toBe("000001.SZ");
    expect(normalizeManualSymbolInput("700")).toBe("0700.HK");
    expect(normalizeManualSymbolInput("AAPL")).toBe("AAPL");
  });

  it("优先级链路验证", () => {
    const aPriority = getMarketDataPriority("600519");
    expect(aPriority[0]).toBe("eastmoney");
    expect(aPriority).toContain("tonghuashun");
    expect(aPriority).toContain("tencent");

    const usPriority = getMarketDataPriority("AAPL");
    expect(usPriority[0]).toBe("yahoo");
  });
});
