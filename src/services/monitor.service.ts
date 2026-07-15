import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import pLimit from 'p-limit'
import type {
  CheckResult,
  HostingProvider,
  MonitorHistory,
  Site,
  SiteResult,
} from '../models/site.model'
import { getAllDnsRecords, getARecordIp, getZoneForDomain } from '../providers/cloudflare.provider'
import { resolveDomain, resolveIpv4 } from '../providers/dns.provider'
import { checkUrl } from '../providers/http.provider'
import { env } from '../utils/env'
import { logger } from '../utils/logger'
import { AccountService } from './account.service'
import { processGasQueue } from './gas-queue.service'
import { syncToGas } from './gas-sync.service'

const HISTORY_FILE = 'status.json'

/**
 * Core monitoring orchestrator.
 * Manages the site list, WHM sync, HTTP checks, and history persistence.
 */
export class MonitorService {
  private readonly accounts: AccountService
  private history: MonitorHistory = { checks: [] }

  constructor() {
    this.accounts = new AccountService()
    this.loadHistory()
  }

  private loadHistory(): void {
    try {
      if (!existsSync(HISTORY_FILE)) return
      const data: MonitorHistory = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
      if (data && Array.isArray(data.checks)) this.history = data
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not load history, starting fresh')
      this.history = { checks: [] }
    }
  }

  private saveHistory(): void {
    writeFileSync(HISTORY_FILE, `${JSON.stringify(this.history, null, 2)}\n`)
  }

  private async checkSiteOnce(site: Site): Promise<SiteResult> {
    const hostname = new URL(site.url).hostname
    const [result, dnsInfo, cloudflareZone, cfDnsRecords, cfARecordIp] = await Promise.all([
      checkUrl(site.url),
      resolveDomain(hostname).catch(() => null),
      getZoneForDomain(hostname).catch(() => null),
      (async () => {
        const zone = await getZoneForDomain(hostname).catch(() => null)
        if (!zone) return null
        return getAllDnsRecords(zone.id).catch(() => null)
      })(),
      getARecordIp(hostname).catch(() => null),
    ])

    const ip = dnsInfo?.ipv4 ?? null

    const inCloudflare = cloudflareZone !== null
    const inWhm = site.whmInfo !== undefined
    const hosting: HostingProvider =
      inCloudflare && inWhm ? 'both' : inCloudflare ? 'cloudflare' : inWhm ? 'whm' : 'unknown'

    const dnsRecords = dnsInfo
      ? {
          a: dnsInfo.ipv4 ? [dnsInfo.ipv4] : [],
          aaaa: dnsInfo.ipv6 ? [dnsInfo.ipv6] : [],
          cname: dnsInfo.cname,
          mx: dnsInfo.mx,
          txt: dnsInfo.txt,
          ns: dnsInfo.ns,
        }
      : undefined

    const cloudflareInfo = cloudflareZone
      ? {
          zoneId: cloudflareZone.id,
          zoneName: cloudflareZone.name,
          sslMode: null as string | null,
          securityLevel: null as string | null,
          alwaysUseHttps: null as boolean | null,
          dnssecEnabled: null as boolean | null,
          totalRecords: cfDnsRecords?.length ?? 0,
          nameservers: [] as string[],
          proxied: null as boolean | null,
        }
      : undefined

    return {
      ...site,
      status: result.statusCode,
      online: result.online,
      responseTime: result.responseTimeMs,
      timestamp: new Date().toISOString(),
      ssl: site.url.startsWith('https:'),
      error: result.error,
      ip,
      cloudflareIp: cfARecordIp,
      hosting,
      dnsRecords,
      cloudflareInfo,
    }
  }

  private shouldRetry(result: SiteResult): boolean {
    return !result.online && (result.status === 0 || result.status >= 500)
  }

  private async checkSite(site: Site): Promise<SiteResult> {
    let last: SiteResult = {
      ...site,
      status: 0,
      online: false,
      responseTime: -1,
      timestamp: new Date().toISOString(),
      error: 'Unknown error',
      attempts: 1,
    }

    for (let attempt = 0; attempt <= env.monitor.maxRetries; attempt++) {
      const result = await this.checkSiteOnce(site)
      last = result
      if (!this.shouldRetry(result) || attempt === env.monitor.maxRetries) {
        return { ...result, attempts: attempt + 1 }
      }
    }

    return { ...last, attempts: env.monitor.maxRetries + 1 }
  }

  async run(): Promise<SiteResult[]> {
    this.accounts.loadFromFile()
    await this.accounts.refreshServerInfo()

    const needsSync =
      !this.accounts.lastWhmSync ||
      Date.now() - new Date(this.accounts.lastWhmSync).getTime() > env.whm.syncIntervalMs

    if (needsSync && env.whm.enabled) {
      await this.accounts.syncWithWhm()
    }

    if (env.cloudflare.apiToken) {
      await this.accounts.syncCloudflareOverview()
    }

    this.accounts.saveToFile()

    const sites = this.accounts.getAllSites()
    logger.info({ count: sites.length }, 'Starting site checks')

    const limit = pLimit(env.monitor.concurrency)
    const results = await Promise.all(sites.map((s) => limit(() => this.checkSite(s))))

    const online = results.filter((r) => r.online).length
    logger.info(
      { total: results.length, online, offline: results.length - online },
      'Checks complete',
    )

    const checkResult: CheckResult = {
      timestamp: new Date().toISOString(),
      results,
      stats: this.accounts.getStats(),
    }

    this.history.checks.unshift(checkResult)
    if (this.history.checks.length > env.monitor.historyLimit) {
      this.history.checks = this.history.checks.slice(0, env.monitor.historyLimit)
    }

    this.saveHistory()

    if (env.gas.enabled && env.gas.apiKey) {
      const gasResults = await Promise.allSettled([syncToGas(results), processGasQueue()])
      for (const r of gasResults) {
        if (r.status === 'rejected') {
          logger.warn({ error: String(r.reason) }, 'GAS sync step failed')
        }
      }
    }

    return results
  }

  calculateUptime(): number {
    if (!this.history.checks.length) return 0
    let total = 0
    let totalOnline = 0
    for (const check of this.history.checks) {
      total += check.results.length
      totalOnline += check.results.filter((r) => r.online).length
    }
    return total ? Math.round((totalOnline / total) * 100) : 0
  }

  get accountService(): AccountService {
    return this.accounts
  }
}
