export type RuntimeSnapshot = {
  positions: unknown[];
  orders: unknown[];
  signals: unknown[];
  risk: Record<string, unknown>;
  updatedAt: string;
};

export type RuntimeStateUpdate = {
  positions?: unknown[];
  orders?: unknown[];
  signals?: unknown[];
  risk?: Record<string, unknown>;
};

export class RuntimeStateStore {
  private snapshot: RuntimeSnapshot = {
    positions: [],
    orders: [],
    signals: [],
    risk: { breaker: { tripped: false }, status: 'ok' },
    updatedAt: new Date().toISOString()
  };

  async replaceSnapshot(snapshot: RuntimeSnapshot): Promise<void> {
    this.snapshot = {
      positions: [...snapshot.positions],
      orders: [...snapshot.orders],
      signals: [...snapshot.signals],
      risk: { ...snapshot.risk },
      updatedAt: snapshot.updatedAt
    };
  }

  async updateState(update: RuntimeStateUpdate): Promise<void> {
    this.snapshot = {
      positions: update.positions ?? this.snapshot.positions,
      orders: update.orders ?? this.snapshot.orders,
      signals: update.signals ?? this.snapshot.signals,
      risk: update.risk ?? this.snapshot.risk,
      updatedAt: new Date().toISOString()
    };
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return {
      positions: [...this.snapshot.positions],
      orders: [...this.snapshot.orders],
      signals: [...this.snapshot.signals],
      risk: { ...this.snapshot.risk },
      updatedAt: this.snapshot.updatedAt
    };
  }
}
