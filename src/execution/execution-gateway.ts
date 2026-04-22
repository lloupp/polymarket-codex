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
  failoverResetCooldownMs?: number;
  isCriticalLiveError?: (error: unknown) => boolean;
  now?: () => Date;
  paperExecutor: ExecutionFn;
  liveExecutor: ExecutionFn;
};

export type ExecutionGatewayStatus = {
  configuredMode: ExecutionMode;
  effectiveMode: ExecutionMode | 'blocked';
  liveEnabled: boolean;
  killSwitch: boolean;
  manualPaperOverride: boolean;
  manualPaperOverrideReason?: string;
  failoverLocked: boolean;
  failoverCount: number;
  cooldownRemainingMs: number;
  blockedReason?:
    | 'live_not_enabled'
    | 'kill_switch_forced_paper'
    | 'auto_failover_live_error'
    | 'manual_paper_override';
  lastFailoverAt?: string;
  lastFailoverReason?: string;
};

export class ExecutionGateway {
  private mode: ExecutionMode;
  private liveEnabled: boolean;
  private killSwitch: boolean;
  private manualPaperOverride: boolean;
  private manualPaperOverrideReason?: string;
  private failoverLocked: boolean;
  private failoverCount: number;
  private readonly failoverResetCooldownMs: number;
  private readonly now: () => Date;
  private readonly paperExecutor: ExecutionFn;
  private readonly liveExecutor: ExecutionFn;
  private readonly autoFailoverToPaperOnLiveError: boolean;
  private readonly isCriticalLiveError: (error: unknown) => boolean;
  private lastBlockedReason?: ExecutionGatewayStatus['blockedReason'];
  private lastFailoverAt?: string;
  private lastFailoverReason?: string;

  constructor(config: ExecutionGatewayConfig) {
    this.mode = config.mode;
    this.liveEnabled = config.liveEnabled;
    this.killSwitch = config.killSwitch ?? false;
    this.manualPaperOverride = false;
    this.manualPaperOverrideReason = undefined;
    this.failoverLocked = false;
    this.failoverCount = 0;
    this.failoverResetCooldownMs = Math.max(0, config.failoverResetCooldownMs ?? 0);
    this.now = config.now ?? (() => new Date());
    this.paperExecutor = config.paperExecutor;
    this.liveExecutor = config.liveExecutor;
    this.autoFailoverToPaperOnLiveError = config.autoFailoverToPaperOnLiveError ?? false;
    this.isCriticalLiveError =
      config.isCriticalLiveError ??
      ((error) => {
        if (error instanceof Error) {
          return true;
        }
        return true;
      });
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

  setManualPaperOverride(reason: string): void {
    this.manualPaperOverride = true;
    this.manualPaperOverrideReason = reason;
  }

  clearManualPaperOverride(): void {
    this.manualPaperOverride = false;
    this.manualPaperOverrideReason = undefined;
    if (this.lastBlockedReason === 'manual_paper_override') {
      this.lastBlockedReason = undefined;
    }
  }

  resetFailoverLock(): void {
    if (!this.failoverLocked) {
      return;
    }

    if (this.getCooldownRemainingMs() > 0) {
      return;
    }

    this.failoverLocked = false;
    this.killSwitch = false;
    if (this.lastBlockedReason === 'auto_failover_live_error') {
      this.lastBlockedReason = undefined;
    }
  }

  private getCooldownRemainingMs(): number {
    if (!this.failoverLocked || !this.lastFailoverAt) {
      return 0;
    }

    const failoverAtMs = Date.parse(this.lastFailoverAt);
    if (!Number.isFinite(failoverAtMs)) {
      return 0;
    }

    const elapsed = this.now().getTime() - failoverAtMs;
    return Math.max(0, this.failoverResetCooldownMs - elapsed);
  }

  async execute(intent: ExecutionIntent): Promise<ExecutionResult> {
    this.lastBlockedReason = undefined;

    if (this.manualPaperOverride) {
      this.lastBlockedReason = 'manual_paper_override';
      return this.paperExecutor(intent);
    }

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
        if (this.autoFailoverToPaperOnLiveError && this.isCriticalLiveError(error)) {
          this.killSwitch = true;
          this.failoverLocked = true;
          this.failoverCount += 1;
          this.lastBlockedReason = 'auto_failover_live_error';
          this.lastFailoverAt = this.now().toISOString();
          this.lastFailoverReason = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    }

    return this.paperExecutor(intent);
  }

  getStatus(): ExecutionGatewayStatus {
    const cooldownRemainingMs = this.getCooldownRemainingMs();

    if (this.lastBlockedReason === 'live_not_enabled') {
      return {
        configuredMode: this.mode,
        effectiveMode: 'blocked',
        liveEnabled: this.liveEnabled,
        killSwitch: this.killSwitch,
        manualPaperOverride: this.manualPaperOverride,
        manualPaperOverrideReason: this.manualPaperOverrideReason,
        failoverLocked: this.failoverLocked,
        failoverCount: this.failoverCount,
        cooldownRemainingMs,
        blockedReason: this.lastBlockedReason,
        lastFailoverAt: this.lastFailoverAt,
        lastFailoverReason: this.lastFailoverReason
      };
    }

    if (this.manualPaperOverride) {
      return {
        configuredMode: this.mode,
        effectiveMode: 'paper',
        liveEnabled: this.liveEnabled,
        killSwitch: this.killSwitch,
        manualPaperOverride: this.manualPaperOverride,
        manualPaperOverrideReason: this.manualPaperOverrideReason,
        failoverLocked: this.failoverLocked,
        failoverCount: this.failoverCount,
        cooldownRemainingMs,
        blockedReason: this.lastBlockedReason ?? 'manual_paper_override',
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
        manualPaperOverride: this.manualPaperOverride,
        manualPaperOverrideReason: this.manualPaperOverrideReason,
        failoverLocked: this.failoverLocked,
        failoverCount: this.failoverCount,
        cooldownRemainingMs,
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
      manualPaperOverride: this.manualPaperOverride,
      manualPaperOverrideReason: this.manualPaperOverrideReason,
      failoverLocked: this.failoverLocked,
      failoverCount: this.failoverCount,
      cooldownRemainingMs,
      blockedReason: this.lastBlockedReason,
      lastFailoverAt: this.lastFailoverAt,
      lastFailoverReason: this.lastFailoverReason
    };
  }
}
