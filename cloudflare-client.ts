const https = require('https');
require('dotenv').config();
import { getCachedOrFetch } from './api-cache';

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getEnvNumber(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

interface CloudflareConfig {
  baseUrl: string;
  apiToken?: string;
  timeout: number;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  cacheStaleTtlMs: number;
  cacheCooldownBaseMs: number;
  cacheCooldownMaxMs: number;
}

const CLOUDFLARE_CONFIG: CloudflareConfig = {
  baseUrl: process.env.CLOUDFLARE_BASE_URL || 'api.cloudflare.com',
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  timeout: getEnvNumber('CLOUDFLARE_TIMEOUT_MS', 10000),
  cacheEnabled: getEnvBoolean('CLOUDFLARE_CACHE_ENABLED', true),
  cacheTtlMs: getEnvNumber('CLOUDFLARE_CACHE_TTL_MS', 15 * 60 * 1000),
  cacheStaleTtlMs: getEnvNumber('CLOUDFLARE_CACHE_STALE_TTL_MS', 24 * 60 * 60 * 1000),
  cacheCooldownBaseMs: getEnvNumber('CLOUDFLARE_CACHE_COOLDOWN_BASE_MS', 60 * 1000),
  cacheCooldownMaxMs: getEnvNumber('CLOUDFLARE_CACHE_COOLDOWN_MAX_MS', 30 * 60 * 1000)
};

function makeCloudflareRequest(pathname: string, params: Record<string, string | number> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      if (!CLOUDFLARE_CONFIG.apiToken) {
        return reject(new Error('CLOUDFLARE_API_TOKEN não configurado'));
      }

      const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
      const fullPath = query.toString() ? `/client/v4${pathname}?${query.toString()}` : `/client/v4${pathname}`;

      const options = {
        hostname: CLOUDFLARE_CONFIG.baseUrl,
        port: 443,
        path: fullPath,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.apiToken}`,
          'User-Agent': 'Cloudflare-Monitor/1.0'
        }
      };

      const req = https.get(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(hardTimeout);
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300 && parsed?.success !== false) {
              resolve(parsed);
            } else {
              reject(new Error(`Cloudflare API Error: HTTP ${res.statusCode}`));
            }
          } catch (error: any) {
            reject(new Error(`Failed to parse Cloudflare response: ${error.message}`));
          }
        });
      });

      req.on('error', (error: Error) => {
        clearTimeout(hardTimeout);
        reject(new Error(`Cloudflare Request failed: ${error.message}`));
      });

      req.setTimeout(CLOUDFLARE_CONFIG.timeout, () => {
        req.destroy();
        clearTimeout(hardTimeout);
        reject(new Error('Cloudflare Request timeout'));
      });

      const hardTimeout = setTimeout(() => {
        req.destroy(new Error('Cloudflare hard timeout'));
      }, CLOUDFLARE_CONFIG.timeout + 1000);
    } catch (error) {
      reject(error);
    }
  });
}

async function makeCloudflareRequestCached(
  pathname: string,
  params: Record<string, string | number> = {},
  options: { bypassCache?: boolean } = {}
): Promise<any> {
  if (!CLOUDFLARE_CONFIG.cacheEnabled || options.bypassCache) {
    return makeCloudflareRequest(pathname, params);
  }

  const result = await getCachedOrFetch<any>({
    namespace: 'cloudflare',
    keyParts: [CLOUDFLARE_CONFIG.baseUrl, pathname, params],
    ttlMs: CLOUDFLARE_CONFIG.cacheTtlMs,
    staleTtlMs: CLOUDFLARE_CONFIG.cacheStaleTtlMs,
    cooldownBaseMs: CLOUDFLARE_CONFIG.cacheCooldownBaseMs,
    cooldownMaxMs: CLOUDFLARE_CONFIG.cacheCooldownMaxMs,
    fetcher: () => makeCloudflareRequest(pathname, params)
  });

  if (result.source !== 'network') {
    console.log(`♻️ Cloudflare cache hit (${result.source}) for ${pathname}`);
  }

  return result.value;
}

export { CLOUDFLARE_CONFIG, makeCloudflareRequest, makeCloudflareRequestCached };
