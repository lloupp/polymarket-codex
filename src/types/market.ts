export type MarketOutcome = {
  tokenId: string;
  outcome: string;
  price: number;
};

export type MarketSnapshot = {
  marketId: string;
  slug: string;
  question: string;
  active: boolean;
  endDate: string | null;
  outcomes: MarketOutcome[];
};

export type OrderLevel = {
  price: number;
  size: number;
};

export type OrderBookSnapshot = {
  marketId: string;
  tokenId: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  timestamp: string;
};

export type TradeSide = 'BUY' | 'SELL';

export type TradeTick = {
  tradeId: string;
  marketId: string;
  tokenId: string;
  side: TradeSide;
  price: number;
  size: number;
  timestamp: string;
};
