import type { MarketState, Signal } from './contracts';
import { isSignal } from './contracts';

export type StrategyPlugin = {
  name: string;
  evaluate: (marketState: MarketState) => Signal[];
};

export class StrategyRegistry {
  private readonly plugins = new Map<string, StrategyPlugin>();

  register(plugin: StrategyPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Strategy '${plugin.name}' is already registered`);
    }

    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  evaluateAll(marketState: MarketState): Signal[] {
    const aggregated: Signal[] = [];

    for (const plugin of this.plugins.values()) {
      const signals = plugin.evaluate(marketState);
      for (const signal of signals) {
        if (!isSignal(signal)) {
          throw new Error(`Strategy '${plugin.name}' produced invalid signal payload`);
        }
        aggregated.push(signal);
      }
    }

    return aggregated;
  }
}
