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

interface RDAPConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  onlyBr: boolean;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  cacheStaleTtlMs: number;
  cacheCooldownBaseMs: number;
  cacheCooldownMaxMs: number;
}

interface RDAPDates {
  expirationDate: string | null;
  renewalDate: string | null;
}

const RDAP_CONFIG: RDAPConfig = {
  enabled: getEnvBoolean('RDAP_ENABLED', true),
  baseUrl: process.env.RDAP_BASE_URL || 'rdap.registro.br',
  timeoutMs: getEnvNumber('RDAP_TIMEOUT_MS', 7000),
  onlyBr: getEnvBoolean('RDAP_ONLY_BR', true),
  cacheEnabled: getEnvBoolean('RDAP_CACHE_ENABLED', true),
  cacheTtlMs: getEnvNumber('RDAP_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000),
  cacheStaleTtlMs: getEnvNumber('RDAP_CACHE_STALE_TTL_MS', 60 * 24 * 60 * 60 * 1000),
  cacheCooldownBaseMs: getEnvNumber('RDAP_CACHE_COOLDOWN_BASE_MS', 5 * 60 * 1000),
  cacheCooldownMaxMs: getEnvNumber('RDAP_CACHE_COOLDOWN_MAX_MS', 24 * 60 * 60 * 1000)
};

function isDomainEligible(domain: string): boolean {
  if (!domain || domain.includes(' ') || domain.startsWith('*.')) return false;
  if (RDAP_CONFIG.onlyBr && !domain.toLowerCase().endsWith('.br')) return false;
  return true;
}

function extractDates(payload: any): RDAPDates {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const expirationEvent = events.find((e: any) => {
    const action = String(e?.eventAction || '').trim().toLowerCase();
    return action === 'expiration';
  });
  const expirationRaw = expirationEvent?.eventDate;
  const expiration = typeof expirationRaw === 'string' ? expirationRaw : null;

  return {
    expirationDate: expiration,
    renewalDate: null
  };
}

function fetchRDAP(domain: string): Promise<RDAPDates> {
  return new Promise((resolve, reject) => {
    try {
      const options = {
        hostname: RDAP_CONFIG.baseUrl,
        port: 443,
        path: `/domain/${encodeURIComponent(domain)}`,
        method: 'GET',
        headers: { 'User-Agent': 'Olamulticom-Monitor/1.0 (RDAP)' }
      };

      const req = https.get(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(hardTimeout);
          if (res.statusCode === 404) {
            resolve({ expirationDate: null, renewalDate: null });
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`RDAP HTTP ${res.statusCode}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(extractDates(parsed));
          } catch (error: any) {
            reject(new Error(`RDAP parse error: ${error.message}`));
          }
        });
      });

      req.on('error', (error: Error) => {
        clearTimeout(hardTimeout);
        reject(new Error(`RDAP request failed: ${error.message}`));
      });

      req.setTimeout(RDAP_CONFIG.timeoutMs, () => {
        req.destroy();
        clearTimeout(hardTimeout);
        reject(new Error('RDAP timeout'));
      });

      const hardTimeout = setTimeout(() => {
        req.destroy(new Error('RDAP hard timeout'));
      }, RDAP_CONFIG.timeoutMs + 1000);
    } catch (error) {
      reject(error);
    }
  });
}

async function getDomainDates(domain: string, options: { bypassCache?: boolean } = {}): Promise<RDAPDates> {
  if (!RDAP_CONFIG.enabled || !isDomainEligible(domain)) {
    return { expirationDate: null, renewalDate: null };
  }

  if (!RDAP_CONFIG.cacheEnabled || options.bypassCache) {
    return fetchRDAP(domain);
  }

  const result = await getCachedOrFetch<RDAPDates>({
    namespace: 'rdap',
    keyParts: [RDAP_CONFIG.baseUrl, domain],
    ttlMs: RDAP_CONFIG.cacheTtlMs,
    staleTtlMs: RDAP_CONFIG.cacheStaleTtlMs,
    cooldownBaseMs: RDAP_CONFIG.cacheCooldownBaseMs,
    cooldownMaxMs: RDAP_CONFIG.cacheCooldownMaxMs,
    fetcher: () => fetchRDAP(domain)
  });

  if (result.source !== 'network') {
    console.log(`♻️ RDAP cache hit (${result.source}) for ${domain}`);
  }

  return result.value;
}

export { RDAP_CONFIG, getDomainDates };
