# API Operacional (S4)

Endpoints HTTP para observabilidade e operação do bot.

## `GET /health`
- Retorna disponibilidade da API.
- Exemplo:

```json
{
  "status": "ok",
  "uptimeSec": 123
}
```

## `GET /metrics`
- Métricas em formato Prometheus (`text/plain`).
- Inclui:
  - `polymarket_fill_rate`
  - `polymarket_order_latency_ms_avg`
  - `polymarket_signals_accepted_total`
  - `polymarket_signals_blocked_total`
  - `polymarket_expected_edge_total`
  - `polymarket_realized_edge_total`
  - `polymarket_edge_capture_ratio`

## `GET /positions`
- Snapshot de posições abertas.
- Exemplo:

```json
{
  "positions": [
    { "marketId": "m1", "tokenId": "yes", "size": 100, "avgPrice": 0.52 }
  ]
}
```

## `GET /orders`
- Snapshot de ordens locais/remotas reconciliadas.

## `GET /signals`
- Últimos sinais produzidos pela estratégia.

## `GET /risk`
- Estado operacional de risco (inclui breaker e limites).

### Exemplo

```json
{
  "risk": {
    "breaker": { "tripped": true, "reason": "daily_drawdown" },
    "limits": { "maxTradeNotional": 100, "maxGlobalNotional": 1000 },
    "status": "paused"
  }
}
```

## Erros
- Falhas internas retornam:

```json
{
  "error": "internal_error",
  "message": "<detalhe>"
}
```
