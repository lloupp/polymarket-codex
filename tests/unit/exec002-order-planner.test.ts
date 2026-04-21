import test from 'node:test';
import assert from 'node:assert/strict';

import { planExecutionIntents } from '../../src/execution/order-planner';
import type { Signal } from '../../src/strategy/contracts';

function signal(partial: Partial<Signal> = {}): Signal {
  return {
    strategy: 'neg-risk-arb-mvp',
    marketId: 'm-1',
    tokenId: 'yes',
    side: 'BUY',
    confidence: 0.7,
    edge: 0.03,
    reason: 'edge positiva',
    timestamp: '2026-04-21T22:00:00.000Z',
    ...partial
  };
}

test('EXEC-002: deve converter sinais em intents válidos LIMIT + MARKET com TIF', () => {
  const intents = planExecutionIntents({
    defaultSize: 100,
    defaultTifForLimit: 'GTC',
    defaultTifForMarket: 'IOC',
    signals: [
      signal({ marketId: 'm-limit', tokenId: 'yes', metadata: { orderType: 'LIMIT', limitPrice: 0.51 } }),
      signal({ marketId: 'm-market', tokenId: 'no', metadata: { orderType: 'MARKET' } })
    ]
  });

  assert.equal(intents.length, 2);

  assert.equal(intents[0]?.orderType, 'LIMIT');
  assert.equal(intents[0]?.timeInForce, 'GTC');
  assert.equal(intents[0]?.price, 0.51);

  assert.equal(intents[1]?.orderType, 'MARKET');
  assert.equal(intents[1]?.timeInForce, 'IOC');
  assert.equal(intents[1]?.price, undefined);
});

test('EXEC-002: deve gerar intents para múltiplos sinais e ignorar HOLD', () => {
  const intents = planExecutionIntents({
    defaultSize: 10,
    defaultTifForLimit: 'GTC',
    defaultTifForMarket: 'IOC',
    signals: [
      signal({ side: 'BUY', metadata: { orderType: 'MARKET' } }),
      signal({ side: 'SELL', tokenId: 'no', metadata: { orderType: 'LIMIT', limitPrice: 0.4 } }),
      signal({ side: 'HOLD' })
    ]
  });

  assert.equal(intents.length, 2);
  assert.deepEqual(intents.map((intent) => intent.side), ['BUY', 'SELL']);
});
