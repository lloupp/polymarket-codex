export type BreakerTripReason = 'consecutive_errors' | 'daily_drawdown';

export type BreakerEventType =
  | 'error_recorded'
  | 'pnl_updated'
  | 'breaker_tripped'
  | 'breaker_reset';

export type BreakerEvent = {
  type: BreakerEventType;
  timestamp: string;
  reason?: BreakerTripReason | string;
  metadata: Record<string, unknown>;
};

export type BreakerAlertPayload = {
  reason: BreakerTripReason;
  message: string;
  state: CircuitBreakerState;
};

export type CircuitBreakerConfig = {
  maxConsecutiveErrors: number;
  dailyDrawdownLimit: number;
  persistEvent?: (event: BreakerEvent) => Promise<void>;
  onAlert?: (payload: BreakerAlertPayload) => Promise<void>;
};

export type CircuitBreakerState = {
  tripped: boolean;
  tripReason: BreakerTripReason | null;
  trippedAt: string | null;
  consecutiveErrors: number;
  dailyDrawdown: number;
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;

  private state: CircuitBreakerState = {
    tripped: false,
    tripReason: null,
    trippedAt: null,
    consecutiveErrors: 0,
    dailyDrawdown: 0
  };

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  canExecute(): { allowed: boolean; reason: string } {
    if (!this.state.tripped) {
      return { allowed: true, reason: 'breaker_not_tripped' };
    }

    return {
      allowed: false,
      reason: this.state.tripReason ?? 'breaker_tripped'
    };
  }

  async recordSuccess(): Promise<void> {
    this.state.consecutiveErrors = 0;
    await this.persist({
      type: 'error_recorded',
      timestamp: new Date().toISOString(),
      metadata: {
        status: 'success',
        consecutiveErrors: this.state.consecutiveErrors
      }
    });
  }

  async recordError(input: { code: string; message: string }): Promise<void> {
    this.state.consecutiveErrors += 1;

    await this.persist({
      type: 'error_recorded',
      timestamp: new Date().toISOString(),
      metadata: {
        status: 'error',
        code: input.code,
        message: input.message,
        consecutiveErrors: this.state.consecutiveErrors
      }
    });

    if (this.state.tripped) {
      return;
    }

    if (this.state.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      await this.trip('consecutive_errors', {
        threshold: this.config.maxConsecutiveErrors,
        code: input.code,
        message: input.message
      });
    }
  }

  async updateDailyPnl(input: {
    realizedPnl: number;
    unrealizedPnl: number;
    timestamp?: string;
  }): Promise<void> {
    const totalPnl = round(input.realizedPnl + input.unrealizedPnl);
    const drawdown = totalPnl < 0 ? Math.abs(totalPnl) : 0;
    this.state.dailyDrawdown = drawdown;

    await this.persist({
      type: 'pnl_updated',
      timestamp: input.timestamp ?? new Date().toISOString(),
      metadata: {
        realizedPnl: round(input.realizedPnl),
        unrealizedPnl: round(input.unrealizedPnl),
        totalPnl,
        dailyDrawdown: drawdown
      }
    });

    if (this.state.tripped) {
      return;
    }

    if (drawdown >= this.config.dailyDrawdownLimit) {
      await this.trip('daily_drawdown', {
        drawdown,
        threshold: this.config.dailyDrawdownLimit
      });
    }
  }

  async reset(input: { reason: string }): Promise<void> {
    this.state = {
      tripped: false,
      tripReason: null,
      trippedAt: null,
      consecutiveErrors: 0,
      dailyDrawdown: 0
    };

    await this.persist({
      type: 'breaker_reset',
      timestamp: new Date().toISOString(),
      reason: input.reason,
      metadata: {
        reason: input.reason
      }
    });
  }

  private async trip(reason: BreakerTripReason, metadata: Record<string, unknown>): Promise<void> {
    this.state.tripped = true;
    this.state.tripReason = reason;
    this.state.trippedAt = new Date().toISOString();

    await this.persist({
      type: 'breaker_tripped',
      timestamp: this.state.trippedAt,
      reason,
      metadata: {
        ...metadata,
        dailyDrawdown: this.state.dailyDrawdown,
        consecutiveErrors: this.state.consecutiveErrors
      }
    });

    if (this.config.onAlert) {
      await this.config.onAlert({
        reason,
        message:
          reason === 'consecutive_errors'
            ? `Circuit breaker acionado: ${this.state.consecutiveErrors} erros consecutivos.`
            : `Circuit breaker acionado: drawdown diário ${this.state.dailyDrawdown} >= ${this.config.dailyDrawdownLimit}.`,
        state: this.getState()
      });
    }
  }

  private async persist(event: BreakerEvent): Promise<void> {
    if (this.config.persistEvent) {
      await this.config.persistEvent(event);
    }
  }
}
