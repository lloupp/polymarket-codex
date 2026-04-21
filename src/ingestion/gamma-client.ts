type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type Fetcher = (url: string) => Promise<FetchResponse>;

type GammaClientOptions = {
  baseUrl: string;
  fetcher?: Fetcher;
  retryDelaysMs?: number[];
};

type GetEventsOptions = {
  limit?: number;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GammaClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly retryDelaysMs: number[];

  constructor(options: GammaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetcher = options.fetcher ?? (async (url) => {
      const response = await fetch(url);
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.json() as Promise<unknown>
      };
    });
    this.retryDelaysMs = options.retryDelaysMs ?? [250, 500, 1000];
  }

  async getEvents(options: GetEventsOptions = {}): Promise<Record<string, unknown>[]> {
    const limit = options.limit ?? 100;
    let offset = 0;
    const all: Record<string, unknown>[] = [];

    while (true) {
      const url = `${this.baseUrl}/events?limit=${limit}&offset=${offset}`;
      const page = await this.fetchWithRetry(url);
      const items = (await page.json()) as Record<string, unknown>[];

      all.push(...items);
      if (items.length < limit) {
        break;
      }

      offset += limit;
    }

    return all;
  }

  private async fetchWithRetry(url: string): Promise<FetchResponse> {
    let attempt = 0;

    while (true) {
      const response = await this.fetcher(url);
      if (response.ok) {
        return response;
      }

      const canRetry = RETRYABLE_STATUS.has(response.status) && attempt < this.retryDelaysMs.length;
      if (!canRetry) {
        throw new Error(`Gamma request failed with status ${response.status}`);
      }

      const delayMs = this.retryDelaysMs[attempt] ?? 0;
      attempt += 1;
      await sleep(delayMs);
    }
  }
}
