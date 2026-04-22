import type { CircuitBreaker } from '../risk/circuit-breaker';
import type { ExecutionGateway, ExecutionGatewayStatus, ExecutionMode } from '../execution/execution-gateway';

export type ControlAuditEvent = {
  command:
    | 'pause'
    | 'resume'
    | 'reset_breaker'
    | 'execution_mode'
    | 'live_enabled'
    | 'kill_switch';
  reason: string;
  actor: string;
  timestamp: string;
  changed: boolean;
};

export type RuntimeControlState = {
  paused: boolean;
  execution: ExecutionGatewayStatus | null;
  audit: ControlAuditEvent[];
};

export type RuntimeControlPlaneConfig = {
  breaker?: CircuitBreaker;
  executionGateway?: ExecutionGateway;
};

export class RuntimeControlPlane {
  private readonly breaker?: CircuitBreaker;
  private readonly executionGateway?: ExecutionGateway;
  private paused = false;
  private readonly audit: ControlAuditEvent[] = [];

  constructor(config: RuntimeControlPlaneConfig = {}) {
    this.breaker = config.breaker;
    this.executionGateway = config.executionGateway;
  }

  getState(): RuntimeControlState {
    return {
      paused: this.paused,
      execution: this.executionGateway ? this.executionGateway.getStatus() : null,
      audit: [...this.audit]
    };
  }

  async pause(input: { reason?: string; actor?: string } = {}): Promise<{ changed: boolean; paused: boolean }> {
    const changed = !this.paused;
    this.paused = true;

    this.recordAudit({
      command: 'pause',
      reason: input.reason ?? 'unspecified',
      actor: input.actor ?? 'system',
      changed
    });

    return { changed, paused: this.paused };
  }

  async resume(input: { reason?: string; actor?: string } = {}): Promise<{ changed: boolean; paused: boolean }> {
    const changed = this.paused;
    this.paused = false;

    this.recordAudit({
      command: 'resume',
      reason: input.reason ?? 'unspecified',
      actor: input.actor ?? 'system',
      changed
    });

    return { changed, paused: this.paused };
  }

  async resetBreaker(input: { reason?: string; actor?: string } = {}): Promise<{ changed: boolean }> {
    if (!this.breaker) {
      this.recordAudit({
        command: 'reset_breaker',
        reason: input.reason ?? 'unspecified',
        actor: input.actor ?? 'system',
        changed: false
      });
      return { changed: false };
    }

    const wasTripped = this.breaker.getState().tripped;
    await this.breaker.reset({ reason: input.reason ?? 'manual_reset' });

    this.recordAudit({
      command: 'reset_breaker',
      reason: input.reason ?? 'manual_reset',
      actor: input.actor ?? 'system',
      changed: wasTripped
    });

    return { changed: wasTripped };
  }

  async setExecutionMode(input: {
    mode: ExecutionMode;
    reason?: string;
    actor?: string;
  }): Promise<{ changed: boolean; status: ExecutionGatewayStatus | null }> {
    if (!this.executionGateway) {
      this.recordAudit({
        command: 'execution_mode',
        reason: input.reason ?? 'unspecified',
        actor: input.actor ?? 'system',
        changed: false
      });
      return { changed: false, status: null };
    }

    const previous = this.executionGateway.getStatus().configuredMode;
    this.executionGateway.setMode(input.mode);
    const changed = previous !== input.mode;

    this.recordAudit({
      command: 'execution_mode',
      reason: input.reason ?? 'unspecified',
      actor: input.actor ?? 'system',
      changed
    });

    return { changed, status: this.executionGateway.getStatus() };
  }

  async setLiveEnabled(input: {
    enabled: boolean;
    reason?: string;
    actor?: string;
  }): Promise<{ changed: boolean; status: ExecutionGatewayStatus | null }> {
    if (!this.executionGateway) {
      this.recordAudit({
        command: 'live_enabled',
        reason: input.reason ?? 'unspecified',
        actor: input.actor ?? 'system',
        changed: false
      });
      return { changed: false, status: null };
    }

    const previous = this.executionGateway.getStatus().liveEnabled;
    this.executionGateway.setLiveEnabled(input.enabled);
    const changed = previous !== input.enabled;

    this.recordAudit({
      command: 'live_enabled',
      reason: input.reason ?? 'unspecified',
      actor: input.actor ?? 'system',
      changed
    });

    return { changed, status: this.executionGateway.getStatus() };
  }

  async setKillSwitch(input: {
    enabled: boolean;
    reason?: string;
    actor?: string;
  }): Promise<{ changed: boolean; status: ExecutionGatewayStatus | null }> {
    if (!this.executionGateway) {
      this.recordAudit({
        command: 'kill_switch',
        reason: input.reason ?? 'unspecified',
        actor: input.actor ?? 'system',
        changed: false
      });
      return { changed: false, status: null };
    }

    const previous = this.executionGateway.getStatus().killSwitch;
    this.executionGateway.setKillSwitch(input.enabled);
    const changed = previous !== input.enabled;

    this.recordAudit({
      command: 'kill_switch',
      reason: input.reason ?? 'unspecified',
      actor: input.actor ?? 'system',
      changed
    });

    return { changed, status: this.executionGateway.getStatus() };
  }

  private recordAudit(input: Omit<ControlAuditEvent, 'timestamp'>): void {
    this.audit.push({
      ...input,
      timestamp: new Date().toISOString()
    });

    if (this.audit.length > 100) {
      this.audit.splice(0, this.audit.length - 100);
    }
  }
}
