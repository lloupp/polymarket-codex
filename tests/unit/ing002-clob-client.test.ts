import test from 'node:test';
import assert from 'node:assert/strict';

import { ClobClient } from '../../src/ingestion/clob-client';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

test('ING-002: deve buscar preço por token e normalizar resultado', async () => {
  const fetcher = async (url: string): Promise<MockResponse> => {
    assert.match(url, /\/price\?token_id=tok-1&side=BUY/);
    return {
      ok: true,
      status: 200,
      json: async () => ({ price: '0.42' })
    };
  };

  const client = new ClobClient({ baseUrl: 'https://clob.polymarket.com', fetcher, retryDelaysMs: [0] });
  const price = await client.getPrice({ tokenId: 'tok-1', side: 'BUY' });

  assert.equal(price.tokenId, 'tok-1');
  assert.equal(price.side, 'BUY');
  assert.equal(price.price, 0.42);
});

test('ING-002: deve buscar orderbook e normalizar bids/asks', async () => {
  const fetcher = async (url: string): Promise<MockResponse> => {
    assert.match(url, /\/book\?token_id=tok-2/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        bids: [{ price: '0.40', size: '150' }],
        asks: [{ price: '0.44', size: '120' }]
      })
    };
  };

  const client = new ClobClient({ baseUrl: 'https://clob.polymarket.com', fetcher, retryDelaysMs: [0] });
  const book = await client.getOrderBook({ tokenId: 'tok-2' });

  assert.equal(book.tokenId, 'tok-2');
  assert.deepEqual(book.bids, [{ price: 0.4, size: 150 }]);
  assert.deepEqual(book.asks, [{ price: 0.44, size: 120 }]);
});

test('ING-002: deve aplicar retry quando receber 503', async () => {
  let attempts = 0;

  const fetcher = async (): Promise<MockResponse> => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ message: 'temporary unavailable' })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ price: '0.50' })
    };
  };

  const client = new ClobClient({ baseUrl: 'https://clob.polymarket.com', fetcher, retryDelaysMs: [0, 0] });
  const price = await client.getPrice({ tokenId: 'tok-3', side: 'SELL' });

  assert.equal(price.price, 0.5);
  assert.equal(attempts, 2);
});

test('ING-002: deve falhar com timeout quando fetch excede limite', async () => {
  const fetcher = async (): Promise<MockResponse> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      ok: true,
      status: 200,
      json: async () => ({ price: '0.30' })
    };
  };

  const client = new ClobClient({
    baseUrl: 'https://clob.polymarket.com',
    fetcher,
    timeoutMs: 5,
    retryDelaysMs: [0]
  });

  await assert.rejects(() => client.getPrice({ tokenId: 'tok-4', side: 'BUY' }), /timeout/i);
});
