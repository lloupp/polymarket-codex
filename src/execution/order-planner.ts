import type { ExecutionIntent, Signal, TimeInForce } from '../strategy/contracts';

type OrderTypeHint = 'LIMIT' | 'MARKET';

type PlannerSignal = Signal & {
  metadata?: Record<string, unknown>;
};

export type OrderPlannerInput = {
  signals: PlannerSignal[];
  defaultSize: number;
  defaultTifForLimit: TimeInForce;
  defaultTifForMarket: TimeInForce;
};

function readOrderType(signal: PlannerSignal): OrderTypeHint {
  const hint = signal.metadata?.orderType;
  if (hint === 'LIMIT' || hint === 'MARKET') {
    return hint;
  }
  return 'LIMIT';
}

function readLimitPrice(signal: PlannerSignal): number | undefined {
  const raw = signal.metadata?.limitPrice;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return undefined;
}

export function planExecutionIntents(input: OrderPlannerInput): ExecutionIntent[] {
  const intents: ExecutionIntent[] = [];

  for (const signal of input.signals) {
    if (signal.side === 'HOLD') {
      continue;
    }

    const orderType = readOrderType(signal);
    const timeInForce = orderType === 'LIMIT' ? input.defaultTifForLimit : input.defaultTifForMarket;
    const limitPrice = readLimitPrice(signal);

    intents.push({
      marketId: signal.marketId,
      tokenId: signal.tokenId,
      side: signal.side,
      orderType,
      size: input.defaultSize,
      price: orderType === 'LIMIT' ? limitPrice : undefined,
      timeInForce,
      sourceSignal: signal,
      riskTags: ['planned-by-order-planner']
    });
  }

  return intents;
}
