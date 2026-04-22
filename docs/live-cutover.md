# Playbook de Cutover — Live Limitado (OPS-003)

## Objetivo
Executar transição controlada de paper para live limitado com rollback imediato, critérios explícitos de abort e evidência operacional auditável.

## Pré-cutover (T-30 a T-5)

### 1) Gate técnico
- Suíte verde obrigatória: `npm run lint && npm run build && npm run test`
- Health operacional: `/health` e `/metrics` sem anomalias
- Watchdog sem módulos stale por pelo menos 15 minutos
- Circuit breaker em estado destravado (`tripped=false`)

### 2) Gate de risco
- `maxDailyDrawdown` revisado para piloto
- `maxPositionPerTrade` e `maxPositionPerMarket` revisados
- Lista de mercados permitidos (allowlist) definida

### 3) Gate de execução
- `ExecutionGateway` configurado em modo `paper`
- `liveEnabled=true` disponível, mas ainda sem tráfego live
- Kill-switch validado (`setKillSwitch(true)` e `false`) em ambiente controlado

## Cutover controlado (T0)

1. Pausar runtime via endpoint `POST /control/pause`.
2. Validar snapshot operacional (`/positions`, `/orders`, `/risk`).
3. Ativar execução live limitada (`setMode('live')`) apenas para allowlist.
4. Retomar runtime via `POST /control/resume`.
5. Executar janela de observação inicial de 10 minutos com:
   - taxa de falha de ordem
   - latência de ciclo
   - staleness por módulo
   - eventos de breaker

## Janelas de monitoramento

### Janela A — 0 a 10 min
- SLO de erro de execução < 5%
- Sem acionamento de breaker por erro consecutivo
- Sem staleness crítico

### Janela B — 10 a 30 min
- Fill-rate compatível com baseline paper (variação aceitável definida previamente)
- Sem desvio abrupto de PnL não explicado

### Janela C — 30 a 60 min
- Estabilidade contínua de métricas
- Zero incidentes críticos

## Critérios de abort
Abortar imediatamente e retornar para paper se ocorrer qualquer item:
- breaker tripped por drawdown diário
- erro de execução >= 10% por 5 minutos consecutivos
- perda de conectividade com CLOB sem recuperação no watchdog
- divergência de reconciliação repetida (>= 3 ciclos)

## Rollback

1. `POST /control/pause`
2. `setKillSwitch(true)` para forçar paper
3. `setMode('paper')`
4. `POST /control/reset-breaker`
5. `POST /control/resume`
6. Registrar incidente com timestamp, causa, métricas e ação corretiva

## Go/No-Go final

### Go
- Todas as janelas passaram sem critérios de abort
- Equipe validou risco/ops/execution
- Evidência registrada em runbook + eventos operacionais

### No-Go
- Qualquer critério de abort foi acionado
- Métricas não convergiram para baseline esperado
- Persistem alertas críticos no watchdog
