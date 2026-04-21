import type { MarketSnapshot, OrderBookSnapshot, TradeTick } from '../types';

type QueryableClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

type IngestionRunStatus = 'running' | 'completed' | 'failed';

export class MarketRepository {
  private readonly client: QueryableClient;

  constructor(client: QueryableClient) {
    this.client = client;
  }

  async upsert(snapshot: MarketSnapshot): Promise<void> {
    await this.client.query(
      `
      insert into markets (market_id, slug, question, active, closed, end_date, raw, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
      on conflict (market_id)
      do update set
        slug = excluded.slug,
        question = excluded.question,
        active = excluded.active,
        closed = excluded.closed,
        end_date = excluded.end_date,
        raw = excluded.raw,
        updated_at = now();
      `,
      [
        snapshot.marketId,
        snapshot.slug,
        snapshot.question,
        snapshot.active,
        !snapshot.active,
        snapshot.endDate,
        JSON.stringify(snapshot)
      ]
    );
  }
}

export class OrderbookRepository {
  private readonly client: QueryableClient;

  constructor(client: QueryableClient) {
    this.client = client;
  }

  async insert(snapshot: OrderBookSnapshot, ingestionRunId?: number): Promise<void> {
    await this.client.query(
      `
      insert into orderbook_snapshots (
        market_id, token_id, snapshot_time, bids, asks, ingestion_run_id
      )
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      on conflict (market_id, token_id, snapshot_time)
      do nothing;
      `,
      [
        snapshot.marketId,
        snapshot.tokenId,
        snapshot.timestamp,
        JSON.stringify(snapshot.bids),
        JSON.stringify(snapshot.asks),
        ingestionRunId ?? null
      ]
    );
  }
}

export class TradeTickRepository {
  private readonly client: QueryableClient;

  constructor(client: QueryableClient) {
    this.client = client;
  }

  async insert(tick: TradeTick, ingestionRunId?: number): Promise<void> {
    await this.client.query(
      `
      insert into trade_ticks (
        trade_id, market_id, token_id, side, price, size, traded_at, ingestion_run_id, raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      on conflict (trade_id)
      do nothing;
      `,
      [
        tick.tradeId,
        tick.marketId,
        tick.tokenId,
        tick.side,
        tick.price,
        tick.size,
        tick.timestamp,
        ingestionRunId ?? null,
        JSON.stringify(tick)
      ]
    );
  }
}

export class IngestionRunRepository {
  private readonly client: QueryableClient;

  constructor(client: QueryableClient) {
    this.client = client;
  }

  async start(input: { status?: IngestionRunStatus } = {}): Promise<number> {
    const status = input.status ?? 'running';
    const result = await this.client.query(
      'insert into ingestion_runs(status, started_at) values($1, now()) returning id',
      [status]
    );

    const id = Number(result.rows[0]?.id);
    if (!Number.isFinite(id)) {
      throw new Error('Failed to create ingestion run');
    }

    return id;
  }

  async finish(input: {
    id: number;
    status: Exclude<IngestionRunStatus, 'running'>;
    checkpoint?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.client.query(
      `
      update ingestion_runs
      set status = $2,
          checkpoint = $3,
          error_message = $4,
          completed_at = now()
      where id = $1;
      `,
      [input.id, input.status, input.checkpoint ?? null, input.errorMessage ?? null]
    );
  }
}
