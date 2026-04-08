import * as whmExtractor from './whm-extractor';
import { RDAP_CONFIG, getDomainDates } from './rdap-client';
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
const fs = require('fs');
const https = require('https');
const http = require('http');
require('dotenv').config();

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(254);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(254);
});

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
    const value = process.env[name];
    if (value == null || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getEnvNumber(name: string, defaultValue: number, min = 1): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= min ? value : defaultValue;
}

interface Site {
    name: string;
    url: string;
    category?: string;
    priority?: 'critical' | 'high' | 'normal' | 'low';
    whmInfo?: {
        type: string;
        username: string;
        status: string;
        expirationDate?: string;
        renewalDate?: string;
        mailAccountsCount?: number | null;
    };
}

interface SiteResult extends Site {
    status: number;
    online: boolean;
    responseTime: number;
    timestamp: string;
    ssl?: boolean;
    error?: string;
    attempts?: number;
}

interface CheckResult {
    timestamp: string;
    results: SiteResult[];
    stats: ReturnType<SiteManager['getStats']>;
}

interface ServerInfo {
    host: string;
    ip: string | null;
    plan: string;
    system: string;
    reverseDns?: string | null;
    whoisOrg?: string | null;
    whoisCountry?: string | null;
    whoisNetName?: string | null;
    whoisAsn?: string | null;
    httpServer?: string | null;
    osGuess?: string | null;
    isp?: string | null;
    asName?: string | null;
    geoCity?: string | null;
    geoRegion?: string | null;
    geoCountry?: string | null;
    geoTimezone?: string | null;
    ipApiSource?: string | null;
    probedAt?: string;
}

const MANUAL_SITES: Site[] = [
    { name: 'Smartbox Brasil', url: 'https://smartboxbrasil.com.br' },
    { name: 'Tecnuv', url: 'https://tecnuv.com.br' },
    { name: 'Postogestor', url: 'https://postogestor.com.br' },
    { name: 'Epsy', url: 'https://epsy.com.br' },
];

const WHM_CONFIG = {
    enabled: getEnvBoolean('WHM_ENABLED', true),
    host: process.env.WHM_HOST || 'servolam.olamulticom.com.br',
    port: getEnvNumber('WHM_PORT', 2087),
    username: process.env.WHM_USERNAME || 'root',
    apiToken: process.env.WHM_API_TOKEN,
    syncIntervalMs: getEnvNumber('WHM_SYNC_INTERVAL_MS', 60 * 60 * 1000),
    filters: {
        excludeSuspended: getEnvBoolean('WHM_EXCLUDE_SUSPENDED', true),
        excludeSubdomains: getEnvBoolean('WHM_EXCLUDE_SUBDOMAINS', false),
        excludeAddonDomains: getEnvBoolean('WHM_EXCLUDE_ADDON_DOMAINS', false),
        onlyMainDomains: getEnvBoolean('WHM_ONLY_MAIN_DOMAINS', false),
        excludePatterns: [
            'cpanel.',
            'webmail.',
            'mail.',
            'ftp.',
            'autodiscover.'
        ]
    },
    rdap: {
        enabled: getEnvBoolean('WHM_RDAP_ENABLED', true),
        concurrency: getEnvNumber('WHM_RDAP_CONCURRENCY', 3, 1)
    }
};

const MONITOR_CONFIG = {
    timeout: getEnvNumber('MONITOR_TIMEOUT_MS', 10000),
    userAgent: process.env.MONITOR_USER_AGENT || 'Website-Monitor/1.0 (+github-actions)',
    maxRetries: getEnvNumber('MONITOR_MAX_RETRIES', 2, 0),
    parallelLimit: getEnvNumber('MONITOR_PARALLEL_LIMIT', 10),
    historyLimit: getEnvNumber('MONITOR_HISTORY_LIMIT', 100),
};

const OUTPUT_CONFIG = {
    generateLegacyHtml: getEnvBoolean('MONITOR_GENERATE_LEGACY_HTML', false),
};

const SERVER_PROBE_CONFIG = {
    enabled: getEnvBoolean('WHM_SERVER_PROBE_ENABLED', true),
    timeoutMs: getEnvNumber('WHM_SERVER_PROBE_TIMEOUT_MS', 12000, 1000),
};

const SERVER_IP_ENRICHMENT_CONFIG = {
    enabled: getEnvBoolean('WHM_IP_ENRICHMENT_ENABLED', true),
    timeoutMs: getEnvNumber('WHM_IP_ENRICHMENT_TIMEOUT_MS', 8000, 1000),
    ipWhoisEnabled: getEnvBoolean('WHM_IPWHOIS_ENABLED', true),
    ipInfoEnabled: getEnvBoolean('WHM_IPINFO_ENABLED', true),
    ipInfoToken: process.env.IPINFO_TOKEN || ''
};

function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let current = 0;

    async function worker(): Promise<void> {
        while (current < items.length) {
            const idx = current;
            current += 1;
            results[idx] = await mapper(items[idx], idx);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

function extractFirstMatch(content: string | null, regexes: RegExp[]): string | null {
    if (!content) return null;
    for (const regex of regexes) {
        const match = content.match(regex);
        if (match && match[1]) {
            return String(match[1]).trim();
        }
    }
    return null;
}

function runLinuxCommand(command: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
        execFile(
            'bash',
            ['-lc', command],
            { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
            (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }
                const value = String(stdout || '').trim();
                resolve(value || null);
            }
        );
    });
}

async function commandExists(name: string): Promise<boolean> {
    const result = await runLinuxCommand(`command -v ${name} >/dev/null 2>&1 && echo yes || echo no`, 2000);
    return result === 'yes';
}

function fetchJson(url: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
        try {
            const request = https.get(url, {
                headers: {
                    'User-Agent': MONITOR_CONFIG.userAgent
                }
            }, (response: any) => {
                let data = '';
                response.on('data', (chunk: Buffer | string) => {
                    data += chunk;
                });
                response.on('end', () => {
                    clearTimeout(hardTimeout);
                    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(`HTTP ${response.statusCode || 0}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (error: any) {
                        reject(new Error(`Invalid JSON: ${error.message}`));
                    }
                });
            });

            request.on('error', (error: Error) => {
                clearTimeout(hardTimeout);
                reject(error);
            });

            request.setTimeout(timeoutMs, () => {
                request.destroy();
                clearTimeout(hardTimeout);
                reject(new Error('Request timeout'));
            });

            const hardTimeout = setTimeout(() => {
                request.destroy(new Error('Hard timeout'));
            }, timeoutMs + 1000);
        } catch (error) {
            reject(error);
        }
    });
}

async function enrichFromIpWhoIs(ip: string, timeoutMs: number): Promise<Partial<ServerInfo> | null> {
    try {
        const payload = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, timeoutMs);
        if (!payload || payload.success === false) return null;

        const asn = payload?.connection?.asn ? `AS${String(payload.connection.asn).replace(/^AS/i, '')}` : null;
        return {
            isp: payload?.connection?.isp || payload?.connection?.org || null,
            asName: payload?.connection?.org || null,
            whoisAsn: asn,
            geoCity: payload?.city || null,
            geoRegion: payload?.region || null,
            geoCountry: payload?.country || null,
            geoTimezone: payload?.timezone?.id || payload?.timezone?.utc || null,
            ipApiSource: 'ipwho.is'
        };
    } catch {
        return null;
    }
}

async function enrichFromIpInfo(ip: string, timeoutMs: number, token: string): Promise<Partial<ServerInfo> | null> {
    try {
        const tokenPart = token ? `?token=${encodeURIComponent(token)}` : '';
        const payload = await fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json${tokenPart}`, timeoutMs);
        if (!payload) return null;

        return {
            isp: payload?.org || null,
            asName: payload?.org || null,
            geoCity: payload?.city || null,
            geoRegion: payload?.region || null,
            geoCountry: payload?.country || null,
            geoTimezone: payload?.timezone || null,
            ipApiSource: token ? 'ipinfo.io (token)' : 'ipinfo.io'
        };
    } catch {
        return null;
    }
}

class SiteManager {
    sites: Site[];
    whmSites: Site[];
    lastWhmSync: string | null;
    serverInfo: ServerInfo;

    constructor() {
        this.sites = [];
        this.whmSites = [];
        this.lastWhmSync = null;
        this.serverInfo = {
            host: WHM_CONFIG.host,
            ip: null,
            plan: process.env.WHM_SERVER_PLAN || 'VPS Linux',
            system: process.env.WHM_SERVER_SYSTEM || 'No disponible'
        };
        this.initManualSites();
    }

    initManualSites(): void {
        this.sites = MANUAL_SITES.map((site) => ({
            ...site,
            category: 'manual',
            priority: 'normal'
        }));
    }

    loadSitesFromFile(): void {
        try {
            if (!fs.existsSync('sites-config.json')) {
                return;
            }

            const data = JSON.parse(fs.readFileSync('sites-config.json', 'utf8'));

            if (Array.isArray(data.manualSites)) {
                this.sites = data.manualSites.map((site: Site) => ({
                    ...site,
                    category: site.category || 'manual',
                    priority: site.priority || 'normal'
                }));
            }

            if (Array.isArray(data.whmSites)) {
                this.whmSites = data.whmSites;
                this.lastWhmSync = data.lastWhmSync || null;
            }

            if (data && typeof data.serverInfo === 'object' && data.serverInfo) {
                this.serverInfo = {
                    host: String((data.serverInfo as any).host || WHM_CONFIG.host),
                    ip: (data.serverInfo as any).ip ? String((data.serverInfo as any).ip) : null,
                    plan: String((data.serverInfo as any).plan || this.serverInfo.plan),
                    system: String((data.serverInfo as any).system || this.serverInfo.system),
                    reverseDns: (data.serverInfo as any).reverseDns ? String((data.serverInfo as any).reverseDns) : null,
                    whoisOrg: (data.serverInfo as any).whoisOrg ? String((data.serverInfo as any).whoisOrg) : null,
                    whoisCountry: (data.serverInfo as any).whoisCountry ? String((data.serverInfo as any).whoisCountry) : null,
                    whoisNetName: (data.serverInfo as any).whoisNetName ? String((data.serverInfo as any).whoisNetName) : null,
                    whoisAsn: (data.serverInfo as any).whoisAsn ? String((data.serverInfo as any).whoisAsn) : null,
                    httpServer: (data.serverInfo as any).httpServer ? String((data.serverInfo as any).httpServer) : null,
                    osGuess: (data.serverInfo as any).osGuess ? String((data.serverInfo as any).osGuess) : null,
                    isp: (data.serverInfo as any).isp ? String((data.serverInfo as any).isp) : null,
                    asName: (data.serverInfo as any).asName ? String((data.serverInfo as any).asName) : null,
                    geoCity: (data.serverInfo as any).geoCity ? String((data.serverInfo as any).geoCity) : null,
                    geoRegion: (data.serverInfo as any).geoRegion ? String((data.serverInfo as any).geoRegion) : null,
                    geoCountry: (data.serverInfo as any).geoCountry ? String((data.serverInfo as any).geoCountry) : null,
                    geoTimezone: (data.serverInfo as any).geoTimezone ? String((data.serverInfo as any).geoTimezone) : null,
                    ipApiSource: (data.serverInfo as any).ipApiSource ? String((data.serverInfo as any).ipApiSource) : null,
                    probedAt: (data.serverInfo as any).probedAt ? String((data.serverInfo as any).probedAt) : undefined
                };
            }

            console.log(`Loaded ${this.sites.length} manual sites and ${this.whmSites.length} WHM sites`);
        } catch (error: any) {
            console.warn('Could not load previous site config, using defaults:', error.message);
            if (fs.existsSync('sites-config.json')) {
                const backupName = `sites-config.invalid-${Date.now()}.json`;
                fs.renameSync('sites-config.json', backupName);
                console.warn(`Corrupted sites-config.json moved to ${backupName}`);
            }
            this.initManualSites();
            this.whmSites = [];
            this.lastWhmSync = null;
        }
    }

    saveSitesConfig(): void {
        const config = {
            manualSites: this.sites,
            whmSites: this.whmSites,
            lastWhmSync: this.lastWhmSync,
            serverInfo: this.serverInfo,
            lastUpdate: new Date().toISOString()
        };

        fs.writeFileSync('sites-config.json', `${JSON.stringify(config, null, 2)}\n`);
    }

    async syncWithWHM(): Promise<boolean> {
        if (!WHM_CONFIG.enabled) {
            console.log('WHM sync disabled');
            return false;
        }

        try {
            console.log('Syncing with WHM...');
            whmExtractor.WHM_CONFIG.host = WHM_CONFIG.host;
            whmExtractor.WHM_CONFIG.port = WHM_CONFIG.port;
            whmExtractor.WHM_CONFIG.username = WHM_CONFIG.username;
            whmExtractor.WHM_CONFIG.apiToken = WHM_CONFIG.apiToken;

            const whmData = await whmExtractor.extractAccountsAndDomains();

            const filteredDomains = whmData.domains.filter((domain: any) => {
                if (WHM_CONFIG.filters.excludeSuspended && domain.status !== 'Activa') return false;
                if (WHM_CONFIG.filters.onlyMainDomains && domain.type !== 'principal') return false;
                if (WHM_CONFIG.filters.excludeSubdomains && domain.type === 'subdominio') return false;
                if (WHM_CONFIG.filters.excludeAddonDomains && domain.type === 'addon') return false;

                return !WHM_CONFIG.filters.excludePatterns.some((pattern) =>
                    domain.domain.toLowerCase().includes(pattern.toLowerCase())
                );
            });

            if (filteredDomains.length > 0) {
                const oldDatesByDomain = new Map<string, { expirationDate?: string; renewalDate?: string }>();
                this.whmSites.forEach((site) => {
                    if (site?.url && site?.whmInfo) {
                        oldDatesByDomain.set(String(site.url).toLowerCase(), {
                            expirationDate: (site.whmInfo as any).expirationDate,
                            renewalDate: (site.whmInfo as any).renewalDate
                        });
                    }
                });

                const rdapDomains = filteredDomains.filter((d: any) => d.type === 'principal');
                const rdapDateMap = new Map<string, { expirationDate: string | null; renewalDate: string | null }>();

                if (WHM_CONFIG.rdap.enabled && RDAP_CONFIG.enabled) {
                    const uniqueMainDomains = Array.from(new Set(rdapDomains.map((d: any) => String(d.domain).toLowerCase())));
                    const rdapResults = await mapWithConcurrency(
                        uniqueMainDomains,
                        WHM_CONFIG.rdap.concurrency,
                        async (domain) => ({ domain, dates: await getDomainDates(domain) })
                    );
                    rdapResults.forEach((item) => rdapDateMap.set(item.domain, item.dates));
                    console.log(`RDAP checked for ${uniqueMainDomains.length} main domains (cache-aware)`);
                }

                this.whmSites = filteredDomains.map((domain: any) => {
                    const url = `https://${domain.domain}`;
                    const key = url.toLowerCase();
                    const rdapDates = rdapDateMap.get(String(domain.domain).toLowerCase());
                    const previous = oldDatesByDomain.get(key);
                    const expirationDate = rdapDates?.expirationDate || previous?.expirationDate || undefined;
                    const renewalDate = rdapDates?.renewalDate || previous?.renewalDate || undefined;

                    return {
                        name: domain.domain,
                        url,
                        category: 'whm',
                        priority: 'normal',
                        whmInfo: {
                            type: domain.type,
                            username: domain.username,
                            status: domain.status,
                            expirationDate,
                            renewalDate,
                            mailAccountsCount: domain.mailAccountsCount ?? null
                        }
                    };
                });
            } else {
                console.warn('WHM returned 0 valid domains. Keeping previous WHM data.');
            }

            this.lastWhmSync = new Date().toISOString();
            await this.refreshServerInfo();
            this.saveSitesConfig();
            console.log(`WHM sync complete: ${this.whmSites.length} sites`);
            return true;
        } catch (error: any) {
            console.error('WHM sync failed:', error.message);
            return false;
        }
    }

    async refreshServerInfo(): Promise<void> {
        const host = WHM_CONFIG.host;
        this.serverInfo.host = host;
        this.serverInfo.plan = process.env.WHM_SERVER_PLAN || this.serverInfo.plan;
        this.serverInfo.system = process.env.WHM_SERVER_SYSTEM || this.serverInfo.system;

        try {
            const resolved = await lookup(host, { family: 4 });
            this.serverInfo.ip = resolved.address;
        } catch {
            try {
                const resolved = await lookup(host);
                this.serverInfo.ip = resolved.address;
            } catch {
                this.serverInfo.ip = null;
            }
        }

        if (!SERVER_PROBE_CONFIG.enabled) {
            this.serverInfo.probedAt = new Date().toISOString();
            return;
        }

        const reverseRaw = await runLinuxCommand(`getent hosts ${host} | awk '{print $2}' | head -n1`, SERVER_PROBE_CONFIG.timeoutMs);
        this.serverInfo.reverseDns = reverseRaw || null;

        const whmHeaders = await runLinuxCommand(`curl -kIs --max-time 8 https://${host}:${WHM_CONFIG.port} | tr -d '\\r'`, SERVER_PROBE_CONFIG.timeoutMs);
        this.serverInfo.httpServer = extractFirstMatch(whmHeaders, [/^server:\s*(.+)$/im]);

        if (this.serverInfo.ip && await commandExists('whois')) {
            const whoisOutput = await runLinuxCommand(`whois ${this.serverInfo.ip} | head -n 250`, SERVER_PROBE_CONFIG.timeoutMs);
            this.serverInfo.whoisOrg = extractFirstMatch(whoisOutput, [
                /^(?:OrgName|org-name|owner|Organization|descr)\s*:\s*(.+)$/im
            ]);
            this.serverInfo.whoisCountry = extractFirstMatch(whoisOutput, [
                /^(?:Country|country)\s*:\s*(.+)$/im
            ]);
            this.serverInfo.whoisNetName = extractFirstMatch(whoisOutput, [
                /^(?:NetName|netname)\s*:\s*(.+)$/im
            ]);
            this.serverInfo.whoisAsn = extractFirstMatch(whoisOutput, [
                /^(?:OriginAS|origin|originas|aut-num)\s*:\s*(AS\d+)$/im
            ]);
        } else {
            this.serverInfo.whoisOrg = null;
            this.serverInfo.whoisCountry = null;
            this.serverInfo.whoisNetName = null;
            this.serverInfo.whoisAsn = null;
        }

        if (this.serverInfo.ip && await commandExists('nmap')) {
            const nmapOutput = await runLinuxCommand(
                `nmap -O -Pn --osscan-limit --max-retries 1 --host-timeout 15s ${this.serverInfo.ip}`,
                SERVER_PROBE_CONFIG.timeoutMs
            );
            this.serverInfo.osGuess = extractFirstMatch(nmapOutput, [
                /^OS details:\s*(.+)$/im,
                /^Running:\s*(.+)$/im
            ]);
        } else {
            this.serverInfo.osGuess = null;
        }

        if (this.serverInfo.ip && SERVER_IP_ENRICHMENT_CONFIG.enabled) {
            let apiData: Partial<ServerInfo> | null = null;
            if (SERVER_IP_ENRICHMENT_CONFIG.ipWhoisEnabled) {
                apiData = await enrichFromIpWhoIs(this.serverInfo.ip, SERVER_IP_ENRICHMENT_CONFIG.timeoutMs);
            }

            if (!apiData && SERVER_IP_ENRICHMENT_CONFIG.ipInfoEnabled) {
                apiData = await enrichFromIpInfo(
                    this.serverInfo.ip,
                    SERVER_IP_ENRICHMENT_CONFIG.timeoutMs,
                    SERVER_IP_ENRICHMENT_CONFIG.ipInfoToken
                );
            }

            if (apiData) {
                this.serverInfo.isp = apiData.isp || this.serverInfo.isp || null;
                this.serverInfo.asName = apiData.asName || this.serverInfo.asName || null;
                this.serverInfo.whoisAsn = apiData.whoisAsn || this.serverInfo.whoisAsn || null;
                this.serverInfo.geoCity = apiData.geoCity || this.serverInfo.geoCity || null;
                this.serverInfo.geoRegion = apiData.geoRegion || this.serverInfo.geoRegion || null;
                this.serverInfo.geoCountry = apiData.geoCountry || this.serverInfo.geoCountry || null;
                this.serverInfo.geoTimezone = apiData.geoTimezone || this.serverInfo.geoTimezone || null;
                this.serverInfo.ipApiSource = apiData.ipApiSource || null;
            } else {
                this.serverInfo.ipApiSource = null;
            }
        } else {
            this.serverInfo.ipApiSource = null;
        }

        this.serverInfo.probedAt = new Date().toISOString();
    }

    getAllSites(): Site[] {
        return [...this.sites, ...this.whmSites];
    }

    getStats() {
        const allSites = this.getAllSites();
        return {
            total: allSites.length,
            manual: this.sites.length,
            whm: this.whmSites.length,
            byCategory: {
                externo: allSites.filter((s) => s.category === 'externo').length,
                whm: allSites.filter((s) => s.category === 'whm').length,
                api: allSites.filter((s) => s.category === 'api').length,
                cdn: allSites.filter((s) => s.category === 'cdn').length,
                manual: allSites.filter((s) => s.category === 'manual').length,
            },
            byPriority: {
                critical: allSites.filter((s) => s.priority === 'critical').length,
                high: allSites.filter((s) => s.priority === 'high').length,
                normal: allSites.filter((s) => s.priority === 'normal').length,
                low: allSites.filter((s) => s.priority === 'low').length,
            }
        };
    }
}

class IntegratedMonitor {
    siteManager: SiteManager;
    history: { checks: CheckResult[] };

    constructor() {
        this.siteManager = new SiteManager();
        this.history = { checks: [] };
        this.loadHistory();
    }

    loadHistory(): void {
        try {
            if (!fs.existsSync('status.json')) {
                return;
            }

            const data = JSON.parse(fs.readFileSync('status.json', 'utf8'));
            if (data && Array.isArray(data.checks)) {
                this.history = data;
            }
        } catch (error: any) {
            console.warn('Could not load previous history. Starting fresh:', error.message);
            this.history = { checks: [] };
        }
    }

    saveHistory(): void {
        fs.writeFileSync('status.json', `${JSON.stringify(this.history, null, 2)}\n`);
    }

    checkSiteOnce(site: Site): Promise<SiteResult> {
        return new Promise((resolve) => {
            try {
                const url = new URL(site.url);
                const client = url.protocol === 'https:' ? https : http;
                const startTime = Date.now();

                const options = {
                    hostname: url.hostname,
                    path: url.pathname + (url.search || ''),
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    timeout: MONITOR_CONFIG.timeout,
                    headers: { 'User-Agent': MONITOR_CONFIG.userAgent }
                };

                const request = client.get(options, (response: any) => {
                    response.resume();
                    const responseTime = Date.now() - startTime;
                    resolve({
                        ...site,
                        status: response.statusCode,
                        online: response.statusCode >= 200 && response.statusCode < 400,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        ssl: url.protocol === 'https:'
                    });
                });

                request.on('error', (error: Error) => {
                    resolve({
                        ...site,
                        status: 0,
                        online: false,
                        responseTime: -1,
                        timestamp: new Date().toISOString(),
                        error: error.message
                    });
                });

                request.setTimeout(MONITOR_CONFIG.timeout, () => {
                    request.destroy();
                    resolve({
                        ...site,
                        status: 0,
                        online: false,
                        responseTime: -1,
                        timestamp: new Date().toISOString(),
                        error: 'Timeout'
                    });
                });
            } catch (error: any) {
                resolve({
                    ...site,
                    status: 0,
                    online: false,
                    responseTime: -1,
                    timestamp: new Date().toISOString(),
                    error: `Invalid URL: ${error.message}`
                });
            }
        });
    }

    shouldRetry(result: SiteResult): boolean {
        return !result.online && (result.status === 0 || result.status >= 500);
    }

    async checkSite(site: Site): Promise<SiteResult> {
        let lastResult: SiteResult = {
            ...site,
            status: 0,
            online: false,
            responseTime: -1,
            timestamp: new Date().toISOString(),
            error: 'Unknown error',
            attempts: 1
        };

        for (let attempt = 0; attempt <= MONITOR_CONFIG.maxRetries; attempt += 1) {
            const result = await this.checkSiteOnce(site);
            lastResult = result;

            if (!this.shouldRetry(result) || attempt === MONITOR_CONFIG.maxRetries) {
                return {
                    ...result,
                    attempts: attempt + 1
                };
            }
        }

        return {
            ...lastResult,
            attempts: MONITOR_CONFIG.maxRetries + 1
        };
    }

    async checkAllSites(): Promise<SiteResult[]> {
        this.siteManager.loadSitesFromFile();
        await this.siteManager.refreshServerInfo();

        const shouldSync = !this.siteManager.lastWhmSync ||
            (Date.now() - new Date(this.siteManager.lastWhmSync).getTime()) > WHM_CONFIG.syncIntervalMs;

        if (shouldSync && WHM_CONFIG.enabled) {
            await this.siteManager.syncWithWHM();
        }
        this.siteManager.saveSitesConfig();

        const allSites = this.siteManager.getAllSites();
        console.log(`Checking ${allSites.length} sites...`);

        const results: SiteResult[] = [];
        for (let i = 0; i < allSites.length; i += MONITOR_CONFIG.parallelLimit) {
            const batch = allSites.slice(i, i + MONITOR_CONFIG.parallelLimit);
            const batchResults = await Promise.all(batch.map((site) => this.checkSite(site)));
            results.push(...batchResults);
            console.log(`Checked ${Math.min(i + MONITOR_CONFIG.parallelLimit, allSites.length)}/${allSites.length}`);
        }

        const checkResult: CheckResult = {
            timestamp: new Date().toISOString(),
            results,
            stats: this.siteManager.getStats()
        };

        this.history.checks.unshift(checkResult);
        if (this.history.checks.length > MONITOR_CONFIG.historyLimit) {
            this.history.checks = this.history.checks.slice(0, MONITOR_CONFIG.historyLimit);
        }

        this.saveHistory();
        if (OUTPUT_CONFIG.generateLegacyHtml) {
            this.generateStatusPage();
        }

        return results;
    }

    generateStatusPage(): void {
        const latestCheck = this.history.checks[0];
        if (!latestCheck || !latestCheck.results.length) {
            fs.writeFileSync('index.html', '<h1>No check data available yet</h1>\n');
            return;
        }

        const stats = latestCheck.stats;
        const uptime = this.calculateUptime();
        const onlineCount = latestCheck.results.filter((r) => r.online).length;
        const offlineCount = latestCheck.results.length - onlineCount;

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor Integrado - WHM + Sitios Manuales</title>
    <style>
        :root {
            --bg: #f4f6fb;
            --card: #ffffff;
            --text: #1f2937;
            --muted: #6b7280;
            --ok: #047857;
            --bad: #b91c1c;
            --border: #e5e7eb;
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: "Segoe UI", Tahoma, sans-serif;
            background: linear-gradient(180deg, #eef2ff 0%, var(--bg) 100%);
            color: var(--text);
            padding: 24px;
        }

        .container {
            max-width: 1100px;
            margin: 0 auto;
        }

        .header {
            margin-bottom: 16px;
        }

        .header h1 {
            margin: 0;
            font-size: 28px;
        }

        .header p,
        .sync-info,
        .last-updated {
            color: var(--muted);
        }

        .sync-info,
        .last-updated {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 12px 14px;
            margin-bottom: 14px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }

        .stat-card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px;
        }

        .stat-number {
            font-size: 30px;
            font-weight: 700;
            line-height: 1;
            margin-bottom: 6px;
        }

        .stat-label {
            color: var(--muted);
            font-size: 14px;
        }

        .category-section {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px;
            margin-bottom: 12px;
        }

        .category-title {
            font-weight: 700;
            margin-bottom: 10px;
        }

        .sites-grid {
            display: grid;
            gap: 10px;
        }

        .site-card {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px;
        }

        .site-name {
            font-weight: 600;
        }

        .site-url,
        .site-meta {
            color: var(--muted);
            font-size: 13px;
            word-break: break-all;
        }

        .status {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
        }

        .status.online {
            background: #d1fae5;
            color: var(--ok);
        }

        .status.offline {
            background: #fee2e2;
            color: var(--bad);
        }

        .response-time,
        .attempts {
            display: block;
            margin-top: 4px;
            font-size: 12px;
            color: var(--muted);
            text-align: right;
        }

        @media (max-width: 680px) {
            body { padding: 14px; }
            .site-card {
                flex-direction: column;
                align-items: flex-start;
            }
            .response-time,
            .attempts {
                text-align: left;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Monitor Integrado</h1>
            <p>Monitoreo de sitios manuales + cuentas WHM</p>
        </div>

        <div class="sync-info">
            <strong>Ultima sincronizacion WHM:</strong> ${this.siteManager.lastWhmSync ?
                new Date(this.siteManager.lastWhmSync).toLocaleString('es-ES') : 'Nunca'} |
            <strong>Total de sitios:</strong> ${latestCheck.results.length}
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${onlineCount}</div>
                <div class="stat-label">Online</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${offlineCount}</div>
                <div class="stat-label">Offline</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.manual}</div>
                <div class="stat-label">Manuales</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.whm}</div>
                <div class="stat-label">WHM</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${uptime}%</div>
                <div class="stat-label">Uptime historico</div>
            </div>
        </div>

        ${this.generateCategorySections(latestCheck.results)}

        <div class="last-updated">
            <p><strong>Ultima actualizacion:</strong> ${new Date(latestCheck.timestamp).toLocaleString('es-ES')}</p>
            <p>Actualizacion automatica cada 5 minutos (GitHub Actions)</p>
        </div>
    </div>
</body>
</html>`;

        fs.writeFileSync('index.html', `${html}\n`);
    }

    generateCategorySections(results: SiteResult[]): string {
        const categories: Record<string, { title: string; sites: SiteResult[] }> = {
            critical: { title: 'Criticos', sites: [] },
            high: { title: 'Alta prioridad', sites: [] },
            whm: { title: 'Sitios WHM', sites: [] },
            externo: { title: 'Externos', sites: [] },
            normal: { title: 'Normales', sites: [] }
        };

        results.forEach((site) => {
            if (site.priority === 'critical') {
                categories.critical.sites.push(site);
            } else if (site.priority === 'high') {
                categories.high.sites.push(site);
            } else if (site.category === 'whm') {
                categories.whm.sites.push(site);
            } else if (site.category === 'externo') {
                categories.externo.sites.push(site);
            } else {
                categories.normal.sites.push(site);
            }
        });

        return Object.values(categories)
            .filter((cat) => cat.sites.length > 0)
            .map((cat) => `
                <div class="category-section">
                    <div class="category-title">${escapeHtml(cat.title)} (${cat.sites.length})</div>
                    <div class="sites-grid">
                        ${cat.sites.map((site) => `
                            <div class="site-card">
                                <div class="site-info">
                                    <div class="site-name">${escapeHtml(site.name)}</div>
                                    <div class="site-url">${escapeHtml(site.url)}</div>
                                    ${site.whmInfo ? `<div class="site-meta">WHM: ${escapeHtml(site.whmInfo.username)} (${escapeHtml(site.whmInfo.type)})</div>` : ''}
                                    ${site.error ? `<div class="site-meta">Error: ${escapeHtml(site.error)}</div>` : ''}
                                </div>
                                <div>
                                    <span class="status ${site.online ? 'online' : 'offline'}">
                                        ${site.online ? 'Online' : 'Offline'}
                                    </span>
                                    ${site.online ? `<span class="response-time">${site.responseTime}ms</span>` : ''}
                                    <span class="attempts">Intentos: ${site.attempts || 1}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
    }

    calculateUptime(): number {
        if (!this.history.checks.length) return 0;

        let totalChecks = 0;
        let totalOnline = 0;

        this.history.checks.forEach((check) => {
            totalChecks += check.results.length;
            totalOnline += check.results.filter((r) => r.online).length;
        });

        return totalChecks ? Math.round((totalOnline / totalChecks) * 100) : 0;
    }
}

async function main(): Promise<void> {
    console.log('Starting monitor...');
    console.log('WHM token:', process.env.WHM_API_TOKEN ? 'PRESENT' : 'MISSING');

    const monitor = new IntegratedMonitor();

    try {
        const results = await monitor.checkAllSites();
        const online = results.filter((r) => r.online).length;
        const offline = results.length - online;
        const stats = monitor.siteManager.getStats();

        console.log('\nSummary:');
        console.log(`Online: ${online}`);
        console.log(`Offline: ${offline}`);
        console.log(`Manual: ${stats.manual}`);
        console.log(`WHM: ${stats.whm}`);
        console.log(`Last WHM sync: ${monitor.siteManager.lastWhmSync || 'Never'}`);
        console.log(`Legacy HTML: ${OUTPUT_CONFIG.generateLegacyHtml ? 'ENABLED' : 'DISABLED'}`);

        if (offline > 0) {
            console.log('\nOffline sites:');
            results.filter((site) => !site.online).forEach((site) => {
                console.log(`- ${site.name}: ${site.error || `HTTP ${site.status}`}`);
            });
        }

        console.log('\nMonitor run finished successfully.');
    } catch (error) {
        console.error('Monitor failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { IntegratedMonitor, SiteManager, WHM_CONFIG, MONITOR_CONFIG };
