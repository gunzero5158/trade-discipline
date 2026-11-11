import { describe, it, expect } from "vitest";
import { isLastBarLive } from "../session";

describe("交易时段判断：最后一根 K 线是否为盘中未收盘", () => {
  it("A 股盘中 (北京时间 10:30) 当日 K 线算盘中", () => {
    const now = new Date("2026-11-11T02:30:00Z"); // 北京 10:30
    expect(isLastBarLive("a-share", "2026-11-11", now)).toBe(true);
  });

  it("A 股收盘后 (北京时间 16:00) 当日 K 线算已收盘", () => {
    const now = new Date("2026-11-11T08:00:00Z"); // 北京 16:00
    expect(isLastBarLive("a-share", "2026-11-11", now)).toBe(false);
  });

  it("K 线日期不是今天则一定已收盘", () => {
    const now = new Date("2026-11-11T02:30:00Z");
    expect(isLastBarLive("a-share", "2026-11-10", now)).toBe(false);
  });

  it("美股按纽约时间判断：北京 06:00 (纽约前一天 17:00) 已收盘；北京 23:00 (纽约 10:00) 盘中", () => {
    const beijing0600 = new Date("2026-11-11T22:00:00Z"); // 北京 11-12 06:00，纽约 11-11 17:00
    expect(isLastBarLive("united-states", "2026-11-11", beijing0600)).toBe(false);
    const beijing2300 = new Date("2026-11-11T15:00:00Z"); // 北京 23:00，纽约 10:00
    expect(isLastBarLive("united-states", "2026-11-11", beijing2300)).toBe(true);
  });
});
