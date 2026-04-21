type JsonObject = Record<string, unknown>;

export type StrategySide = 'BUY' | 'SELL' | 'HOLD';

export type MarketOutcomeState = {
  tokenId: string;
  outcome: string;
  bid: number;
  ask: number;
  lastPrice: number;
  liquidity: number;
};

export type MarketState = {
  marketId: string;
  question: string;
  active: boolean;
  closed: boolean;
  updatedAt: string;
  outcomes: MarketOutcomeState[];
  metadata?: JsonObject;
};

export type Signal = {
  strategy: string;
  marketId: string;
  tokenId: string;
  side: StrategySide;
  confidence: number;
  edge: number;
  reason: string;
  timestamp: string;
  metadata?: JsonObject;
};

export type Opportunity = {
  signal: Signal;
  marketState: MarketState;
  fairPrice: number;
  expectedValue: number;
};

export type OrderType = 'LIMIT' | 'MARKET';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export type ExecutionIntent = {
  marketId: string;
  tokenId: string;
  side: Exclude<StrategySide, 'HOLD'>;
  orderType: OrderType;
  size: number;
  price?: number;
  timeInForce: TimeInForce;
  sourceSignal: Signal;
  riskTags: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMarketOutcomeState(value: unknown): value is MarketOutcomeState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.tokenId === 'string' &&
    value.tokenId.length > 0 &&
    typeof value.outcome === 'string' &&
    value.outcome.length > 0 &&
    isFiniteNumber(value.bid) &&
    isFiniteNumber(value.ask) &&
    isFiniteNumber(value.lastPrice) &&
    isFiniteNumber(value.liquidity)
  );
}

export function isMarketState(value: unknown): value is MarketState {
  if (!isRecord(value)) {
    return false;
  }

  const outcomes = value.outcomes;

  return (
    typeof value.marketId === 'string' &&
    value.marketId.length > 0 &&
    typeof value.question === 'string' &&
    typeof value.active === 'boolean' &&
    typeof value.closed === 'boolean' &&
    isIsoDate(value.updatedAt) &&
    Array.isArray(outcomes) &&
    outcomes.every((outcome) => isMarketOutcomeState(outcome))
  );
}

export function isSignal(value: unknown): value is Signal {
  if (!isRecord(value)) {
    return false;
  }

  const side = value.side;

  return (
    typeof value.strategy === 'string' &&
    value.strategy.length > 0 &&
    typeof value.marketId === 'string' &&
    value.marketId.length > 0 &&
    typeof value.tokenId === 'string' &&
    value.tokenId.length > 0 &&
    (side === 'BUY' || side === 'SELL' || side === 'HOLD') &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isFiniteNumber(value.edge) &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    isIsoDate(value.timestamp)
  );
}

export function isOpportunity(value: unknown): value is Opportunity {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isSignal(value.signal) &&
    isMarketState(value.marketState) &&
    isFiniteNumber(value.fairPrice) &&
    isFiniteNumber(value.expectedValue)
  );
}

export function isExecutionIntent(value: unknown): value is ExecutionIntent {
  if (!isRecord(value)) {
    return false;
  }

  const side = value.side;
  const orderType = value.orderType;
  const timeInForce = value.timeInForce;

  const validPrice =
    value.price === undefined || (isFiniteNumber(value.price) && value.price > 0);

  return (
    typeof value.marketId === 'string' &&
    value.marketId.length > 0 &&
    typeof value.tokenId === 'string' &&
    value.tokenId.length > 0 &&
    (side === 'BUY' || side === 'SELL') &&
    (orderType === 'LIMIT' || orderType === 'MARKET') &&
    isFiniteNumber(value.size) &&
    value.size > 0 &&
    validPrice &&
    (timeInForce === 'GTC' || timeInForce === 'IOC' || timeInForce === 'FOK') &&
    isSignal(value.sourceSignal) &&
    Array.isArray(value.riskTags) &&
    value.riskTags.every((tag) => typeof tag === 'string' && tag.length > 0)
  );
}
