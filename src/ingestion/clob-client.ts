type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type Fetcher = (url: string) => Promise<FetchResponse>;

type ClobClientOptions = {
  baseUrl: string;
  fetcher?: Fetcher;
  retryDelaysMs?: number[];
  timeoutMs?: number;
};

type GetPriceInput = {
  tokenId: string;
  side: 'BUY' | 'SELL';
};

type GetOrderBookInput = {
  tokenId: string;
};

type OrderLevel = {
  price: number;
  size: number;
};

type PriceResult = {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
};

type BookResult = {
  tokenId: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

export class ClobClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly retryDelaysMs: number[];
  private readonly timeoutMs: number;

  constructor(options: ClobClientOptions) {
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
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getPrice(input: GetPriceInput): Promise<PriceResult> {
    const url = `${this.baseUrl}/price?token_id=${encodeURIComponent(input.tokenId)}&side=${input.side}`;
    const response = await this.fetchWithRetry(url);
    const payload = (await response.json()) as { price: string | number };

    return {
      tokenId: input.tokenId,
      side: input.side,
      price: Number(payload.price)
    };
  }

  async getOrderBook(input: GetOrderBookInput): Promise<BookResult> {
    const url = `${this.baseUrl}/book?token_id=${encodeURIComponent(input.tokenId)}`;
    const response = await this.fetchWithRetry(url);
    const payload = (await response.json()) as {
      bids?: Array<{ price: string | number; size: string | number }>;
      asks?: Array<{ price: string | number; size: string | number }>;
    };

    return {
      tokenId: input.tokenId,
      bids: (payload.bids ?? []).map((level) => ({ price: Number(level.price), size: Number(level.size) })),
      asks: (payload.asks ?? []).map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    };
  }

  private async fetchWithRetry(url: string): Promise<FetchResponse> {
    let attempt = 0;

    while (true) {
      const response = await withTimeout(
        this.fetcher(url),
        this.timeoutMs,
        `CLOB request timeout after ${this.timeoutMs}ms`
      );

      if (response.ok) {
        return response;
      }

      const canRetry = RETRYABLE_STATUS.has(response.status) && attempt < this.retryDelaysMs.length;
      if (!canRetry) {
        throw new Error(`CLOB request failed with status ${response.status}`);
      }

      const delayMs = this.retryDelaysMs[attempt] ?? 0;
      attempt += 1;
      await sleep(delayMs);
    }
  }
}
