import pLimit from 'p-limit'
import type { DnsInfo } from '../dto/dns.dto'
import type { SslInfo } from '../dto/ssl.dto'
import type { WhoisInfo } from '../dto/whois.dto'
import { getZoneForDomain } from '../providers/cloudflare.provider'
import { resolveDomain } from '../providers/dns.provider'
import { getRdapDates } from '../providers/rdap.provider'
import { checkSsl } from '../providers/ssl.provider'
import { getWhoisInfo } from '../providers/whois.provider'
import { logger } from '../utils/logger'

export interface DomainEnrichment {
  domain: string
  dns: DnsInfo | null
  whois: WhoisInfo | null
  ssl: SslInfo | null
  cloudflareZone: string | null
  ipMatchesServer: boolean | null
}

/**
 * Enrich a single domain with DNS, WHOIS, SSL, and Cloudflare data.
 */
export async function enrichDomain(
  domain: string,
  serverIp: string | null,
): Promise<DomainEnrichment> {
  const [dns, whois, ssl, cfZone] = await Promise.all([
    resolveDomain(domain).catch((e) => {
      logger.debug({ domain, error: e.message }, 'DNS enrich failed')
      return null
    }),
    getWhoisInfo(domain).catch((e) => {
      logger.debug({ domain, error: e.message }, 'WHOIS enrich failed')
      return null
    }),
    checkSsl(domain).catch((e) => {
      logger.debug({ domain, error: e.message }, 'SSL enrich failed')
      return null
    }),
    getZoneForDomain(domain).catch(() => null),
  ])

  const ipMatchesServer = serverIp != null && dns?.ipv4 != null ? dns.ipv4 === serverIp : null

  return {
    domain,
    dns,
    whois,
    ssl,
    cloudflareZone: cfZone?.name ?? null,
    ipMatchesServer,
  }
}

/**
 * Enrich multiple domains in parallel with a configurable concurrency limit.
 */
export async function enrichDomains(
  domains: string[],
  serverIp: string | null,
  concurrency = 5,
): Promise<DomainEnrichment[]> {
  const limit = pLimit(concurrency)
  return Promise.all(domains.map((d) => limit(() => enrichDomain(d, serverIp))))
}
