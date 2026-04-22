type CycleRow = Record<string, unknown>;
type EventRow = Record<string, unknown>;

type CycleSource = {
  listRecent: (limit?: number) => Promise<CycleRow[]>;
};

type EventSource = {
  listRecent: (input?: { limit?: number; eventType?: string }) => Promise<EventRow[]>;
};

export type ReplayQuery = {
  limit?: number;
  eventType?: string;
  from?: string;
  to?: string;
};

export type ReplayPayload = {
  generatedAt: string;
  filters: ReplayQuery;
  cycles: CycleRow[];
  events: EventRow[];
  summary: {
    cycles: number;
    events: number;
    eventTypes: string[];
  };
};

export type OperationalReplayServiceConfig = {
  cycleSource: CycleSource;
  eventSource: EventSource;
  now?: () => string;
};

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyTimeWindow<T extends Record<string, unknown>>(
  rows: T[],
  input: { fromMs: number | null; toMs: number | null },
  timestampKeys: string[]
): T[] {
  return rows.filter((row) => {
    const rowTs = timestampKeys
      .map((key) => parseTimestamp(row[key]))
      .find((value) => typeof value === 'number') ?? null;

    if (rowTs === null) {
      return true;
    }

    if (input.fromMs !== null && rowTs < input.fromMs) {
      return false;
    }

    if (input.toMs !== null && rowTs > input.toMs) {
      return false;
    }

    return true;
  });
}

export class OperationalReplayService {
  private readonly config: OperationalReplayServiceConfig;

  constructor(config: OperationalReplayServiceConfig) {
    this.config = config;
  }

  async getReplay(query: ReplayQuery = {}): Promise<ReplayPayload> {
    const safeLimit = query.limit && query.limit > 0 ? Math.min(Math.floor(query.limit), 500) : 50;

    const fromMs = parseTimestamp(query.from);
    const toMs = parseTimestamp(query.to);

    const [cyclesRaw, eventsRaw] = await Promise.all([
      this.config.cycleSource.listRecent(safeLimit),
      this.config.eventSource.listRecent({ limit: safeLimit, eventType: query.eventType })
    ]);

    const cycles = applyTimeWindow(cyclesRaw, { fromMs, toMs }, ['finished_at', 'started_at']);
    const events = applyTimeWindow(eventsRaw, { fromMs, toMs }, ['created_at']);

    const eventTypes = Array.from(new Set(events.map((event) => event.event_type).filter((value): value is string => typeof value === 'string'))).sort();

    return {
      generatedAt: this.now(),
      filters: {
        limit: safeLimit,
        eventType: query.eventType,
        from: query.from,
        to: query.to
      },
      cycles,
      events,
      summary: {
        cycles: cycles.length,
        events: events.length,
        eventTypes
      }
    };
  }

  private now(): string {
    return this.config.now ? this.config.now() : new Date().toISOString();
  }
}
