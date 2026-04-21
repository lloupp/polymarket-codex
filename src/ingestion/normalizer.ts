import type { MarketSnapshot, OrderBookSnapshot, TradeTick, TradeSide } from '../types';

function toIso(value?: string): string {
  return new Date(value ?? Date.now()).toISOString();
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${String(value)}`);
  }
  return parsed;
}

function readMarketId(payload: Record<string, unknown>): string {
  const marketId = (payload.id ?? payload.market ?? payload.market_id) as string | undefined;
  if (!marketId || String(marketId).trim() === '') {
    throw new Error('Invalid market id in payload');
  }
  return String(marketId);
}

export function normalizeMarketSnapshot(input: Record<string, unknown>): MarketSnapshot {
  const marketId = readMarketId(input);

  const tokens = Array.isArray(input.tokens) ? input.tokens : [];
  const outcomes = tokens.map((token) => {
    const item = token as Record<string, unknown>;
    return {
      tokenId: String(item.token_id ?? item.tokenId ?? ''),
      outcome: String(item.outcome ?? ''),
      price: toNumber(item.price ?? 0)
    };
  });

  return {
    marketId,
    slug: String(input.slug ?? ''),
    question: String(input.question ?? ''),
    active: Boolean(input.active),
    endDate: input.endDate ? toIso(String(input.endDate)) : null,
    outcomes
  };
}

export function normalizeOrderBookSnapshot(input: Record<string, unknown>): OrderBookSnapshot {
  const marketId = readMarketId(input);
  const tokenId = String(input.token_id ?? input.tokenId ?? '');
  if (!tokenId) {
    throw new Error('Invalid token id in orderbook payload');
  }

  const bidsRaw = Array.isArray(input.bids) ? input.bids : [];
  const asksRaw = Array.isArray(input.asks) ? input.asks : [];

  return {
    marketId,
    tokenId,
    bids: bidsRaw.map((level) => {
      const item = level as Record<string, unknown>;
      return { price: toNumber(item.price), size: toNumber(item.size) };
    }),
    asks: asksRaw.map((level) => {
      const item = level as Record<string, unknown>;
      return { price: toNumber(item.price), size: toNumber(item.size) };
    }),
    timestamp: toIso((input.timestamp as string | undefined) ?? undefined)
  };
}

export function normalizeTradeTick(input: Record<string, unknown>): TradeTick {
  const marketId = readMarketId(input);
  const tokenId = String(input.token_id ?? input.tokenId ?? '');
  const tradeId = String(input.trade_id ?? input.tradeId ?? '');
  const side = String(input.side ?? '').toUpperCase() as TradeSide;

  if (!tokenId) {
    throw new Error('Invalid token id in trade payload');
  }

  if (!tradeId) {
    throw new Error('Invalid trade id in trade payload');
  }

  if (side !== 'BUY' && side !== 'SELL') {
    throw new Error('Invalid trade side in trade payload');
  }

  return {
    tradeId,
    marketId,
    tokenId,
    side,
    price: toNumber(input.price),
    size: toNumber(input.size),
    timestamp: toIso((input.timestamp as string | undefined) ?? undefined)
  };
}
