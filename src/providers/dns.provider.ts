import {
  resolve4,
  resolve6,
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
} from 'node:dns/promises'
import { getCached } from '../cache/cache.service'
import type { DnsInfo } from '../dto/dns.dto'
import { logger } from '../utils/logger'

const DNS_TTL = 5 * 60 * 1000

async function safeResolve<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

/**
 * Resolve all relevant DNS records for a domain.
 * Uses Node.js dns/promises — no ICMP, pure DNS.
 */
export async function resolveDomain(domain: string, bypassCache = false): Promise<DnsInfo> {
  const result = await getCached<DnsInfo>({
    namespace: 'dns',
    keyParts: [domain],
    ttlOverrideMs: DNS_TTL,
    bypassCache,
    fetcher: async () => {
      const [a, aaaa, mx, txt, ns, cname] = await Promise.all([
        safeResolve(() => resolve4(domain)),
        safeResolve(() => resolve6(domain)),
        safeResolve(() => resolveMx(domain)),
        safeResolve(() => resolveTxt(domain)),
        safeResolve(() => resolveNs(domain)),
        safeResolve(() => resolveCname(domain)),
      ])

      return {
        ipv4: Array.isArray(a) && a.length > 0 ? a[0]! : null,
        ipv6: Array.isArray(aaaa) && aaaa.length > 0 ? aaaa[0]! : null,
        mx: (mx ?? []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange),
        txt: (txt ?? []).flat(),
        ns: ns ?? [],
        cname: Array.isArray(cname) && cname.length > 0 ? cname[0]! : null,
      }
    },
  })

  if (result.source !== 'network') {
    logger.debug({ domain, source: result.source }, 'DNS cache hit')
  }

  return result.value
}

/**
 * Resolve a domain to its IPv4 address — lightweight single-record lookup.
 */
export async function resolveIpv4(domain: string): Promise<string | null> {
  const info = await resolveDomain(domain)
  return info.ipv4
}
