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
    getEvents: async () => []
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
  getEvents: async () => []
};

function unauthorized(res: express.Response): void {
  res.status(401).json({ error: 'unauthorized', message: 'invalid admin token' });
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
    getEvents: input.provider?.getEvents ?? baseProvider.getEvents
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
      if (!input.control) {
        res.status(404).json({ error: 'not_available', message: 'control plane not configured' });
        return;
      }

      const token = req.header('x-admin-token');
      if (token !== input.control.adminToken) {
        unauthorized(res);
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
      if (!input.control) {
        res.status(404).json({ error: 'not_available', message: 'control plane not configured' });
        return;
      }

      const token = req.header('x-admin-token');
      if (token !== input.control.adminToken) {
        unauthorized(res);
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
      if (!input.control) {
        res.status(404).json({ error: 'not_available', message: 'control plane not configured' });
        return;
      }

      const token = req.header('x-admin-token');
      if (token !== input.control.adminToken) {
        unauthorized(res);
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

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      error: 'internal_error',
      message: error.message
    });
  });

  return app;
}
