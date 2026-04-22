# Runbook Operacional — Polymarket Codex

## Objetivo
Garantir operação segura em paper/live-ready com resposta rápida a incidentes e trilha de auditoria.

## 1) Start seguro

1. Validar configuração:
   - `POLYMARKET_CLOB_HOST`
   - `POLYMARKET_GAMMA_HOST`
   - (se alerta Telegram) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
2. Executar checagem local:
   - `npm run lint`
   - `npm run build`
   - `npm run test`
3. Iniciar API:
   - `npm run dev` (desenvolvimento)
   - `npm run start` (produção, após build)
4. Validar endpoints:
   - `GET /health`
   - `GET /metrics`
   - `GET /risk`

## 2) Stop seguro

1. Bloquear novas ordens (setar modo paused no orchestrator ou breaker manual).
2. Aguardar reconciliação de ordens/fills pendentes.
3. Persistir snapshot final de posições e risco.
4. Encerrar processo.
5. Registrar motivo, horário e estado final em log estruturado.

## 3) Resposta a incidentes

### 3.1 Circuit breaker acionado

**Sinais:** `/risk` retorna `breaker.tripped=true`, alerta crítico Telegram.

Ações:
1. Congelar execução (sem novas ordens).
2. Verificar causa:
   - `consecutive_errors`
   - `daily_drawdown`
3. Coletar evidências:
   - `/metrics`
   - logs de execução
   - status de conectividade CLOB/Gamma
4. Corrigir causa raiz.
5. Reset manual do breaker apenas após checklist de validação.

### 3.2 WebSocket down

**Sinais:** alerta `incident=ws_down`, ausência de atualização em stream.

Ações:
1. Confirmar fallback de polling ativo.
2. Testar conectividade para endpoint WS.
3. Se instável por período prolongado, pausar execução.
4. Reestabelecer stream e validar normalização de mensagens.

### 3.3 DB down

**Sinais:** erro `internal_error` em endpoints, falhas de persistência.

Ações:
1. Pausar ordens.
2. Verificar disponibilidade e credenciais do banco.
3. Validar integridade de migrations (`migration:up` quando aplicável).
4. Restaurar conexão e reprocessar reconciliação.

## 4) Checklist para habilitar live trading

> **Não habilitar live trading sem todos os itens abaixo.**

- [ ] RISK-001/002/003 ativos e testados
- [ ] Circuit breaker validado com teste de acionamento
- [ ] Alertas críticos entregues no Telegram
- [ ] Endpoint `/metrics` monitorado
- [ ] Reconciliação de ordens/fills idempotente
- [ ] Limites de exposição revisados (trade/market/global)
- [ ] Procedimento de rollback testado
- [ ] Chaves/segredos fora do código e rotacionáveis
- [ ] Aprovação operacional registrada

## 5) Auditoria mínima por incidente

Registrar:
- timestamp de início/fim
- impacto
- mercados afetados
- evento do breaker (se houver)
- ações tomadas
- validação pós-correção
- responsável
