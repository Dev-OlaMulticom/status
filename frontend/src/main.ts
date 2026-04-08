import './style.css';

type WhmInfo = {
  type?: 'principal' | 'subdominio' | 'addon' | string;
  username?: string;
  status?: string;
  expirationDate?: string;
  expiresAt?: string;
  mailAccountsCount?: number | null;
};

type SiteResult = {
  name: string;
  url: string;
  online: boolean;
  responseTime: number;
  status: number;
  attempts?: number;
  error?: string;
  category?: string;
  whmInfo?: WhmInfo;
};

type SiteConfig = {
  name: string;
  url: string;
  category?: string;
  priority?: string;
  whmInfo?: WhmInfo;
};

type Check = {
  timestamp: string;
  results: SiteResult[];
};

type StatusData = {
  checks: Check[];
};

type SitesConfigData = {
  manualSites?: SiteConfig[];
  whmSites?: SiteConfig[];
  lastWhmSync?: string;
  serverInfo?: {
    host?: string;
    ip?: string | null;
    plan?: string;
    system?: string;
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
  };
};

type DomainRecord = {
  site: SiteResult;
  visits: number;
  uniqueVisits: number;
  type: 'main' | 'sub';
  account: string;
  subCount: number;
  expirationDate: string | null;
  mailAccountsCount: number | null;
};

type DomainRow = {
  site: DomainRecord;
  kind: 'parent' | 'child';
  parentKey?: string;
};

type AppState = {
  status: StatusData | null;
  config: SitesConfigData | null;
  rows: DomainRow[];
  search: string;
  statusFilter: 'all' | 'online' | 'offline';
  expanded: Set<string>;
  selectedYear: number;
  networkLatencyMs: number | null;
  networkOnline: boolean;
  lastProbeAt: number | null;
  rdapExpiryCache: Map<string, { expirationDate: string | null; fetchedAt: number }>;
  rdapPending: Set<string>;
  adminAvailable: boolean;
  adminBusy: boolean;
  adminMessage: string;
};

const appState: AppState = {
  status: null,
  config: null,
  rows: [],
  search: '',
  statusFilter: 'all',
  expanded: new Set<string>(),
  selectedYear: new Date().getFullYear(),
  networkLatencyMs: null,
  networkOnline: false,
  lastProbeAt: null,
  rdapExpiryCache: new Map(),
  rdapPending: new Set(),
  adminAvailable: false,
  adminBusy: false,
  adminMessage: ''
};

const RDAP_CACHE_KEY = 'olamulticom_rdap_expiry_v1';
const RDAP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RDAP_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const RDAP_CONCURRENCY = 2;
const rdapQueue: string[] = [];
let rdapWorkers = 0;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-ES').format(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso?: string): string {
  if (!iso) return 'Nunca';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Nunca';
  return d.toLocaleString('es-ES');
}

function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return '#';
  } catch {
    return '#';
  }
}

function scoreParentByAccount(hostname: string, account: string): number {
  const h = hostname.toLowerCase();
  const a = account.toLowerCase();
  if (!a || a.startsWith('manual:')) return 0;

  if (h === a || h.startsWith(`${a}.`) || h.includes(`.${a}.`)) return 1200;
  if (h.includes(a)) return 700;

  const baseToken = a.replace(/[^a-z0-9]/g, '');
  if (baseToken && h.replace(/[^a-z0-9]/g, '').includes(baseToken)) return 500;
  return 0;
}

function normalizeDateInput(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatShortDate(iso: string | null): string {
  if (!iso) return 'Sin dato';
  return new Date(iso).toLocaleDateString('es-ES');
}

function formatRemaining(iso: string | null): string {
  if (!iso) return 'Sin dato';
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return `Vencido hace ${Math.abs(days)} dias`;
  if (days === 0) return 'Vence hoy';
  return `Faltan ${days} dias`;
}

function isEligibleForRdap(domain: string): boolean {
  const d = domain.toLowerCase();
  return d.endsWith('.br') && !d.includes('cprapid.com');
}

function loadRdapCacheFromStorage(): void {
  try {
    const raw = localStorage.getItem(RDAP_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { expirationDate: string | null; fetchedAt: number }>;
    const now = Date.now();
    Object.entries(parsed).forEach(([domain, value]) => {
      const ttl = value.expirationDate ? RDAP_CACHE_TTL_MS : RDAP_NEGATIVE_TTL_MS;
      if (value.fetchedAt + ttl > now) {
        appState.rdapExpiryCache.set(domain, value);
      }
    });
  } catch {
    // Ignore malformed cache.
  }
}

function persistRdapCacheToStorage(): void {
  try {
    const obj = Object.fromEntries(appState.rdapExpiryCache.entries());
    localStorage.setItem(RDAP_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage errors.
  }
}

async function fetchRdapExpiration(domain: string): Promise<string | null> {
  const res = await fetch(`https://rdap.registro.br/domain/${encodeURIComponent(domain)}`, { cache: 'no-store' });
  if (!res.ok) {
    return null;
  }
  const payload = await res.json();
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const expirationEvent = events.find((e: any) => String(e?.eventAction || '').trim().toLowerCase() === 'expiration');
  const date = expirationEvent?.eventDate;
  return typeof date === 'string' ? date : null;
}

function getResolvedExpiration(record: DomainRecord): string | null {
  if (record.expirationDate) return record.expirationDate;
  const domain = getHostname(record.site.url).toLowerCase();
  return appState.rdapExpiryCache.get(domain)?.expirationDate ?? null;
}

function enqueueRdapLookup(domain: string): void {
  const d = domain.toLowerCase();
  if (!isEligibleForRdap(d)) return;
  if (appState.rdapExpiryCache.has(d) || appState.rdapPending.has(d) || rdapQueue.includes(d)) return;
  rdapQueue.push(d);
}

function prefetchRdapForExpandedParent(parentKey: string): void {
  const children = appState.rows.filter((row) => row.kind === 'child' && row.parentKey === parentKey);
  children.forEach((row) => {
    if (row.site.expirationDate) return;
    enqueueRdapLookup(getHostname(row.site.site.url));
  });
  processRdapQueue();
}

function processRdapQueue(): void {
  while (rdapWorkers < RDAP_CONCURRENCY && rdapQueue.length > 0) {
    const domain = rdapQueue.shift();
    if (!domain) break;
    rdapWorkers += 1;
    appState.rdapPending.add(domain);

    fetchRdapExpiration(domain)
      .then((expirationDate) => {
        appState.rdapExpiryCache.set(domain, {
          expirationDate,
          fetchedAt: Date.now()
        });
        persistRdapCacheToStorage();
      })
      .catch(() => {
        appState.rdapExpiryCache.set(domain, {
          expirationDate: null,
          fetchedAt: Date.now()
        });
        persistRdapCacheToStorage();
      })
      .finally(() => {
        appState.rdapPending.delete(domain);
        rdapWorkers -= 1;
        if (appState.status) renderMain();
        processRdapQueue();
      });
  }
}

async function loadStatus(): Promise<StatusData> {
  const res = await fetch('/status.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo leer status.json (${res.status})`);
  return (await res.json()) as StatusData;
}

async function checkAdminAvailability(): Promise<boolean> {
  try {
    const res = await fetch('/__admin/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadSitesConfig(): Promise<SitesConfigData | null> {
  const res = await fetch('/sites-config.json', { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as SitesConfigData;
}

function getYears(checks: Check[]): number[] {
  const years = new Set<number>();
  checks.forEach((c) => {
    const d = new Date(c.timestamp);
    if (!Number.isNaN(d.getTime())) years.add(d.getFullYear());
  });
  if (!years.size) years.add(new Date().getFullYear());
  return Array.from(years).sort((a, b) => b - a);
}

function getVisitsMap(checks: Check[], year: number): Map<string, { checks: number; online: number }> {
  const map = new Map<string, { checks: number; online: number }>();

  checks.forEach((c) => {
    const d = new Date(c.timestamp);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) return;

    c.results.forEach((r) => {
      const key = r.url.toLowerCase();
      const current = map.get(key) ?? { checks: 0, online: 0 };
      current.checks += 1;
      if (r.online) current.online += 1;
      map.set(key, current);
    });
  });

  return map;
}

function normalizeType(site: SiteResult): 'main' | 'sub' {
  return site.whmInfo?.type === 'principal' || site.category !== 'whm' ? 'main' : 'sub';
}

function buildMergedSites(status: StatusData, config: SitesConfigData | null): SiteResult[] {
  const latest = status.checks?.[0];
  const merged = new Map<string, SiteResult>();

  if (latest?.results?.length) {
    latest.results.forEach((site) => merged.set(site.url.toLowerCase(), site));
  }

  const allCatalog = [...(config?.manualSites ?? []), ...(config?.whmSites ?? [])];

  allCatalog.forEach((site) => {
    const key = site.url.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        name: site.name,
        url: site.url,
        online: false,
        responseTime: -1,
        status: -1,
        error: 'Sin verificacion reciente',
        category: site.category,
        whmInfo: site.whmInfo
      });
    }
  });

  return Array.from(merged.values());
}

function toDomainRecord(site: SiteResult, visitsMap: Map<string, { checks: number; online: number }>): DomainRecord {
  const key = site.url.toLowerCase();
  const stats = visitsMap.get(key) ?? { checks: 0, online: 0 };
  const visits = stats.checks;
  const uniqueVisits = stats.online;

  return {
    site,
    visits,
    uniqueVisits,
    type: normalizeType(site),
    account: site.whmInfo?.username || `manual:${site.name}`,
    subCount: 0,
    expirationDate: normalizeDateInput(
      site.whmInfo?.expirationDate || site.whmInfo?.expiresAt
    ),
    mailAccountsCount: site.whmInfo?.mailAccountsCount ?? null
  };
}

function buildRows(status: StatusData, config: SitesConfigData | null, year: number): DomainRow[] {
  const visitsMap = getVisitsMap(status.checks, year);
  const allSites = buildMergedSites(status, config).map((site) => toDomainRecord(site, visitsMap));

  const groups = new Map<string, DomainRecord[]>();
  allSites.forEach((record) => {
    const arr = groups.get(record.account) ?? [];
    arr.push(record);
    groups.set(record.account, arr);
  });

  const rows: DomainRow[] = [];

  Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, 'es')).forEach((account) => {
    const records = groups.get(account) ?? [];
    const mains = records.filter((r) => r.type === 'main').sort((a, b) => b.visits - a.visits);
    const sortedAll = [...records].sort((a, b) => b.visits - a.visits);

    if (!sortedAll.length) return;

    const chooseParent = (candidates: DomainRecord[]): DomainRecord => {
      return [...candidates].sort((a, b) => {
        const aHost = getHostname(a.site.url);
        const bHost = getHostname(b.site.url);
        const aMatch = scoreParentByAccount(aHost, account);
        const bMatch = scoreParentByAccount(bHost, account);
        if (aMatch !== bMatch) return bMatch - aMatch;
        const aPenalty = aHost.includes('cprapid.com') ? 1 : 0;
        const bPenalty = bHost.includes('cprapid.com') ? 1 : 0;
        if (aPenalty !== bPenalty) return aPenalty - bPenalty;
        const aDots = (aHost.match(/\./g) || []).length;
        const bDots = (bHost.match(/\./g) || []).length;
        if (aDots !== bDots) return aDots - bDots;
        if (aHost.length !== bHost.length) return aHost.length - bHost.length;
        return b.visits - a.visits;
      })[0];
    };

    const parent = mains.length ? chooseParent(mains) : chooseParent(sortedAll);
    const parentKey = parent.site.url.toLowerCase();
    const children = sortedAll.filter((record) => record.site.url.toLowerCase() !== parentKey);

    parent.subCount = children.length;
    rows.push({ site: parent, kind: 'parent' });
    children.forEach((child) => {
      if (child.mailAccountsCount == null && parent.mailAccountsCount != null) {
        child.mailAccountsCount = parent.mailAccountsCount;
      }
      rows.push({ site: child, kind: 'child', parentKey });
    });
  });

  return rows;
}

function getFilteredRows(rows: DomainRow[]): DomainRow[] {
  const query = appState.search.trim().toLowerCase();
  const parentVisible = new Set<string>();

  rows.forEach((row) => {
    const matchesQuery = !query
      || row.site.site.name.toLowerCase().includes(query)
      || row.site.site.url.toLowerCase().includes(query)
      || row.site.account.toLowerCase().includes(query);

    const matchesStatus = appState.statusFilter === 'all'
      || (appState.statusFilter === 'online' && row.site.site.online)
      || (appState.statusFilter === 'offline' && !row.site.site.online);

    if (matchesQuery && matchesStatus) {
      if (row.kind === 'parent') {
        parentVisible.add(row.site.site.url.toLowerCase());
      } else if (row.parentKey) {
        parentVisible.add(row.parentKey);
      }
    }
  });

  return rows.filter((row) => {
    if (row.kind === 'parent') {
      return parentVisible.has(row.site.site.url.toLowerCase());
    }

    if (!row.parentKey) return false;
    return parentVisible.has(row.parentKey) && appState.expanded.has(row.parentKey);
  });
}

function getUniqueRecords(rows: DomainRow[]): DomainRecord[] {
  const map = new Map<string, DomainRecord>();
  rows.forEach((row) => {
    map.set(row.site.site.url.toLowerCase(), row.site);
  });
  return Array.from(map.values());
}

function renderSidebar(rows: DomainRow[]): string {
  const parents = rows.filter((r) => r.kind === 'parent');
  const uniqueRecords = getUniqueRecords(rows);
  const mains = uniqueRecords.filter((r) => r.type === 'main').length;
  const subs = uniqueRecords.filter((r) => r.type === 'sub').length;
  const latencyLabel = appState.networkLatencyMs == null ? '--' : `${appState.networkLatencyMs}ms`;
  const networkStateLabel = appState.networkOnline ? 'Servidor online' : 'Servidor offline';
  const networkClass = appState.networkOnline ? 'ok' : 'bad';

  return `
    <aside class="left-panel">
      <div class="search-box">
        <input id="searchInput" type="text" placeholder="Buscar por dominio..." value="${escapeHtml(appState.search)}" />
      </div>
      <article class="metric-card">
        <div class="metric-label">Total de Dominios</div>
        <div class="metric-value">${formatNumber(mains)}</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Total de Subdominios</div>
        <div class="metric-value">${formatNumber(subs)}</div>
      </article>
      <article class="metric-card latency">
        <div class="metric-label">Latencia de Red</div>
        <div class="metric-value ${networkClass}">${latencyLabel}</div>
        <div class="metric-sub">${networkStateLabel}</div>
      </article>
    </aside>
  `;
}

function statusBadge(site: SiteResult): string {
  if (site.status < 0) return '<span class="badge unknown">Sin check</span>';
  return site.online
    ? '<span class="badge online">Online</span>'
    : '<span class="badge offline">Offline</span>';
}

function rowHtml(row: DomainRow, index: number): string {
  const parentKey = row.kind === 'parent' ? row.site.site.url.toLowerCase() : row.parentKey ?? '';
  const isExpanded = appState.expanded.has(parentKey);
  const canExpand = row.kind === 'parent' && row.site.subCount > 0;
  const hostname = getHostname(row.site.site.url);
  const safeUrl = sanitizeUrl(row.site.site.url);

  const resolvedExpiration = getResolvedExpiration(row.site);
  const mailCount = row.site.mailAccountsCount;
  const mailLabel = mailCount == null
    ? (row.site.site.category === 'whm' ? 'Sin permiso' : 'N/A')
    : formatNumber(mailCount);

  return `
    <tr class="${row.kind === 'child' ? 'child-row' : ''}">
      <td>${row.kind === 'parent' ? index + 1 : ''}</td>
      <td>
        <div class="domain-cell ${row.kind === 'child' ? 'is-child' : ''}">
          ${canExpand ? `<button class="toggle" data-toggle="${parentKey}">${isExpanded ? '▾' : '▸'}</button>` : '<span class="toggle placeholder"></span>'}
          <div>
            <div class="domain-name">${escapeHtml(hostname)}</div>
            ${row.kind === 'parent' && row.site.subCount > 0 ? `<div class="domain-sub">+${row.site.subCount} dominios/subdominios en la cuenta</div>` : ''}
          </div>
        </div>
      </td>
      <td>${statusBadge(row.site.site)}</td>
      <td>
        <div class="date-main">${formatShortDate(resolvedExpiration)}</div>
        <div class="date-sub">${formatRemaining(resolvedExpiration)}</div>
      </td>
      <td>
        <div class="visit-main">${formatNumber(row.site.visits)}</div>
        <div class="visit-sub">${formatNumber(row.site.uniqueVisits)} online</div>
      </td>
      <td>
        <div class="date-main">${mailLabel}</div>
      </td>
      <td><a class="visit-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">↗</a></td>
    </tr>
  `;
}

function renderMain(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app || !appState.status) return;

  const allRows = appState.rows;
  const visibleRows = getFilteredRows(allRows);
  const years = getYears(appState.status.checks);

  const serverHost = appState.config?.serverInfo?.host || 'No disponible';
  const serverIp = appState.config?.serverInfo?.ip || 'No disponible';
  const serverPlan = appState.config?.serverInfo?.plan || 'No disponible';
  const serverSystem = appState.config?.serverInfo?.system || 'No disponible';
  const serverReverseDns = appState.config?.serverInfo?.reverseDns || 'No disponible';
  const serverWhoisOrg = appState.config?.serverInfo?.whoisOrg || 'No disponible';
  const serverWhoisCountry = appState.config?.serverInfo?.whoisCountry || 'No disponible';
  const serverWhoisNetName = appState.config?.serverInfo?.whoisNetName || 'No disponible';
  const serverWhoisAsn = appState.config?.serverInfo?.whoisAsn || 'No disponible';
  const serverHttpServer = appState.config?.serverInfo?.httpServer || 'No disponible';
  const serverOsGuess = appState.config?.serverInfo?.osGuess || 'No disponible';
  const serverIsp = appState.config?.serverInfo?.isp || 'No disponible';
  const serverAsName = appState.config?.serverInfo?.asName || 'No disponible';
  const serverGeoCity = appState.config?.serverInfo?.geoCity || 'No disponible';
  const serverGeoRegion = appState.config?.serverInfo?.geoRegion || 'No disponible';
  const serverGeoCountry = appState.config?.serverInfo?.geoCountry || 'No disponible';
  const serverGeoTimezone = appState.config?.serverInfo?.geoTimezone || 'No disponible';
  const serverIpApiSource = appState.config?.serverInfo?.ipApiSource || 'No disponible';
  const serverProbedAt = formatDate(appState.config?.serverInfo?.probedAt);

  const mainHtml = `
    <section class="main-panel">
      <h1>Gestao de Dominios</h1>
      <article class="server-card">
        <div class="server-title">Servidor Ola Multicom</div>
        <div class="server-grid">
          <div><span>Host:</span> ${escapeHtml(serverHost)}</div>
          <div><span>IP:</span> ${escapeHtml(serverIp)}</div>
          <div><span>Reverse DNS:</span> ${escapeHtml(serverReverseDns)}</div>
          <div><span>HTTP Server:</span> ${escapeHtml(serverHttpServer)}</div>
          <div><span>ASN:</span> ${escapeHtml(serverWhoisAsn)}</div>
          <div><span>WHOIS Org:</span> ${escapeHtml(serverWhoisOrg)}</div>
          <div><span>WHOIS Pais:</span> ${escapeHtml(serverWhoisCountry)}</div>
          <div><span>WHOIS NetName:</span> ${escapeHtml(serverWhoisNetName)}</div>
          <div><span>ISP:</span> ${escapeHtml(serverIsp)}</div>
          <div><span>ASN Org:</span> ${escapeHtml(serverAsName)}</div>
          <div><span>Ciudad:</span> ${escapeHtml(serverGeoCity)}</div>
          <div><span>Region:</span> ${escapeHtml(serverGeoRegion)}</div>
          <div><span>Pais:</span> ${escapeHtml(serverGeoCountry)}</div>
          <div><span>Timezone:</span> ${escapeHtml(serverGeoTimezone)}</div>
          <div><span>API Fuente:</span> ${escapeHtml(serverIpApiSource)}</div>
          <div><span>OS Guess:</span> ${escapeHtml(serverOsGuess)}</div>
          <div><span>Plano:</span> ${escapeHtml(serverPlan)}</div>
          <div><span>Sistema:</span> ${escapeHtml(serverSystem)}</div>
          <div><span>WHM Sync:</span> ${formatDate(appState.config?.lastWhmSync)}</div>
          <div><span>Analisis:</span> ${escapeHtml(serverProbedAt)}</div>
        </div>
      </article>

      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${appState.statusFilter === 'all' ? 'active' : ''}" data-filter="all">Todos</button>
          <button class="tab ${appState.statusFilter === 'online' ? 'active' : ''}" data-filter="online">Online</button>
          <button class="tab ${appState.statusFilter === 'offline' ? 'active' : ''}" data-filter="offline">Offline</button>
        </div>
        <div class="actions">
          <select id="yearSelect">
            ${years.map((y) => `<option value="${y}" ${y === appState.selectedYear ? 'selected' : ''}>Checks (${y})</option>`).join('')}
          </select>
          ${appState.adminAvailable ? `<button id="regenerateBtn" class="ghost" ${appState.adminBusy ? 'disabled' : ''}>${appState.adminBusy ? 'Regenerando...' : 'Limpiar cache y regenerar'}</button>` : ''}
          <button id="expandAllBtn" class="ghost">Expandir todos</button>
          <button id="collapseAllBtn" class="ghost">Contraer todos</button>
        </div>
      </div>
      ${appState.adminMessage ? `<p class="admin-note">${escapeHtml(appState.adminMessage)}</p>` : ''}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Dominio Principal</th>
              <th>Status</th>
              <th>Vencimiento</th>
              <th>Checks (${appState.selectedYear})</th>
              <th>Correos</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map((row, i) => rowHtml(row, i)).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  app.innerHTML = `<main class="app-shell">${renderSidebar(allRows)}${mainHtml}</main>`;
  bindEvents();
}

function bindEvents(): void {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    appState.search = searchInput.value;
    renderMain();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.filter as AppState['statusFilter'];
      appState.statusFilter = next;
      renderMain();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      if (!key) return;
      if (appState.expanded.has(key)) appState.expanded.delete(key);
      else {
        appState.expanded.add(key);
        prefetchRdapForExpandedParent(key);
      }
      renderMain();
    });
  });

  const yearSelect = document.getElementById('yearSelect') as HTMLSelectElement | null;
  yearSelect?.addEventListener('change', () => {
    appState.selectedYear = Number(yearSelect.value);
    if (appState.status) {
      appState.rows = buildRows(appState.status, appState.config, appState.selectedYear);
    }
    renderMain();
  });

  document.getElementById('expandAllBtn')?.addEventListener('click', () => {
    appState.rows.filter((r) => r.kind === 'parent' && r.site.subCount > 0).forEach((r) => {
      appState.expanded.add(r.site.site.url.toLowerCase());
    });
    renderMain();
  });

  document.getElementById('collapseAllBtn')?.addEventListener('click', () => {
    appState.expanded.clear();
    renderMain();
  });

  document.getElementById('regenerateBtn')?.addEventListener('click', async () => {
    if (appState.adminBusy) return;
    appState.adminBusy = true;
    appState.adminMessage = 'Regenerando datos...';
    renderMain();

    try {
      const res = await fetch('/__admin/regenerate', { method: 'POST' });
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
          const payload = (await res.json()) as { error?: string };
          if (payload?.error) reason = payload.error;
        } catch {
          // Keep HTTP message.
        }
        throw new Error(reason);
      }

      const [status, config] = await Promise.all([loadStatus(), loadSitesConfig()]);
      appState.status = status;
      appState.config = config;
      appState.rows = buildRows(status, config, appState.selectedYear);
      appState.adminMessage = 'Cache limpiado y datos regenerados correctamente.';
    } catch (error) {
      appState.adminMessage = `No se pudo regenerar: ${(error as Error).message}`;
    } finally {
      appState.adminBusy = false;
      renderMain();
    }
  });
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  try {
    const [status, config] = await Promise.all([loadStatus(), loadSitesConfig()]);
    appState.status = status;
    appState.config = config;
    appState.adminAvailable = await checkAdminAvailability();
    loadRdapCacheFromStorage();

    const years = getYears(status.checks);
    appState.selectedYear = years[0];
    appState.rows = buildRows(status, config, appState.selectedYear);

    appState.expanded.clear();

    renderMain();
  } catch (error) {
    app.innerHTML = `<main class="app-shell"><p class="error">Error cargando dashboard: ${(error as Error).message}</p></main>`;
  }
}

async function probeNetwork(): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(`/status.json?probe=${started}`, { cache: 'no-store' });
    if (!res.ok) {
      appState.networkOnline = false;
      appState.networkLatencyMs = null;
      appState.lastProbeAt = Date.now();
      if (appState.status) renderMain();
      return;
    }

    appState.networkOnline = true;
    appState.networkLatencyMs = Date.now() - started;
    appState.lastProbeAt = Date.now();
  } catch {
    appState.networkOnline = false;
    appState.networkLatencyMs = null;
    appState.lastProbeAt = Date.now();
  }

  if (appState.status) {
    renderMain();
  }
}

bootstrap();
probeNetwork();
setInterval(() => {
  probeNetwork();
}, 15000);
