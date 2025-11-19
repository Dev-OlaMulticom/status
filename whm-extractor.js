const https = require('https');

const WHM_CONFIG = {
    host: 'servolam.olamulticom.com.br',
    port: 2087,
    username: 'root',
    apiToken: process.env.WHM_API_TOKEN,
};

function makeWHMRequest(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        try {
            if (!WHM_CONFIG.apiToken) {
                return reject(new Error('WHM_API_TOKEN não configurado'));
            }

            const queryParams = new URLSearchParams({
                'api.version': '1',
                ...params
            });

            const path = `/json-api/${endpoint}?${queryParams.toString()}`;

            const options = {
                hostname: WHM_CONFIG.host,
                port: WHM_CONFIG.port,
                path: path,
                method: 'GET',
                headers: {
                    'Authorization': `WHM ${WHM_CONFIG.username}:${WHM_CONFIG.apiToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (WHM Monitor)'
                },
                rejectUnauthorized: false,
            };

            const request = https.get(options, (response) => {
                let data = '';

                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            const result = JSON.parse(data);
                            resolve(result);
                        } else {
                            reject(new Error(`WHM API Error: HTTP ${response.statusCode}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse WHM response: ${error.message}`));
                    }
                });
            });

            request.on('error', (error) => {
                reject(new Error(`WHM Request failed: ${error.message}`));
            });

            request.setTimeout(10000, () => {
                request.destroy();
                reject(new Error('WHM Request timeout'));
            });

        } catch (error) {
            reject(error);
        }
    });
}

async function extractAccountsAndDomains() {
    try {
        console.log('🔗 Conectando com WHM...');
        const response = await makeWHMRequest('get_domain_info');

        if (!response.data) {
            console.warn('⚠️ Nenhum dado retornado do WHM');
            return { domains: [], accounts: [] };
        }

        const domains = [];
        const accounts = new Map();

        if (Array.isArray(response.data)) {
            response.data.forEach((item) => {
                if (item.domain) {
                    const domainInfo = {
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
                        accounts.get(domainInfo.username).domains.push(domainInfo.domain);
                    }
                }
            });
        }

        console.log(`✅ Extraídos ${domains.length} domínios de ${accounts.size} contas`);

        return {
            domains: domains,
            accounts: Array.from(accounts.values()),
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Erro ao extrair dados do WHM:', error.message);
        throw error;
    }
}

function identifyDomainType(domainData) {
    if (domainData.addon === 1 || domainData.addon === true) {
        return 'addon';
    }
    if (domainData.type === 'sub' || domainData.sub_domain === 1 || domainData.sub_domain === true) {
        return 'subdominio';
    }
    return 'principal';
}

async function testConnection() {
    try {
        console.log('🧪 Testando conexão com WHM...');
        console.log(`   Host: ${WHM_CONFIG.host}:${WHM_CONFIG.port}`);
        console.log(`   Username: ${WHM_CONFIG.username}`);
        console.log(`   Token: ${WHM_CONFIG.apiToken ? '✓ Presente' : '✗ Ausente'}`);

        if (!WHM_CONFIG.apiToken) {
            console.error('❌ WHM_API_TOKEN não configurado!');
            return false;
        }

        const result = await makeWHMRequest('get_domain_info');
        console.log('✅ Conexão bem-sucedida!');
        return true;
    } catch (error) {
        console.error('❌ Erro na conexão:', error.message);
        return false;
    }
}

module.exports = {
    WHM_CONFIG,
    makeWHMRequest,
    extractAccountsAndDomains,
    identifyDomainType,
    testConnection
};
