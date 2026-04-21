import type { Logger } from '../logger';

export type EdgeInput = {
  marketId: string;
  tokenId: string;
  fairProb: number;
  marketPrice: number;
  fees: number;
  slippageEstimate: number;
};

export type EdgeBreakdown = {
  fairProb: number;
  marketPrice: number;
  fees: number;
  slippageEstimate: number;
  grossEdge: number;
  netEdge: number;
  netEdgeBps: number;
};

export type EdgeResult = {
  marketId: string;
  tokenId: string;
  grossEdge: number;
  netEdge: number;
  netEdgeBps: number;
  breakdown: EdgeBreakdown;
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function calculateEdge(input: EdgeInput, options?: { logger?: Logger }): EdgeResult {
  const grossEdge = round(input.fairProb - input.marketPrice);
  const netEdge = round(grossEdge - input.fees - input.slippageEstimate);
  const netEdgeBps = Math.round(netEdge * 10_000);

  const breakdown: EdgeBreakdown = {
    fairProb: input.fairProb,
    marketPrice: input.marketPrice,
    fees: input.fees,
    slippageEstimate: input.slippageEstimate,
    grossEdge,
    netEdge,
    netEdgeBps
  };

  options?.logger?.info('edge_calculated', {
    marketId: input.marketId,
    tokenId: input.tokenId,
    breakdown
  });

  return {
    marketId: input.marketId,
    tokenId: input.tokenId,
    grossEdge,
    netEdge,
    netEdgeBps,
    breakdown
  };
}
