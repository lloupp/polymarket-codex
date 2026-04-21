import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PreTradeRiskEngine,
  type PortfolioExposureSnapshot,
  type RiskDecisionInput
} from '../../src/risk/pretrade-engine';

function baseInput(overrides: Partial<RiskDecisionInput> = {}): RiskDecisionInput {
  return {
    intent: {
      marketId: 'm-1',
      tokenId: 'yes',
      side: 'BUY',
      orderType: 'LIMIT',
      size: 100,
      price: 0.5,
      timeInForce: 'GTC',
      sourceSignal: {
        strategy: 'neg-risk-arb-mvp',
        marketId: 'm-1',
        tokenId: 'yes',
        side: 'BUY',
        confidence: 0.75,
        edge: 0.03,
        reason: 'edge positiva',
        timestamp: '2026-04-21T21:00:00.000Z'
      },
      riskTags: ['base']
    },
    exposure: {
      marketExposureNotional: 400,
      globalExposureNotional: 2_000
    },
    ...overrides
  };
}

test('RISK-001: deve aceitar quando dentro dos limites e retornar reasons[]', () => {
  const engine = new PreTradeRiskEngine({
    maxTradeNotional: 1_000,
    maxMarketNotional: 5_000,
    maxGlobalNotional: 20_000
  });

  const decision = engine.evaluate(baseInput());

  assert.equal(decision.decision, 'ACCEPT');
  assert.equal(Array.isArray(decision.reasons), true);
  assert.equal(decision.reasons.length > 0, true);
  assert.match(decision.reasons[0] ?? '', /within configured risk limits/i);
});

test('RISK-001: deve bloquear quando excede limite por trade', () => {
  const engine = new PreTradeRiskEngine({
    maxTradeNotional: 20,
    maxMarketNotional: 5_000,
    maxGlobalNotional: 20_000
  });

  const decision = engine.evaluate(baseInput());

  assert.equal(decision.decision, 'BLOCK');
  assert.equal(decision.reasons.some((r) => /trade limit exceeded/i.test(r)), true);
});

test('RISK-001: deve bloquear quando excede limite por mercado e global', () => {
  const engine = new PreTradeRiskEngine({
    maxTradeNotional: 2_000,
    maxMarketNotional: 450,
    maxGlobalNotional: 2_020
  });

  const exposure: PortfolioExposureSnapshot = {
    marketExposureNotional: 430,
    globalExposureNotional: 1_980
  };

  const decision = engine.evaluate(baseInput({ exposure }));

  assert.equal(decision.decision, 'BLOCK');
  assert.equal(decision.reasons.some((r) => /market limit exceeded/i.test(r)), true);
  assert.equal(decision.reasons.some((r) => /global limit exceeded/i.test(r)), true);
});
