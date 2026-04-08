const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

interface CacheEntry<T = any> {
  value: T;
  updatedAt: number;
  expiresAt: number;
  staleUntil: number;
  errorCount: number;
  cooldownUntil: number;
  lastError?: string;
}

interface CacheStore {
  version: 1;
  entries: Record<string, CacheEntry>;
}

interface CachedFetchOptions<T> {
  namespace: 'whm' | 'cloudflare' | 'rdap';
  keyParts: unknown[];
  ttlMs: number;
  staleTtlMs: number;
  cooldownBaseMs: number;
  cooldownMaxMs: number;
  bypassCache?: boolean;
  fetcher: () => Promise<T>;
}

interface CachedFetchResult<T> {
  value: T;
  source: 'network' | 'cache-fresh' | 'cache-stale';
}

const CACHE_DIR = path.resolve('.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'api-cache.json');

const inFlight = new Map<string, Promise<CachedFetchResult<any>>>();
let store: CacheStore | null = null;

function ensureStore(): CacheStore {
  if (store) return store;

  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as CacheStore;
      if (parsed && parsed.version === 1 && parsed.entries) {
        store = parsed;
        return store;
      }
    }
  } catch {
    // Ignore malformed cache and recreate.
  }

  store = { version: 1, entries: {} };
  return store;
}

function persistStore(): void {
  const current = ensureStore();
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

function buildKey(namespace: string, keyParts: unknown[]): string {
  const payload = JSON.stringify(keyParts);
  const digest = crypto.createHash('sha1').update(payload).digest('hex');
  return `${namespace}:${digest}`;
}

function getNow(): number {
  return Date.now();
}

async function getCachedOrFetch<T>(options: CachedFetchOptions<T>): Promise<CachedFetchResult<T>> {
  const {
    namespace,
    keyParts,
    ttlMs,
    staleTtlMs,
    cooldownBaseMs,
    cooldownMaxMs,
    bypassCache = false,
    fetcher
  } = options;

  const cacheKey = buildKey(namespace, keyParts);
  const currentStore = ensureStore();
  const now = getNow();
  const existing = currentStore.entries[cacheKey] as CacheEntry<T> | undefined;

  if (!bypassCache && existing && now < existing.expiresAt) {
    return { value: existing.value, source: 'cache-fresh' };
  }

  if (!bypassCache && existing && now < existing.cooldownUntil && now < existing.staleUntil) {
    return { value: existing.value, source: 'cache-stale' };
  }

  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey) as Promise<CachedFetchResult<T>>;
  }

  const requestPromise: Promise<CachedFetchResult<T>> = (async (): Promise<CachedFetchResult<T>> => {
    try {
      const value = await fetcher();
      currentStore.entries[cacheKey] = {
        value,
        updatedAt: now,
        expiresAt: now + ttlMs,
        staleUntil: now + staleTtlMs,
        errorCount: 0,
        cooldownUntil: 0
      };
      persistStore();
      return { value, source: 'network' as const };
    } catch (error: any) {
      const previous = currentStore.entries[cacheKey] as CacheEntry<T> | undefined;
      const errorCount = (previous?.errorCount || 0) + 1;
      const cooldownMs = Math.min(cooldownMaxMs, cooldownBaseMs * (2 ** Math.min(errorCount, 6)));

      if (previous) {
        currentStore.entries[cacheKey] = {
          ...previous,
          errorCount,
          cooldownUntil: now + cooldownMs,
          lastError: String(error?.message || error)
        };
        persistStore();

        if (!bypassCache && now < previous.staleUntil) {
          return { value: previous.value, source: 'cache-stale' as const };
        }
      }

      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, requestPromise as Promise<CachedFetchResult<any>>);
  return requestPromise;
}

function clearApiCache(namespace?: 'whm' | 'cloudflare' | 'rdap'): void {
  const currentStore = ensureStore();
  if (!namespace) {
    currentStore.entries = {};
    persistStore();
    return;
  }

  currentStore.entries = Object.fromEntries(
    Object.entries(currentStore.entries).filter(([key]) => !key.startsWith(`${namespace}:`))
  );
  persistStore();
}

export { getCachedOrFetch, clearApiCache, type CachedFetchResult };
