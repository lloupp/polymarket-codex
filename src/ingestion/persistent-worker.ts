import { IngestionWorker } from './worker';
import {
  IngestionRunRepository,
  MarketRepository,
  OrderbookRepository,
  TradeTickRepository
} from '../storage/repositories';
import type { MarketSnapshot, OrderBookSnapshot, TradeTick } from '../types';

type QueryableClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

type PersistentWorkerOptions = {
  pollIntervalMs: number;
  client: QueryableClient;
  gamma: {
    getEvents: () => Promise<Record<string, unknown>[]>;
  };
  clob: {
    getOrderBook: (input: { tokenId: string }) => Promise<Record<string, unknown>>;
  };
  realtime: {
    setMessageHandler: (handler: (message: unknown) => Promise<void>) => void;
    connect: () => void;
    disconnect: () => void;
    subscribe: (payload: Record<string, unknown>) => void;
  };
};

type SnapshotEntry =
  | { type: 'market'; payload: MarketSnapshot }
  | { type: 'orderbook'; payload: OrderBookSnapshot }
  | { type: 'trade_tick'; payload: TradeTick };

export class PersistentIngestionService {
  private readonly runRepository: IngestionRunRepository;
  private readonly marketRepository: MarketRepository;
  private readonly orderbookRepository: OrderbookRepository;
  private readonly tradeTickRepository: TradeTickRepository;
  private readonly worker: IngestionWorker;

  private runId: number | null = null;
  private runFinished = false;

  constructor(options: PersistentWorkerOptions) {
    this.runRepository = new IngestionRunRepository(options.client);
    this.marketRepository = new MarketRepository(options.client);
    this.orderbookRepository = new OrderbookRepository(options.client);
    this.tradeTickRepository = new TradeTickRepository(options.client);

    this.worker = new IngestionWorker({
      pollIntervalMs: options.pollIntervalMs,
      gamma: options.gamma,
      clob: options.clob,
      realtime: options.realtime,
      saveSnapshot: async (entry) => {
        await this.saveSnapshot(entry as SnapshotEntry);
      },
      onError: async (error) => {
        await this.markFailed(error);
      }
    });
  }

  async start(): Promise<void> {
    if (this.runId !== null) {
      return;
    }

    this.runId = await this.runRepository.start({ status: 'running' });
    this.worker.start();
  }

  async pollOnce(): Promise<void> {
    try {
      await this.worker.pollOnce();
    } catch (error) {
      await this.markFailed(error);
      throw error;
    }
  }

  async stop(status: 'completed' | 'failed' = 'completed'): Promise<void> {
    this.worker.stop();

    if (this.runId === null || this.runFinished) {
      return;
    }

    await this.runRepository.finish({
      id: this.runId,
      status,
      checkpoint: this.worker.getCheckpoint(),
      errorMessage: status === 'failed' ? 'stopped_after_failure' : null
    });
    this.runFinished = true;
  }

  private async saveSnapshot(entry: SnapshotEntry): Promise<void> {
    if (this.runId === null) {
      throw new Error('Ingestion run not started before snapshot persistence');
    }

    if (entry.type === 'market') {
      await this.marketRepository.upsert(entry.payload);
      return;
    }

    if (entry.type === 'orderbook') {
      await this.orderbookRepository.insert(entry.payload, this.runId);
      return;
    }

    await this.tradeTickRepository.insert(entry.payload, this.runId);
  }

  private async markFailed(error: unknown): Promise<void> {
    if (this.runId === null || this.runFinished) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);

    await this.runRepository.finish({
      id: this.runId,
      status: 'failed',
      checkpoint: this.worker.getCheckpoint(),
      errorMessage: message
    });

    this.runFinished = true;
  }
}
