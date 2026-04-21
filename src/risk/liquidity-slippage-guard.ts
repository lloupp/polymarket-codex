import type { ExecutionIntent } from '../strategy/contracts';

export type MarketDepthLevel = {
  price: number;
  size: number;
};

export type MarketDepthSnapshot = {
  marketId: string;
  tokenId: string;
  asks: MarketDepthLevel[];
  bids: MarketDepthLevel[];
  timestamp: string;
};

export type LiquidityGuardInput = {
  intent: ExecutionIntent;
  depth: MarketDepthSnapshot;
};

export type LiquidityGuardOutput = {
  decision: 'ACCEPT' | 'BLOCK';
  reasons: string[];
  metrics: {
    requiredDepth: number;
    availableDepth: number;
    estimatedSlippageBps: number;
  };
};

export type LiquidityGuardLimits = {
  minDepthSize: number;
  maxSlippageBps: number;
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function estimateAverageExecutionPrice(levels: MarketDepthLevel[], size: number): number | null {
  let remaining = size;
  let notional = 0;

  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }

    const fill = Math.min(remaining, level.size);
    notional += fill * level.price;
    remaining -= fill;
  }

  if (remaining > 0) {
    return null;
  }

  return notional / size;
}

export class LiquiditySlippageGuard {
  private readonly limits: LiquidityGuardLimits;

  constructor(limits: LiquidityGuardLimits) {
    this.limits = limits;
  }

  evaluate(input: LiquidityGuardInput): LiquidityGuardOutput {
    const bookSide = input.intent.side === 'BUY' ? input.depth.asks : input.depth.bids;
    const availableDepth = round(bookSide.reduce((sum, level) => sum + level.size, 0));
    const requiredDepth = Math.max(this.limits.minDepthSize, input.intent.size);

    const reasons: string[] = [];

    if (availableDepth < requiredDepth) {
      reasons.push(
        `insufficient depth: available_depth=${availableDepth} < required_depth=${requiredDepth}`
      );
    }

    const referencePrice = input.intent.price ?? bookSide[0]?.price ?? 0;
    const averageExecutionPrice = estimateAverageExecutionPrice(bookSide, input.intent.size);

    let estimatedSlippageBps = Number.POSITIVE_INFINITY;
    if (referencePrice > 0 && averageExecutionPrice !== null) {
      const direction = input.intent.side === 'BUY' ? 1 : -1;
      estimatedSlippageBps = round(
        direction * ((averageExecutionPrice - referencePrice) / referencePrice) * 10_000,
        3
      );
    }

    if (estimatedSlippageBps > this.limits.maxSlippageBps) {
      reasons.push(
        `slippage limit exceeded: estimated_slippage_bps=${estimatedSlippageBps} > max_slippage_bps=${this.limits.maxSlippageBps}`
      );
    }

    if (reasons.length === 0) {
      reasons.push('liquidity and slippage checks passed');
    }

    return {
      decision: reasons.some((reason) => reason.includes('exceeded') || reason.includes('insufficient'))
        ? 'BLOCK'
        : 'ACCEPT',
      reasons,
      metrics: {
        requiredDepth,
        availableDepth,
        estimatedSlippageBps
      }
    };
  }
}
