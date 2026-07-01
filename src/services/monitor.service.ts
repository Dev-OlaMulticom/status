import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import pLimit from 'p-limit';
import { env } from '../utils/env';
import { logger } from '../utils/logger';
import { checkUrl } from '../providers/http.provider';
import { AccountService } from './account.service';
import type { Site, SiteResult, CheckResult, MonitorHistory } from '../models/site.model';

const HISTORY_FILE = 'status.json';

/**
 * Core monitoring orchestrator.
 * Manages the site list, WHM sync, HTTP checks, and history persistence.
 */
export class MonitorService {
  private readonly accounts: AccountService;
  private history: MonitorHistory = { checks: [] };

  constructor() {
    this.accounts = new AccountService();
    this.loadHistory();
  }

  private loadHistory(): void {
    try {
      if (!existsSync(HISTORY_FILE)) return;
      const data: MonitorHistory = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
      if (data && Array.isArray(data.checks)) this.history = data;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not load history, starting fresh');
      this.history = { checks: [] };
    }
  }

  private saveHistory(): void {
    writeFileSync(HISTORY_FILE, `${JSON.stringify(this.history, null, 2)}\n`);
  }

  private async checkSiteOnce(site: Site): Promise<SiteResult> {
    const result = await checkUrl(site.url);
    return {
      ...site,
      status: result.statusCode,
      online: result.online,
      responseTime: result.responseTimeMs,
      timestamp: new Date().toISOString(),
      ssl: site.url.startsWith('https:'),
      error: result.error,
    };
  }

  private shouldRetry(result: SiteResult): boolean {
    return !result.online && (result.status === 0 || result.status >= 500);
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
    };

    for (let attempt = 0; attempt <= env.monitor.maxRetries; attempt++) {
      const result = await this.checkSiteOnce(site);
      last = result;
      if (!this.shouldRetry(result) || attempt === env.monitor.maxRetries) {
        return { ...result, attempts: attempt + 1 };
      }
    }

    return { ...last, attempts: env.monitor.maxRetries + 1 };
  }

  async run(): Promise<SiteResult[]> {
    this.accounts.loadFromFile();
    await this.accounts.refreshServerInfo();

    const needsSync =
      !this.accounts.lastWhmSync ||
      Date.now() - new Date(this.accounts.lastWhmSync).getTime() > env.whm.syncIntervalMs;

    if (needsSync && env.whm.enabled) {
      await this.accounts.syncWithWhm();
    }

    this.accounts.saveToFile();

    const sites = this.accounts.getAllSites();
    logger.info({ count: sites.length }, 'Starting site checks');

    const limit = pLimit(env.monitor.concurrency);
    const results = await Promise.all(sites.map((s) => limit(() => this.checkSite(s))));

    const online = results.filter((r) => r.online).length;
    logger.info({ total: results.length, online, offline: results.length - online }, 'Checks complete');

    const checkResult: CheckResult = {
      timestamp: new Date().toISOString(),
      results,
      stats: this.accounts.getStats(),
    };

    this.history.checks.unshift(checkResult);
    if (this.history.checks.length > env.monitor.historyLimit) {
      this.history.checks = this.history.checks.slice(0, env.monitor.historyLimit);
    }

    this.saveHistory();
    return results;
  }

  calculateUptime(): number {
    if (!this.history.checks.length) return 0;
    let total = 0;
    let totalOnline = 0;
    for (const check of this.history.checks) {
      total += check.results.length;
      totalOnline += check.results.filter((r) => r.online).length;
    }
    return total ? Math.round((totalOnline / total) * 100) : 0;
  }

  get accountService(): AccountService {
    return this.accounts;
  }
}
