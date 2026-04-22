import express from 'express';

import { MetricsRegistry } from './monitoring/metrics-registry';

export type ApiDataProvider = {
  getPositions: () => Promise<unknown[]>;
  getOrders: () => Promise<unknown[]>;
  getSignals: () => Promise<unknown[]>;
  getRisk: () => Promise<Record<string, unknown>>;
};

export type CreateAppInput = {
  startedAt?: Date;
  metrics?: MetricsRegistry;
  provider?: Partial<ApiDataProvider>;
};

const defaultProvider: ApiDataProvider = {
  getPositions: async () => [],
  getOrders: async () => [],
  getSignals: async () => [],
  getRisk: async () => ({
    breaker: { tripped: false },
    limits: {},
    status: 'ok'
  })
};

export function createApp(input: CreateAppInput = {}) {
  const app = express();
  const startedAt = input.startedAt ?? new Date();
  const metrics = input.metrics ?? new MetricsRegistry();

  const provider: ApiDataProvider = {
    getPositions: input.provider?.getPositions ?? defaultProvider.getPositions,
    getOrders: input.provider?.getOrders ?? defaultProvider.getOrders,
    getSignals: input.provider?.getSignals ?? defaultProvider.getSignals,
    getRisk: input.provider?.getRisk ?? defaultProvider.getRisk
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

  app.get('/risk', async (_req, res, next) => {
    try {
      const risk = await provider.getRisk();
      res.status(200).json({ risk });
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
