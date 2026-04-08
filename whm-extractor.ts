const https = require('https');
require('dotenv').config();
import { getCachedOrFetch } from './api-cache';

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
    const value = process.env[name];
    if (value == null || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getEnvNumber(name: string, defaultValue: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

interface WHMConfig {
    host: string;
    port: number;
    username: string;
    apiToken?: string;
    timeout: number;
    rejectUnauthorized: boolean;
    family?: 4 | 6;
    cacheEnabled: boolean;
    cacheTtlMs: number;
    cacheStaleTtlMs: number;
    cacheCooldownBaseMs: number;
    cacheCooldownMaxMs: number;
    emailStatsEnabled: boolean;
    emailStatsConcurrency: number;
    emailStatsCacheTtlMs: number;
    emailStatsCacheStaleTtlMs: number;
    emailStatsCacheCooldownBaseMs: number;
    emailStatsCacheCooldownMaxMs: number;
}

interface WHMRequestResponse {
    data?: any[] | { domains?: any[] };
}

interface DomainInfo {
    domain: string;
    username: string;
    status: string;
    type: 'addon' | 'subdominio' | 'principal';
    mainDomain: string;
    ip: string;
    addon: boolean;
    subdomain: boolean;
    mailAccountsCount?: number | null;
}

interface AccountInfo {
    username: string;
    domains: string[];
    suspended: boolean;
    mailAccountsCount?: number | null;
}

interface ExtractResult {
    domains: DomainInfo[];
    accounts: AccountInfo[];
    timestamp?: string;
}

const WHM_CONFIG: WHMConfig = {
    host: process.env.WHM_HOST || 'servolam.olamulticom.com.br',
    port: getEnvNumber('WHM_PORT', 2087),
    username: process.env.WHM_USERNAME || 'root',
    apiToken: process.env.WHM_API_TOKEN,
    timeout: getEnvNumber('WHM_TIMEOUT_MS', 10000),
    rejectUnauthorized: getEnvBoolean('WHM_REJECT_UNAUTHORIZED', true),
    family: process.env.WHM_IP_FAMILY === '6' ? 6 : 4,
    cacheEnabled: getEnvBoolean('WHM_CACHE_ENABLED', true),
    cacheTtlMs: getEnvNumber('WHM_CACHE_TTL_MS', 45 * 60 * 1000),
    cacheStaleTtlMs: getEnvNumber('WHM_CACHE_STALE_TTL_MS', 24 * 60 * 60 * 1000),
    cacheCooldownBaseMs: getEnvNumber('WHM_CACHE_COOLDOWN_BASE_MS', 60 * 1000),
    cacheCooldownMaxMs: getEnvNumber('WHM_CACHE_COOLDOWN_MAX_MS', 30 * 60 * 1000),
    emailStatsEnabled: getEnvBoolean('WHM_EMAIL_STATS_ENABLED', true),
    emailStatsConcurrency: getEnvNumber('WHM_EMAIL_STATS_CONCURRENCY', 4),
    emailStatsCacheTtlMs: getEnvNumber('WHM_EMAIL_STATS_CACHE_TTL_MS', 6 * 60 * 60 * 1000),
    emailStatsCacheStaleTtlMs: getEnvNumber('WHM_EMAIL_STATS_CACHE_STALE_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    emailStatsCacheCooldownBaseMs: getEnvNumber('WHM_EMAIL_STATS_CACHE_COOLDOWN_BASE_MS', 2 * 60 * 1000),
    emailStatsCacheCooldownMaxMs: getEnvNumber('WHM_EMAIL_STATS_CACHE_COOLDOWN_MAX_MS', 60 * 60 * 1000),
};

function makeWHMRequest(endpoint: string, params: Record<string, string | number> = {}): Promise<WHMRequestResponse> {
    return new Promise((resolve, reject) => {
        try {
            if (!WHM_CONFIG.apiToken) {
                return reject(new Error('WHM_API_TOKEN não configurado'));
            }

            const queryParams = new URLSearchParams({
                'api.version': '1',
                ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
            });

            const path = `/json-api/${endpoint}?${queryParams.toString()}`;

            const options = {
                hostname: WHM_CONFIG.host,
                port: WHM_CONFIG.port,
                path,
                method: 'GET',
                headers: {
                    Authorization: `WHM ${WHM_CONFIG.username}:${WHM_CONFIG.apiToken}`,
                    'User-Agent': 'Mozilla/5.0 (WHM Monitor)'
                },
                rejectUnauthorized: WHM_CONFIG.rejectUnauthorized,
                family: WHM_CONFIG.family,
            };

            const request = https.get(options, (response: any) => {
                let data = '';

                response.on('data', (chunk: Buffer | string) => {
                    data += chunk;
                });

                response.on('end', () => {
                    clearTimeout(hardTimeout);
                    try {
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            resolve(JSON.parse(data));
                        } else {
                            reject(new Error(`WHM API Error: HTTP ${response.statusCode}`));
                        }
                    } catch (error: any) {
                        reject(new Error(`Failed to parse WHM response: ${error.message}`));
                    }
                });
            });

            request.on('error', (error: Error) => {
                clearTimeout(hardTimeout);
                reject(new Error(`WHM Request failed: ${error.message}`));
            });

            request.setTimeout(WHM_CONFIG.timeout, () => {
                request.destroy();
                clearTimeout(hardTimeout);
                reject(new Error('WHM Request timeout'));
            });

            const hardTimeout = setTimeout(() => {
                request.destroy(new Error('WHM hard timeout'));
            }, WHM_CONFIG.timeout + 1000);
        } catch (error) {
            reject(error);
        }
    });
}

async function makeWHMRequestCached(
    endpoint: string,
    params: Record<string, string | number> = {},
    options: { bypassCache?: boolean } = {}
): Promise<WHMRequestResponse> {
    if (!WHM_CONFIG.cacheEnabled || options.bypassCache) {
        return makeWHMRequest(endpoint, params);
    }

    const result = await getCachedOrFetch<WHMRequestResponse>({
        namespace: 'whm',
        keyParts: [WHM_CONFIG.host, WHM_CONFIG.port, WHM_CONFIG.username, endpoint, params],
        ttlMs: WHM_CONFIG.cacheTtlMs,
        staleTtlMs: WHM_CONFIG.cacheStaleTtlMs,
        cooldownBaseMs: WHM_CONFIG.cacheCooldownBaseMs,
        cooldownMaxMs: WHM_CONFIG.cacheCooldownMaxMs,
        fetcher: () => makeWHMRequest(endpoint, params)
    });

    if (result.source !== 'network') {
        console.log(`♻️ WHM cache hit (${result.source}) for ${endpoint}`);
    }

    return result.value;
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

function extractEmailEntries(payload: any): any[] {
    const candidates = [
        payload?.cpanelresult?.data,
        payload?.cpanelresult?.result?.data,
        payload?.cpanelresult?.result?.result?.data,
        payload?.data,
        payload?.result?.data
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return [];
}

async function getEmailAccountsCountForUser(username: string): Promise<number | null> {
    if (!username) return null;

    const result = await getCachedOrFetch<number | null>({
        namespace: 'whm',
        keyParts: ['email_accounts_count', WHM_CONFIG.host, WHM_CONFIG.username, username],
        ttlMs: WHM_CONFIG.emailStatsCacheTtlMs,
        staleTtlMs: WHM_CONFIG.emailStatsCacheStaleTtlMs,
        cooldownBaseMs: WHM_CONFIG.emailStatsCacheCooldownBaseMs,
        cooldownMaxMs: WHM_CONFIG.emailStatsCacheCooldownMaxMs,
        fetcher: async () => {
            const payload = await makeWHMRequest('cpanel', {
                cpanel_jsonapi_user: username,
                cpanel_jsonapi_apiversion: '2',
                cpanel_jsonapi_module: 'Email',
                cpanel_jsonapi_func: 'listpopswithdisk'
            });

            const entries = extractEmailEntries(payload);
            if (!entries.length) {
                return 0;
            }
            return entries.length;
        }
    });

    return result.value;
}

async function extractAccountsAndDomains(): Promise<ExtractResult> {
    try {
        console.log('🔗 Conectando com WHM...');
        const response = await makeWHMRequestCached('get_domain_info');

        if (!response.data) {
            console.warn('⚠️ Nenhum dado retornado do WHM');
            return { domains: [], accounts: [] };
        }

        const domains: DomainInfo[] = [];
        const accounts = new Map<string, AccountInfo>();
        const rawDomains = Array.isArray(response.data)
            ? response.data
            : Array.isArray(response.data.domains)
                ? response.data.domains
                : [];

        rawDomains.forEach((item: any) => {
            if (item.domain) {
                const domainInfo: DomainInfo = {
                    domain: item.domain,
                    username: item.user || item.username || 'unknown',
                    status: item.suspended ? 'Suspensa' : 'Activa',
                    type: identifyDomainType(item),
                    mainDomain: item.main_domain || item.parent_domain || item.domain,
                    ip: item.ip || item.ipv4 || 'N/A',
                    addon: item.addon === 1 || item.addon === true || item.domain_type === 'addon',
                    subdomain: item.type === 'sub' || item.sub_domain === 1 || item.domain_type === 'sub',
                };

                domains.push(domainInfo);

                if (domainInfo.username && !accounts.has(domainInfo.username)) {
                    accounts.set(domainInfo.username, {
                        username: domainInfo.username,
                        domains: [],
                        suspended: false
                    });
                }

                if (accounts.has(domainInfo.username)) {
                    accounts.get(domainInfo.username)?.domains.push(domainInfo.domain);
                }
            }
        });

        if (WHM_CONFIG.emailStatsEnabled && accounts.size > 0) {
            const usernames = Array.from(accounts.keys());
            const counts = await mapWithConcurrency(
                usernames,
                WHM_CONFIG.emailStatsConcurrency,
                async (username) => {
                    try {
                        return {
                            username,
                            count: await getEmailAccountsCountForUser(username)
                        };
                    } catch (error: any) {
                        console.warn(`⚠️ Email stats failed for ${username}: ${error.message}`);
                        return { username, count: null };
                    }
                }
            );

            const countByUser = new Map<string, number | null>();
            counts.forEach((item) => countByUser.set(item.username, item.count));

            accounts.forEach((account) => {
                account.mailAccountsCount = countByUser.get(account.username) ?? null;
            });

            domains.forEach((domain) => {
                domain.mailAccountsCount = countByUser.get(domain.username) ?? null;
            });
        }

        console.log(`✅ Extraídos ${domains.length} domínios de ${accounts.size} contas`);

        return {
            domains,
            accounts: Array.from(accounts.values()),
            timestamp: new Date().toISOString()
        };
    } catch (error: any) {
        console.error('❌ Erro ao extrair dados do WHM:', error.message);
        throw error;
    }
}

function identifyDomainType(domainData: any): 'addon' | 'subdominio' | 'principal' {
    if (domainData.addon === 1 || domainData.addon === true || domainData.domain_type === 'addon') {
        return 'addon';
    }
    if (
        domainData.type === 'sub'
        || domainData.sub_domain === 1
        || domainData.sub_domain === true
        || domainData.domain_type === 'sub'
    ) {
        return 'subdominio';
    }
    return 'principal';
}

async function testConnection(): Promise<boolean> {
    try {
        console.log('🧪 Testando conexão com WHM...');
        console.log(`   Host: ${WHM_CONFIG.host}:${WHM_CONFIG.port}`);
        console.log(`   Username: ${WHM_CONFIG.username}`);
        console.log(`   Token: ${WHM_CONFIG.apiToken ? '✓ Presente' : '✗ Ausente'}`);

        if (!WHM_CONFIG.apiToken) {
            console.error('❌ WHM_API_TOKEN não configurado!');
            return false;
        }

        await makeWHMRequestCached('get_domain_info', {}, { bypassCache: true });
        console.log('✅ Conexão bem-sucedida!');
        return true;
    } catch (error: any) {
        console.error('❌ Erro na conexão:', error.message);
        return false;
    }
}

export {
    WHM_CONFIG,
    makeWHMRequest,
    extractAccountsAndDomains,
    identifyDomainType,
    testConnection
};
