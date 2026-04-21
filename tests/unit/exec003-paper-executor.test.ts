import test from 'node:test';
import assert from 'node:assert/strict';

import { PaperExecutor } from '../../src/execution/paper-executor';
import type { ExecutionIntent } from '../../src/strategy/contracts';

function intent(partial: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
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
      edge: 0.04,
      reason: 'edge positiva',
      timestamp: '2026-04-21T22:00:00.000Z'
    },
    riskTags: ['paper-test'],
    ...partial
  };
}

test('EXEC-003: deve simular fill com slippage, atualizar posição e pnl', async () => {
  const persisted: Array<Record<string, unknown>> = [];

  const executor = new PaperExecutor({
    slippageBps: 20,
    persistFill: async (fill) => {
      persisted.push(fill as unknown as Record<string, unknown>);
    }
  });

  const fill = await executor.execute(intent());
  const state = executor.getPortfolioState();

  assert.equal(fill.executedSize, 100);
  assert.equal(fill.executedPrice, 0.501);
  assert.equal(persisted.length, 1);

  assert.equal(state.positions['m-1:yes']?.size, 100);
  assert.equal(state.positions['m-1:yes']?.avgPrice, 0.501);
  assert.equal(state.realizedPnl, 0);
});

test('EXEC-003: fluxo E2E paper com BUY depois SELL atualiza pnl consistente', async () => {
  const executor = new PaperExecutor({ slippageBps: 10 });

  await executor.execute(intent({ side: 'BUY', size: 50, price: 0.5 }));
  await executor.execute(intent({ side: 'SELL', size: 50, price: 0.55, tokenId: 'yes' }));

  const state = executor.getPortfolioState();

  assert.equal(state.positions['m-1:yes']?.size ?? 0, 0);
  assert.equal(state.realizedPnl > 2, true);
});
