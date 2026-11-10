export const PROVIDER_FAILURE_THRESHOLD = 2;
export const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;

export type MarketDataProviderId =
  | "yahoo"
  | "yahoo-chart"
  | "kabutan"
  | "eastmoney"
  | "tonghuashun"
  | "optional-provider"
  | "tencent";

interface CircuitState {
  consecutiveFailures: number;
  openUntil: number;
}

export class ProviderCircuitBreaker {
  private readonly states = new Map<MarketDataProviderId, CircuitState>();

  constructor(
    private readonly failureThreshold = PROVIDER_FAILURE_THRESHOLD,
    private readonly cooldownMs = PROVIDER_COOLDOWN_MS,
  ) {}

  shouldAttempt(provider: MarketDataProviderId, alreadySucceeded: boolean, now = Date.now()): boolean {
    if (alreadySucceeded) return false;

    const state = this.states.get(provider);
    if (!state) return true;
    if (state.openUntil > now) return false;

    if (state.openUntil > 0) {
      this.states.delete(provider);
    }
    return true;
  }

  recordSuccess(provider: MarketDataProviderId): void {
    this.states.delete(provider);
  }

  recordFailure(provider: MarketDataProviderId, now = Date.now()): void {
    const previous = this.states.get(provider);
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    this.states.set(provider, {
      consecutiveFailures,
      openUntil: consecutiveFailures >= this.failureThreshold ? now + this.cooldownMs : 0,
    });
  }
}

export interface ProviderChainResult<T, P extends MarketDataProviderId = MarketDataProviderId> {
  provider: P;
  value: T;
}

interface ProviderChainOptions<P extends MarketDataProviderId> {
  circuitBreaker?: ProviderCircuitBreaker;
  onFailure?: (provider: P, error?: unknown) => void;
}

const globalCircuitStore = globalThis as typeof globalThis & {
  zenithMarketDataCircuitBreaker?: ProviderCircuitBreaker;
};

export const marketDataCircuitBreaker =
  globalCircuitStore.zenithMarketDataCircuitBreaker ?? new ProviderCircuitBreaker();

globalCircuitStore.zenithMarketDataCircuitBreaker = marketDataCircuitBreaker;

export async function runSequentialProviderChain<T, P extends MarketDataProviderId>(
  providers: readonly P[],
  attempt: (provider: P) => Promise<T | null>,
  options: ProviderChainOptions<P> = {},
): Promise<ProviderChainResult<T, P> | null> {
  const circuitBreaker = options.circuitBreaker ?? marketDataCircuitBreaker;

  for (const provider of providers) {
    if (!circuitBreaker.shouldAttempt(provider, false)) continue;

    try {
      const value = await attempt(provider);
      if (value === null) {
        circuitBreaker.recordFailure(provider);
        options.onFailure?.(provider);
        continue;
      }

      circuitBreaker.recordSuccess(provider);
      return { provider, value };
    } catch (error: unknown) {
      circuitBreaker.recordFailure(provider);
      options.onFailure?.(provider, error);
    }
  }

  return null;
}
