export type RemoteOrder = {
  orderId: string;
  status: string;
};

export type RemoteFill = {
  fillId: string;
  orderId: string;
  size: number;
  price: number;
};

type ReconcilerDeps = {
  fetchRemoteOrders: () => Promise<RemoteOrder[]>;
  fetchRemoteFills: () => Promise<RemoteFill[]>;
  getLocalOrder: (orderId: string) => Promise<{ status: string } | null>;
  upsertLocalOrder: (order: RemoteOrder) => Promise<void>;
  hasLocalFill: (fillId: string) => Promise<boolean>;
  persistLocalFill: (fill: RemoteFill) => Promise<void>;
};

export type ReconcileResult = {
  ordersUpdated: number;
  fillsInserted: number;
};

export class OrderReconciler {
  private readonly deps: ReconcilerDeps;

  constructor(deps: ReconcilerDeps) {
    this.deps = deps;
  }

  async reconcileOnce(): Promise<ReconcileResult> {
    const [remoteOrders, remoteFills] = await Promise.all([
      this.deps.fetchRemoteOrders(),
      this.deps.fetchRemoteFills()
    ]);

    let ordersUpdated = 0;
    for (const remote of remoteOrders) {
      const local = await this.deps.getLocalOrder(remote.orderId);
      if (!local || local.status !== remote.status) {
        await this.deps.upsertLocalOrder(remote);
        ordersUpdated += 1;
      }
    }

    let fillsInserted = 0;
    const processedInRun = new Set<string>();
    for (const fill of remoteFills) {
      if (processedInRun.has(fill.fillId)) {
        continue;
      }

      const alreadyExists = await this.deps.hasLocalFill(fill.fillId);
      if (alreadyExists) {
        processedInRun.add(fill.fillId);
        continue;
      }

      await this.deps.persistLocalFill(fill);
      processedInRun.add(fill.fillId);
      fillsInserted += 1;
    }

    return { ordersUpdated, fillsInserted };
  }
}
