const fs = require('fs');
const https = require('https');
const http = require('http');

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection:', reason);
    process.exit(254);
});
  
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    process.exit(254);
});

// ===========================================
// CONFIGURACIÓN
// ===========================================

const MANUAL_SITES = [
    { name: 'Smartbox Brasil', url: 'https://smartboxbrasil.com.br' },
    { name: 'Tecnuv', url: 'https://tecnuv.com.br' },
    { name: 'Postogestor', url: 'https://postogestor.com.br' },
    { name: 'Epsy', url: 'https://epsy.com.br' },
];

const WHM_CONFIG = {
    enabled: true,
    host: 'servolam.olamulticom.com.br',
    port: 2087,
    username: 'root',
    apiToken: process.env.WHM_API_TOKEN,
    filters: {
        excludeSuspended: true,
        excludeSubdomains: false,
        excludeAddonDomains: false,
        onlyMainDomains: false,
        excludePatterns: [
            'cpanel.',
            'webmail.',
            'mail.',
            'ftp.',
            'autodiscover.'
        ]
    }
};

const MONITOR_CONFIG = {
    timeout: 10000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91 Safari/537.36',
    maxRetries: 2,
    parallelLimit: 10,
    updateInterval: 300000,
};

// ===========================================
// GESTIÓN DE SITIOS
// ===========================================

class SiteManager {
    constructor() {
        this.sites = [];
        this.whmSites = [];
        this.lastWhmSync = null;
        this.initManualSites();
    }

    initManualSites() {
        this.sites = MANUAL_SITES.map(site => ({
            ...site,
            category: 'manual',
            priority: 'normal'
        }));
    }

    loadSitesFromFile() {
        try {
            if (fs.existsSync('sites-config.json')) {
                const data = JSON.parse(fs.readFileSync('sites-config.json', 'utf8'));
                
                if (data.manualSites) {
                    this.sites = data.manualSites.map(site => ({
                        ...site,
                        category: site.category || 'manual',
                        priority: site.priority || 'normal'
                    }));
                }
                
                if (data.whmSites) {
                    this.whmSites = data.whmSites;
                    this.lastWhmSync = data.lastWhmSync;
                }
                
                console.log(`📁 Cargados ${this.sites.length} sitios manuales y ${this.whmSites.length} de WHM`);
            }
        } catch (error) {
            console.log('⚠️ No se pudo cargar configuración previa, usando configuración por defecto');
            if (fs.existsSync('sites-config.json')) {
                fs.unlinkSync('sites-config.json');
            }
            this.initManualSites();
        }
    }

    saveSitesConfig() {
        const config = {
            manualSites: this.sites,
            whmSites: this.whmSites,
            lastWhmSync: this.lastWhmSync,
            lastUpdate: new Date().toISOString()
        };
        fs.writeFileSync('sites-config.json', JSON.stringify(config, null, 2));
    }

    async syncWithWHM() {
        if (!WHM_CONFIG.enabled) {
            console.log('🔄 Sync con WHM desactivado');
            return false;
        }

        try {
            console.log('🔄 Sincronizando con WHM...');
            const whmExtractor = require('./whm-extractor');
            
            whmExtractor.WHM_CONFIG.host = WHM_CONFIG.host;
            whmExtractor.WHM_CONFIG.port = WHM_CONFIG.port;
            whmExtractor.WHM_CONFIG.username = WHM_CONFIG.username;
            whmExtractor.WHM_CONFIG.apiToken = WHM_CONFIG.apiToken;

            const whmData = await whmExtractor.extractAccountsAndDomains();
            
            const filteredDomains = whmData.domains.filter(domain => {
                if (WHM_CONFIG.filters.excludeSuspended && domain.status !== 'Activa') {
                    return false;
                }

                if (WHM_CONFIG.filters.onlyMainDomains && domain.type !== 'principal') {
                    return false;
                }
                if (WHM_CONFIG.filters.excludeSubdomains && domain.type === 'subdominio') {
                    return false;
                }
                if (WHM_CONFIG.filters.excludeAddonDomains && domain.type === 'addon') {
                    return false;
                }

                return !WHM_CONFIG.filters.excludePatterns.some(pattern => 
                    domain.domain.toLowerCase().includes(pattern.toLowerCase())
                );
            });

            if (filteredDomains.length > 0) {
                this.whmSites = filteredDomains.map(domain => ({
                    name: domain.domain,
                    url: `https://${domain.domain}`,
                    category: 'whm',
                    priority: 'normal',
                    whmInfo: {
                        type: domain.type,
                        username: domain.username,
                        status: domain.status
                    }
                }));
            } else {
                console.warn('⚠️ WHM no devolvió dominios. Se conservarán los datos anteriores.');
            }

            this.lastWhmSync = new Date().toISOString();
            console.log(`✅ Sincronizados ${this.whmSites.length} sitios de WHM`);
            
            this.saveSitesConfig();
            return true;

        } catch (error) {
            console.error('❌ Error sincronizando con WHM:', error.message);
            return false;
        }
    }

    getAllSites() {
        return [...this.sites, ...this.whmSites];
    }

    getSitesByCategory(category) {
        return this.getAllSites().filter(site => site.category === category);
    }

    getSitesByPriority(priority) {
        return this.getAllSites().filter(site => site.priority === priority);
    }

    addManualSite(site) {
        const newSite = {
            ...site,
            category: site.category || 'manual',
            priority: site.priority || 'normal'
        };
        this.sites.push(newSite);
        this.saveSitesConfig();
        console.log(`➕ Agregado sitio manual: ${site.name}`);
    }

    removeManualSite(name) {
        this.sites = this.sites.filter(site => site.name !== name);
        this.saveSitesConfig();
        console.log(`➖ Removido sitio manual: ${name}`);
    }

    getStats() {
        const allSites = this.getAllSites();
        return {
            total: allSites.length,
            manual: this.sites.length,
            whm: this.whmSites.length,
            byCategory: {
                externo: allSites.filter(s => s.category === 'externo').length,
                whm: allSites.filter(s => s.category === 'whm').length,
                api: allSites.filter(s => s.category === 'api').length,
                cdn: allSites.filter(s => s.category === 'cdn').length,
                manual: allSites.filter(s => s.category === 'manual').length,
            },
            byPriority: {
                critical: allSites.filter(s => s.priority === 'critical').length,
                high: allSites.filter(s => s.priority === 'high').length,
                normal: allSites.filter(s => s.priority === 'normal').length,
                low: allSites.filter(s => s.priority === 'low').length,
            }
        };
    }
}

// ===========================================
// MONITOR INTEGRADO
// ===========================================

class IntegratedMonitor {
    constructor() {
        this.siteManager = new SiteManager();
        this.history = { checks: [] };
        this.loadHistory();
    }

    loadHistory() {
        try {
            if (fs.existsSync('status.json')) {
                this.history = JSON.parse(fs.readFileSync('status.json', 'utf8'));
            }
        } catch (error) {
            console.log('⚠️ No se pudo cargar historial previo');
        }
    }

    saveHistory() {
        fs.writeFileSync('status.json', JSON.stringify(this.history, null, 2));
    }

    async checkSite(site) {
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

                const request = client.get(options, (response) => {
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
                
                request.on('error', (error) => {
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

            } catch (error) {
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

    async checkAllSites() {
        await this.siteManager.loadSitesFromFile();
        
        const syncThreshold = 60 * 60 * 1000; // 1 hora
        const shouldSync = !this.siteManager.lastWhmSync || 
            (Date.now() - new Date(this.siteManager.lastWhmSync).getTime()) > syncThreshold;

        if (shouldSync && WHM_CONFIG.enabled) {
            await this.siteManager.syncWithWHM();
        }

        const allSites = this.siteManager.getAllSites();
        console.log(`🔍 Verificando ${allSites.length} sitios...`);

        const results = [];
        const batchSize = MONITOR_CONFIG.parallelLimit;
        
        for (let i = 0; i < allSites.length; i += batchSize) {
            const batch = allSites.slice(i, i + batchSize);
            const batchPromises = batch.map(site => this.checkSite(site));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            console.log(`📊 Verificados ${Math.min(i + batchSize, allSites.length)}/${allSites.length} sitios`);
        }

        const checkResult = {
            timestamp: new Date().toISOString(),
            results,
            stats: this.siteManager.getStats()
        };
        
        this.history.checks.unshift(checkResult);
        
        if (this.history.checks.length > 100) {
            this.history.checks = this.history.checks.slice(0, 100);
        }
        
        this.saveHistory();
        this.generateStatusPage();
        
        return results;
    }

    generateStatusPage() {
        const latestCheck = this.history.checks[0];
        if (!latestCheck || !latestCheck.results.length) {
            return fs.writeFileSync('index.html', '<h1>Sin datos de verificación aún</h1>');
        }

        const stats = latestCheck.stats;
        const uptime = this.calculateUptime();

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor Integrado - WHM + Sitios Manuales</title>
    <style>
        /* ... (estilos permanecen iguales) ... */
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Monitor Integrado</h1>
            <p>Monitoreo automático de sitios manuales + cuentas WHM</p>
        </div>
        
        <div class="sync-info">
            <strong>Última sincronización WHM:</strong> ${this.siteManager.lastWhmSync ? 
              new Date(this.siteManager.lastWhmSync).toLocaleString('es-ES') : 'Nunca'} |
            <strong>Total de sitios:</strong> ${latestCheck.results.length}
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${latestCheck.results.filter(r => r.online).length}</div>
                <div class="stat-label">✅ Online</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${latestCheck.results.filter(r => !r.online).length}</div>
                <div class="stat-label">❌ Offline</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.manual}</div>
                <div class="stat-label">📝 Manuales</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.whm}</div>
                <div class="stat-label">🌐 WHM</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${uptime}%</div>
                <div class="stat-label">📊 Uptime</div>
            </div>
        </div>
        
        ${this.generateCategorySections(latestCheck.results)}
        
        <div class="last-updated">
            <p><strong>Última actualización:</strong> ${new Date(latestCheck.timestamp).toLocaleString('es-ES')}</p>
            <p>Actualizaciones automáticas cada 5 minutos • Sync WHM cada hora</p>
        </div>
    </div>
</body>
</html>`;

        fs.writeFileSync('index.html', html);
    }

    generateCategorySections(results) {
        const categories = {
            critical: { title: '🚨 Críticos', sites: [], class: 'category-critical' },
            high: { title: '⚡ Alta Prioridad', sites: [], class: 'category-high' },
            whm: { title: '🌐 Sitios WHM', sites: [], class: 'category-whm' },
            externo: { title: '🔗 Externos', sites: [], class: 'category-external' },
            normal: { title: '📋 Normales', sites: [], class: 'category-normal' }
        };

        results.forEach(site => {
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
            .filter(cat => cat.sites.length > 0)
            .map(cat => `
                <div class="category-section ${cat.class}">
                    <div class="category-title">${cat.title} (${cat.sites.length})</div>
                    <div class="sites-grid">
                        ${cat.sites.map(site => `
                            <div class="site-card">
                                <div class="site-info">
                                    <div class="site-name">${site.name}</div>
                                    <div class="site-url">${site.url}</div>
                                    ${site.whmInfo ? `<div class="site-meta">WHM: ${site.whmInfo.username} (${site.whmInfo.type})</div>` : ''}
                                </div>
                                <div>
                                    <span class="status ${site.online ? 'online' : 'offline'}">
                                        ${site.online ? '✅' : '❌'} ${site.online ? 'Online' : 'Offline'}
                                    </span>
                                    ${site.online ? `<span class="response-time">${site.responseTime}ms</span>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
    }

    calculateUptime() {
        if (!this.history.checks.length) return 0;
        
        let totalChecks = 0;
        let totalOnline = 0;
        
        this.history.checks.forEach(check => {
            totalChecks += check.results.length;
            totalOnline += check.results.filter(r => r.online).length;
        });
        
        return totalChecks ? Math.round((totalOnline / totalChecks) * 100) : 0;
    }
}

// ===========================================
// EJECUCIÓN PRINCIPAL
// ===========================================

console.log("🔧 Iniciando monitor.js");
console.log("🔐 WHM_API_TOKEN:", process.env.WHM_API_TOKEN ? "PRESENTE" : "AUSENTE");

async function main() {
    console.log('🚀 Iniciando Monitor Integrado...\n');
    
    const monitor = new IntegratedMonitor();
    
    try {
        const results = await monitor.checkAllSites();
        const online = results.filter(r => r.online).length;
        const offline = results.filter(r => !r.online).length;
        const stats = monitor.siteManager.getStats();
        
        console.log('\n📊 RESUMEN:');
        console.log(`✅ Online: ${online}`);
        console.log(`❌ Offline: ${offline}`);
        console.log(`📝 Manuales: ${stats.manual}`);
        console.log(`🌐 WHM: ${stats.whm}`);
        console.log(`🔄 Última sync WHM: ${monitor.siteManager.lastWhmSync ? 
            new Date(monitor.siteManager.lastWhmSync).toLocaleString('es-ES') : 'Nunca'}`);
        
        const offlineSites = results.filter(r => !r.online);
        if (offlineSites.length) {
            console.log('\n🚨 SITIOS OFFLINE:');
            offlineSites.forEach(site => {
                console.log(`   ❌ ${site.name} - ${site.error || 'Error desconocido'}`);
            });
        }
        
        console.log('\n✨ Monitor completado exitosamente!');
        
    } catch (error) {
        console.error('💥 Error durante el monitoreo:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { IntegratedMonitor, SiteManager };
