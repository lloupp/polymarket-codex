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

test('CORE-004: checksum inválido no principal deve forçar restore pelo backup íntegro', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-integrity-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const store = new RuntimeStateStore();
  await store.updateState({
    positions: [{ marketId: 'm-ok', size: 3 }],
    orders: [{ orderId: 'o-ok', status: 'open' }],
    signals: [{ signalId: 's-ok', edge: 0.03 }],
    risk: { status: 'ok', breaker: { tripped: false } }
  });

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  await checkpoint.persist(await store.getSnapshot());

  const tampered = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as {
    checksum?: string;
    snapshot?: { orders?: Array<{ orderId?: string }> };
  };

  assert.equal(typeof tampered.checksum, 'string');
  assert.equal(typeof tampered.snapshot, 'object');

  if (tampered.snapshot?.orders?.[0]) {
    tampered.snapshot.orders[0].orderId = 'o-tampered';
  }

  fs.writeFileSync(checkpointPath, JSON.stringify(tampered, null, 2));

  const restored = await checkpoint.restore();
  assert.equal(restored?.orders[0]?.orderId, 'o-ok');
});

test('CORE-005: persist deve salvar envelope com version + writtenAt e manter restore legado', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-meta-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const store = new RuntimeStateStore();
  await store.updateState({
    positions: [{ marketId: 'm-meta', size: 4 }],
    orders: [{ orderId: 'o-meta', status: 'open' }],
    signals: [{ signalId: 's-meta', edge: 0.04 }],
    risk: { status: 'ok', breaker: { tripped: false } }
  });

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  const snapshot = await store.getSnapshot();
  await checkpoint.persist(snapshot);

  const persisted = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as {
    version?: number;
    writtenAt?: string;
    checksum?: string;
  };

  assert.equal(persisted.version, 1);
  assert.equal(typeof persisted.checksum, 'string');
  assert.equal(typeof persisted.writtenAt, 'string');
  assert.equal(Number.isNaN(Date.parse(persisted.writtenAt ?? '')), false);

  const legacyPath = path.join(tempDir, 'runtime-checkpoint-legacy.json');
  fs.writeFileSync(legacyPath, JSON.stringify(snapshot, null, 2));

  const legacyCheckpoint = new RuntimeCheckpointStore({ filePath: legacyPath });
  const restoredLegacy = await legacyCheckpoint.restore();
  assert.equal(restoredLegacy?.orders[0]?.orderId, 'o-meta');
});

test('CORE-005: writtenAt inválido no principal deve usar backup íntegro', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-written-at-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const store = new RuntimeStateStore();
  await store.updateState({
    positions: [{ marketId: 'm-written', size: 5 }],
    orders: [{ orderId: 'o-written', status: 'open' }],
    signals: [{ signalId: 's-written', edge: 0.05 }],
    risk: { status: 'ok', breaker: { tripped: false } }
  });

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  await checkpoint.persist(await store.getSnapshot());

  const tampered = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as {
    writtenAt?: string;
  };
  tampered.writtenAt = 'not-a-date';
  fs.writeFileSync(checkpointPath, JSON.stringify(tampered, null, 2));

  const restored = await checkpoint.restore();
  assert.equal(restored?.orders[0]?.orderId, 'o-written');
});

test('CORE-006: deve registrar restore_meta como primary quando restore principal for válido', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-meta-primary-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  const store = new RuntimeStateStore();
  await store.updateState({
    orders: [{ orderId: 'o-primary', status: 'open' }]
  });
  await checkpoint.persist(await store.getSnapshot());

  const restored = await checkpoint.restore();
  assert.equal(restored?.orders[0]?.orderId, 'o-primary');

  const meta = checkpoint.getLastRestoreMeta();
  assert.equal(meta.source, 'primary');
  assert.equal(meta.reason, undefined);
});

test('CORE-006: deve registrar restore_meta como backup com reason quando fallback ocorrer', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-meta-backup-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  const store = new RuntimeStateStore();
  await store.updateState({
    orders: [{ orderId: 'o-backup-meta', status: 'open' }]
  });
  await checkpoint.persist(await store.getSnapshot());

  fs.writeFileSync(checkpointPath, '{ invalid json');

  const restored = await checkpoint.restore();
  assert.equal(restored?.orders[0]?.orderId, 'o-backup-meta');

  const meta = checkpoint.getLastRestoreMeta();
  assert.equal(meta.source, 'backup');
  assert.equal(meta.reason, 'primary_restore_failed');
});

test('CORE-006: deve registrar restore_meta como none quando nenhum checkpoint existir', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-meta-none-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  const restored = await checkpoint.restore();

  assert.equal(restored, null);
  const meta = checkpoint.getLastRestoreMeta();
  assert.equal(meta.source, 'none');
  assert.equal(meta.reason, 'no_checkpoint_available');
});

test('CORE-007: deve manter histórico de restore com timestamp e origem final', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-history-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });
  const store = new RuntimeStateStore();
  await store.updateState({
    orders: [{ orderId: 'o-history', status: 'open' }]
  });
  await checkpoint.persist(await store.getSnapshot());

  const restored = await checkpoint.restore();
  assert.equal(restored?.orders[0]?.orderId, 'o-history');

  const history = checkpoint.getRestoreHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.source, 'primary');
  assert.equal(history[0]?.reason, undefined);
  assert.equal(Number.isNaN(Date.parse(history[0]?.at ?? '')), false);
});

test('CORE-007: getRestoreHistory(limit) deve retornar eventos mais recentes primeiro', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-history-limit-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });

  await checkpoint.restore();
  await checkpoint.restore();
  await checkpoint.restore();

  const limited = checkpoint.getRestoreHistory(2);
  assert.equal(limited.length, 2);
  assert.equal(limited[0]?.source, 'none');
  assert.equal(limited[0]?.reason, 'no_checkpoint_available');
  assert.equal(limited[1]?.source, 'none');
  assert.equal(limited[1]?.reason, 'no_checkpoint_available');
});

test('CORE-008: clearRestoreHistory deve limpar histórico sem perder último restore_meta', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-history-clear-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });

  await checkpoint.restore();
  await checkpoint.restore();

  assert.equal(checkpoint.getRestoreHistory().length, 2);
  checkpoint.clearRestoreHistory();
  assert.equal(checkpoint.getRestoreHistory().length, 0);

  const meta = checkpoint.getLastRestoreMeta();
  assert.equal(meta.source, 'none');
  assert.equal(meta.reason, 'no_checkpoint_available');
});

test('CORE-008: getRestoreHistory(limit) deve tratar limites inválidos de forma segura', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-history-invalid-limit-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath });

  await checkpoint.restore();
  await checkpoint.restore();

  assert.equal(checkpoint.getRestoreHistory(Number.NaN).length, 0);
  assert.equal(checkpoint.getRestoreHistory(-3).length, 0);
  assert.equal(checkpoint.getRestoreHistory(0).length, 0);
  assert.equal(checkpoint.getRestoreHistory(1.9).length, 1);
});

test('CORE-009: deve respeitar maxRestoreHistorySize configurado', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-history-capacity-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath, maxRestoreHistorySize: 2 });

  await checkpoint.restore();
  await checkpoint.restore();
  await checkpoint.restore();

  const history = checkpoint.getRestoreHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0]?.reason, 'no_checkpoint_available');
  assert.equal(history[1]?.reason, 'no_checkpoint_available');
});

test('CORE-009: maxRestoreHistorySize inválido deve cair para default seguro', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-checkpoint-restore-history-capacity-fallback-'));
  const checkpointPath = path.join(tempDir, 'runtime-checkpoint.json');

  const checkpoint = new RuntimeCheckpointStore({ filePath: checkpointPath, maxRestoreHistorySize: 0 });

  await checkpoint.restore();
  await checkpoint.restore();
  await checkpoint.restore();

  assert.equal(checkpoint.getRestoreHistory().length, 3);
});
