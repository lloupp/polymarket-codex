export type IncidentType = 'breaker' | 'ws_down' | 'critical_error' | 'staleness' | 'slo_degradation';

export type AlertSeverity = 'critical' | 'warning';

export type IncidentAlertInput = {
  incidentType: IncidentType;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
};

export type IncidentAlertPayload = {
  source: 'polymarket-codex';
  severity: AlertSeverity;
  incidentType: IncidentType;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
};

export type AlertTransport = {
  send: (payload: IncidentAlertPayload) => Promise<void>;
};

export class AlertingService {
  private readonly transport: AlertTransport;

  constructor(transport: AlertTransport) {
    this.transport = transport;
  }

  async notify(input: IncidentAlertInput): Promise<void> {
    const warningIncidents: IncidentType[] = ['ws_down', 'staleness', 'slo_degradation'];

    const payload: IncidentAlertPayload = {
      source: 'polymarket-codex',
      severity: warningIncidents.includes(input.incidentType) ? 'warning' : 'critical',
      incidentType: input.incidentType,
      message: input.message,
      context: input.context ?? {},
      timestamp: input.timestamp ?? new Date().toISOString()
    };

    await this.transport.send(payload);
  }
}

export type TelegramTransportInput = {
  botToken: string;
  chatId: string;
  fetcher?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;
};

export class TelegramTransport implements AlertTransport {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetcher: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

  constructor(input: TelegramTransportInput) {
    this.botToken = input.botToken;
    this.chatId = input.chatId;
    this.fetcher =
      input.fetcher ??
      (async (url, init) => {
        const response = await fetch(url, init);
        return { ok: response.ok, status: response.status };
      });
  }

  async send(payload: IncidentAlertPayload): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const body = {
      chat_id: this.chatId,
      text: this.renderMessage(payload),
      disable_web_page_preview: true
    };

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`telegram alert failed with status ${response.status}`);
    }
  }

  private renderMessage(payload: IncidentAlertPayload): string {
    const context = Object.entries(payload.context)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');

    return [
      '[POLYMARKET ALERT]',
      `severity=${payload.severity}`,
      `incident=${payload.incidentType}`,
      `message=${payload.message}`,
      `timestamp=${payload.timestamp}`,
      `context=${context || 'none'}`
    ].join('\n');
  }
}
