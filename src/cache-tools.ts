import 'dotenv/config';
import { clearCache } from './cache/cache.service';
import { logger } from './utils/logger';
import type { CacheNamespace } from './cache/cache.service';

const arg = process.argv[2] as CacheNamespace | 'all' | undefined;

const VALID = new Set<string>(['all', 'whm', 'cloudflare', 'rdap', 'whois', 'dns', 'ssl', 'http', 'ip']);

if (!arg || !VALID.has(arg)) {
  logger.error({ arg, valid: Array.from(VALID) }, 'Invalid cache namespace');
  process.exit(1);
}

(async () => {
  try {
    if (arg === 'all') {
      await clearCache();
    } else {
      await clearCache(arg as CacheNamespace);
    }
    logger.info({ namespace: arg }, 'Cache cleared successfully');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to clear cache');
    process.exit(1);
  }
})();
