import fs from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeSnapshot } from './state-store';

export type RuntimeCheckpointStoreConfig = {
  filePath: string;
  logger?: { warn: (message: string, context?: Record<string, unknown>) => void };
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

export class RuntimeCheckpointStore {
  private readonly filePath: string;
  private readonly logger?: { warn: (message: string, context?: Record<string, unknown>) => void };

  constructor(config: RuntimeCheckpointStoreConfig) {
    this.filePath = config.filePath;
    this.logger = config.logger;
  }

  async persist(snapshot: RuntimeSnapshot): Promise<void> {
    const payload = JSON.stringify(snapshot, null, 2);
    const directory = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.tmp`;

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  async restore(): Promise<RuntimeSnapshot | null> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (!isRuntimeSnapshot(parsed)) {
        this.logger?.warn('runtime checkpoint schema invalid; ignoring restore', {
          filePath: this.filePath
        });
        return null;
      }

      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') {
        return null;
      }

      this.logger?.warn('runtime checkpoint restore failed; ignoring checkpoint', {
        filePath: this.filePath,
        reason: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}
