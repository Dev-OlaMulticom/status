import './style.css';
import { getAllServices, upsertService, type DomainService } from './db';

// ─── Constants ───────────────────────────────────────────────────────────────

const WHM_SERVER_IP_FALLBACK = '31.97.169.57';
let whmServerIp = WHM_SERVER_IP_FALLBACK;
const PAGE_SIZE = 50;

// ─── Types ───────────────────────────────────────────────────────────────────

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
  whmUsage?: {
    diskUsedMb?: number | null;
    diskQuotaMb?: number | null;
    diskPercent?: number | null;
    plan?: string | null;
  };
  ip?: string | null;
  cloudflareIp?: string | null;
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
  type: 'main' | 'sub';
  account: string;
  expirationDate: string | null;
};

type DomainRow = {
  site: DomainRecord;
};

type FilterType = 'all' | 'cuenta' | 'adicionado';
type SortType = 'alpha' | 'venc-mais-proximo' | 'venc-mais-distante';
type ServerFilterType = 'all' | 'whm' | 'cloudflare' | 'both' | 'none';

type AppState = {
  status: StatusData | null;
  config: SitesConfigData | null;
  rows: DomainRow[];
  search: string;
  filter: FilterType;
  sortBy: SortType;
  accountFilter: string;
  serverFilter: ServerFilterType;
  serviceCache: Map<string, DomainService>;
  currentPage: number;
  networkLatencyMs: number | null;
  networkOnline: boolean;
  lastProbeAt: number | null;
  rdapExpiryCache: Map<string, { expirationDate: string | null; fetchedAt: number }>;
  rdapPending: Set<string>;
  adminAvailable: boolean;
  adminBusy: boolean;
  adminMessage: string;
  sidebarOpen: boolean;
  accountDomainCount: Map<string, number>;
};

// ─── State ───────────────────────────────────────────────────────────────────

const appState: AppState = {
  status: null,
  config: null,
  rows: [],
  search: '',
  filter: 'all',
  sortBy: 'alpha',
  accountFilter: '',
  serverFilter: 'all',
  serviceCache: new Map(),
  currentPage: 1,
  networkLatencyMs: null,
  networkOnline: false,
  lastProbeAt: null,
  rdapExpiryCache: new Map(),
  rdapPending: new Set(),
  adminAvailable: false,
  adminBusy: false,
  adminMessage: '',
  sidebarOpen: false,
  accountDomainCount: new Map(),
};

const RDAP_CACHE_KEY = 'olamulticom_rdap_expiry_v1';
const RDAP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RDAP_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const RDAP_CONCURRENCY = 2;
const rdapQueue: string[] = [];
let rdapWorkers = 0;

// ─── RDAP TLD servers ─────────────────────────────────────────────────────

const RDAP_TLD_SERVERS: Record<string, string> = {
  br: 'https://rdap.registro.br/domain/',
  com: 'https://rdap.verisign.com/com/v1/domain/',
  net: 'https://rdap.verisign.com/net/v1/domain/',
  org: 'https://rdap.publicinterestregistry.org/rdap/domain/',
  info: 'https://rdap.identitydigital.services/rdap/domain/',
  xyz: 'https://rdap.centralnic.com/xyz/domain/',
  io: 'https://rdap.identitydigital.services/rdap/domain/',
  app: 'https://pubapi.registry.google/rdap/domain/',
  dev: 'https://pubapi.registry.google/rdap/domain/',
};

// ─── Utility functions ───────────────────────────────────────────────────────

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function normalizeDateInput(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatShortDate(iso: string | null): string {
  if (!iso) return 'Sem dados';
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('pt-BR', { month: 'long' });
  const year = d.getFullYear();
  return `${day}/${month.charAt(0).toUpperCase() + month.slice(1)}/${year}`;
}

function formatRemaining(iso: string | null): string {
  if (!iso) return 'Sem dados';
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return `Vencido há ${Math.abs(days)} dias`;
  if (days === 0) return 'Vence hoje';
  return `Faltam ${days} dias`;
}

function getTld(domain: string): string {
  const parts = domain.split('.');
  return parts.length >= 2 ? parts[parts.length - 1] : '';
}

function getRdapUrl(domain: string): string | null {
  const tld = getTld(domain);
  const base = RDAP_TLD_SERVERS[tld];
  return base ? `${base}${encodeURIComponent(domain)}` : null;
}

function isEligibleForRdap(domain: string): boolean {
  const d = domain.toLowerCase();
  if (d.includes('cprapid.com')) return false;
  const tld = getTld(d);
  return tld in RDAP_TLD_SERVERS;
}

function highlightText(escapedText: string, words: string[]): string {
  if (!words.length) return escapedText;
  let result = escapedText;
  for (const w of words) {
    const safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safe})`, 'gi');
    result = result.replace(regex, '<mark class="search-hl">$1</mark>');
  }
  return result;
}

// ─── Disk / account helpers ─────────────────────────────────────────────────

function formatDiskMb(mb?: number | null): string {
  if (mb == null || Number.isNaN(mb)) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${formatNumber(mb)} MB`;
}

/**
 * Count how many domains in the current catalog share each WHM account (username).
 * Used to show "dominios en conta" per row.
 */
function computeAccountDomainCounts(rows: DomainRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const username = r.site.site.whmInfo?.username;
    if (!username) continue;
    counts.set(username, (counts.get(username) ?? 0) + 1);
  }
  return counts;
}

// ─── Service cache helpers ──────────────────────────────────────────────────

async function loadServiceCache(): Promise<void> {
  appState.serviceCache = await getAllServices();
}

function getServiceForDomain(hostname: string): DomainService | undefined {
  return appState.serviceCache.get(hostname);
}

async function toggleService(domain: string, field: 'site' | 'email'): Promise<void> {
  const current = getServiceForDomain(domain);
  const currentVal = current ? current[field] : false;
  await upsertService(domain, field, !currentVal);
  await loadServiceCache();
}

// ─── RDAP cache ──────────────────────────────────────────────────────────────

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
  } catch { /* Ignore */ }
}

function persistRdapCacheToStorage(): void {
  try {
    const obj = Object.fromEntries(appState.rdapExpiryCache.entries());
    localStorage.setItem(RDAP_CACHE_KEY, JSON.stringify(obj));
  } catch { /* Ignore */ }
}

async function fetchRdapExpiration(domain: string): Promise<string | null> {
  const url = getRdapUrl(domain);
  if (!url) return null;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const payload = await res.json();
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const ev = events.find((e: any) => String(e?.eventAction || '').trim().toLowerCase() === 'expiration');
  return typeof ev?.eventDate === 'string' ? ev.eventDate : null;
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

function processRdapQueue(): void {
  while (rdapWorkers < RDAP_CONCURRENCY && rdapQueue.length > 0) {
    const domain = rdapQueue.shift();
    if (!domain) break;
    rdapWorkers += 1;
    appState.rdapPending.add(domain);
    fetchRdapExpiration(domain)
      .then((expirationDate) => {
        appState.rdapExpiryCache.set(domain, { expirationDate, fetchedAt: Date.now() });
        persistRdapCacheToStorage();
      })
      .catch(() => {
        appState.rdapExpiryCache.set(domain, { expirationDate: null, fetchedAt: Date.now() });
        persistRdapCacheToStorage();
      })
      .finally(() => {
        appState.rdapPending.delete(domain);
        rdapWorkers -= 1;
        if (appState.status) renderTableBody();
        processRdapQueue();
      });
  }
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadStatus(): Promise<StatusData> {
  const res = await fetch('/status.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Não foi possível ler status.json (${res.status})`);
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

// ─── Data processing ─────────────────────────────────────────────────────────

function normalizeType(site: SiteResult): 'main' | 'sub' {
  return site.whmInfo?.type === 'principal' || site.category !== 'whm' ? 'main' : 'sub';
}

function buildMergedSites(status: StatusData, config: SitesConfigData | null): SiteResult[] {
  // Build a whitelist of domains from the current WHM/manual config
  const allCatalog = [...(config?.manualSites ?? []), ...(config?.whmSites ?? [])];
  const currentUrls = new Set(allCatalog.map((s) => s.url.toLowerCase()));

  const latest = status.checks?.[0];
  const merged = new Map<string, SiteResult>();
  if (latest?.results?.length) {
    latest.results.forEach((site) => {
      const key = site.url.toLowerCase();
      // Only include domains that exist in the current WHM/manual config
      if (currentUrls.has(key)) {
        merged.set(key, site);
      }
    });
  }
  allCatalog.forEach((site) => {
    const key = site.url.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        name: site.name, url: site.url, online: false, responseTime: -1,
        status: -1, error: 'Sem verificação recente', category: site.category, whmInfo: site.whmInfo,
      });
    }
  });
  return Array.from(merged.values());
}

function toDomainRecord(site: SiteResult): DomainRecord {
  return {
    site,
    type: normalizeType(site),
    account: site.whmInfo?.username || `manual:${site.name}`,
    expirationDate: normalizeDateInput(site.whmInfo?.expirationDate || site.whmInfo?.expiresAt),
  };
}

function buildRows(status: StatusData, config: SitesConfigData | null): DomainRow[] {
  const allSites = buildMergedSites(status, config).map((site) => toDomainRecord(site));
  return allSites
    .sort((a, b) => getHostname(a.site.url).localeCompare(getHostname(b.site.url)))
    .map((site) => ({ site }));
}

function getUniqueAccounts(rows: DomainRow[]): string[] {
  const accounts = new Set<string>();
  rows.forEach((r) => {
    if (r.site.account && !r.site.account.startsWith('manual:')) {
      accounts.add(r.site.account);
    }
  });
  return Array.from(accounts).sort();
}

function getServerFilterForSite(row: DomainRow): ServerFilterType {
  const effectiveIp = row.site.site.cloudflareIp ?? row.site.site.ip ?? null;
  if (!effectiveIp) return 'none';
  const isWhm = effectiveIp === whmServerIp;
  const isCf = row.site.site.cloudflareIp !== null;
  if (isWhm && isCf) return 'both';
  if (isWhm) return 'whm';
  if (isCf) return 'cloudflare';
  return 'none';
}

// ─── Filtering & Sorting ─────────────────────────────────────────────────────

function rowMatchesSearch(row: DomainRecord, words: string[]): boolean {
  if (!words.length) return true;
  const hostname = getHostname(row.site.url).toLowerCase();
  const name = row.site.name.toLowerCase();
  const account = row.account.toLowerCase();
  return words.every((w) => hostname.includes(w) || name.includes(w) || account.includes(w));
}

function getFilteredAndSortedRows(rows: DomainRow[]): DomainRow[] {
  const query = appState.search.trim().toLowerCase();
  const words = query ? query.split(/\s+/).filter(Boolean) : [];

  let filtered = rows.filter((row) => {
    if (!rowMatchesSearch(row.site, words)) return false;
    if (appState.filter === 'cuenta') return row.site.type === 'main';
    if (appState.filter === 'adicionado') return row.site.type === 'sub';
    return true;
  });

  // Account filter
  if (appState.accountFilter) {
    filtered = filtered.filter((row) => row.site.account === appState.accountFilter);
  }

  // Server filter
  if (appState.serverFilter !== 'all') {
    filtered = filtered.filter((row) => getServerFilterForSite(row) === appState.serverFilter);
  }

  // Sorting
  if (appState.sortBy === 'alpha') {
    filtered.sort((a, b) => getHostname(a.site.site.url).localeCompare(getHostname(b.site.site.url), 'pt-BR'));
  } else if (appState.sortBy === 'venc-mais-proximo') {
    filtered.sort((a, b) => {
      const ea = getResolvedExpiration(a.site);
      const eb = getResolvedExpiration(b.site);
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return new Date(ea).getTime() - new Date(eb).getTime();
    });
  } else if (appState.sortBy === 'venc-mais-distante') {
    filtered.sort((a, b) => {
      const ea = getResolvedExpiration(a.site);
      const eb = getResolvedExpiration(b.site);
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return new Date(eb).getTime() - new Date(ea).getTime();
    });
  }

  return filtered;
}

// ─── Rendering: Sidebar ──────────────────────────────────────────────────────

function renderSidebar(rows: DomainRow[]): string {
  const allRecords = rows.map((r) => r.site);
  const mains = allRecords.filter((r) => r.type === 'main').length;
  const subs = allRecords.filter((r) => r.type === 'sub').length;
  const whmAccounts = new Set(
    allRecords.filter((r) => r.account && !r.account.startsWith('manual:')).map((r) => r.account),
  ).size;
  const latencyLabel = appState.networkLatencyMs == null ? '--' : `${appState.networkLatencyMs}ms`;
  const networkStateLabel = appState.networkOnline ? 'Servidor online' : 'Servidor offline';
  const networkClass = appState.networkOnline ? 'ok' : 'bad';

  const accounts = getUniqueAccounts(rows);

  const accountOptions = accounts.map((acc) => {
    const count = rows.filter((r) => r.site.account === acc).length;
    return `<option value="${escapeHtml(acc)}" ${appState.accountFilter === acc ? 'selected' : ''}>${escapeHtml(acc)} (${count})</option>`;
  }).join('');

  return `
    <aside class="left-panel ${appState.sidebarOpen ? 'open' : ''}">
      <div class="sidebar-header-mobile">
        <span>Filtros</span>
        <button class="sidebar-close" id="sidebarCloseBtn" aria-label="Fechar menu">✕</button>
      </div>
      <div class="search-box">
        <input id="searchInput" type="text" placeholder="Buscar domínio..." value="${escapeHtml(appState.search)}" />
      </div>
      <article class="metric-card">
        <div class="metric-label">Filtrar por Conta</div>
        <div class="filter-select-wrap">
          <select id="accountSelect">
            <option value="">Todas as contas (${accounts.length})</option>
            ${accountOptions}
          </select>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Servidor</div>
        <div class="metric-grid">
          <div class="metric-item">
            <span class="metric-item-label">Contas WHM</span>
            <span class="metric-item-value">${formatNumber(whmAccounts)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-item-label">Domínios</span>
            <span class="metric-item-value">${formatNumber(mains + subs)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-item-label">Conta</span>
            <span class="metric-item-value">${formatNumber(mains)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-item-label">Adicionado</span>
            <span class="metric-item-value">${formatNumber(subs)}</span>
          </div>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Latência de Rede</div>
        <div class="metric-value ${networkClass}">${latencyLabel}</div>
        <div class="metric-sub">${networkStateLabel}</div>
      </article>
      <button id="exportCsvBtn" class="export-btn" title="Descargar tabla en CSV">Descargar CSV</button>
    </aside>
  `;
}

// ─── Rendering: Table helpers ────────────────────────────────────────────────

function statusBadge(site: SiteResult): string {
  if (site.status < 0) return '<span class="badge unknown">Sem check</span>';
  return site.online
    ? '<span class="badge online">Online</span>'
    : '<span class="badge offline">Offline</span>';
}

function getEffectiveIp(site: SiteResult): string | null {
  return site.cloudflareIp ?? site.ip ?? null;
}

function hostingLabel(record: DomainRow): string {
  const effectiveIp = record.site.site.cloudflareIp ?? record.site.site.ip ?? null;
  const isWhm = effectiveIp === whmServerIp;
  const isCf = record.site.site.cloudflareIp !== null;
  if (isWhm && isCf) return '<span class="hosting-label hosting-both" title="WHM + Cloudflare">WHM+CF</span>';
  if (isWhm) return '<span class="hosting-label hosting-yes" title="A Record: ' + whmServerIp + ' (WHM)">WHM</span>';
  if (isCf) return '<span class="hosting-label hosting-cf" title="Cloudflare">CF</span>';
  if (effectiveIp) return '<span class="hosting-label hosting-no" title="A Record: ' + effectiveIp + ' (fora)">Fora</span>';
  return '<span class="hosting-label hosting-no">Não</span>';
}

function typeBadge(record: DomainRecord): string {
  if (record.type === 'main') {
    return '<span class="type-badge type-cuenta">Conta</span>';
  }
  const accountName = record.account.startsWith('manual:') ? 'Manual' : record.account;
  return `<span class="type-badge type-adicionado" title="Pertence à conta: ${escapeHtml(accountName)}">Adicionado</span>`;
}

function accountInfo(record: DomainRecord): string {
  if (record.type === 'main') return '';
  const accountName = record.account.startsWith('manual:') ? 'Manual' : record.account;
  return `<span class="account-detail">→ ${escapeHtml(accountName)}</span>`;
}

function servicesCell(hostname: string): string {
  const svc = getServiceForDomain(hostname);
  const siteOn = svc?.site ?? false;
  const emailOn = svc?.email ?? false;
  return `
    <div class="services-cell">
      <button class="svc-tag ${siteOn ? 'svc-active' : ''}" data-svc="site" data-domain="${escapeHtml(hostname)}" title="Serviço SITE">SITE</button>
      <button class="svc-tag ${emailOn ? 'svc-active' : ''}" data-svc="email" data-domain="${escapeHtml(hostname)}" title="Serviço EMAIL">EMAIL</button>
    </div>
  `;
}

function renderExpirationCell(row: DomainRow, resolvedExpiration: string | null): string {
  if (!resolvedExpiration) {
    if (row.site.type === 'sub') {
      return '<div class="date-main">-</div><div class="date-sub">-</div>';
    }
    const hostname = getHostname(row.site.site.url).toLowerCase();
    const rdapUrl = getRdapUrl(hostname);
    if (rdapUrl) {
      return `<div class="date-main"><a href="${escapeHtml(rdapUrl)}" target="_blank" rel="noreferrer" class="rdap-link" title="Consultar vencimento via RDAP">Sem dados ↗</a></div><div class="date-sub">Consultar RDAP</div>`;
    }
    return '<div class="date-main">Sem dados</div><div class="date-sub">Sem dados</div>';
  }
  return `<div class="date-main">${formatShortDate(resolvedExpiration)}</div><div class="date-sub">${formatRemaining(resolvedExpiration)}</div>`;
}

function renderDiskCell(row: DomainRow): string {
  const usage = row.site.site.whmUsage;
  if (!usage || (usage.diskQuotaMb == null && usage.diskUsedMb == null)) {
    return '<div class="disk-main">—</div><div class="disk-sub">—</div>';
  }

  const used = formatDiskMb(usage.diskUsedMb);
  const quota = formatDiskMb(usage.diskQuotaMb);
  const pct = usage.diskPercent != null ? `${usage.diskPercent}%` : '—';

  const username = row.site.site.whmInfo?.username;
  const accountCount = username ? appState.accountDomainCount.get(username) ?? 1 : 1;

  return `
    <div class="disk-main">${used} <span class="disk-sep">/</span> ${quota}</div>
    <div class="disk-sub">${pct} usado · ${accountCount} dom. en conta</div>
  `;
}

function rowHtml(row: DomainRow, index: number): string {
  const hostname = getHostname(row.site.site.url);
  const safeUrl = sanitizeUrl(row.site.site.url);
  const resolvedExpiration = getResolvedExpiration(row.site);
  const query = appState.search.trim().toLowerCase();
  const words = query ? query.split(/\s+/).filter(Boolean) : [];
  const highlightedHostname = highlightText(escapeHtml(hostname), words);
  const effectiveIp = getEffectiveIp(row.site.site);
  const ipSource = row.site.site.cloudflareIp ? 'CF' : row.site.site.ip ? 'DNS' : null;

  return `
    <tr>
      <td data-label="#">${index + 1}</td>
      <td data-label="Domínio">
        <div class="domain-cell">
          <div class="domain-name">${highlightedHostname}</div>
          <a class="domain-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer" title="Abrir domínio">↗</a>
        </div>
      </td>
      <td data-label="Tipo">
        <div class="type-cell">
          ${typeBadge(row.site)}
          ${accountInfo(row.site)}
        </div>
      </td>
      <td data-label="Status">${statusBadge(row.site.site)}</td>
      <td data-label="Vencimento">
        ${renderExpirationCell(row, resolvedExpiration)}
      </td>
      <td data-label="Serviços">
        ${servicesCell(hostname)}
      </td>
      <td data-label="Servidor">
        <div class="hosting-cell">
          ${hostingLabel(row)}
          ${effectiveIp ? `<span class="ip-detail" title="A Record via ${ipSource}">${escapeHtml(effectiveIp)}</span>` : ''}
        </div>
      </td>
      <td data-label="Disco">${renderDiskCell(row)}</td>
    </tr>
  `;
}

// ─── Rendering: Pagination ───────────────────────────────────────────────────

function renderPagination(totalRows: number): string {
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);
  if (totalPages <= 1) return '';
  const from = (appState.currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(appState.currentPage * PAGE_SIZE, totalRows);

  let buttons = '';
  const maxVisible = 7;
  let start = Math.max(1, appState.currentPage - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

  if (start > 1) buttons += `<button class="page-btn" data-page="1">1</button>`;
  if (start > 2) buttons += `<span class="page-ellipsis">…</span>`;
  for (let i = start; i <= end; i++) {
    buttons += `<button class="page-btn ${i === appState.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  if (end < totalPages - 1) buttons += `<span class="page-ellipsis">…</span>`;
  if (end < totalPages) buttons += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;

  return `
    <div class="pagination-bar">
      <span class="page-info">Mostrando ${from}–${to} de ${formatNumber(totalRows)}</span>
      <div class="page-controls">
        <button class="page-btn page-nav" data-page="${appState.currentPage - 1}" ${appState.currentPage <= 1 ? 'disabled' : ''}>‹</button>
        ${buttons}
        <button class="page-btn page-nav" data-page="${appState.currentPage + 1}" ${appState.currentPage >= totalPages ? 'disabled' : ''}>›</button>
      </div>
    </div>
  `;
}

// ─── Rendering: Table body (lightweight) ─────────────────────────────────────

let searchRafId = 0;

function renderTableBody(): void {
  const tbody = document.querySelector<HTMLTableSectionElement>('#tableBody');
  const emptyMsg = document.querySelector<HTMLDivElement>('#emptyResults');
  const table = document.querySelector<HTMLTableElement>('#mainTable');
  const pag = document.querySelector<HTMLDivElement>('#pagination');
  if (!tbody || !emptyMsg || !table || !appState.status) return;

  const filteredRows = getFilteredAndSortedRows(appState.rows);
  const total = filteredRows.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (appState.currentPage > totalPages) appState.currentPage = Math.max(1, totalPages);

  if (total === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = appState.search.trim()
      ? `Não encontrado para: "${appState.search.trim()}"`
      : 'Sem resultados para este filtro.';
    if (pag) pag.innerHTML = '';
  } else {
    table.style.display = '';
    emptyMsg.style.display = 'none';
    emptyMsg.textContent = '';
    const start = (appState.currentPage - 1) * PAGE_SIZE;
    const pageRows = filteredRows.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = pageRows.map((row, i) => rowHtml(row, start + i)).join('');
    if (pag) pag.innerHTML = renderPagination(total);
  }
}

// ─── Rendering: Main ─────────────────────────────────────────────────────────

function renderMain(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app || !appState.status) return;

  const allRows = appState.rows;
  const filteredCount = getFilteredAndSortedRows(allRows).length;

  const mainHtml = `
    <section class="main-panel">
      <h1 class="desktop-title">Gestão de Domínios</h1>
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${appState.filter === 'all' ? 'active' : ''}" data-filter="all">Todos (${formatNumber(allRows.length)})</button>
          <button class="tab ${appState.filter === 'cuenta' ? 'active' : ''}" data-filter="cuenta">Conta</button>
          <button class="tab ${appState.filter === 'adicionado' ? 'active' : ''}" data-filter="adicionado">Adicionado</button>
        </div>
        <div class="actions">
          <select id="serverFilterSelect">
            <option value="all" ${appState.serverFilter === 'all' ? 'selected' : ''}>Servidor: Todos</option>
            <option value="whm" ${appState.serverFilter === 'whm' ? 'selected' : ''}>Servidor: WHM</option>
            <option value="cloudflare" ${appState.serverFilter === 'cloudflare' ? 'selected' : ''}>Servidor: Cloudflare</option>
            <option value="both" ${appState.serverFilter === 'both' ? 'selected' : ''}>Servidor: WHM + CF</option>
            <option value="none" ${appState.serverFilter === 'none' ? 'selected' : ''}>Servidor: Fora</option>
          </select>
          <select id="sortSelect">
            <option value="alpha" ${appState.sortBy === 'alpha' ? 'selected' : ''}>Ordenar: A–Z</option>
            <option value="venc-mais-proximo" ${appState.sortBy === 'venc-mais-proximo' ? 'selected' : ''}>Vencimento: mais próximo</option>
            <option value="venc-mais-distante" ${appState.sortBy === 'venc-mais-distante' ? 'selected' : ''}>Vencimento: mais distante</option>

          </select>
          ${appState.adminAvailable
            ? `<button id="regenerateBtn" class="ghost" ${appState.adminBusy ? 'disabled' : ''}>${appState.adminBusy ? 'Regenerando...' : 'Limpar cache'}</button>`
            : '<span class="admin-note" title="O deploy é estático; os dados são atualizados pelo agendador (cron) a cada 5 minutos.">Auto-atualização: cron 5 min</span>'}
        </div>
      </div>
      ${appState.adminMessage ? `<p class="admin-note">${escapeHtml(appState.adminMessage)}</p>` : ''}
      <div id="emptyResults" class="empty-results" style="display:none"></div>
      <div class="table-wrap">
        <table id="mainTable">
          <thead>
            <tr>
              <th>#</th>
              <th>Domínio</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Vencimento</th>
              <th>Serviços</th>
              <th>Servidor</th>
              <th>Disco</th>
            </tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
        <div id="pagination"></div>
      </div>
      <div class="table-footer">
        <span class="total-count">Total: ${formatNumber(filteredCount)} domínios</span>
      </div>
    </section>
  `;

  const sidebarOpen = appState.sidebarOpen ? ' open' : '';
  app.innerHTML = `
    <header class="mobile-header">
      <button class="hamburger-btn" id="hamburgerBtn" aria-label="Abrir menu">
        <span></span><span></span><span></span>
      </button>
      <h1 class="mobile-title">Gestão de Domínios</h1>
    </header>
    <div class="sidebar-overlay ${sidebarOpen}" id="sidebarOverlay"></div>
    <main class="app-shell">
      ${renderSidebar(allRows)}
      ${mainHtml}
    </main>
  `;
  bindEvents();
  renderTableBody();
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportToCSV(): void {
  const filteredRows = getFilteredAndSortedRows(appState.rows);
  if (filteredRows.length === 0) {
    alert('No hay registros para exportar');
    return;
  }

  // Headers
  const headers = ['#', 'Domínio', 'Tipo', 'Cuenta', 'Status', 'Vencimiento', 'IP', 'Servidor', 'Capacidad Disco', 'Disco Usado', 'Dominios en cuenta'];
  
  // Convert rows to CSV data
  const csvData = filteredRows.map((row, index) => {
    const hostname = getHostname(row.site.site.url);
    const status = row.site.site.online ? 'Online' : (row.site.site.status < 0 ? 'Sin check' : 'Offline');
    const expiration = getResolvedExpiration(row.site) || 'N/A';
    const ip = getEffectiveIp(row.site.site) || 'N/A';
    const isWhm = ip === whmServerIp;
    const isCf = row.site.site.cloudflareIp !== null;
    let servidor = 'No';
    if (isWhm && isCf) servidor = 'WHM+CF';
    else if (isWhm) servidor = 'WHM';
    else if (isCf) servidor = 'CF';
    else if (ip !== 'N/A') servidor = 'Fora';

    const usage = row.site.site.whmUsage;
    const quota = usage?.diskQuotaMb != null ? formatDiskMb(usage.diskQuotaMb) : 'N/A';
    const used = usage?.diskUsedMb != null ? formatDiskMb(usage.diskUsedMb) : 'N/A';
    const username = row.site.site.whmInfo?.username;
    const accountCount = username ? (appState.accountDomainCount.get(username) ?? 1) : 1;
    
    return [
      (index + 1).toString(),
      hostname,
      row.site.type,
      row.site.account || 'N/A',
      status,
      expiration,
      ip,
      servidor,
      quota,
      used,
      String(accountCount)
    ];
  });

  // Create CSV content
  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...csvData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `dominios-${timestamp}.csv`;
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Event binding ───────────────────────────────────────────────────────────

function bindEvents(): void {
  // Sidebar toggle (hamburger)
  document.getElementById('hamburgerBtn')?.addEventListener('click', () => {
    appState.sidebarOpen = !appState.sidebarOpen;
    updateSidebarState();
  });

  document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
    appState.sidebarOpen = false;
    updateSidebarState();
  });

  document.getElementById('sidebarCloseBtn')?.addEventListener('click', () => {
    appState.sidebarOpen = false;
    updateSidebarState();
  });

  // Search
  const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    appState.search = searchInput.value;
    appState.currentPage = 1;
    if (searchRafId) cancelAnimationFrame(searchRafId);
    searchRafId = requestAnimationFrame(() => {
      searchRafId = 0;
      renderTableBody();
    });
  });

  // Filter tabs
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      appState.filter = button.dataset.filter as FilterType;
      appState.currentPage = 1;
      renderMain();
    });
  });

  // Account filter
  const accountSelect = document.getElementById('accountSelect') as HTMLSelectElement | null;
  accountSelect?.addEventListener('change', () => {
    appState.accountFilter = accountSelect.value;
    appState.currentPage = 1;
    renderMain();
  });

  // Server filter
  const serverFilterSelect = document.getElementById('serverFilterSelect') as HTMLSelectElement | null;
  serverFilterSelect?.addEventListener('change', () => {
    appState.serverFilter = serverFilterSelect.value as ServerFilterType;
    appState.currentPage = 1;
    renderMain();
  });

  // Sort select
  const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement | null;
  sortSelect?.addEventListener('change', () => {
    appState.sortBy = sortSelect.value as SortType;
    appState.currentPage = 1;
    renderMain();
  });

  // Admin regenerate
  document.getElementById('regenerateBtn')?.addEventListener('click', async () => {
    if (appState.adminBusy) return;
    appState.adminBusy = true;
    appState.adminMessage = 'Regenerando dados...';
    renderMain();
    try {
      const res = await fetch('/__admin/regenerate', { method: 'POST' });
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try { const p = (await res.json()) as { error?: string }; if (p?.error) reason = p.error; } catch { /* keep */ }
        throw new Error(reason);
      }
      const [status, config] = await Promise.all([loadStatus(), loadSitesConfig()]);
      appState.status = status;
      appState.config = config;
      appState.rows = buildRows(status, config);
      appState.accountDomainCount = computeAccountDomainCounts(appState.rows);
      appState.adminMessage = 'Cache limpo e dados regenerados com sucesso.';
    } catch (error) {
      appState.adminMessage = `Não foi possível regenerar: ${(error as Error).message}`;
    } finally {
      appState.adminBusy = false;
      renderMain();
    }
  });

  // Service toggle (event delegation — table body is re-rendered dynamically)
  document.querySelector('#tableBody')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.svc-tag');
    if (!btn) return;
    const domain = btn.dataset.domain;
    const field = btn.dataset.svc as 'site' | 'email';
    if (!domain || !field) return;
    await toggleService(domain, field);
    renderTableBody();
  });

  // Pagination
  document.querySelector('#pagination')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON' || target.hasAttribute('disabled')) return;
    const page = Number(target.dataset.page);
    if (page >= 1) {
      appState.currentPage = page;
      renderTableBody();
      document.querySelector('.table-wrap')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // CSV Export
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    exportToCSV();
  });
}

function updateSidebarState(): void {
  const sidebar = document.querySelector<HTMLElement>('.left-panel');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) {
    sidebar.classList.toggle('open', appState.sidebarOpen);
  }
  if (overlay) {
    overlay.classList.toggle('open', appState.sidebarOpen);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function enqueueMainDomainsRdap(): void {
  appState.rows.forEach(({ site }) => {
    if (site.type === 'main') {
      const domain = getHostname(site.site.url).toLowerCase();
      enqueueRdapLookup(domain);
    }
  });
  processRdapQueue();
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  try {
    const [status, config] = await Promise.all([loadStatus(), loadSitesConfig()]);
    appState.status = status;
    appState.config = config;
    whmServerIp = config?.serverInfo?.ip || WHM_SERVER_IP_FALLBACK;
    appState.adminAvailable = await checkAdminAvailability();
    loadRdapCacheFromStorage();
    await loadServiceCache();
    appState.rows = buildRows(status, config);
    appState.accountDomainCount = computeAccountDomainCounts(appState.rows);
    appState.currentPage = 1;
    renderMain();
    enqueueMainDomainsRdap();
  } catch (error) {
    app.innerHTML = `<main class="app-shell"><p class="error">Erro ao carregar painel: ${(error as Error).message}</p></main>`;
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
  if (appState.status) renderMain();
}

bootstrap();
probeNetwork();
setInterval(() => probeNetwork(), 15000);
