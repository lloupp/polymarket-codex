import type { ExecutionIntent } from '../strategy/contracts';

export type ExecutionMode = 'paper' | 'live';

type ExecutionResult = {
  fillId: string;
  executedPrice: number;
  executedSize: number;
};

type ExecutionFn = (intent: ExecutionIntent) => Promise<ExecutionResult>;

export class ExecutionModeError extends Error {
  readonly code: 'LIVE_NOT_ENABLED';

  constructor(message: string) {
    super(message);
    this.name = 'ExecutionModeError';
    this.code = 'LIVE_NOT_ENABLED';
  }
}

export type ExecutionGatewayConfig = {
  mode: ExecutionMode;
  liveEnabled: boolean;
  killSwitch?: boolean;
  autoFailoverToPaperOnLiveError?: boolean;
  paperExecutor: ExecutionFn;
  liveExecutor: ExecutionFn;
};

export type ExecutionGatewayStatus = {
  configuredMode: ExecutionMode;
  effectiveMode: ExecutionMode | 'blocked';
  liveEnabled: boolean;
  killSwitch: boolean;
  blockedReason?: 'live_not_enabled' | 'kill_switch_forced_paper' | 'auto_failover_live_error';
  lastFailoverAt?: string;
  lastFailoverReason?: string;
};

export class ExecutionGateway {
  private mode: ExecutionMode;
  private liveEnabled: boolean;
  private killSwitch: boolean;
  private readonly paperExecutor: ExecutionFn;
  private readonly liveExecutor: ExecutionFn;
  private readonly autoFailoverToPaperOnLiveError: boolean;
  private lastBlockedReason?: ExecutionGatewayStatus['blockedReason'];
  private lastFailoverAt?: string;
  private lastFailoverReason?: string;

  constructor(config: ExecutionGatewayConfig) {
    this.mode = config.mode;
    this.liveEnabled = config.liveEnabled;
    this.killSwitch = config.killSwitch ?? false;
    this.paperExecutor = config.paperExecutor;
    this.liveExecutor = config.liveExecutor;
    this.autoFailoverToPaperOnLiveError = config.autoFailoverToPaperOnLiveError ?? false;
  }

  setMode(mode: ExecutionMode): void {
    this.mode = mode;
  }

  setLiveEnabled(liveEnabled: boolean): void {
    this.liveEnabled = liveEnabled;
  }

  setKillSwitch(killSwitch: boolean): void {
    this.killSwitch = killSwitch;
  }

  async execute(intent: ExecutionIntent): Promise<ExecutionResult> {
    this.lastBlockedReason = undefined;

    if (this.killSwitch) {
      this.lastBlockedReason = 'kill_switch_forced_paper';
      return this.paperExecutor(intent);
    }

    if (this.mode === 'live') {
      if (!this.liveEnabled) {
        this.lastBlockedReason = 'live_not_enabled';
        throw new ExecutionModeError('Live execution blocked: LIVE_ENABLED flag is false');
      }

      try {
        return await this.liveExecutor(intent);
      } catch (error) {
        if (this.autoFailoverToPaperOnLiveError) {
          this.killSwitch = true;
          this.lastBlockedReason = 'auto_failover_live_error';
          this.lastFailoverAt = new Date().toISOString();
          this.lastFailoverReason = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    }

    return this.paperExecutor(intent);
  }

  getStatus(): ExecutionGatewayStatus {
    if (this.lastBlockedReason === 'live_not_enabled') {
      return {
        configuredMode: this.mode,
        effectiveMode: 'blocked',
        liveEnabled: this.liveEnabled,
        killSwitch: this.killSwitch,
        blockedReason: this.lastBlockedReason,
        lastFailoverAt: this.lastFailoverAt,
        lastFailoverReason: this.lastFailoverReason
      };
    }

    if (this.killSwitch) {
      return {
        configuredMode: this.mode,
        effectiveMode: 'paper',
        liveEnabled: this.liveEnabled,
        killSwitch: this.killSwitch,
        blockedReason: this.lastBlockedReason ?? 'kill_switch_forced_paper',
        lastFailoverAt: this.lastFailoverAt,
        lastFailoverReason: this.lastFailoverReason
      };
    }

    return {
      configuredMode: this.mode,
      effectiveMode: this.mode,
      liveEnabled: this.liveEnabled,
      killSwitch: this.killSwitch,
      blockedReason: this.lastBlockedReason,
      lastFailoverAt: this.lastFailoverAt,
      lastFailoverReason: this.lastFailoverReason
    };
  }
}
