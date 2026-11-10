import { aShareCodeToSuffixedSymbol } from "./symbolConversion";

export function getMarketCurrencySymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase();

  if (clean.endsWith(".HK") || (/^\d{4,5}$/.test(clean) && !clean.includes("."))) {
    return "HK$";
  }

  if (clean.endsWith(".T") || /^\d{3}[A-Z]$/.test(clean)) {
    return "\u00A5";
  }

  if (
    clean.endsWith(".SS") ||
    clean.endsWith(".SH") ||
    clean.endsWith(".SZ") ||
    /^\d{6}$/.test(clean)
  ) {
    return "\u00A5";
  }

  return "$";
}

export function normalizeManualSymbolInput(symbol: string): string {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return "";

  const aShare = clean.match(/^(\d{6})\.(SS|SH|SZ)$/);
  if (aShare) {
    const [, code, market] = aShare;
    return market === "SZ" ? `${code}.SZ` : `${code}.SS`;
  }

  if (/^\d{6}$/.test(clean)) {
    return aShareCodeToSuffixedSymbol(clean);
  }

  const hk = clean.match(/^(\d{1,5})(?:\.HK)?$/);
  if (hk) {
    const rawCode = hk[1];
    const code = rawCode.length === 5 && rawCode.startsWith("0") && !rawCode.startsWith("00")
      ? rawCode
      : String(Number(rawCode)).padStart(4, "0");
    return `${code}.HK`;
  }

  if (/^\d{3}[A-Z](?:\.T)?$/.test(clean)) {
    return clean.endsWith(".T") ? clean : `${clean}.T`;
  }

  return clean;
}

export function formatMarketPrice(symbol: string, price: number): string {
  const currency = getMarketCurrencySymbol(symbol);
  return `${currency}${price.toFixed(2)}`;
}

export function replaceDollarPriceSymbols(text: string, currencySymbol: string): string {
  if (currencySymbol === "$") return text;
  return text.replace(/(^|[^A-Za-z])\$(?=\d)/g, (_match, prefix: string) => `${prefix}${currencySymbol}`);
}
