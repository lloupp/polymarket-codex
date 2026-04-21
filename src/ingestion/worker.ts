import { normalizeMarketSnapshot, normalizeTradeTick } from './normalizer';

type MarketEvent = Record<string, unknown>;

type GammaLike = {
  getEvents: () => Promise<MarketEvent[]>;
};

type ClobLike = {
  getOrderBook: (input: { tokenId: string }) => Promise<Record<string, unknown>>;
};

type RealtimeLike = {
  setMessageHandler: (handler: (message: unknown) => Promise<void>) => void;
  connect: () => void;
  disconnect: () => void;
  subscribe: (payload: Record<string, unknown>) => void;
};

type IngestionMetrics = {
  pollCycles: number;
  streamMessages: number;
  snapshotsPersisted: number;
};

type IngestionWorkerOptions = {
  pollIntervalMs: number;
  gamma: GammaLike;
  clob: ClobLike;
  realtime: RealtimeLike;
  saveSnapshot: (entry: unknown) => Promise<void>;
  onError?: (error: Error) => Promise<void> | void;
};

export class IngestionWorker {
  private readonly pollIntervalMs: number;
  private readonly gamma: GammaLike;
  private readonly clob: ClobLike;
  private readonly realtime: RealtimeLike;
  private readonly saveSnapshot: (entry: unknown) => Promise<void>;
  private readonly onError: ((error: Error) => Promise<void> | void) | undefined;

  private timer: NodeJS.Timeout | null = null;
  private checkpoint: string | null = null;
  private readonly metrics: IngestionMetrics = {
    pollCycles: 0,
    streamMessages: 0,
    snapshotsPersisted: 0
  };

  constructor(options: IngestionWorkerOptions) {
    this.pollIntervalMs = options.pollIntervalMs;
    this.gamma = options.gamma;
    this.clob = options.clob;
    this.realtime = options.realtime;
    this.saveSnapshot = options.saveSnapshot;
    this.onError = options.onError;
  }

  start(): void {
    this.realtime.setMessageHandler(async (message) => {
      try {
        await this.handleStreamMessage(message);
      } catch (error) {
        await this.reportError(error);
      }
    });
    this.realtime.connect();

    this.timer = setInterval(() => {
      void this.pollOnce().catch(async (error) => {
        await this.reportError(error);
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.realtime.disconnect();
  }

  async pollOnce(): Promise<void> {
    const events = await this.gamma.getEvents();

    for (const event of events) {
      const marketSnapshot = normalizeMarketSnapshot(event);
      await this.saveSnapshot({ type: 'market', payload: marketSnapshot });
      this.metrics.snapshotsPersisted += 1;

      for (const outcome of marketSnapshot.outcomes) {
        const orderBook = await this.clob.getOrderBook({ tokenId: outcome.tokenId });
        await this.saveSnapshot({ type: 'orderbook', payload: orderBook });
        this.metrics.snapshotsPersisted += 1;
      }
    }

    this.metrics.pollCycles += 1;
    this.checkpoint = new Date().toISOString();
  }

  getCheckpoint(): string | null {
    return this.checkpoint;
  }

  getMetrics(): IngestionMetrics {
    return { ...this.metrics };
  }

  private async handleStreamMessage(message: unknown): Promise<void> {
    this.metrics.streamMessages += 1;

    const payload = message as Record<string, unknown>;
    const hasTradeShape =
      payload &&
      typeof payload === 'object' &&
      'trade_id' in payload &&
      'token_id' in payload &&
      'market' in payload;

    if (!hasTradeShape) {
      return;
    }

    const tick = normalizeTradeTick(payload);
    await this.saveSnapshot({ type: 'trade_tick', payload: tick });
    this.metrics.snapshotsPersisted += 1;
  }

  private async reportError(error: unknown): Promise<void> {
    if (!this.onError) {
      return;
    }

    const wrapped = error instanceof Error ? error : new Error(String(error));
    await this.onError(wrapped);
  }
}
