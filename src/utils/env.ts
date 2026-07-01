import { z } from 'zod';
import { config } from 'dotenv';

config();

function parseWhmUrl(whmUrl?: string): { host: string; port: number } {
  if (!whmUrl) return { host: 'servolam.olamulticom.com.br', port: 2087 };
  try {
    const u = new URL(whmUrl.includes('://') ? whmUrl : `https://${whmUrl}`);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 2087,
    };
  } catch {
    return { host: whmUrl, port: 2087 };
  }
}

const envSchema = z.object({
  WHM_ENABLED: z.string().optional().default('true'),
  WHM_URL: z.string().optional(),
  WHM_HOST: z.string().optional().default('servolam.olamulticom.com.br'),
  WHM_PORT: z.string().optional().default('2087'),
  WHM_USERNAME: z.string().optional().default('root'),
  WHM_API_TOKEN: z.string().optional(),
  WHM_TIMEOUT_MS: z.string().optional().default('10000'),
  WHM_REJECT_UNAUTHORIZED: z.string().optional().default('true'),
  WHM_IP_FAMILY: z.string().optional().default('4'),
  WHM_SYNC_INTERVAL_MS: z.string().optional().default('3600000'),
  WHM_EXCLUDE_SUSPENDED: z.string().optional().default('true'),
  WHM_EXCLUDE_SUBDOMAINS: z.string().optional().default('false'),
  WHM_EXCLUDE_ADDON_DOMAINS: z.string().optional().default('false'),
  WHM_ONLY_MAIN_DOMAINS: z.string().optional().default('false'),
  WHM_EMAIL_STATS_ENABLED: z.string().optional().default('true'),
  WHM_EMAIL_STATS_CONCURRENCY: z.string().optional().default('4'),
  WHM_RDAP_ENABLED: z.string().optional().default('true'),
  WHM_RDAP_CONCURRENCY: z.string().optional().default('3'),
  WHM_SERVER_PROBE_ENABLED: z.string().optional().default('true'),
  WHM_SERVER_PROBE_TIMEOUT_MS: z.string().optional().default('12000'),
  WHM_IP_ENRICHMENT_ENABLED: z.string().optional().default('true'),
  WHM_IP_ENRICHMENT_TIMEOUT_MS: z.string().optional().default('8000'),
  WHM_SERVER_PLAN: z.string().optional().default('VPS Linux'),
  WHM_SERVER_SYSTEM: z.string().optional().default('No disponible'),

  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_TIMEOUT_MS: z.string().optional().default('10000'),

  RDAP_ENABLED: z.string().optional().default('true'),
  RDAP_BASE_URL: z.string().optional().default('rdap.registro.br'),
  RDAP_TIMEOUT_MS: z.string().optional().default('7000'),
  RDAP_ONLY_BR: z.string().optional().default('true'),

  MONITOR_TIMEOUT_MS: z.string().optional().default('10000'),
  MONITOR_USER_AGENT: z.string().optional().default('Website-Monitor/2.0'),
  MONITOR_MAX_RETRIES: z.string().optional().default('2'),
  MONITOR_PARALLEL_LIMIT: z.string().optional().default('10'),
  MONITOR_HISTORY_LIMIT: z.string().optional().default('100'),
  MONITOR_CONCURRENCY: z.string().optional().default('10'),

  IPINFO_TOKEN: z.string().optional().default(''),
  LOG_LEVEL: z.string().optional().default('info'),
  NODE_ENV: z.string().optional().default('development'),
});

function parseBool(val: string | undefined, def: boolean): boolean {
  if (val == null || val === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(val.toLowerCase());
}

function parseNum(val: string | undefined, def: number, min = 0): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= min ? n : def;
}

const raw = envSchema.parse(process.env);

const whmFromUrl = parseWhmUrl(raw.WHM_URL);

export const env = {
  whm: {
    enabled: parseBool(raw.WHM_ENABLED, true),
    host: raw.WHM_URL ? whmFromUrl.host : raw.WHM_HOST,
    port: raw.WHM_URL ? whmFromUrl.port : parseNum(raw.WHM_PORT, 2087, 1),
    username: raw.WHM_USERNAME,
    apiToken: raw.WHM_API_TOKEN,
    timeoutMs: parseNum(raw.WHM_TIMEOUT_MS, 10000, 1000),
    rejectUnauthorized: parseBool(raw.WHM_REJECT_UNAUTHORIZED, true),
    ipFamily: raw.WHM_IP_FAMILY === '6' ? (6 as const) : (4 as const),
    syncIntervalMs: parseNum(raw.WHM_SYNC_INTERVAL_MS, 3_600_000),
    excludeSuspended: parseBool(raw.WHM_EXCLUDE_SUSPENDED, true),
    excludeSubdomains: parseBool(raw.WHM_EXCLUDE_SUBDOMAINS, false),
    excludeAddonDomains: parseBool(raw.WHM_EXCLUDE_ADDON_DOMAINS, false),
    onlyMainDomains: parseBool(raw.WHM_ONLY_MAIN_DOMAINS, false),
    emailStatsEnabled: parseBool(raw.WHM_EMAIL_STATS_ENABLED, true),
    emailStatsConcurrency: parseNum(raw.WHM_EMAIL_STATS_CONCURRENCY, 4, 1),
    rdapEnabled: parseBool(raw.WHM_RDAP_ENABLED, true),
    rdapConcurrency: parseNum(raw.WHM_RDAP_CONCURRENCY, 3, 1),
    serverProbeEnabled: parseBool(raw.WHM_SERVER_PROBE_ENABLED, true),
    serverProbeTimeoutMs: parseNum(raw.WHM_SERVER_PROBE_TIMEOUT_MS, 12000, 1000),
    ipEnrichmentEnabled: parseBool(raw.WHM_IP_ENRICHMENT_ENABLED, true),
    ipEnrichmentTimeoutMs: parseNum(raw.WHM_IP_ENRICHMENT_TIMEOUT_MS, 8000, 1000),
    serverPlan: raw.WHM_SERVER_PLAN,
    serverSystem: raw.WHM_SERVER_SYSTEM,
    excludePatterns: ['cpanel.', 'webmail.', 'mail.', 'ftp.', 'autodiscover.'],
  },
  cloudflare: {
    apiToken: raw.CLOUDFLARE_API_TOKEN,
    timeoutMs: parseNum(raw.CLOUDFLARE_TIMEOUT_MS, 10000, 1000),
  },
  rdap: {
    enabled: parseBool(raw.RDAP_ENABLED, true),
    baseUrl: raw.RDAP_BASE_URL,
    timeoutMs: parseNum(raw.RDAP_TIMEOUT_MS, 7000, 1000),
    onlyBr: parseBool(raw.RDAP_ONLY_BR, true),
  },
  monitor: {
    timeoutMs: parseNum(raw.MONITOR_TIMEOUT_MS, 10000, 1000),
    userAgent: raw.MONITOR_USER_AGENT,
    maxRetries: parseNum(raw.MONITOR_MAX_RETRIES, 2, 0),
    parallelLimit: parseNum(raw.MONITOR_PARALLEL_LIMIT, 10, 1),
    historyLimit: parseNum(raw.MONITOR_HISTORY_LIMIT, 100, 1),
    concurrency: parseNum(raw.MONITOR_CONCURRENCY, 10, 1),
  },
  ipInfoToken: raw.IPINFO_TOKEN,
};
