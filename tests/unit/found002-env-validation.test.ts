import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEnv } from '../../src/config/env';

test('FOUND-002: deve falhar quando env obrigatória está ausente', () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: 'development'
      } as NodeJS.ProcessEnv),
    /Missing required environment variables: POLYMARKET_CLOB_HOST/
  );
});

test('FOUND-002: deve retornar env validada quando obrigatórias existem', () => {
  const env = loadEnv({
    NODE_ENV: 'development',
    PORT: '3000',
    POLYMARKET_CLOB_HOST: 'https://clob.polymarket.com',
    POLYMARKET_GAMMA_HOST: 'https://gamma-api.polymarket.com'
  } as NodeJS.ProcessEnv);

  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.PORT, 3000);
  assert.equal(env.POLYMARKET_CLOB_HOST, 'https://clob.polymarket.com');
});
