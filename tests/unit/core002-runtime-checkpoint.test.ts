import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RuntimeCheckpointStore } from '../../src/runtime/checkpoint-store';
import { RuntimeStateStore } from '../../src/runtime/state-store';

test('CORE-002: deve persistir checkpoint e restaurar snapshot no boot', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const store = new RuntimeStateStore();
  await store.updateState({
    positions: [{ marketId: 'm1', size: 10 }],
    orders: [{ orderId: 'o1', status: 'open' }],
    signals: [{ signalId: 's1', edge: 0.06 }],
    risk: { status: 'paused', breaker: { tripped: true } }
  });

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  await checkpoint.persist(await store.getSnapshot());

  const freshStore = new RuntimeStateStore();
  const restored = await checkpoint.restore();
  assert.equal(restored !== null, true);

  if (restored) {
    await freshStore.replaceSnapshot(restored);
  }

  const snapshot = await freshStore.getSnapshot();
  assert.equal(snapshot.orders[0]?.orderId, 'o1');
  assert.equal(snapshot.positions[0]?.marketId, 'm1');
  assert.equal(snapshot.risk.status, 'paused');
});

test('CORE-002: arquivo corrompido não deve derrubar restore (fallback null)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-bad-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  fs.writeFileSync(checkpointPath, '{ invalid json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  const restored = await checkpoint.restore();

  assert.equal(restored, null);
});

test('CORE-003: restore deve usar backup quando checkpoint principal estiver corrompido', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-backup-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const store = new RuntimeStateStore();
  await store.updateState({
    positions: [{ marketId: 'm-backup', size: 2 }],
    orders: [{ orderId: 'o-backup', status: 'open' }],
    signals: [{ signalId: 's-backup', edge: 0.02 }],
    risk: { status: 'ok', breaker: { tripped: false } }
  });

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  await checkpoint.persist(await store.getSnapshot());

  const backupPath = `${checkpointPath}.bak`;
  assert.equal(fs.existsSync(backupPath), true);

  fs.writeFileSync(checkpointPath, '{ invalid json');

  const restored = await checkpoint.restore();
  assert.equal(restored?.orders[0]?.orderId, 'o-backup');
  assert.equal(restored?.positions[0]?.marketId, 'm-backup');
});
