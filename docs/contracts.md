# Contratos de Domínio — Strategy

Este documento define os contratos tipados usados no módulo de estratégia (S2).

## `MarketState`
Representa o estado consolidado de um mercado para avaliação de estratégia.

Campos principais:
- `marketId: string`
- `question: string`
- `active: boolean`
- `closed: boolean`
- `updatedAt: string (ISO)`
- `outcomes: MarketOutcomeState[]`

### `MarketOutcomeState`
- `tokenId: string`
- `outcome: string`
- `bid: number`
- `ask: number`
- `lastPrice: number`
- `liquidity: number`

## `Signal`
Sinal gerado por uma estratégia.

Campos:
- `strategy: string`
- `marketId: string`
- `tokenId: string`
- `side: 'BUY' | 'SELL' | 'HOLD'`
- `confidence: number` (0..1)
- `edge: number`
- `reason: string`
- `timestamp: string (ISO)`

## `Opportunity`
Empacota uma oportunidade calculada a partir do `Signal` + `MarketState`.

Campos:
- `signal: Signal`
- `marketState: MarketState`
- `fairPrice: number`
- `expectedValue: number`

## `ExecutionIntent`
Contrato de intenção de execução (ainda sem envio real de ordens).

Campos:
- `marketId: string`
- `tokenId: string`
- `side: 'BUY' | 'SELL'`
- `orderType: 'LIMIT' | 'MARKET'`
- `size: number`
- `price?: number`
- `timeInForce: 'GTC' | 'IOC' | 'FOK'`
- `sourceSignal: Signal`
- `riskTags: string[]`

## Interface de estratégia (`evaluate`)
As estratégias pluginadas devem seguir:

```ts
interface StrategyPlugin {
  name: string;
  evaluate(marketState: MarketState): Signal[];
}
```

O `StrategyRegistry` permite coexistência de múltiplas estratégias sem alteração do core.
