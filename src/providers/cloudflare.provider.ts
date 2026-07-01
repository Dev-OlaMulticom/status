import Cloudflare from 'cloudflare';
import { env } from '../utils/env';
import { logger } from '../utils/logger';
import { getCached } from '../cache/cache.service';

const CF_TTL = 15 * 60 * 1000;

let _client: Cloudflare | null = null;

function getClient(): Cloudflare {
  if (!_client) {
    if (!env.cloudflare.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is not configured');
    _client = new Cloudflare({ apiToken: env.cloudflare.apiToken });
  }
  return _client;
}

export interface CloudflareZoneInfo {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  plan: string;
  ssl: string | null;
}

/**
 * List all Cloudflare zones, with caching.
 */
export async function listZones(bypassCache = false): Promise<CloudflareZoneInfo[]> {
  if (!env.cloudflare.apiToken) {
    logger.debug('Cloudflare API token not configured, skipping');
    return [];
  }

  const result = await getCached<CloudflareZoneInfo[]>({
    namespace: 'cloudflare',
    keyParts: ['zones'],
    ttlOverrideMs: CF_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient();
      const zones = await client.zones.list();
      return (zones.result ?? []).map((z: any) => ({
        id: z.id,
        name: z.name,
        status: z.status,
        paused: z.paused,
        plan: z.plan?.name ?? 'unknown',
        ssl: z.meta?.ssl_universal ? 'universal' : null,
      }));
    },
  });

  if (result.source !== 'network') {
    logger.debug({ source: result.source }, 'Cloudflare zones cache hit');
  }

  return result.value;
}

/**
 * Find the Cloudflare zone for a given domain name.
 */
export async function getZoneForDomain(domain: string): Promise<CloudflareZoneInfo | null> {
  const zones = await listZones();
  const parts = domain.toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const zone = zones.find((z) => z.name === candidate);
    if (zone) return zone;
  }
  return null;
}
