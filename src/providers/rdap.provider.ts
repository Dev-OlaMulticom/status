import got from 'got';
import { env } from '../utils/env';
import { logger } from '../utils/logger';
import { getCached } from '../cache/cache.service';
import type { RdapDates } from '../dto/rdap.dto';

const RDAP_TTL = 24 * 60 * 60 * 1000;

function isDomainEligible(domain: string): boolean {
  if (!domain || domain.includes(' ') || domain.startsWith('*.')) return false;
  if (env.rdap.onlyBr && !domain.toLowerCase().endsWith('.br')) return false;
  return true;
}

function extractDates(payload: any): RdapDates {
  const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
  const expEvent = events.find((e) => String(e?.eventAction ?? '').trim().toLowerCase() === 'expiration');
  const expRaw = expEvent?.eventDate;
  return {
    expirationDate: typeof expRaw === 'string' ? expRaw : null,
    renewalDate: null,
  };
}

/**
 * Fetch domain expiration dates from RDAP (primarily registro.br for .br domains).
 * Falls back to null dates when the domain is ineligible or the request fails.
 */
export async function getRdapDates(domain: string, bypassCache = false): Promise<RdapDates> {
  if (!env.rdap.enabled || !isDomainEligible(domain)) {
    return { expirationDate: null, renewalDate: null };
  }

  const result = await getCached<RdapDates>({
    namespace: 'rdap',
    keyParts: [env.rdap.baseUrl, domain],
    ttlOverrideMs: RDAP_TTL,
    bypassCache,
    fetcher: async () => {
      try {
        const response = await got<any>(
          `https://${env.rdap.baseUrl}/domain/${encodeURIComponent(domain)}`,
          {
            timeout: { request: env.rdap.timeoutMs },
            retry: { limit: 1 },
            headers: { 'User-Agent': 'Olamulticom-Monitor/2.0 (RDAP)' },
            responseType: 'json',
            throwHttpErrors: false,
          },
        );

        if (response.statusCode === 404) return { expirationDate: null, renewalDate: null };
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`RDAP HTTP ${response.statusCode}`);
        }

        return extractDates(response.body);
      } catch (error: any) {
        logger.debug({ domain, error: error.message }, 'RDAP fetch failed');
        throw error;
      }
    },
  });

  if (result.source !== 'network') {
    logger.debug({ domain, source: result.source }, 'RDAP cache hit');
  }

  return result.value;
}
