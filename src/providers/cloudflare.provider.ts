import Cloudflare from 'cloudflare'
import { getCached } from '../cache/cache.service'
import type {
  CloudflareAccountInfo,
  CloudflareDnsRecord,
  CloudflareDnsSec,
  CloudflareZoneSettings,
  CloudflareZoneSummary,
} from '../dto/cloudflare.dto'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

const CF_TTL = 15 * 60 * 1000
const CF_SETTINGS_TTL = 30 * 60 * 1000
const CF_DNS_TTL = 5 * 60 * 1000

let _client: Cloudflare | null = null

function getClient(): Cloudflare {
  if (!_client) {
    if (!env.cloudflare.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is not configured')
    _client = new Cloudflare({ apiToken: env.cloudflare.apiToken })
  }
  return _client
}

export interface CloudflareZoneInfo {
  id: string
  name: string
  status: string
  paused: boolean
  plan: string
  ssl: string | null
}

/**
 * List all Cloudflare zones (basic), with caching.
 */
export async function listZones(bypassCache = false): Promise<CloudflareZoneInfo[]> {
  if (!env.cloudflare.apiToken) {
    logger.debug('Cloudflare API token not configured, skipping')
    return []
  }

  const result = await getCached<CloudflareZoneInfo[]>({
    namespace: 'cloudflare',
    keyParts: ['zones'],
    ttlOverrideMs: CF_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient()
      const zones = await client.zones.list()
      return (zones.result ?? []).map((z: any) => ({
        id: z.id,
        name: z.name,
        status: z.status,
        paused: z.paused,
        plan: z.plan?.name ?? 'unknown',
        ssl: z.meta?.ssl_universal ? 'universal' : null,
      }))
    },
  })

  if (result.source !== 'network') {
    logger.debug({ source: result.source }, 'Cloudflare zones cache hit')
  }

  return result.value
}

/**
 * Find the Cloudflare zone for a given domain name.
 */
export async function getZoneForDomain(domain: string): Promise<CloudflareZoneInfo | null> {
  const zones = await listZones()
  const parts = domain.toLowerCase().split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.')
    const zone = zones.find((z) => z.name === candidate)
    if (zone) return zone
  }
  return null
}

/**
 * Get A record IPs for a domain via Cloudflare API.
 */
export async function getARecordIp(domain: string): Promise<string | null> {
  if (!env.cloudflare.apiToken) return null

  const result = await getCached<string | null>({
    namespace: 'cloudflare',
    keyParts: ['a-record', domain],
    ttlOverrideMs: CF_TTL,
    fetcher: async () => {
      const zone = await getZoneForDomain(domain)
      if (!zone) return null

      const client = getClient()
      try {
        const records = await client.dns.records.list({
          zone_id: zone.id,
          type: 'A',
          name: domain as any,
        })

        const aRecords = (records.result ?? []).filter((r: any) => r.type === 'A' && r.content)
        if (aRecords.length === 0) return null

        return aRecords[0].content
      } catch (error: any) {
        logger.debug({ domain, error: error.message }, 'Cloudflare A record lookup failed')
        return null
      }
    },
  })

  return result.value
}

/**
 * Get all DNS records for a zone, grouped by type.
 */
export async function getAllDnsRecords(
  zoneId: string,
  bypassCache = false,
): Promise<CloudflareDnsRecord[]> {
  if (!env.cloudflare.apiToken) return []

  const result = await getCached<CloudflareDnsRecord[]>({
    namespace: 'cloudflare',
    keyParts: ['dns-records', zoneId],
    ttlOverrideMs: CF_DNS_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient()
      try {
        const records = await client.dns.records.list({ zone_id: zoneId })
        return (records.result ?? []).map((r: any) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          content: r.content,
          ttl: r.ttl ?? 1,
          proxied: r.proxied ?? null,
          createdOn: r.created_on ?? null,
          modifiedOn: r.modified_on ?? null,
        }))
      } catch (error: any) {
        logger.debug({ zoneId, error: error.message }, 'Cloudflare DNS records fetch failed')
        return []
      }
    },
  })

  return result.value
}

/**
 * Get DNSSEC status for a zone.
 */
export async function getDnsSecStatus(
  zoneId: string,
  bypassCache = false,
): Promise<CloudflareDnsSec | null> {
  if (!env.cloudflare.apiToken) return null

  const result = await getCached<CloudflareDnsSec | null>({
    namespace: 'cloudflare',
    keyParts: ['dnssec', zoneId],
    ttlOverrideMs: CF_SETTINGS_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient()
      try {
        const resp = await client.dns.dnssec.get({ zone_id: zoneId })
        const d = resp as any
        return {
          status: d.status ?? 'disabled',
          enabled: d.status === 'active',
          algorithm: d.algorithm ?? null,
          digest: d.digest ?? null,
          digestType: d.digest_type ?? null,
        }
      } catch (error: any) {
        logger.debug({ zoneId, error: error.message }, 'Cloudflare DNSSEC fetch failed')
        return null
      }
    },
  })

  return result.value
}

/**
 * Get key zone settings (SSL mode, security level, TLS version, etc.).
 */
export async function getZoneSettings(
  zoneId: string,
  bypassCache = false,
): Promise<CloudflareZoneSettings | null> {
  if (!env.cloudflare.apiToken) return null

  const result = await getCached<CloudflareZoneSettings | null>({
    namespace: 'cloudflare',
    keyParts: ['settings', zoneId],
    ttlOverrideMs: CF_SETTINGS_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient()
      try {
        const settingIds = [
          'ssl',
          'min_tls_version',
          'security_level',
          'always_use_https',
          'http2',
          'http3',
          'brotli',
          'rocket_loader',
          'email_obfuscation',
          'ip_geolocation',
        ]

        const results = await Promise.allSettled(
          settingIds.map((id) =>
            client.zones.settings.get(id, { zone_id: zoneId }) as Promise<any>,
          ),
        )

        const getVal = (idx: number): any => {
          const r = results[idx]
          if (r.status === 'fulfilled') return r.value?.result ?? r.value
          return null
        }

        return {
          sslMode: getVal(0)?.value ?? null,
          minTlsVersion: getVal(1)?.value ?? null,
          securityLevel: getVal(2)?.value ?? null,
          alwaysUseHttps: getVal(3)?.value === 'on',
          http2: getVal(4)?.value === 'on',
          http3: getVal(5)?.value === 'on',
          brotli: getVal(6)?.value === 'on',
          rocketLoader: getVal(7)?.value === 'on',
          emailObfuscation: getVal(8)?.value === 'on',
          ipGeolocation: getVal(9)?.value === 'on',
        }
      } catch (error: any) {
        logger.debug({ zoneId, error: error.message }, 'Cloudflare zone settings fetch failed')
        return null
      }
    },
  })

  return result.value
}

/**
 * Get Cloudflare account information.
 */
export async function getAccountInfo(bypassCache = false): Promise<CloudflareAccountInfo | null> {
  if (!env.cloudflare.apiToken) return null

  const result = await getCached<CloudflareAccountInfo | null>({
    namespace: 'cloudflare',
    keyParts: ['account'],
    ttlOverrideMs: CF_SETTINGS_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient()
      try {
        const user = await client.user.get()
        const u = user as any
        return {
          id: u.id ?? '',
          email: u.email ?? '',
        }
      } catch (error: any) {
        logger.debug({ error: error.message }, 'Cloudflare account info fetch failed')
        return null
      }
    },
  })

  return result.value
}

/**
 * Get full zone summaries with DNS records, settings, and DNSSEC for all zones.
 */
export async function listZonesWithDetails(bypassCache = false): Promise<CloudflareZoneSummary[]> {
  if (!env.cloudflare.apiToken) return []

  const result = await getCached<CloudflareZoneSummary[]>({
    namespace: 'cloudflare',
    keyParts: ['zones-full'],
    ttlOverrideMs: CF_TTL,
    bypassCache,
    fetcher: async () => {
      const client = getClient()
      try {
        const zones = await client.zones.list()
        const zoneList = zones.result ?? []

        const summaries: CloudflareZoneSummary[] = []

        for (const z of zoneList) {
          const zoneId = z.id
          const [dnsRecords, dnssec, settings] = await Promise.all([
            getAllDnsRecords(zoneId, bypassCache),
            getDnsSecStatus(zoneId, bypassCache),
            getZoneSettings(zoneId, bypassCache),
          ])

          const aRecords = dnsRecords
            .filter((r) => r.type === 'A')
            .map((r) => r.content)
          const aaaaRecords = dnsRecords
            .filter((r) => r.type === 'AAAA')
            .map((r) => r.content)
          const cnameRecords = dnsRecords
            .filter((r) => r.type === 'CNAME')
            .map((r) => r.content)
          const mxRecords = dnsRecords
            .filter((r) => r.type === 'MX')
            .map((r) => r.content)
          const txtRecords = dnsRecords
            .filter((r) => r.type === 'TXT')
            .map((r) => r.content)
          const nsRecords = dnsRecords
            .filter((r) => r.type === 'NS')
            .map((r) => r.content)

          summaries.push({
            id: zoneId,
            name: z.name,
            status: z.status,
            paused: z.paused,
            plan: z.plan?.name ?? 'unknown',
            ssl: (z.meta as any)?.ssl_universal ? 'universal' : null,
            nameServers: (z as any).name_servers ?? [],
            createdOn: (z as any).created_on ?? null,
            modifiedOn: (z as any).modified_on ?? null,
            originalRegistrar: (z as any).original_registrar ?? null,
            originalDnsHost: (z as any).original_dns_host ?? null,
            totalDnsRecords: dnsRecords.length,
            aRecords,
            aaaaRecords,
            cnameRecords,
            mxRecords,
            txtRecords,
            nsRecords,
            settings,
            dnssec,
          })
        }

        return summaries
      } catch (error: any) {
        logger.error({ error: error.message }, 'Cloudflare zones full fetch failed')
        return []
      }
    },
  })

  return result.value
}
