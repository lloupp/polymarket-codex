export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type SocketLike = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send: (payload: string) => void;
  close: () => void;
};

type RealtimeClientOptions = {
  wsUrl: string;
  reconnectDelaysMs?: number[];
  socketFactory?: (url: string) => SocketLike;
  onMessage?: (message: unknown) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RealtimeClient {
  private readonly wsUrl: string;
  private readonly reconnectDelaysMs: number[];
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly onMessage?: (message: unknown) => void;
  private readonly onStatusChange?: (status: RealtimeStatus) => void;

  private socket: SocketLike | null = null;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private subscriptions: string[] = [];

  constructor(options: RealtimeClientOptions) {
    this.wsUrl = options.wsUrl;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [250, 500, 1000, 2000];
    this.socketFactory =
      options.socketFactory ??
      ((url) => {
        const NativeWebSocket = (globalThis as unknown as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
        if (!NativeWebSocket) {
          throw new Error('No WebSocket implementation available. Provide socketFactory.');
        }
        return new NativeWebSocket(url);
      });
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.emitStatus('connecting');
    this.createSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.socket?.close();
    this.socket = null;
    this.emitStatus('disconnected');
  }

  subscribe(payload: Record<string, unknown>): void {
    const serialized = JSON.stringify(payload);
    this.subscriptions.push(serialized);

    if (this.socket) {
      this.socket.send(serialized);
    }
  }

  private createSocket(): void {
    const socket = this.socketFactory(this.wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.emitStatus('connected');
      for (const subscription of this.subscriptions) {
        socket.send(subscription);
      }
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.onMessage?.(parsed);
      } catch {
        // Ignore malformed JSON messages to keep stream alive
      }
    };

    socket.onerror = () => {
      // noop: reconnect decision happens in onclose
    };

    socket.onclose = (_event) => {
      this.socket = null;
      if (!this.shouldReconnect) {
        this.emitStatus('disconnected');
        return;
      }
      void this.reconnect();
    };
  }

  private async reconnect(): Promise<void> {
    this.emitStatus('reconnecting');
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? 0;
    this.reconnectAttempt += 1;
    await sleep(delay);

    if (!this.shouldReconnect) {
      return;
    }

    this.createSocket();
  }

  private emitStatus(status: RealtimeStatus): void {
    this.onStatusChange?.(status);
  }
}
