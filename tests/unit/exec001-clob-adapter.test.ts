import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ClobExecutionAdapter,
  ExecutionError,
  type RemoteOrderStatus
} from '../../src/execution/clob-adapter';

test('EXEC-001: deve encapsular create/cancel/get status em interface única', async () => {
  const calls: string[] = [];

  const adapter = new ClobExecutionAdapter({
    retryDelaysMs: [0],
    client: {
      createOrder: async () => {
        calls.push('create');
        return { orderId: 'o-1' };
      },
      cancelOrder: async () => {
        calls.push('cancel');
      },
      getOrderStatus: async () => {
        calls.push('status');
        return { orderId: 'o-1', state: 'filled', filledSize: 10, remainingSize: 0 } satisfies RemoteOrderStatus;
      }
    }
  });

  const created = await adapter.create({ marketId: 'm-1', tokenId: 'yes', side: 'BUY', size: 10, price: 0.5, tif: 'GTC' });
  await adapter.cancel({ orderId: created.orderId });
  const status = await adapter.getStatus({ orderId: created.orderId });

  assert.deepEqual(calls, ['create', 'cancel', 'status']);
  assert.equal(status.state, 'filled');
});

test('EXEC-001: deve mapear erro de rate limit para categoria operacional', async () => {
  const adapter = new ClobExecutionAdapter({
    retryDelaysMs: [0],
    client: {
      createOrder: async () => {
        const error = new Error('429 too many requests');
        (error as Error & { status?: number }).status = 429;
        throw error;
      },
      cancelOrder: async () => undefined,
      getOrderStatus: async () => ({ orderId: 'o-1', state: 'open', filledSize: 0, remainingSize: 1 })
    }
  });

  await assert.rejects(
    async () => {
      await adapter.create({ marketId: 'm-1', tokenId: 'yes', side: 'BUY', size: 1, price: 0.5, tif: 'GTC' });
    },
    (error: unknown) => {
      assert.equal(error instanceof ExecutionError, true);
      assert.equal((error as ExecutionError).category, 'RATE_LIMIT');
      return true;
    }
  );
});

test('EXEC-001: deve aplicar retentativa para falhas transitórias', async () => {
  let attempts = 0;

  const adapter = new ClobExecutionAdapter({
    retryDelaysMs: [0, 0],
    client: {
      createOrder: async () => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('503 temporarily unavailable');
          (error as Error & { status?: number }).status = 503;
          throw error;
        }
        return { orderId: 'o-2' };
      },
      cancelOrder: async () => undefined,
      getOrderStatus: async () => ({ orderId: 'o-2', state: 'open', filledSize: 0, remainingSize: 1 })
    }
  });

  const created = await adapter.create({ marketId: 'm-1', tokenId: 'yes', side: 'BUY', size: 1, price: 0.5, tif: 'IOC' });

  assert.equal(created.orderId, 'o-2');
  assert.equal(attempts, 2);
});
