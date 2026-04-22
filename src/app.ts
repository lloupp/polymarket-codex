import express from 'express';

import { MetricsRegistry } from './monitoring/metrics-registry';
import { RuntimeControlPlane } from './runtime/control-plane';
import { RuntimeStateStore } from './runtime/state-store';

export type ApiDataProvider = {
  getPositions: () => Promise<unknown[]>;
  getOrders: () => Promise<unknown[]>;
  getSignals: () => Promise<unknown[]>;
  getRisk: () => Promise<Record<string, unknown>>;
  getCycles: () => Promise<unknown[]>;
  getEvents: () => Promise<unknown[]>;
  getReplay: (query: {
    limit?: number;
    eventType?: string;
    from?: string;
    to?: string;
  }) => Promise<Record<string, unknown>>;
};

export type CreateAppInput = {
  startedAt?: Date;
  metrics?: MetricsRegistry;
  provider?: Partial<ApiDataProvider>;
  stateStore?: RuntimeStateStore;
  control?: {
    plane: RuntimeControlPlane;
    adminToken: string;
  };
};

function buildStateStoreProvider(stateStore: RuntimeStateStore): ApiDataProvider {
  return {
    getPositions: async () => (await stateStore.getSnapshot()).positions,
    getOrders: async () => (await stateStore.getSnapshot()).orders,
    getSignals: async () => (await stateStore.getSnapshot()).signals,
    getRisk: async () => (await stateStore.getSnapshot()).risk,
    getCycles: async () => [],
    getEvents: async () => [],
    getReplay: async (query) => ({
      generatedAt: new Date().toISOString(),
      filters: query,
      cycles: [],
      events: [],
      summary: { cycles: 0, events: 0, eventTypes: [] }
    })
  };
}

const fallbackProvider: ApiDataProvider = {
  getPositions: async () => [],
  getOrders: async () => [],
  getSignals: async () => [],
  getRisk: async () => ({
    breaker: { tripped: false },
    limits: {},
    status: 'ok'
  }),
  getCycles: async () => [],
  getEvents: async () => [],
  getReplay: async (query) => ({
    generatedAt: new Date().toISOString(),
    filters: query,
    cycles: [],
    events: [],
    summary: { cycles: 0, events: 0, eventTypes: [] }
  })
};

function unauthorized(res: express.Response): void {
  res.status(401).json({ error: 'unauthorized', message: 'invalid admin token' });
}

function badRequest(res: express.Response, message: string): void {
  res.status(400).json({ error: 'bad_request', message });
}

function ensureAuthorized(
  req: express.Request,
  res: express.Response,
  control: CreateAppInput['control']
): control is NonNullable<CreateAppInput['control']> {
  if (!control) {
    res.status(404).json({ error: 'not_available', message: 'control plane not configured' });
    return false;
  }

  const token = req.header('x-admin-token');
  if (token !== control.adminToken) {
    unauthorized(res);
    return false;
  }

  return true;
}

export function createApp(input: CreateAppInput = {}) {
  const app = express();
  const startedAt = input.startedAt ?? new Date();
  const metrics = input.metrics ?? new MetricsRegistry();

  app.use(express.json());

  const baseProvider = input.stateStore ? buildStateStoreProvider(input.stateStore) : fallbackProvider;

  const provider: ApiDataProvider = {
    getPositions: input.provider?.getPositions ?? baseProvider.getPositions,
    getOrders: input.provider?.getOrders ?? baseProvider.getOrders,
    getSignals: input.provider?.getSignals ?? baseProvider.getSignals,
    getRisk: input.provider?.getRisk ?? baseProvider.getRisk,
    getCycles: input.provider?.getCycles ?? baseProvider.getCycles,
    getEvents: input.provider?.getEvents ?? baseProvider.getEvents,
    getReplay: input.provider?.getReplay ?? baseProvider.getReplay
  };

  app.get('/health', (_req, res) => {
    const uptimeSec = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
    res.status(200).json({ status: 'ok', uptimeSec });
  });

  app.get('/metrics', (_req, res) => {
    res.status(200).type('text/plain; version=0.0.4').send(`${metrics.toPrometheus()}\n`);
  });

  app.get('/positions', async (_req, res, next) => {
    try {
      const positions = await provider.getPositions();
      res.status(200).json({ positions });
    } catch (error) {
      next(error);
    }
  });

  app.get('/orders', async (_req, res, next) => {
    try {
      const orders = await provider.getOrders();
      res.status(200).json({ orders });
    } catch (error) {
      next(error);
    }
  });

  app.get('/signals', async (_req, res, next) => {
    try {
      const signals = await provider.getSignals();
      res.status(200).json({ signals });
    } catch (error) {
      next(error);
    }
  });

  app.get('/cycles', async (_req, res, next) => {
    try {
      const cycles = await provider.getCycles();
      res.status(200).json({ cycles });
    } catch (error) {
      next(error);
    }
  });

  app.get('/events', async (_req, res, next) => {
    try {
      const events = await provider.getEvents();
      res.status(200).json({ events });
    } catch (error) {
      next(error);
    }
  });

  app.get('/replay', async (req, res, next) => {
    try {
      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const limit = Number.isFinite(limitRaw) && (limitRaw as number) > 0 ? Math.floor(limitRaw as number) : undefined;

      const replay = await provider.getReplay({
        limit,
        eventType: typeof req.query.eventType === 'string' ? req.query.eventType : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined
      });

      res.status(200).json({ replay });
    } catch (error) {
      next(error);
    }
  });

  app.get('/execution', (_req, res) => {
    res.status(200).json({
      execution: input.control?.plane.getState().execution ?? null
    });
  });

  app.get('/risk', async (_req, res, next) => {
    try {
      const risk = await provider.getRisk();
      const controlState = input.control?.plane.getState();
      const status = controlState?.paused ? 'paused' : ((risk.status as string | undefined) ?? 'ok');

      res.status(200).json({
        risk: {
          ...risk,
          status,
          control: controlState ?? null
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/control/pause', async (req, res, next) => {
    try {
      if (!ensureAuthorized(req, res, input.control)) {
        return;
      }

      const result = await input.control.plane.pause({
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        actor: typeof req.body?.actor === 'string' ? req.body.actor : undefined
      });

      res.status(200).json({ ok: true, command: 'pause', result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/control/resume', async (req, res, next) => {
    try {
      if (!ensureAuthorized(req, res, input.control)) {
        return;
      }

      const result = await input.control.plane.resume({
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        actor: typeof req.body?.actor === 'string' ? req.body.actor : undefined
      });

      res.status(200).json({ ok: true, command: 'resume', result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/control/reset-breaker', async (req, res, next) => {
    try {
      if (!ensureAuthorized(req, res, input.control)) {
        return;
      }

      const result = await input.control.plane.resetBreaker({
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        actor: typeof req.body?.actor === 'string' ? req.body.actor : undefined
      });

      res.status(200).json({ ok: true, command: 'reset-breaker', result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/control/execution-mode', async (req, res, next) => {
    try {
      if (!ensureAuthorized(req, res, input.control)) {
        return;
      }

      if (req.body?.mode !== 'paper' && req.body?.mode !== 'live') {
        badRequest(res, 'mode must be one of: paper, live');
        return;
      }

      const result = await input.control.plane.setExecutionMode({
        mode: req.body.mode,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        actor: typeof req.body?.actor === 'string' ? req.body.actor : undefined
      });

      res.status(200).json({ ok: true, command: 'execution-mode', result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/control/live-enabled', async (req, res, next) => {
    try {
      if (!ensureAuthorized(req, res, input.control)) {
        return;
      }

      if (typeof req.body?.enabled !== 'boolean') {
        badRequest(res, 'enabled must be boolean');
        return;
      }

      const result = await input.control.plane.setLiveEnabled({
        enabled: req.body.enabled,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        actor: typeof req.body?.actor === 'string' ? req.body.actor : undefined
      });

      res.status(200).json({ ok: true, command: 'live-enabled', result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/control/kill-switch', async (req, res, next) => {
    try {
      if (!ensureAuthorized(req, res, input.control)) {
        return;
      }

      if (typeof req.body?.enabled !== 'boolean') {
        badRequest(res, 'enabled must be boolean');
        return;
      }

      const result = await input.control.plane.setKillSwitch({
        enabled: req.body.enabled,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        actor: typeof req.body?.actor === 'string' ? req.body.actor : undefined
      });

      res.status(200).json({ ok: true, command: 'kill-switch', result });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      error: 'internal_error',
      message: error.message
    });
  });

  return app;
}
