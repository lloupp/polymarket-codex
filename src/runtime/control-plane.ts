import type { CircuitBreaker } from '../risk/circuit-breaker';

export type ControlAuditEvent = {
  command: 'pause' | 'resume' | 'reset_breaker';
  reason: string;
  actor: string;
  timestamp: string;
  changed: boolean;
};

export type RuntimeControlState = {
  paused: boolean;
  audit: ControlAuditEvent[];
};

export type RuntimeControlPlaneConfig = {
  breaker?: CircuitBreaker;
};

export class RuntimeControlPlane {
  private readonly breaker?: CircuitBreaker;
  private paused = false;
  private readonly audit: ControlAuditEvent[] = [];

  constructor(config: RuntimeControlPlaneConfig = {}) {
    this.breaker = config.breaker;
  }

  getState(): RuntimeControlState {
    return {
      paused: this.paused,
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
