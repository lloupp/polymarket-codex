create unique index if not exists ux_orderbook_snapshots_market_token_time
  on orderbook_snapshots(market_id, token_id, snapshot_time);
