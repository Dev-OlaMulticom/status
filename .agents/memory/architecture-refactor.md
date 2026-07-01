---
name: Architecture refactor
description: Clean Architecture layout for the status-olamulticom project; entry points, folder structure, and key decisions.
---

The backend was fully rewritten into a Clean Architecture layout under `src/`. All old root-level `.ts` files (monitor.ts, whm-extractor.ts, rdap-client.ts, cloudflare-client.ts, api-cache.ts, cache-tools.ts) were removed.

## New layout

```
src/
  utils/      logger.ts, env.ts, helpers.ts
  cache/      cache.service.ts (Keyv + @keyv/sqlite, per-namespace TTL)
  models/     site.model.ts
  dto/        whm.dto.ts, rdap.dto.ts, dns.dto.ts, whois.dto.ts, ssl.dto.ts
  providers/  http, whm, cloudflare, dns, rdap, whois, ssl
  services/   account.service.ts, domain.service.ts, monitor.service.ts, export.service.ts
  monitor.ts  (entry point)
  cache-tools.ts (CLI for cache invalidation)
```

## Key decisions

- `tsconfig.json` `include` is `["src/**/*.ts"]` — only the src/ subtree
- Entry point: `ts-node --project tsconfig.json src/monitor.ts`
- Output format (status.json, sites-config.json) unchanged — frontend reads these
- Cache backend: SQLite at `.cache/monitor-cache.sqlite` (replaces old .cache/api-cache.json)
- All logging via Pino — no console.log anywhere in src/

**Why:** The spec requires Clean Architecture, SOLID, and specific libraries. The old code had all logic in flat root files with raw `https.get()` calls and a JSON file cache.
