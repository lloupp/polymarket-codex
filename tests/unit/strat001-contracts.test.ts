import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  isExecutionIntent,
  isMarketState,
  isOpportunity,
  isSignal
} from '../../src/strategy/contracts';

test('STRAT-001: deve validar Signal, MarketState, Opportunity e ExecutionIntent válidos', () => {
  const marketState = {
    marketId: 'm-1',
    question: 'BTC acima de 100k?',
    active: true,
    closed: false,
    updatedAt: '2026-04-21T20:30:00.000Z',
    outcomes: [
      { tokenId: 'yes-token', outcome: 'YES', bid: 0.51, ask: 0.53, lastPrice: 0.52, liquidity: 12500 }
    ]
  };

  const signal = {
    strategy: 'neg-risk-arb',
    marketId: 'm-1',
    tokenId: 'yes-token',
    side: 'BUY',
    confidence: 0.82,
    edge: 0.04,
    reason: 'spread/edge favorável',
    timestamp: '2026-04-21T20:30:05.000Z'
  };

  const opportunity = {
    signal,
    marketState,
    fairPrice: 0.56,
    expectedValue: 0.03
  };

  const executionIntent = {
    marketId: 'm-1',
    tokenId: 'yes-token',
    side: 'BUY',
    orderType: 'LIMIT',
    size: 100,
    price: 0.53,
    timeInForce: 'GTC',
    sourceSignal: signal,
    riskTags: ['default-risk-check']
  };

  assert.equal(isMarketState(marketState), true);
  assert.equal(isSignal(signal), true);
  assert.equal(isOpportunity(opportunity), true);
  assert.equal(isExecutionIntent(executionIntent), true);
});

test('STRAT-001: deve invalidar Signal com confiança fora de faixa', () => {
  const invalidSignal = {
    strategy: 'invalid',
    marketId: 'm-1',
    tokenId: 'yes-token',
    side: 'BUY',
    confidence: 1.5,
    edge: 0.1,
    reason: 'invalid confidence',
    timestamp: '2026-04-21T20:30:05.000Z'
  };

  assert.equal(isSignal(invalidSignal), false);
});

test('STRAT-001: docs/contracts.md deve documentar os contratos principais', () => {
  const contractsDocPath = path.resolve(process.cwd(), 'docs', 'contracts.md');
  const content = readFileSync(contractsDocPath, 'utf-8');

  assert.match(content, /Signal/);
  assert.match(content, /MarketState/);
  assert.match(content, /Opportunity/);
  assert.match(content, /ExecutionIntent/);
});
