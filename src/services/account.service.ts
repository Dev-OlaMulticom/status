import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import pLimit from 'p-limit';
import { env } from '../utils/env';
import { logger } from '../utils/logger';
import { runLinuxCommand, commandExists, extractFirstMatch } from '../utils/helpers';
import { fetchJson } from '../providers/http.provider';
import { extractAccountsAndDomains } from '../providers/whm.provider';
import { getRdapDates } from '../providers/rdap.provider';
import type { Site, ServerInfo, SitesConfig } from '../models/site.model';

const SITES_CONFIG_FILE = 'sites-config.json';

const MANUAL_SITES: Site[] = [
  { name: 'Smartbox Brasil', url: 'https://smartboxbrasil.com.br' },
  { name: 'Tecnuv', url: 'https://tecnuv.com.br' },
  { name: 'Postogestor', url: 'https://postogestor.com.br' },
  { name: 'Epsy', url: 'https://epsy.com.br' },
];

async function enrichFromIpWhoIs(ip: string): Promise<Partial<ServerInfo> | null> {
  try {
    const payload = await fetchJson<any>(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      env.whm.ipEnrichmentTimeoutMs,
    );
    if (!payload || payload.success === false) return null;
    const asn = payload?.connection?.asn ? `AS${String(payload.connection.asn).replace(/^AS/i, '')}` : null;
    return {
      isp: payload?.connection?.isp ?? payload?.connection?.org ?? null,
      asName: payload?.connection?.org ?? null,
      whoisAsn: asn,
      geoCity: payload?.city ?? null,
      geoRegion: payload?.region ?? null,
      geoCountry: payload?.country ?? null,
      geoTimezone: payload?.timezone?.id ?? payload?.timezone?.utc ?? null,
      ipApiSource: 'ipwho.is',
    };
  } catch {
    return null;
  }
}

async function enrichFromIpInfo(ip: string): Promise<Partial<ServerInfo> | null> {
  try {
    const tokenPart = env.ipInfoToken ? `?token=${encodeURIComponent(env.ipInfoToken)}` : '';
    const payload = await fetchJson<any>(
      `https://ipinfo.io/${encodeURIComponent(ip)}/json${tokenPart}`,
      env.whm.ipEnrichmentTimeoutMs,
    );
    if (!payload) return null;
    return {
      isp: payload?.org ?? null,
      asName: payload?.org ?? null,
      geoCity: payload?.city ?? null,
      geoRegion: payload?.region ?? null,
      geoCountry: payload?.country ?? null,
      geoTimezone: payload?.timezone ?? null,
      ipApiSource: env.ipInfoToken ? 'ipinfo.io (token)' : 'ipinfo.io',
    };
  } catch {
    return null;
  }
}

export class AccountService {
  manualSites: Site[] = [];
  whmSites: Site[] = [];
  lastWhmSync: string | null = null;
  serverInfo: ServerInfo = {
    host: env.whm.host,
    ip: null,
    plan: env.whm.serverPlan,
    system: env.whm.serverSystem,
  };

  constructor() {
    this.manualSites = MANUAL_SITES.map((s) => ({ ...s, category: 'manual' as const, priority: 'normal' as const }));
  }

  loadFromFile(): void {
    try {
      if (!existsSync(SITES_CONFIG_FILE)) return;
      const data: SitesConfig = JSON.parse(readFileSync(SITES_CONFIG_FILE, 'utf8'));

      if (Array.isArray(data.manualSites)) {
        this.manualSites = data.manualSites.map((s) => ({
          ...s,
          category: s.category ?? 'manual',
          priority: s.priority ?? 'normal',
        }));
      }

      if (Array.isArray(data.whmSites)) {
        this.whmSites = data.whmSites;
        this.lastWhmSync = data.lastWhmSync ?? null;
      }

      if (data.serverInfo && typeof data.serverInfo === 'object') {
        this.serverInfo = { ...this.serverInfo, ...data.serverInfo };
      }

      logger.info(
        { manual: this.manualSites.length, whm: this.whmSites.length },
        'Loaded sites config',
      );
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not load sites config, using defaults');
      if (existsSync(SITES_CONFIG_FILE)) {
        const backup = `sites-config.invalid-${Date.now()}.json`;
        renameSync(SITES_CONFIG_FILE, backup);
        logger.warn({ backup }, 'Corrupted config backed up');
      }
      this.manualSites = MANUAL_SITES.map((s) => ({ ...s, category: 'manual' as const, priority: 'normal' as const }));
      this.whmSites = [];
      this.lastWhmSync = null;
    }
  }

  saveToFile(): void {
    const config: SitesConfig = {
      manualSites: this.manualSites,
      whmSites: this.whmSites,
      lastWhmSync: this.lastWhmSync,
      serverInfo: this.serverInfo,
      lastUpdate: new Date().toISOString(),
    };
    writeFileSync(SITES_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  }

  getAllSites(): Site[] {
    return [...this.manualSites, ...this.whmSites];
  }

  getStats() {
    const all = this.getAllSites();
    return {
      total: all.length,
      manual: this.manualSites.length,
      whm: this.whmSites.length,
      byCategory: {
        externo: all.filter((s) => s.category === 'externo').length,
        whm: all.filter((s) => s.category === 'whm').length,
        api: all.filter((s) => s.category === 'api').length,
        cdn: all.filter((s) => s.category === 'cdn').length,
        manual: all.filter((s) => s.category === 'manual').length,
      },
      byPriority: {
        critical: all.filter((s) => s.priority === 'critical').length,
        high: all.filter((s) => s.priority === 'high').length,
        normal: all.filter((s) => s.priority === 'normal').length,
        low: all.filter((s) => s.priority === 'low').length,
      },
    };
  }

  async syncWithWhm(): Promise<boolean> {
    if (!env.whm.enabled) {
      logger.info('WHM sync disabled');
      return false;
    }

    try {
      logger.info('Starting WHM sync');
      const whmData = await extractAccountsAndDomains();

      const filtered = whmData.domains.filter((d) => {
        if (env.whm.excludeSuspended && d.status !== 'Activa') return false;
        if (env.whm.onlyMainDomains && d.type !== 'principal') return false;
        if (env.whm.excludeSubdomains && d.type === 'subdominio') return false;
        if (env.whm.excludeAddonDomains && d.type === 'addon') return false;
        return !env.whm.excludePatterns.some((p) => d.domain.toLowerCase().includes(p.toLowerCase()));
      });

      if (filtered.length === 0) {
        logger.warn('WHM returned 0 valid domains, keeping previous data');
        return false;
      }

      const oldDates = new Map<string, { expirationDate?: string; renewalDate?: string }>();
      this.whmSites.forEach((s) => {
        if (s.url && s.whmInfo) {
          oldDates.set(s.url.toLowerCase(), {
            expirationDate: s.whmInfo.expirationDate,
            renewalDate: s.whmInfo.renewalDate,
          });
        }
      });

      const rdapDateMap = new Map<string, { expirationDate: string | null; renewalDate: string | null }>();

      if (env.whm.rdapEnabled && env.rdap.enabled) {
        const mainDomains = Array.from(
          new Set(filtered.filter((d) => d.type === 'principal').map((d) => d.domain.toLowerCase())),
        );
        const limit = pLimit(env.whm.rdapConcurrency);
        const rdapResults = await Promise.all(
          mainDomains.map((domain) => limit(async () => ({ domain, dates: await getRdapDates(domain) }))),
        );
        rdapResults.forEach(({ domain, dates }) => rdapDateMap.set(domain, dates));
        logger.info({ count: mainDomains.length }, 'RDAP checked for main domains');
      }

      this.whmSites = filtered.map((d) => {
        const url = `https://${d.domain}`;
        const rdap = rdapDateMap.get(d.domain.toLowerCase());
        const prev = oldDates.get(url.toLowerCase());
        return {
          name: d.domain,
          url,
          category: 'whm' as const,
          priority: 'normal' as const,
          whmInfo: {
            type: d.type,
            username: d.username,
            status: d.status,
            expirationDate: rdap?.expirationDate ?? prev?.expirationDate,
            renewalDate: rdap?.renewalDate ?? prev?.renewalDate,
            mailAccountsCount: d.mailAccountsCount ?? null,
          },
        };
      });

      this.lastWhmSync = new Date().toISOString();
      await this.refreshServerInfo();
      this.saveToFile();
      logger.info({ count: this.whmSites.length }, 'WHM sync complete');
      return true;
    } catch (error: any) {
      logger.error({ error: error.message }, 'WHM sync failed');
      return false;
    }
  }

  async refreshServerInfo(): Promise<void> {
    this.serverInfo.host = env.whm.host;
    this.serverInfo.plan = env.whm.serverPlan;
    this.serverInfo.system = env.whm.serverSystem;

    try {
      const resolved = await lookup(env.whm.host, { family: 4 });
      this.serverInfo.ip = resolved.address;
    } catch {
      try {
        const resolved = await lookup(env.whm.host);
        this.serverInfo.ip = resolved.address;
      } catch {
        this.serverInfo.ip = null;
      }
    }

    if (!env.whm.serverProbeEnabled) {
      this.serverInfo.probedAt = new Date().toISOString();
      return;
    }

    const timeoutMs = env.whm.serverProbeTimeoutMs;

    this.serverInfo.reverseDns = await runLinuxCommand(
      `getent hosts ${env.whm.host} | awk '{print $2}' | head -n1`,
      timeoutMs,
    );

    const headers = await runLinuxCommand(
      `curl -kIs --max-time 8 https://${env.whm.host}:${env.whm.port} | tr -d '\\r'`,
      timeoutMs,
    );
    this.serverInfo.httpServer = extractFirstMatch(headers, [/^server:\s*(.+)$/im]);

    if (this.serverInfo.ip && (await commandExists('whois'))) {
      const whoisOut = await runLinuxCommand(`whois ${this.serverInfo.ip} | head -n 250`, timeoutMs);
      this.serverInfo.whoisOrg = extractFirstMatch(whoisOut, [/^(?:OrgName|org-name|owner|Organization|descr)\s*:\s*(.+)$/im]);
      this.serverInfo.whoisCountry = extractFirstMatch(whoisOut, [/^(?:Country|country)\s*:\s*(.+)$/im]);
      this.serverInfo.whoisNetName = extractFirstMatch(whoisOut, [/^(?:NetName|netname)\s*:\s*(.+)$/im]);
      this.serverInfo.whoisAsn = extractFirstMatch(whoisOut, [/^(?:OriginAS|origin|originas|aut-num)\s*:\s*(AS\d+)$/im]);
    } else {
      this.serverInfo.whoisOrg = null;
      this.serverInfo.whoisCountry = null;
      this.serverInfo.whoisNetName = null;
      this.serverInfo.whoisAsn = null;
    }

    if (this.serverInfo.ip && (await commandExists('nmap'))) {
      const nmapOut = await runLinuxCommand(
        `nmap -O -Pn --osscan-limit --max-retries 1 --host-timeout 15s ${this.serverInfo.ip}`,
        timeoutMs,
      );
      this.serverInfo.osGuess = extractFirstMatch(nmapOut, [/^OS details:\s*(.+)$/im, /^Running:\s*(.+)$/im]);
    } else {
      this.serverInfo.osGuess = null;
    }

    if (this.serverInfo.ip && env.whm.ipEnrichmentEnabled) {
      let geoData: Partial<ServerInfo> | null = null;
      geoData = await enrichFromIpWhoIs(this.serverInfo.ip);
      if (!geoData) geoData = await enrichFromIpInfo(this.serverInfo.ip);

      if (geoData) {
        Object.assign(this.serverInfo, {
          isp: geoData.isp ?? this.serverInfo.isp ?? null,
          asName: geoData.asName ?? this.serverInfo.asName ?? null,
          whoisAsn: geoData.whoisAsn ?? this.serverInfo.whoisAsn ?? null,
          geoCity: geoData.geoCity ?? this.serverInfo.geoCity ?? null,
          geoRegion: geoData.geoRegion ?? this.serverInfo.geoRegion ?? null,
          geoCountry: geoData.geoCountry ?? this.serverInfo.geoCountry ?? null,
          geoTimezone: geoData.geoTimezone ?? this.serverInfo.geoTimezone ?? null,
          ipApiSource: geoData.ipApiSource ?? null,
        });
      }
    }

    this.serverInfo.probedAt = new Date().toISOString();
  }
}
