import test from 'node:test';
import assert from 'node:assert/strict';

import { StrategyRegistry } from '../../src/strategy/registry';
import type { StrategyPlugin } from '../../src/strategy/registry';

test('STRAT-002: registry deve permitir coexistência de duas estratégias sem alterar core', () => {
  const registry = new StrategyRegistry();

  const s1: StrategyPlugin = {
    name: 'strategy-a',
    evaluate: (marketState) => [
      {
        strategy: 'strategy-a',
        marketId: marketState.marketId,
        tokenId: marketState.outcomes[0]?.tokenId ?? 'token-a',
        side: 'BUY',
        confidence: 0.7,
        edge: 0.03,
        reason: 'A',
        timestamp: marketState.updatedAt
      }
    ]
  };

  const s2: StrategyPlugin = {
    name: 'strategy-b',
    evaluate: (marketState) => [
      {
        strategy: 'strategy-b',
        marketId: marketState.marketId,
        tokenId: marketState.outcomes[0]?.tokenId ?? 'token-b',
        side: 'SELL',
        confidence: 0.62,
        edge: 0.02,
        reason: 'B',
        timestamp: marketState.updatedAt
      }
    ]
  };

  registry.register(s1);
  registry.register(s2);

  const signals = registry.evaluateAll({
    marketId: 'm-1',
    question: 'BTC > 100k?',
    active: true,
    closed: false,
    updatedAt: '2026-04-21T20:00:00.000Z',
    outcomes: [{ tokenId: 'yes-token', outcome: 'YES', bid: 0.5, ask: 0.52, lastPrice: 0.51, liquidity: 10000 }]
  });

  assert.equal(signals.length, 2);
  assert.deepEqual(
    signals.map((signal) => signal.strategy).sort(),
    ['strategy-a', 'strategy-b']
  );
});

test('STRAT-002: registry deve impedir registro duplicado por nome', () => {
  const registry = new StrategyRegistry();

  const strategy: StrategyPlugin = {
    name: 'dup-strategy',
    evaluate: () => []
  };

  registry.register(strategy);

  assert.throws(() => {
    registry.register(strategy);
  }, /already registered/i);
});
