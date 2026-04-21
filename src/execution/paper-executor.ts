import type { ExecutionIntent } from '../strategy/contracts';

export type PaperFill = {
  fillId: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  executedSize: number;
  executedPrice: number;
  timestamp: string;
};

type PositionState = {
  size: number;
  avgPrice: number;
};

export type PaperPortfolioState = {
  positions: Record<string, PositionState>;
  realizedPnl: number;
};

export class PaperExecutor {
  private readonly slippageBps: number;
  private readonly persistFill?: (fill: PaperFill) => Promise<void>;

  private readonly positions = new Map<string, PositionState>();
  private realizedPnl = 0;
  private fillSequence = 0;

  constructor(input: { slippageBps: number; persistFill?: (fill: PaperFill) => Promise<void> }) {
    this.slippageBps = input.slippageBps;
    this.persistFill = input.persistFill;
  }

  async execute(intent: ExecutionIntent): Promise<PaperFill> {
    const basePrice = intent.price ?? 0.5;
    const slipMultiplier = 1 + (this.slippageBps / 10_000) * (intent.side === 'BUY' ? 1 : -1);
    const executedPrice = Math.round(basePrice * slipMultiplier * 1_000_000) / 1_000_000;

    const fill: PaperFill = {
      fillId: `paper-fill-${++this.fillSequence}`,
      marketId: intent.marketId,
      tokenId: intent.tokenId,
      side: intent.side,
      executedSize: intent.size,
      executedPrice,
      timestamp: new Date().toISOString()
    };

    this.applyFill(fill);

    if (this.persistFill) {
      await this.persistFill(fill);
    }

    return fill;
  }

  getPortfolioState(): PaperPortfolioState {
    const positions: Record<string, PositionState> = {};
    for (const [key, position] of this.positions.entries()) {
      positions[key] = { ...position };
    }

    return {
      positions,
      realizedPnl: Math.round(this.realizedPnl * 1_000_000) / 1_000_000
    };
  }

  private applyFill(fill: PaperFill): void {
    const key = `${fill.marketId}:${fill.tokenId}`;
    const current = this.positions.get(key) ?? { size: 0, avgPrice: 0 };

    if (fill.side === 'BUY') {
      const totalCost = current.avgPrice * current.size + fill.executedPrice * fill.executedSize;
      const nextSize = current.size + fill.executedSize;
      const nextAvg = nextSize === 0 ? 0 : totalCost / nextSize;

      this.positions.set(key, {
        size: nextSize,
        avgPrice: Math.round(nextAvg * 1_000_000) / 1_000_000
      });
      return;
    }

    const sellSize = Math.min(current.size, fill.executedSize);
    const realized = (fill.executedPrice - current.avgPrice) * sellSize;
    this.realizedPnl += realized;

    const remaining = current.size - sellSize;
    this.positions.set(key, {
      size: remaining,
      avgPrice: remaining > 0 ? current.avgPrice : 0
    });
  }
}
