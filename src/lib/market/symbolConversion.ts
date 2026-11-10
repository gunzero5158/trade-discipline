/**
 * Canonical symbol/market classification helpers.
 *
 * These rules used to be copy-pasted across the analyze/quotes routes,
 * ashareRealtime and market.ts, and the copies had drifted (some used a loose
 * "starts with 6" rule that misclassified 900xxx Shanghai B-shares as Shenzhen).
 *
 * A-share code ranges:
 *   Shanghai: 60xxxx (main board), 68xxxx (STAR market), 900xxx (B-shares)
 *   Shenzhen: everything else (00xxxx main, 30xxxx ChiNext, 200xxx B-shares)
 */
export function isShanghaiAShareCode(code: string): boolean {
  return code.startsWith("60") || code.startsWith("68") || code.startsWith("90");
}

/** Converts a bare 6-digit A-share code to a Yahoo-style suffixed symbol. */
export function aShareCodeToSuffixedSymbol(code: string): string {
  return isShanghaiAShareCode(code) ? `${code}.SS` : `${code}.SZ`;
}

/**
 * Converts a user-facing symbol to an EastMoney secid.
 * Supports A-shares (1./0.), HK (116.), Japan (176.) and US (105.) symbols; null otherwise.
 */
export function convertSymbolToEastMoneySecid(symbol: string): string | null {
  const clean = symbol.trim().toUpperCase();

  // 1. A-share (e.g. 600519.SS, 000001.SZ, 300059.SZ, 688001.SH)
  if (clean.endsWith(".SS") || clean.endsWith(".SH")) {
    return `1.${clean.split(".")[0]}`;
  }
  if (clean.endsWith(".SZ")) {
    return `0.${clean.split(".")[0]}`;
  }
  // A-share raw numbers without suffix (e.g. 600519)
  if (/^\d{6}$/.test(clean)) {
    return isShanghaiAShareCode(clean) ? `1.${clean}` : `0.${clean}`;
  }

  // 2. HK stock (e.g. 0700.HK, 9988.HK)
  if (clean.endsWith(".HK")) {
    const code = clean.split(".")[0].padStart(5, "0");
    return `116.${code}`;
  }
  if (/^\d{4,5}$/.test(clean) && !clean.includes(".")) {
    return `116.${clean.padStart(5, "0")}`;
  }

  // 3. Japan stock (e.g. 7203.T, 9984.T, 285A.T)
  if (/^\d{3}[0-9A-Z]\.T$/.test(clean)) {
    return `176.${clean.slice(0, -2)}`;
  }

  // 4. US stock (e.g. AAPL, TSLA, MSFT)
  if (/^[A-Z]{1,5}$/.test(clean)) {
    return `105.${clean}`;
  }

  return null;
}

/**
 * US symbols can live on NASDAQ (105), NYSE (106) or AMEX (107) — return all
 * candidates so callers can probe each market.
 */
export function getEastMoneySecidCandidates(symbol: string): string[] {
  const clean = symbol.trim().toUpperCase();
  if (/^[A-Z]{1,5}$/.test(clean)) {
    return [`105.${clean}`, `106.${clean}`, `107.${clean}`];
  }

  const secid = convertSymbolToEastMoneySecid(clean);
  return secid ? [secid] : [];
}

/** A-share-only secid conversion; returns null for HK/US/unknown symbols. */
export function convertSymbolToEastMoneyAShareSecid(symbol: string): string | null {
  const clean = symbol.trim().toUpperCase();
  if (clean.endsWith(".SS") || clean.endsWith(".SH")) {
    return `1.${clean.split(".")[0]}`;
  }
  if (clean.endsWith(".SZ")) {
    return `0.${clean.split(".")[0]}`;
  }
  if (/^\d{6}$/.test(clean)) {
    return isShanghaiAShareCode(clean) ? `1.${clean}` : `0.${clean}`;
  }
  return null;
}
