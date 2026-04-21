import type { MarketState, Signal } from '../contracts';
import type { StrategyPlugin } from '../registry';
import { calculateEdge } from '../edge-calculator';

export type NegRiskArbOptions = {
  name: string;
  fees: number;
  slippageEstimate: number;
  ttlMs: number;
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export class NegRiskArbStrategy implements StrategyPlugin {
  readonly name: string;
  private readonly fees: number;
  private readonly slippageEstimate: number;
  private readonly ttlMs: number;

  constructor(options: NegRiskArbOptions) {
    this.name = options.name;
    this.fees = options.fees;
    this.slippageEstimate = options.slippageEstimate;
    this.ttlMs = options.ttlMs;
  }

  evaluate(marketState: MarketState): Signal[] {
    if (!marketState.active || marketState.closed || marketState.outcomes.length < 2) {
      return [];
    }

    const askSum = round(
      marketState.outcomes.reduce((total, outcome) => total + Math.max(0, outcome.ask), 0)
    );

    const edge = calculateEdge({
      marketId: marketState.marketId,
      tokenId: 'multi-outcome-bundle',
      fairProb: 1,
      marketPrice: askSum,
      fees: this.fees,
      slippageEstimate: this.slippageEstimate
    });

    if (edge.netEdge <= 0) {
      return [];
    }

    const ranked = [...marketState.outcomes].sort((a, b) => a.ask - b.ask);
    const confidence = Math.min(0.99, Math.max(0.5, 0.5 + edge.netEdge));

    return ranked.map((outcome, index) => ({
      strategy: this.name,
      marketId: marketState.marketId,
      tokenId: outcome.tokenId,
      side: 'BUY',
      confidence,
      edge: edge.netEdge,
      reason: `negrisk_arb ask_sum=${askSum.toFixed(4)} net_edge=${edge.netEdge.toFixed(4)}`,
      timestamp: marketState.updatedAt,
      metadata: {
        ttlMs: this.ttlMs,
        expectedEdgeBps: edge.netEdgeBps,
        rank: index + 1,
        askSum,
        outcomeAsk: outcome.ask,
        breakdown: edge.breakdown
      }
    }));
  }
}
