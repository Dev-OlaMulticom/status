const https = require('https');
require('dotenv').config();

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
}

interface WHMRequestResponse {
    data?: any[];
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
}

interface AccountInfo {
    username: string;
    domains: string[];
    suspended: boolean;
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
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (WHM Monitor)'
                },
                rejectUnauthorized: WHM_CONFIG.rejectUnauthorized,
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

async function extractAccountsAndDomains(): Promise<ExtractResult> {
    try {
        console.log('🔗 Conectando com WHM...');
        const response = await makeWHMRequest('get_domain_info');

        if (!response.data) {
            console.warn('⚠️ Nenhum dado retornado do WHM');
            return { domains: [], accounts: [] };
        }

        const domains: DomainInfo[] = [];
        const accounts = new Map<string, AccountInfo>();

        if (Array.isArray(response.data)) {
            response.data.forEach((item: any) => {
                if (item.domain) {
                    const domainInfo: DomainInfo = {
                        domain: item.domain,
                        username: item.user || item.username || 'unknown',
                        status: item.suspended ? 'Suspensa' : 'Activa',
                        type: identifyDomainType(item),
                        mainDomain: item.main_domain || item.domain,
                        ip: item.ip || 'N/A',
                        addon: item.addon === 1 || item.addon === true,
                        subdomain: item.type === 'sub' || item.sub_domain === 1,
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
    if (domainData.addon === 1 || domainData.addon === true) {
        return 'addon';
    }
    if (domainData.type === 'sub' || domainData.sub_domain === 1 || domainData.sub_domain === true) {
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

        await makeWHMRequest('get_domain_info');
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
