import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../../src/logger';
import { calculateEdge } from '../../src/strategy/edge-calculator';

test('STRAT-003: deve calcular edge determinístico com breakdown completo', () => {
  const result = calculateEdge({
    marketId: 'm-1',
    tokenId: 'yes-token',
    fairProb: 0.62,
    marketPrice: 0.56,
    fees: 0.01,
    slippageEstimate: 0.005
  });

  assert.equal(result.grossEdge, 0.06);
  assert.equal(result.netEdge, 0.045);
  assert.equal(result.netEdgeBps, 450);
  assert.deepEqual(result.breakdown, {
    fairProb: 0.62,
    marketPrice: 0.56,
    fees: 0.01,
    slippageEstimate: 0.005,
    grossEdge: 0.06,
    netEdge: 0.045,
    netEdgeBps: 450
  });
});

test('STRAT-003: deve gerar logs com componentes do cálculo para auditoria', () => {
  const entries: Record<string, unknown>[] = [];
  const logger = createLogger({
    module: 'strategy.edge',
    traceId: 'trace-strat003',
    sink: (entry) => entries.push(entry)
  });

  const result = calculateEdge(
    {
      marketId: 'm-2',
      tokenId: 'no-token',
      fairProb: 0.44,
      marketPrice: 0.48,
      fees: 0.01,
      slippageEstimate: 0.002
    },
    { logger }
  );

  assert.equal(result.netEdge, -0.052);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.message, 'edge_calculated');
  assert.equal(entries[0]?.marketId, 'm-2');
  assert.equal(entries[0]?.tokenId, 'no-token');
  assert.deepEqual(entries[0]?.breakdown, result.breakdown);
});

test('STRAT-003: deve ser reproduzível para mesmo input', () => {
  const input = {
    marketId: 'm-3',
    tokenId: 'token-3',
    fairProb: 0.5,
    marketPrice: 0.49,
    fees: 0.005,
    slippageEstimate: 0.001
  };

  const first = calculateEdge(input);
  const second = calculateEdge(input);

  assert.deepEqual(first, second);
});
