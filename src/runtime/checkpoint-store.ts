import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeSnapshot } from './state-store';

export type RuntimeCheckpointStoreConfig = {
  filePath: string;
  maxRestoreHistorySize?: number;
  logger?: { warn: (message: string, context?: Record<string, unknown>) => void };
};

export type RuntimeCheckpointRestoreMeta = {
  source: 'primary' | 'backup' | 'none';
  reason?: 'primary_restore_failed' | 'no_checkpoint_available';
};

export type RuntimeCheckpointRestoreEvent = RuntimeCheckpointRestoreMeta & {
  at: string;
};

function isRuntimeSnapshot(input: unknown): input is RuntimeSnapshot {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const value = input as Record<string, unknown>;

  return (
    Array.isArray(value.positions) &&
    Array.isArray(value.orders) &&
    Array.isArray(value.signals) &&
    typeof value.risk === 'object' &&
    value.risk !== null &&
    typeof value.updatedAt === 'string'
  );
}

type LegacyCheckpointEnvelope = {
  snapshot: RuntimeSnapshot;
  checksum: string;
};

type CheckpointEnvelope = {
  version: 1;
  writtenAt: string;
  snapshot: RuntimeSnapshot;
  checksum: string;
};

function checksumForSnapshot(snapshot: RuntimeSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function isLegacyCheckpointEnvelope(input: unknown): input is LegacyCheckpointEnvelope {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const value = input as Record<string, unknown>;
  return typeof value.checksum === 'string' && isRuntimeSnapshot(value.snapshot);
}

function isCheckpointEnvelope(input: unknown): input is CheckpointEnvelope {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const value = input as Record<string, unknown>;
  return (
    value.version === 1 &&
    typeof value.writtenAt === 'string' &&
    typeof value.checksum === 'string' &&
    isRuntimeSnapshot(value.snapshot)
  );
}

export class RuntimeCheckpointStore {
  private readonly filePath: string;
  private readonly backupFilePath: string;
  private readonly logger?: { warn: (message: string, context?: Record<string, unknown>) => void };
  private lastRestoreMeta: RuntimeCheckpointRestoreMeta;
  private readonly restoreHistory: RuntimeCheckpointRestoreEvent[];
  private readonly maxRestoreHistorySize: number;

  constructor(config: RuntimeCheckpointStoreConfig) {
    this.filePath = config.filePath;
    this.backupFilePath = `${config.filePath}.bak`;
    this.logger = config.logger;
    this.lastRestoreMeta = { source: 'none', reason: 'no_checkpoint_available' };
    this.restoreHistory = [];

    const normalizedCapacity = Math.floor(config.maxRestoreHistorySize ?? 50);
    this.maxRestoreHistorySize = Number.isFinite(normalizedCapacity) && normalizedCapacity > 0 ? normalizedCapacity : 50;
  }

  async persist(snapshot: RuntimeSnapshot): Promise<void> {
    const envelope: CheckpointEnvelope = {
      version: 1,
      writtenAt: new Date().toISOString(),
      snapshot,
      checksum: checksumForSnapshot(snapshot)
    };
    const payload = JSON.stringify(envelope, null, 2);
    const directory = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.tmp`;

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, this.filePath);
    await fs.copyFile(this.filePath, this.backupFilePath);
  }

  private async restoreFromPath(targetPath: string): Promise<RuntimeSnapshot | null> {
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (isRuntimeSnapshot(parsed)) {
        return parsed;
      }

      if (isCheckpointEnvelope(parsed)) {
        if (!Number.isFinite(Date.parse(parsed.writtenAt))) {
          this.logger?.warn('runtime checkpoint writtenAt invalid; ignoring restore', {
            filePath: targetPath
          });
          return null;
        }

        const expected = checksumForSnapshot(parsed.snapshot);
        if (parsed.checksum !== expected) {
          this.logger?.warn('runtime checkpoint checksum mismatch; ignoring restore', {
            filePath: targetPath
          });
          return null;
        }

        return parsed.snapshot;
      }

      if (isLegacyCheckpointEnvelope(parsed)) {
        const expected = checksumForSnapshot(parsed.snapshot);
        if (parsed.checksum !== expected) {
          this.logger?.warn('runtime checkpoint checksum mismatch; ignoring restore', {
            filePath: targetPath
          });
          return null;
        }

        return parsed.snapshot;
      }

      this.logger?.warn('runtime checkpoint schema invalid; ignoring restore', {
        filePath: targetPath
      });
      return null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') {
        return null;
      }

      this.logger?.warn('runtime checkpoint restore failed; ignoring checkpoint', {
        filePath: targetPath,
        reason: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  getLastRestoreMeta(): RuntimeCheckpointRestoreMeta {
    return this.lastRestoreMeta;
  }

  getRestoreHistory(limit?: number): RuntimeCheckpointRestoreEvent[] {
    if (limit === undefined) {
      return [...this.restoreHistory];
    }

    const normalizedLimit = Math.max(0, Math.floor(limit));
    return this.restoreHistory.slice(0, normalizedLimit);
  }

  clearRestoreHistory(): void {
    this.restoreHistory.length = 0;
  }

  private recordRestoreMeta(meta: RuntimeCheckpointRestoreMeta): void {
    this.lastRestoreMeta = meta;
    this.restoreHistory.unshift({
      ...meta,
      at: new Date().toISOString()
    });

    if (this.restoreHistory.length > this.maxRestoreHistorySize) {
      this.restoreHistory.length = this.maxRestoreHistorySize;
    }
  }

  async restore(): Promise<RuntimeSnapshot | null> {
    const primary = await this.restoreFromPath(this.filePath);
    if (primary !== null) {
      this.recordRestoreMeta({ source: 'primary' });
      return primary;
    }

    if (this.backupFilePath === this.filePath) {
      this.recordRestoreMeta({ source: 'none', reason: 'no_checkpoint_available' });
      return null;
    }

    const backup = await this.restoreFromPath(this.backupFilePath);
    if (backup !== null) {
      this.recordRestoreMeta({ source: 'backup', reason: 'primary_restore_failed' });
      return backup;
    }

    this.recordRestoreMeta({ source: 'none', reason: 'no_checkpoint_available' });
    return null;
  }
}
