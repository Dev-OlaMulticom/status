import Keyv from 'keyv';
import KeyvSqlite from '@keyv/sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { logger } from '../utils/logger';

export type CacheNamespace = 'whm' | 'cloudflare' | 'rdap' | 'whois' | 'dns' | 'ssl' | 'http' | 'ip';

const TTL_BY_NAMESPACE: Record<CacheNamespace, number> = {
  whm: 10 * 60 * 1000,
  cloudflare: 15 * 60 * 1000,
  dns: 5 * 60 * 1000,
  http: 45 * 1000,
  rdap: 24 * 60 * 60 * 1000,
  whois: 24 * 60 * 60 * 1000,
  ssl: 24 * 60 * 60 * 1000,
  ip: 60 * 60 * 1000,
};

const STALE_TTL_MULTIPLIER = 48;

interface CacheEntry<T> {
  value: T;
  updatedAt: number;
  errorCount: number;
  cooldownUntil: number;
  lastError?: string;
}

mkdirSync('.cache', { recursive: true });

const stores = new Map<CacheNamespace, Keyv>();

function getStore(namespace: CacheNamespace): Keyv {
  if (!stores.has(namespace)) {
    const adapter = new KeyvSqlite('sqlite://.cache/monitor-cache.sqlite');
    const store = new Keyv({ store: adapter, namespace });
    stores.set(namespace, store);
  }
  return stores.get(namespace)!;
}

function buildKey(parts: unknown[]): string {
  const payload = JSON.stringify(parts);
  return createHash('sha1').update(payload).digest('hex');
}

export interface CachedFetchOptions<T> {
  namespace: CacheNamespace;
  keyParts: unknown[];
  ttlOverrideMs?: number;
  fetcher: () => Promise<T>;
  bypassCache?: boolean;
}

export interface CachedResult<T> {
  value: T;
  source: 'network' | 'cache-fresh' | 'cache-stale';
}

const inFlight = new Map<string, Promise<CachedResult<any>>>();

export async function getCached<T>(options: CachedFetchOptions<T>): Promise<CachedResult<T>> {
  const { namespace, keyParts, ttlOverrideMs, fetcher, bypassCache = false } = options;
  const ttl = ttlOverrideMs ?? TTL_BY_NAMESPACE[namespace];
  const staleTtl = ttl * STALE_TTL_MULTIPLIER;
  const store = getStore(namespace);
  const key = buildKey(keyParts);
  const inflightKey = `${namespace}:${key}`;
  const now = Date.now();

  if (!bypassCache) {
    const existing = await store.get<CacheEntry<T>>(key);
    if (existing) {
      const age = now - existing.updatedAt;
      if (age < ttl) {
        return { value: existing.value, source: 'cache-fresh' };
      }
      if (now < existing.cooldownUntil && age < staleTtl) {
        return { value: existing.value, source: 'cache-stale' };
      }
    }
  }

  if (inFlight.has(inflightKey)) {
    return inFlight.get(inflightKey) as Promise<CachedResult<T>>;
  }

  const request: Promise<CachedResult<T>> = (async (): Promise<CachedResult<T>> => {
    const existing = await store.get<CacheEntry<T>>(key);
    try {
      const value = await fetcher();
      const entry: CacheEntry<T> = { value, updatedAt: now, errorCount: 0, cooldownUntil: 0 };
      await store.set(key, entry, staleTtl);
      return { value, source: 'network' };
    } catch (error: any) {
      const errorCount = (existing?.errorCount ?? 0) + 1;
      const cooldownMs = Math.min(30 * 60 * 1000, 60_000 * 2 ** Math.min(errorCount, 5));

      if (existing) {
        const updated: CacheEntry<T> = {
          ...existing,
          errorCount,
          cooldownUntil: now + cooldownMs,
          lastError: String(error?.message ?? error),
        };
        await store.set(key, updated, staleTtl);
        logger.warn({ namespace, error: updated.lastError }, 'Cache fetch failed, returning stale value');
        return { value: existing.value, source: 'cache-stale' };
      }
      throw error;
    } finally {
      inFlight.delete(inflightKey);
    }
  })();

  inFlight.set(inflightKey, request);
  return request;
}

export async function clearCache(namespace?: CacheNamespace): Promise<void> {
  if (namespace) {
    await getStore(namespace).clear();
    logger.info({ namespace }, 'Cache cleared');
  } else {
    for (const ns of Object.keys(TTL_BY_NAMESPACE) as CacheNamespace[]) {
      await getStore(ns).clear();
    }
    logger.info('All caches cleared');
  }
}
