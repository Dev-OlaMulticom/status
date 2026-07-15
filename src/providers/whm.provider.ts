import got from 'got'
import pLimit from 'p-limit'
import { getCached } from '../cache/cache.service'
import type { AccountInfo, DomainInfo, WhmAccountDetail, WhmExtractResult } from '../dto/whm.dto'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

const WHM_CACHE_TTL = 10 * 60 * 1000

/**
 * Make a raw GET request to the WHM JSON API.
 */
async function requestWhm(
  endpoint: string,
  params: Record<string, string | number> = {},
): Promise<any> {
  if (!env.whm.apiToken) throw new Error('WHM_API_TOKEN is not configured')

  const searchParams: Record<string, string> = { 'api.version': '1' }
  for (const [k, v] of Object.entries(params)) searchParams[k] = String(v)

  const url = `https://${env.whm.host}:${env.whm.port}/json-api/${endpoint}`

  const response = await got(url, {
    searchParams,
    timeout: { request: env.whm.timeoutMs },
    retry: { limit: 1, backoffLimit: 3000 },
    headers: {
      Authorization: `WHM ${env.whm.username}:${env.whm.apiToken}`,
      'User-Agent': 'WHM-Monitor/2.0',
    },
    https: { rejectUnauthorized: env.whm.rejectUnauthorized },
    responseType: 'json',
    throwHttpErrors: true,
  })

  return response.body
}

/**
 * WHM request with intelligent caching.
 */
async function requestWhmCached(
  endpoint: string,
  params: Record<string, string | number> = {},
  bypassCache = false,
): Promise<any> {
  const result = await getCached({
    namespace: 'whm',
    keyParts: [env.whm.host, env.whm.port, env.whm.username, endpoint, params],
    ttlOverrideMs: WHM_CACHE_TTL,
    bypassCache,
    fetcher: () => requestWhm(endpoint, params),
  })

  if (result.source !== 'network') {
    logger.debug({ endpoint, source: result.source }, 'WHM cache hit')
  }

  return result.value
}

function identifyDomainType(raw: any): 'addon' | 'subdominio' | 'principal' {
  if (raw.addon === 1 || raw.addon === true || raw.domain_type === 'addon') return 'addon'
  if (
    raw.type === 'sub' ||
    raw.sub_domain === 1 ||
    raw.sub_domain === true ||
    raw.domain_type === 'sub'
  )
    return 'subdominio'
  return 'principal'
}

function extractEmailEntries(payload: any): any[] {
  const candidates = [
    payload?.cpanelresult?.data,
    payload?.cpanelresult?.result?.data,
    payload?.cpanelresult?.result?.result?.data,
    payload?.data,
    payload?.result?.data,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) return c
  }
  return []
}

async function getEmailCountForUser(username: string): Promise<number | null> {
  if (!username) return null

  const result = await getCached<number | null>({
    namespace: 'whm',
    keyParts: ['email_count', env.whm.host, username],
    ttlOverrideMs: 6 * 60 * 60 * 1000,
    fetcher: async () => {
      try {
        const payload = await requestWhm('cpanel', {
          cpanel_jsonapi_user: username,
          cpanel_jsonapi_apiversion: '2',
          cpanel_jsonapi_module: 'Email',
          cpanel_jsonapi_func: 'listpopswithdisk',
        })
        const entries = extractEmailEntries(payload)
        logger.debug({ username, emailCount: entries.length }, 'Email count fetched')
        return entries.length
      } catch (error: any) {
        logger.warn({ username, error: error.message }, 'Email count fetch failed')
        return null
      }
    },
  })

  return result.value
}

/**
 * Extract all domains and accounts from WHM.
 */
export async function extractAccountsAndDomains(bypassCache = false): Promise<WhmExtractResult> {
  logger.info({ host: env.whm.host }, 'Connecting to WHM')

  const response = await requestWhmCached('get_domain_info', {}, bypassCache)

  if (!response.data) {
    logger.warn('WHM returned no data')
    return { domains: [], accounts: [], timestamp: new Date().toISOString() }
  }

  const rawDomains: any[] = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.data?.domains)
      ? response.data.domains
      : []

  const domains: DomainInfo[] = []
  const accounts = new Map<string, AccountInfo>()

  for (const item of rawDomains) {
    if (!item.domain) continue
    const domain: DomainInfo = {
      domain: item.domain,
      username: item.user ?? item.username ?? 'unknown',
      status: item.suspended ? 'Suspensa' : 'Activa',
      type: identifyDomainType(item),
      mainDomain: item.main_domain ?? item.parent_domain ?? item.domain,
      ip: item.ip ?? item.ipv4 ?? 'N/A',
      addon: item.addon === 1 || item.addon === true || item.domain_type === 'addon',
      subdomain: item.type === 'sub' || item.sub_domain === 1 || item.domain_type === 'sub',
    }
    domains.push(domain)

    if (!accounts.has(domain.username)) {
      accounts.set(domain.username, { username: domain.username, domains: [], suspended: false })
    }
    accounts.get(domain.username)!.domains.push(domain.domain)
  }

  if (env.whm.emailStatsEnabled && accounts.size > 0) {
    const limit = pLimit(env.whm.emailStatsConcurrency)
    const usernames = Array.from(accounts.keys())
    const counts = await Promise.all(
      usernames.map((u) =>
        limit(async () => {
          try {
            return { username: u, count: await getEmailCountForUser(u) }
          } catch (error: any) {
            logger.warn({ username: u, error: error.message }, 'Email stats failed')
            return { username: u, count: null }
          }
        }),
      ),
    )

    const countMap = new Map(counts.map(({ username, count }) => [username, count]))
    accounts.forEach((a) => {
      a.mailAccountsCount = countMap.get(a.username) ?? null
    })
    domains.forEach((d) => {
      d.mailAccountsCount = countMap.get(d.username) ?? null
    })
  }

  logger.info({ domains: domains.length, accounts: accounts.size }, 'WHM extraction complete')

  return {
    domains,
    accounts: Array.from(accounts.values()),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Get detailed account information (disk usage, bandwidth, plan) from WHM listaccts.
 */
export async function getAccountDetails(bypassCache = false): Promise<WhmAccountDetail[]> {
  if (!env.whm.apiToken) {
    logger.warn('WHM_API_TOKEN not configured, skipping account details')
    return []
  }

  const result = await getCached<WhmAccountDetail[]>({
    namespace: 'whm',
    keyParts: ['account_details', env.whm.host],
    ttlOverrideMs: WHM_CACHE_TTL,
    bypassCache,
    fetcher: async () => {
      try {
        const response = await requestWhm('listaccts', {
          want_usage: '1',
          search_type: 'all',
        })

        const accounts: any[] = response?.data ?? response?.accts ?? []
        if (!Array.isArray(accounts)) {
          logger.warn({ responseKeys: Object.keys(response ?? {}) }, 'WHM listaccts returned non-array')
          return []
        }

        logger.info({ count: accounts.length }, 'WHM listaccts returned accounts')
        return accounts.map((acc: any) => ({
          username: acc.user ?? acc.username ?? '',
          domain: acc.domain ?? '',
          plan: acc.plan ?? acc.package ?? '',
          diskused: Number(acc.diskused ?? acc.disk_used ?? 0),
          diskquota: Number(acc.diskquota ?? acc.disk_quota ?? 0),
          diskpercent: Number(acc.diskpercent ?? acc.disk_used_percent ?? 0),
          bwused: Number(acc.bwused ?? acc.bandwidth_used ?? 0),
          bwquota: Number(acc.bwquota ?? acc.bandwidth_quota ?? 0),
          bwpercent: Number(acc.bwpercent ?? acc.bandwidth_used_percent ?? 0),
          emailAccounts: Number(acc.emails ?? acc.email_accounts ?? 0),
          suspended: acc.suspended === 1 || acc.suspended === true,
          ip: acc.ip ?? acc.ipaddr ?? '',
          startdate: acc.startdate ?? acc.created ?? null,
        }))
      } catch (error: any) {
        logger.warn({ error: error.message }, 'WHM listaccts failed')
        return []
      }
    },
  })

  return result.value
}

/**
 * Get usage summary for all WHM accounts.
 */
export async function getWhmUsageSummary(bypassCache = false): Promise<{
  totalDiskUsedMb: number
  totalDiskQuotaMb: number
  totalBwUsedMb: number
  totalBwQuotaMb: number
  totalAccounts: number
}> {
  const details = await getAccountDetails(bypassCache)

  return {
    totalDiskUsedMb: details.reduce((sum, d) => sum + d.diskused, 0),
    totalDiskQuotaMb: details.reduce((sum, d) => sum + d.diskquota, 0),
    totalBwUsedMb: details.reduce((sum, d) => sum + d.bwused, 0),
    totalBwQuotaMb: details.reduce((sum, d) => sum + d.bwquota, 0),
    totalAccounts: details.length,
  }
}

export { requestWhmCached }
