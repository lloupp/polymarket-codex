import type { ExecutionIntent } from '../strategy/contracts';

export type RiskDecision = 'ACCEPT' | 'BLOCK';

export type PortfolioExposureSnapshot = {
  marketExposureNotional: number;
  globalExposureNotional: number;
};

export type RiskDecisionInput = {
  intent: ExecutionIntent;
  exposure: PortfolioExposureSnapshot;
};

export type RiskDecisionOutput = {
  decision: RiskDecision;
  reasons: string[];
  metrics: {
    tradeNotional: number;
    projectedMarketNotional: number;
    projectedGlobalNotional: number;
  };
};

export type PreTradeRiskLimits = {
  maxTradeNotional: number;
  maxMarketNotional: number;
  maxGlobalNotional: number;
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export class PreTradeRiskEngine {
  private readonly limits: PreTradeRiskLimits;

  constructor(limits: PreTradeRiskLimits) {
    this.limits = limits;
  }

  evaluate(input: RiskDecisionInput): RiskDecisionOutput {
    const referencePrice = input.intent.price ?? 1;
    const tradeNotional = round(input.intent.size * referencePrice);

    const projectedMarketNotional = round(input.exposure.marketExposureNotional + tradeNotional);
    const projectedGlobalNotional = round(input.exposure.globalExposureNotional + tradeNotional);

    const reasons: string[] = [];

    if (tradeNotional > this.limits.maxTradeNotional) {
      reasons.push(
        `trade limit exceeded: trade_notional=${tradeNotional} > max_trade_notional=${this.limits.maxTradeNotional}`
      );
    }

    if (projectedMarketNotional > this.limits.maxMarketNotional) {
      reasons.push(
        `market limit exceeded: projected_market_notional=${projectedMarketNotional} > max_market_notional=${this.limits.maxMarketNotional}`
      );
    }

    if (projectedGlobalNotional > this.limits.maxGlobalNotional) {
      reasons.push(
        `global limit exceeded: projected_global_notional=${projectedGlobalNotional} > max_global_notional=${this.limits.maxGlobalNotional}`
      );
    }

    if (reasons.length === 0) {
      reasons.push('within configured risk limits');
    }

    return {
      decision: reasons.some((reason) => reason.includes('exceeded')) ? 'BLOCK' : 'ACCEPT',
      reasons,
      metrics: {
        tradeNotional,
        projectedMarketNotional,
        projectedGlobalNotional
      }
    };
  }
}
