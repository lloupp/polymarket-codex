import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../../src/logger';

test('FOUND-003: logger deve emitir evento estruturado com campos padrão', () => {
  const events: unknown[] = [];

  const logger = createLogger({ module: 'ingestion.worker', traceId: 'trace-123', sink: (entry) => events.push(entry) });

  logger.info('worker started', { pollIntervalMs: 1000 });

  assert.equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.level, 'info');
  assert.equal(event.module, 'ingestion.worker');
  assert.equal(event.traceId, 'trace-123');
  assert.equal(event.message, 'worker started');
  assert.equal(typeof event.timestamp, 'string');
  assert.equal((event.pollIntervalMs as number), 1000);
});
