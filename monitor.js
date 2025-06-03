const fs = require('fs');
const https = require('https');
const http = require('http');

// ===========================================
// CONFIGURACIÓN
// ===========================================

// Sitios agregados manualmente (se mantienen siempre)
const MANUAL_SITES = [
  { name: 'Smartbox Brasil', url: 'https://smartboxbrasil.com.br' },
  { name: 'Tecnuv', url: 'https://tecnuv.com.br' },
  { name: 'Postogestor', url: 'https://postogestor.com.br' },
  { name: 'Epsy', url: 'https://epsy.com.br' },
];

// Configuración de WHM (opcional - para auto-sync)
const WHM_CONFIG = {
  enabled: true, // Cambiar a false para desactivar sync con WHM
  host: 'servolam.olamulticom.com.br',
  port: 2087,
  username: 'root',
  apiToken: process.env.WHM_API_TOKEN,
  // Filtros para sitios de WHM
  filters: {
    excludeSuspended: true,        // Excluir cuentas suspendidas
    excludeSubdomains: false,      // Incluir subdominios
    excludeAddonDomains: false,    // Incluir dominios addon
    onlyMainDomains: false,        // Solo dominios principales
    excludePatterns: [             // Excluir dominios que contengan:
      'cpanel.',
      'webmail.',
      'mail.',
      'ftp.',
      'autodiscover.'
    ]
  }
};

// Configuración del monitor
const MONITOR_CONFIG = {
  timeout: 10000,           // Timeout en milisegundos
  userAgent: 'Website-Monitor/1.0',
  maxRetries: 2,           // Reintentos para sitios fallidos
  parallelLimit: 10,       // Máximo sitios en paralelo
  updateInterval: 300000,  // Auto-update cada 5 minutos (300000ms)
};

// ===========================================
// GESTIÓN DE SITIOS
// ===========================================

class SiteManager {
  constructor() {
    this.sites = [...MANUAL_SITES];
    this.whmSites = [];
    this.lastWhmSync = null;
  }

  // Cargar sitios desde archivo local
  loadSitesFromFile() {
    try {
      if (fs.existsSync('sites-config.json')) {
        const data = JSON.parse(fs.readFileSync('sites-config.json', 'utf8'));
        if (data.manualSites) {
          this.sites = [...data.manualSites];
        }
        if (data.whmSites) {
          this.whmSites = data.whmSites;
          this.lastWhmSync = data.lastWhmSync;
        }
        console.log(`📁 Cargados ${this.sites.length} sitios manuales y ${this.whmSites.length} de WHM`);
      }
    } catch (error) {
      console.log('⚠️ No se pudo cargar configuración previa, usando configuración por defecto');
    }
  }

  // Guardar configuración actual
  saveSitesConfig() {
    const config = {
      manualSites: this.sites,
      whmSites: this.whmSites,
      lastWhmSync: this.lastWhmSync,
      lastUpdate: new Date().toISOString()
    };
    fs.writeFileSync('sites-config.json', JSON.stringify(config, null, 2));
  }

  // Sincronizar con WHM
  async syncWithWHM() {
    if (!WHM_CONFIG.enabled) {
      console.log('🔄 Sync con WHM desactivado');
      return false;
    }

    try {
      console.log('🔄 Sincronizando con WHM...');
      const whmExtractor = require('./whm-extractor');
      
      // Configurar WHM extractor
      whmExtractor.WHM_CONFIG.host = WHM_CONFIG.host;
      whmExtractor.WHM_CONFIG.port = WHM_CONFIG.port;
      whmExtractor.WHM_CONFIG.username = WHM_CONFIG.username;
      whmExtractor.WHM_CONFIG.apiToken = WHM_CONFIG.apiToken;

      const whmData = await whmExtractor.extractAccountsAndDomains();
      
      // Filtrar dominios según configuración
      const filteredDomains = whmData.domains.filter(domain => {
        // Excluir suspendidas
        if (WHM_CONFIG.filters.excludeSuspended && domain.status !== 'Activa') {
          return false;
        }

        // Filtrar por tipo
        if (WHM_CONFIG.filters.onlyMainDomains && domain.type !== 'principal') {
          return false;
        }
        if (WHM_CONFIG.filters.excludeSubdomains && domain.type === 'subdominio') {
          return false;
        }
        if (WHM_CONFIG.filters.excludeAddonDomains && domain.type === 'addon') {
          return false;
        }

        // Excluir patrones
        return !WHM_CONFIG.filters.excludePatterns.some(pattern => 
          domain.domain.toLowerCase().includes(pattern.toLowerCase())
        );
      });

      // Convertir a formato de sitios
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

      this.lastWhmSync = new Date().toISOString();
      console.log(`✅ Sincronizados ${this.whmSites.length} sitios de WHM`);
      
      // Guardar configuración
      this.saveSitesConfig();
      return true;

    } catch (error) {
      console.error('❌ Error sincronizando con WHM:', error.message);
      return false;
    }
  }

  // Obtener todos los sitios (manuales + WHM)
  getAllSites() {
    return [...this.sites, ...this.whmSites];
  }

  // Obtener sitios por categoría
  getSitesByCategory(category) {
    return this.getAllSites().filter(site => site.category === category);
  }

  // Obtener sitios por prioridad
  getSitesByPriority(priority) {
    return this.getAllSites().filter(site => site.priority === priority);
  }

  // Agregar sitio manual
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

  // Remover sitio manual
  removeManualSite(name) {
    this.sites = this.sites.filter(site => site.name !== name);
    this.saveSitesConfig();
    console.log(`➖ Removido sitio manual: ${name}`);
  }

  // Estadísticas
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

  // Cargar historial
  loadHistory() {
    try {
      if (fs.existsSync('status.json')) {
        const data = fs.readFileSync('status.json', 'utf8');
        this.history = JSON.parse(data);
      }
    } catch (error) {
      console.log('⚠️ No se pudo cargar historial previo');
    }
  }

  // Guardar historial
  saveHistory() {
    fs.writeFileSync('status.json', JSON.stringify(this.history, null, 2));
  }

  // Verificar un sitio
  async checkSite(site) {
    return new Promise((resolve) => {
      const url = new URL(site.url);
      const client = url.protocol === 'https:' ? https : http;
      
      const startTime = Date.now();
      
      const options = {
        ...url,
        timeout: MONITOR_CONFIG.timeout,
        headers: {
          'User-Agent': MONITOR_CONFIG.userAgent
        }
      };

      const request = client.get(options, (response) => {
        const responseTime = Date.now() - startTime;
        const status = response.statusCode;
        
        resolve({
          ...site,
          status: status,
          online: status >= 200 && status < 400,
          responseTime: responseTime,
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
    });
  }

  // Verificar todos los sitios
  async checkAllSites() {
    await this.siteManager.loadSitesFromFile();
    
    // Auto-sync con WHM si es necesario
    const shouldSync = !this.siteManager.lastWhmSync || 
      (Date.now() - new Date(this.siteManager.lastWhmSync).getTime()) > (60 * 60 * 1000); // 1 hora

    if (shouldSync && WHM_CONFIG.enabled) {
      await this.siteManager.syncWithWHM();
    }

    const allSites = this.siteManager.getAllSites();
    console.log(`🔍 Verificando ${allSites.length} sitios...`);

    // Verificar sitios en lotes para no sobrecargar
    const results = [];
    const batchSize = MONITOR_CONFIG.parallelLimit;
    
    for (let i = 0; i < allSites.length; i += batchSize) {
      const batch = allSites.slice(i, i + batchSize);
      const batchPromises = batch.map(site => this.checkSite(site));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Mostrar progreso
      console.log(`📊 Verificados ${Math.min(i + batchSize, allSites.length)}/${allSites.length} sitios`);
    }

    // Agregar verificación al historial
    const checkResult = {
      timestamp: new Date().toISOString(),
      results: results,
      stats: this.siteManager.getStats()
    };
    
    this.history.checks.unshift(checkResult);
    
    // Mantener solo las últimas 100 verificaciones
    if (this.history.checks.length > 100) {
      this.history.checks = this.history.checks.slice(0, 100);
    }
    
    this.saveHistory();
    this.generateStatusPage();
    
    return results;
  }

  // Generar página de status mejorada
  generateStatusPage() {
    const latestCheck = this.history.checks[0];
    if (!latestCheck) return;

    const stats = latestCheck.stats;
    const uptime = this.calculateUptime();

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor Integrado - WHM + Sitios Manuales</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        .header {
            text-align: center;
            margin-bottom: 30px;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            padding: 30px;
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .header h1 { 
            font-size: 2.5rem; 
            background: linear-gradient(45deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }
        .stat-card:hover { transform: translateY(-5px); }
        .stat-number { 
            font-size: 2.5rem; 
            font-weight: 700; 
            background: linear-gradient(45deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stat-label { color: #666; margin-top: 8px; font-weight: 500; }
        
        .category-section {
            margin-bottom: 30px;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .category-title {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .category-critical { border-left: 4px solid #dc3545; }
        .category-high { border-left: 4px solid #fd7e14; }
        .category-normal { border-left: 4px solid #28a745; }
        .category-whm { border-left: 4px solid #6f42c1; }
        .category-external { border-left: 4px solid #17a2b8; }
        
        .sites-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 15px;
        }
        .site-card {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: rgba(255,255,255,0.7);
            border-radius: 10px;
            transition: all 0.3s ease;
        }
        .site-card:hover { 
            background: rgba(255,255,255,0.9);
            transform: translateX(5px);
        }
        .site-info { flex-grow: 1; }
        .site-name { font-weight: 600; font-size: 16px; }
        .site-url { color: #666; font-size: 13px; margin-top: 3px; }
        .site-meta { color: #888; font-size: 12px; margin-top: 2px; }
        .status {
            padding: 6px 12px;
            border-radius: 15px;
            font-weight: 600;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .online { background: #d4edda; color: #155724; }
        .offline { background: #f8d7da; color: #721c24; }
        .response-time { 
            margin-left: 10px; 
            color: #666; 
            font-size: 12px;
            background: #f8f9fa;
            padding: 4px 8px;
            border-radius: 8px;
        }
        
        .last-updated {
            text-align: center;
            color: rgba(255,255,255,0.8);
            margin-top: 30px;
            padding: 20px;
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
        }
        
        .sync-info {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            color: rgba(255,255,255,0.9);
            text-align: center;
        }
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

  // Generar secciones por categoría
  generateCategorySections(results) {
    const categories = {
      critical: { title: '🚨 Críticos', sites: [], class: 'category-critical' },
      high: { title: '⚡ Alta Prioridad', sites: [], class: 'category-high' },
      whm: { title: '🌐 Sitios WHM', sites: [], class: 'category-whm' },
      externo: { title: '🔗 Externos', sites: [], class: 'category-external' },
      normal: { title: '📋 Normales', sites: [], class: 'category-normal' }
    };

    // Agrupar sitios por categoría/prioridad
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

  // Calcular uptime
  calculateUptime() {
    if (!this.history.checks || this.history.checks.length === 0) return 0;
    
    const totalChecks = this.history.checks.reduce((sum, check) => sum + check.results.length, 0);
    const totalOnline = this.history.checks.reduce((sum, check) => {
      return sum + check.results.filter(r => r.online).length;
    }, 0);
    
    return totalChecks > 0 ? Math.round((totalOnline / totalChecks) * 100) : 0;
  }
}

// ===========================================
// EJECUCIÓN PRINCIPAL
// ===========================================

async function main() {
  console.log('🚀 Iniciando Monitor Integrado...\n');
  
  const monitor = new IntegratedMonitor();
  
  try {
    const results = await monitor.checkAllSites();
    
    // Mostrar resumen
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
    
    // Mostrar sitios offline
    const offlineSites = results.filter(r => !r.online);
    if (offlineSites.length > 0) {
      console.log('\n🚨 SITIOS OFFLINE:');
      offlineSites.forEach(site => {
        console.log(`   ❌ ${site.name} - ${site.error || 'Error desconocido'}`);
      });
    }
    
    console.log('\n✨ Monitor completado exitosamente!');
    
  } catch (error) {
    console.error('💥 Error durante el monitoreo:', error.message);
    process.exit(1);
  }
}

// Ejecutar solo si el archivo se ejecuta directamente
if (require.main === module) {
  main();
}

module.exports = { IntegratedMonitor, SiteManager };