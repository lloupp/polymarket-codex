import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMarketSnapshot,
  normalizeOrderBookSnapshot,
  normalizeTradeTick
} from '../../src/ingestion/normalizer';

test('ING-004: deve normalizar market snapshot de payload Gamma', () => {
  const snapshot = normalizeMarketSnapshot({
    id: 'm-1',
    slug: 'btc-up-or-down',
    question: 'BTC up?',
    active: true,
    endDate: '2026-04-21T20:10:00Z',
    tokens: [
      { token_id: 'yes-token', outcome: 'Yes', price: '0.54' },
      { token_id: 'no-token', outcome: 'No', price: '0.46' }
    ]
  });

  assert.equal(snapshot.marketId, 'm-1');
  assert.equal(snapshot.slug, 'btc-up-or-down');
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.outcomes.length, 2);
  assert.equal(snapshot.outcomes[0]?.tokenId, 'yes-token');
  assert.equal(snapshot.outcomes[0]?.price, 0.54);
});

test('ING-004: deve normalizar orderbook snapshot para tipos numéricos', () => {
  const book = normalizeOrderBookSnapshot({
    market: 'm-1',
    token_id: 'yes-token',
    bids: [{ price: '0.53', size: '120' }],
    asks: [{ price: '0.55', size: '140' }],
    timestamp: '2026-04-21T20:11:00Z'
  });

  assert.equal(book.marketId, 'm-1');
  assert.equal(book.tokenId, 'yes-token');
  assert.deepEqual(book.bids, [{ price: 0.53, size: 120 }]);
  assert.deepEqual(book.asks, [{ price: 0.55, size: 140 }]);
  assert.equal(book.timestamp, '2026-04-21T20:11:00.000Z');
});

test('ING-004: deve normalizar trade tick para estrutura única', () => {
  const tick = normalizeTradeTick({
    market: 'm-1',
    token_id: 'yes-token',
    side: 'BUY',
    price: '0.545',
    size: '50',
    trade_id: 't-100',
    timestamp: '2026-04-21T20:12:00Z'
  });

  assert.equal(tick.tradeId, 't-100');
  assert.equal(tick.marketId, 'm-1');
  assert.equal(tick.tokenId, 'yes-token');
  assert.equal(tick.price, 0.545);
  assert.equal(tick.size, 50);
  assert.equal(tick.side, 'BUY');
});

test('ING-004: deve falhar para market sem id', () => {
  assert.throws(() => normalizeMarketSnapshot({ slug: 'x' }), /market id/i);
});
