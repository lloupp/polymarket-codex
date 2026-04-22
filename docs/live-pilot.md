# Protocolo de Piloto Controlado — Paper Soak + Go/No-Go

## Objetivo
Definir critérios operacionais objetivos para transição de paper mode para live limitado com risco controlado.

## 1) Escopo do piloto
- Ambiente inicial: **paper mode**.
- Estratégias habilitadas: somente estratégias aprovadas e auditáveis.
- Mercados permitidos: whitelist com liquidez mínima.
- Exposição: limites conservadores (trade/mercado/global).

## 2) Fases de soak test

### Fase A — Soak de 24h
Objetivo: validar estabilidade básica de execução e observabilidade.

Critérios mínimos (todos obrigatórios):
- uptime do processo >= 99%
- `polymarket_stale_modules_total = 0` por pelo menos 95% da janela
- zero erros críticos não tratados
- reconciliação executada sem divergência não explicada
- fill pipeline funcionando (signals -> orders -> fills)

### Fase B — Soak de 48h
Objetivo: validar robustez operacional prolongada.

Critérios mínimos (todos obrigatórios):
- manter critérios da Fase A
- zero incidentes P1/P2 sem RCA concluído
- circuit breaker testado com acionamento e recuperação controlada
- expected vs realized edge dentro de faixa tolerada definida pelo time

## 3) Critérios objetivos de go/no-go

## Go
Seguir para live limitado somente se:
1. Fase A e Fase B aprovadas.
2. Alertas críticos entregues e acionáveis.
3. Runbook executado em simulação de incidente (tabletop) com evidência.
4. Aprovação formal registrada por responsável técnico.

## No-Go
Bloquear live se qualquer item abaixo ocorrer:
- staleness recorrente de módulos críticos (`execution`, `reconciliation`)
- divergência de estado entre execução e reconciliação sem causa raiz
- quebra de invariantes de risco (limites, breaker, bloqueios)
- falha de observabilidade (métricas/alertas incompletos)

## 4) Live limitado (após Go)
- iniciar com tamanho mínimo de ordem
- janela inicial curta (ex.: 60-120 min)
- monitoramento ativo durante toda a sessão
- rollback imediato ao primeiro gatilho de no-go

## 5) Template de relatório (incidente/performance)

## Template de relatório
- período analisado
- versão/commit em produção
- resumo de métricas-chave
- incidentes observados
- ações corretivas
- decisão final: Go / No-Go
- responsáveis e timestamp

## 6) Evidências mínimas a anexar
- snapshot `/metrics` de início/fim
- evidências de reconciliação
- logs de alertas críticos
- checklist de risco assinado
