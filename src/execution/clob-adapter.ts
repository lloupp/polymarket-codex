export type ExecutionErrorCategory =
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'UNKNOWN';

export class ExecutionError extends Error {
  readonly category: ExecutionErrorCategory;
  readonly original?: unknown;

  constructor(input: { message: string; category: ExecutionErrorCategory; original?: unknown }) {
    super(input.message);
    this.name = 'ExecutionError';
    this.category = input.category;
    this.original = input.original;
  }
}

export type CreateOrderRequest = {
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price?: number;
  tif: 'GTC' | 'IOC' | 'FOK';
};

export type CreateOrderResponse = {
  orderId: string;
};

export type CancelOrderRequest = {
  orderId: string;
};

export type GetOrderStatusRequest = {
  orderId: string;
};

export type RemoteOrderStatus = {
  orderId: string;
  state: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired';
  filledSize: number;
  remainingSize: number;
};

type ClobClientLike = {
  createOrder: (request: CreateOrderRequest) => Promise<CreateOrderResponse>;
  cancelOrder: (request: CancelOrderRequest) => Promise<void>;
  getOrderStatus: (request: GetOrderStatusRequest) => Promise<RemoteOrderStatus>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const maybeStatus = (error as { status?: unknown }).status;
  return typeof maybeStatus === 'number' ? maybeStatus : undefined;
}

function categorize(error: unknown): ExecutionErrorCategory {
  const status = toStatus(error);

  if (status === 429) {
    return 'RATE_LIMIT';
  }

  if (status === 401 || status === 403) {
    return 'AUTH';
  }

  if (status === 404) {
    return 'NOT_FOUND';
  }

  if (status === 400 || status === 422) {
    return 'VALIDATION';
  }

  if ((status !== undefined && status >= 500) || (error instanceof Error && /timeout|temporar|network|503/i.test(error.message))) {
    return 'TRANSIENT';
  }

  return 'UNKNOWN';
}

function isRetryable(category: ExecutionErrorCategory): boolean {
  return category === 'RATE_LIMIT' || category === 'TRANSIENT';
}

async function withRetry<T>(
  operation: () => Promise<T>,
  retryDelaysMs: number[]
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const category = categorize(error);
      const retryDelay = retryDelaysMs[attempt];

      if (!isRetryable(category) || retryDelay === undefined) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ExecutionError({
          message: `Execution failed: ${message}`,
          category,
          original: error
        });
      }

      await sleep(retryDelay);
      attempt += 1;
    }
  }
}

export class ClobExecutionAdapter {
  private readonly client: ClobClientLike;
  private readonly retryDelaysMs: number[];

  constructor(input: { client: ClobClientLike; retryDelaysMs?: number[] }) {
    this.client = input.client;
    this.retryDelaysMs = input.retryDelaysMs ?? [100, 300, 800];
  }

  create(request: CreateOrderRequest): Promise<CreateOrderResponse> {
    return withRetry(() => this.client.createOrder(request), this.retryDelaysMs);
  }

  cancel(request: CancelOrderRequest): Promise<void> {
    return withRetry(() => this.client.cancelOrder(request), this.retryDelaysMs);
  }

  getStatus(request: GetOrderStatusRequest): Promise<RemoteOrderStatus> {
    return withRetry(() => this.client.getOrderStatus(request), this.retryDelaysMs);
  }
}
