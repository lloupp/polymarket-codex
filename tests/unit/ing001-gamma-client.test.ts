import test from 'node:test';
import assert from 'node:assert/strict';

import { GammaClient } from '../../src/ingestion/gamma-client';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

test('ING-001: deve paginar eventos até esgotar resultado', async () => {
  const calls: string[] = [];
  const pages: MockResponse[] = [
    {
      ok: true,
      status: 200,
      json: async () => [{ id: 'e1' }, { id: 'e2' }]
    },
    {
      ok: true,
      status: 200,
      json: async () => [{ id: 'e3' }]
    }
  ];

  const fetcher = async (url: string): Promise<MockResponse> => {
    calls.push(url);
    const next = pages.shift();
    if (!next) throw new Error('no more pages');
    return next;
  };

  const client = new GammaClient({ baseUrl: 'https://gamma-api.polymarket.com', fetcher, retryDelaysMs: [0] });
  const result = await client.getEvents({ limit: 2 });

  assert.equal(result.length, 3);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /limit=2/);
  assert.match(calls[0]!, /offset=0/);
  assert.match(calls[1]!, /offset=2/);
});

test('ING-001: deve aplicar retry em 429 e depois retornar sucesso', async () => {
  let attempts = 0;

  const fetcher = async (): Promise<MockResponse> => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ message: 'rate limited' })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => [{ id: 'e1' }]
    };
  };

  const client = new GammaClient({ baseUrl: 'https://gamma-api.polymarket.com', fetcher, retryDelaysMs: [0, 0] });
  const result = await client.getEvents({ limit: 2 });

  assert.equal(result.length, 1);
  assert.equal(attempts, 2);
});
