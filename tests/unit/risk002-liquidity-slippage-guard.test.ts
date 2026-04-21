import test from 'node:test';
import assert from 'node:assert/strict';

import { LiquiditySlippageGuard, type MarketDepthSnapshot } from '../../src/risk/liquidity-slippage-guard';
import type { ExecutionIntent } from '../../src/strategy/contracts';

function makeIntent(size: number): ExecutionIntent {
  return {
    marketId: 'm-1',
    tokenId: 'yes',
    side: 'BUY',
    orderType: 'LIMIT',
    size,
    price: 0.5,
    timeInForce: 'GTC',
    sourceSignal: {
      strategy: 'neg-risk-arb-mvp',
      marketId: 'm-1',
      tokenId: 'yes',
      side: 'BUY',
      confidence: 0.71,
      edge: 0.02,
      reason: 'spread favorável',
      timestamp: '2026-04-21T21:00:00.000Z'
    },
    riskTags: ['base']
  };
}

function makeDepth(levels: Array<{ price: number; size: number }>): MarketDepthSnapshot {
  return {
    marketId: 'm-1',
    tokenId: 'yes',
    asks: levels,
    bids: [{ price: 0.49, size: 300 }],
    timestamp: '2026-04-21T21:00:01.000Z'
  };
}

test('RISK-002: deve bloquear sinal com profundidade insuficiente', () => {
  const guard = new LiquiditySlippageGuard({
    minDepthSize: 200,
    maxSlippageBps: 80
  });

  const result = guard.evaluate({
    intent: makeIntent(150),
    depth: makeDepth([{ price: 0.5, size: 100 }])
  });

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reasons.some((r) => /insufficient depth/i.test(r)), true);
});

test('RISK-002: deve bloquear quando slippage estimado excede limite', () => {
  const guard = new LiquiditySlippageGuard({
    minDepthSize: 50,
    maxSlippageBps: 20
  });

  const result = guard.evaluate({
    intent: makeIntent(120),
    depth: makeDepth([
      { price: 0.5, size: 20 },
      { price: 0.56, size: 150 }
    ])
  });

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reasons.some((r) => /slippage limit exceeded/i.test(r)), true);
  assert.equal((result.metrics.estimatedSlippageBps ?? 0) > 20, true);
});

test('RISK-002: deve aceitar quando profundidade e slippage estão dentro do limite', () => {
  const guard = new LiquiditySlippageGuard({
    minDepthSize: 100,
    maxSlippageBps: 120
  });

  const result = guard.evaluate({
    intent: makeIntent(100),
    depth: makeDepth([
      { price: 0.5, size: 70 },
      { price: 0.503, size: 70 }
    ])
  });

  assert.equal(result.decision, 'ACCEPT');
  assert.equal(result.reasons.some((r) => /liquidity and slippage checks passed/i.test(r)), true);
});
