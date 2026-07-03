# Status OlaMulticom

Sistema de monitoramento de disponibilidade de websites para a agencia OlaMulticom. Monitora sites manuais e dominios hospedados no WHM (ServoLam), verificando status HTTP, DNS, SSL, Cloudflare e vencimento de dominios. Sincroniza automaticamente com Google Sheets via Apps Script.

## Arquitetura

```
src/
  monitor.ts              # Entry point — roda o ciclo completo
  services/
    monitor.service.ts    # Orquestrador: WHM sync, checks HTTP, historico, GAS sync
    account.service.ts    # Gerencia lista de sites, sync WHM/Cloudflare, info do servidor
    gas-sync.service.ts   # Sincronizacao bidirecional com Google Sheets via GAS
    domain.service.ts     # Enriquecimento DNS/WHOIS/SSL de dominios
    export.service.ts     # Exportacao CSV
  providers/
    gas.provider.ts       # Cliente HTTP para Google Apps Script API
    whm.provider.ts       # Integracao com WHM/cPanel API
    cloudflare.provider.ts# API Cloudflare (zones, DNS records)
    cloudflare-analytics.provider.ts # Analytics de visitas Cloudflare
    http.provider.ts      # Verificacao HTTP de sites
    dns.provider.ts       # Resolucao DNS
    ssl.provider.ts       # Verificacao de certificados SSL
    whois.provider.ts     # Consulta WHOIS
    rdap.provider.ts      # Consulta RDAP (vencimento de dominios BR)
  models/
    site.model.ts         # Tipos TypeScript para sites, resultados, historico
  dto/
    gas.dto.ts            # Tipos para a API GAS
    whm.dto.ts            # Tipos para WHM API
    cloudflare.dto.ts     # Tipos para Cloudflare API
    dns.dto.ts, ssl.dto.ts, whois.dto.ts, rdap.dto.ts
  utils/
    env.ts                # Parsing e validacao de variaveis de ambiente (Zod)
    logger.ts             # Logging estruturado (Pino)
    helpers.ts            # Utilitarios (comandos Linux, parsing)
  cache/
    cache.service.ts      # Cache SQLite via Keyv
frontend/
  src/main.ts             # Dashboard SPA vanilla TS
  src/db.ts               # IndexedDB local (Dexie) para servicos por dominio
  src/style.css           # Estilos do dashboard
```

## Fluxo de Execucao

1. `AccountService` carrega `sites-config.json` (4 sites manuais + dominios WHM)
2. Sync WHM: conecta ao ServoLam, extrai dominios, enriquece com RDAP (vencimento)
3. Sync Cloudflare: lista zones, coleta analytics de visitas
4. Checks HTTP: verifica cada site com retries configuraveis
5. Enriquecimento: DNS, Cloudflare zone info, IP publico
6. Historico: salva em `status.json` (ultimas N execucoes)
7. GAS sync: envia resultados para Google Sheets (se `GAS_API_KEY` configurado)
8. Dashboard: frontend vanilla TS le `status.json` e `sites-config.json`

## Variaveis de Ambiente

Copie `.env.example` para `.env` e configure:

### WHM (obrigatorio para sync de dominios)
```
WHM_ENABLED=true
WHM_HOST=servolam.olamulticom.com.br
WHM_PORT=2087
WHM_USERNAME=root
WHM_API_TOKEN=<seu_token>
WHM_SYNC_INTERVAL_MS=3600000    # 1 hora
WHM_EXCLUDE_SUSPENDED=true
```

### Cloudflare
```
CLOUDFLARE_API_TOKEN=<seu_token>
```

### Google Apps Script (GAS) — Sincronizacao com Google Sheets
```
GAS_API_URL=https://script.google.com/macros/s/<ID>/exec
GAS_API_KEY=<chave_de_api_do_apps_script>
GAS_SYNC_ENABLED=true
GAS_SYNC_INTERVAL_MS=300000     # 5 minutos
```

### Monitor
```
MONITOR_TIMEOUT_MS=10000
MONITOR_MAX_RETRIES=2
MONITOR_CONCURRENCY=10
LOG_LEVEL=info
```

Consulte `.env.example` para a lista completa.

## Scripts

```bash
# Desenvolvimento (backend + frontend)
pnpm dev

# Apenas backend
pnpm dev:backend

# Apenas frontend
pnpm dev:frontend

# Executar monitor (producao)
pnpm monitor

# Typecheck
pnpm typecheck

# Lint
pnpm lint
pnpm lint:fix

# Build frontend
pnpm frontend:build

# Limpar cache
pnpm cache:clear          # tudo
pnpm cache:clear:whm      # so WHM
pnpm cache:clear:cloudflare
```

## Google Apps Script (GAS) — CRUD Otimizado

O arquivo `api-dominios-crud-optimizado.gs` implementa a API REST dentro de um Google Apps Script vinculado a uma Google Sheet. O backend Node.js se conecta via HTTP para sincronizar dados bidirecionalmente.

**Arquivo:** `api-dominios-crud-optimizado.gs` (deploy no editor de Apps Script)

### Estrategias de Otimizacao

| Estrategia | Descricao |
|-----------|-----------|
| **Indice de IDs cacheado** | Leia SOLO a coluna "id" (nao a hoja inteira) e cacheie o mapeamento `{id -> numeroDaLinha}` com TTL de 20s |
| **Update direto** | Atualize SOLO a linha afetada usando o indice, nao toda a hoja |
| **Cache de dados sincronizado** | Apos escrita, sincronize a cache em memoria (append/replace) em vez de invalidar tudo |
| **Headers cacheados** | TTL de 6 horas — a estrutura de colunas quase nunca muda |
| **Bulk update** | N atualizacoes em 1 unica requisicao e 1 unico lock |

### API Endpoints

| Acao            | Metodo | Parametros                              | Descricao                          |
|-----------------|--------|----------------------------------------|------------------------------------|
| `list`          | GET    | `status`, `servidor`, `tipo`, `q`, `limit`, `offset` | Lista dominios com filtros    |
| `get`           | GET    | `id`                                    | Obtem um dominio por ID            |
| `create`        | POST   | `{ data: {...} }`                       | Cria um novo dominio (UUID auto)   |
| `update`        | POST   | `{ id, data: {...} }`                   | Atualiza um registro existente     |
| `comment`       | POST   | `{ id, data: { comentarios } }`         | Adiciona/atualiza comentario       |
| `delete`        | POST   | `{ id }`                                | Remove um dominio                  |
| `bulkUpdate`    | POST   | `{ items: [{ id, data }, ...] }`        | Atualiza varios registros em lote  |

### Autenticacao

Todas as requisicoes devem incluir a `API_KEY` (configurada em `PropertiesService > Script Properties` no editor de Apps Script):
- **GET**: `?key=SUA_CHAVE`
- **POST**: `"key": "SUA_CHAVE"` no body JSON

### Fluxo de Sincronizacao

```
Backend (Node.js)                    Google Apps Script               Google Sheets
    │                                      │                              │
    ├─ gasListAllDomains() ────────────────┤ GET list ────────────────────┤
    │                                      │     CacheService (20s TTL)   │
    ├─ syncToGas(sites) ──────────────────┤                              │
    │   ├─ para cada site:                 │                              │
    │   │   ├─ existe? → update ───────────┤ POST update ── setRange() ──┤
    │   │   └─ novo?   → create ──────────┤ POST create ── appendRow() ─┤
    │                                      │                              │
    ├─ processGasQueue() ─────────────────┤ POST bulkUpdate ────────────┤
    │   └─ batches de 10, 2s delay         │   1 lock para N items       │
    │                                      │                              │
    ├─ gasSaveServices() ─────────────────┤ POST save_services ─────────┤
```

### Estrutura de um Dominio (GasDomain)

```typescript
{
  id: string            // UUID gerado pelo GAS
  dominio: string       // hostname
  tipo: string          // "Conta" | "Adicionado"
  subtipo: string       // username WHM
  status: string        // "Online" | "Offline"
  vencimento: string    // "20/Setembro/2026"
  dias_restantes: number
  servidor: string      // "WHM" | "CF" | "WHM+CF" | "Fora" | "Não"
  servidor_ip: string
  site: boolean
  email: boolean
  comentarios: string
  createdAt: string     // ISO timestamp
  updatedAt: string     // ISO timestamp
}
```

### Estrutura de Servico (GasServiceSync)

```typescript
{
  dominio: string   // hostname
  site: boolean     // servico de site ativo
  email: boolean    // servico de email ativo
  updatedAt: string // ISO timestamp
}
```

### Deploy

1. Crie um Google Apps Script vinculado a uma Google Sheet com aba "dominios"
2. Copie o conteudo de `api-dominios-crud-optimizado.gs` para o editor
3. Configure `API_KEY` em **Project Settings > Script Properties**
4. Deploy > New deployment > Web app
   - Execute as: Me
   - Who has access: Anyone
5. Copie a URL do deploy para `GAS_API_URL` no `.env`
6. Configure `GAS_API_KEY` no `.env` com a mesma chave do Script Properties

### Sincronizacao de Dominios

Apos cada execucao do monitor, `syncToGas()`:
1. Busca todos os dominios existentes no GAS (via `list`)
2. Para cada site monitorado:
   - Se o dominio ja existe e mudou status/servidor: envia `update`
   - Se o dominio nao existe: envia `create`
3. Registra created/updated/errors no log

### Sincronizacao de Servicos (Queue)

O sistema de fila (`gas-queue.service.ts`) processa atualizacoes de servicos:
1. **Frontend**: ao togglear site/email, salva em Dexie e enfileira em `localStorage`
2. **Backend**: apos cada run do monitor, processa a fila em batches de 10
3. **Rate limit**: 2 segundos de delay entre batches
4. **Retry**: itens com erro permanecem na fila para proxima tentativa
5. **Dedup**: se o mesmo dominio esta na fila, apenas atualiza (latest wins)

## Deploy

### Vercel (frontend estatico)

```json
{
  "buildCommand": "cd frontend && pnpm install && pnpm build",
  "outputDirectory": "frontend/dist"
}
```

### GitHub Actions

O workflow `.github/workflows/website-monitor.yml` executa a cada 5 minutos:
1. Instala dependencias
2. Roda o monitor (com WHM API token dos secrets)
3. Build do frontend
4. Commit de `status.json` e `sites-config.json`
5. Deploy para GitHub Pages

Secrets necessarios no GitHub:
- `WHM_API_TOKEN`
- `CLOUDFLARE_API_TOKEN` (opcional)
- `GAS_API_KEY` (opcional, para sync com Sheets)

## Site de Exemplo

O dashboard esta disponivel em: `https://<user>.github.io/status-olamulticom/`

## Stack

- **Backend**: TypeScript, Node.js 20+, ts-node
- **Frontend**: Vanilla TypeScript, Vite, Dexie (IndexedDB)
- **Cache**: SQLite via Keyv
- **HTTP**: Got
- **Logging**: Pino
- **Validacao**: Zod
- **CI/CD**: GitHub Actions, GitHub Pages
- **GAS**: Google Apps Script (Google Sheets API)
