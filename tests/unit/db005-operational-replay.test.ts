import test from 'node:test';
import assert from 'node:assert/strict';

import { OperationalReplayService } from '../../src/runtime/operational-replay';

test('DB-005: replay deve aplicar filtros de tempo e eventType com payload estável', async () => {
  const service = new OperationalReplayService({
    cycleSource: {
      listRecent: async () => [
        {
          cycle_id: 'cycle-3',
          status: 'completed',
          finished_at: '2026-04-22T10:03:00.000Z'
        },
        {
          cycle_id: 'cycle-2',
          status: 'failed',
          finished_at: '2026-04-22T10:02:00.000Z'
        },
        {
          cycle_id: 'cycle-1',
          status: 'completed',
          finished_at: '2026-04-22T10:01:00.000Z'
        }
      ]
    },
    eventSource: {
      listRecent: async (input) => {
        const rows = [
          {
            event_type: 'breaker_tripped',
            source: 'risk',
            created_at: '2026-04-22T10:02:30.000Z'
          },
          {
            event_type: 'control_pause',
            source: 'api-control',
            created_at: '2026-04-22T10:01:30.000Z'
          }
        ];

        if (input?.eventType) {
          return rows.filter((row) => row.event_type === input.eventType);
        }

        return rows;
      }
    },
    now: () => '2026-04-22T11:00:00.000Z'
  });

  const replay = await service.getReplay({
    limit: 20,
    eventType: 'breaker_tripped',
    from: '2026-04-22T10:02:00.000Z',
    to: '2026-04-22T10:05:00.000Z'
  });

  assert.equal(replay.generatedAt, '2026-04-22T11:00:00.000Z');
  assert.equal(replay.summary.cycles, 2);
  assert.equal(replay.summary.events, 1);
  assert.deepEqual(replay.summary.eventTypes, ['breaker_tripped']);
  assert.deepEqual(
    replay.cycles.map((cycle) => cycle.cycle_id),
    ['cycle-3', 'cycle-2']
  );
  assert.equal(replay.events[0]?.event_type, 'breaker_tripped');
});
