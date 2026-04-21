import test from 'node:test';
import assert from 'node:assert/strict';

import { NegRiskArbStrategy } from '../../src/strategy/strategies/neg-risk-arb';

test('STRAT-004: deve gerar sinais NegRisk quando oportunidade multi-outcome é positiva', () => {
  const strategy = new NegRiskArbStrategy({
    name: 'neg-risk-arb-mvp',
    fees: 0.01,
    slippageEstimate: 0.005,
    ttlMs: 20_000
  });

  const signals = strategy.evaluate({
    marketId: 'm-pos',
    question: 'Mercado com arbitragem positiva',
    active: true,
    closed: false,
    updatedAt: '2026-04-21T21:00:00.000Z',
    outcomes: [
      { tokenId: 'yes', outcome: 'YES', bid: 0.3, ask: 0.35, lastPrice: 0.34, liquidity: 12000 },
      { tokenId: 'no', outcome: 'NO', bid: 0.31, ask: 0.36, lastPrice: 0.35, liquidity: 11800 }
    ]
  });

  assert.equal(signals.length, 2);
  assert.equal(signals[0]?.strategy, 'neg-risk-arb-mvp');
  assert.equal(signals[0]?.side, 'BUY');
  assert.equal(signals[0]?.metadata?.ttlMs, 20_000);
  assert.equal(typeof signals[0]?.metadata?.expectedEdgeBps, 'number');
  assert.equal((signals[0]?.metadata?.expectedEdgeBps as number) > 0, true);
  assert.equal((signals[0]?.metadata?.rank as number) <= (signals[1]?.metadata?.rank as number), true);
});

test('STRAT-004: não deve gerar sinais quando oportunidade multi-outcome é negativa', () => {
  const strategy = new NegRiskArbStrategy({
    name: 'neg-risk-arb-mvp',
    fees: 0.01,
    slippageEstimate: 0.005,
    ttlMs: 20_000
  });

  const signals = strategy.evaluate({
    marketId: 'm-neg',
    question: 'Mercado sem arbitragem',
    active: true,
    closed: false,
    updatedAt: '2026-04-21T21:05:00.000Z',
    outcomes: [
      { tokenId: 'yes', outcome: 'YES', bid: 0.49, ask: 0.52, lastPrice: 0.5, liquidity: 12000 },
      { tokenId: 'no', outcome: 'NO', bid: 0.48, ask: 0.51, lastPrice: 0.49, liquidity: 12000 }
    ]
  });

  assert.deepEqual(signals, []);
});
