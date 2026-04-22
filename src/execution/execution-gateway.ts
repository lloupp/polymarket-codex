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
  paperExecutor: ExecutionFn;
  liveExecutor: ExecutionFn;
};

export type ExecutionGatewayStatus = {
  configuredMode: ExecutionMode;
  effectiveMode: ExecutionMode | 'blocked';
  liveEnabled: boolean;
  killSwitch: boolean;
  blockedReason?: 'live_not_enabled' | 'kill_switch_forced_paper';
};

export class ExecutionGateway {
  private mode: ExecutionMode;
  private liveEnabled: boolean;
  private killSwitch: boolean;
  private readonly paperExecutor: ExecutionFn;
  private readonly liveExecutor: ExecutionFn;
  private lastBlockedReason?: ExecutionGatewayStatus['blockedReason'];

  constructor(config: ExecutionGatewayConfig) {
    this.mode = config.mode;
    this.liveEnabled = config.liveEnabled;
    this.killSwitch = config.killSwitch ?? false;
    this.paperExecutor = config.paperExecutor;
    this.liveExecutor = config.liveExecutor;
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
      return this.liveExecutor(intent);
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
        blockedReason: this.lastBlockedReason
      };
    }

    if (this.killSwitch) {
      return {
        configuredMode: this.mode,
        effectiveMode: 'paper',
        liveEnabled: this.liveEnabled,
        killSwitch: this.killSwitch,
        blockedReason: 'kill_switch_forced_paper'
      };
    }

    return {
      configuredMode: this.mode,
      effectiveMode: this.mode,
      liveEnabled: this.liveEnabled,
      killSwitch: this.killSwitch,
      blockedReason: this.lastBlockedReason
    };
  }
}
