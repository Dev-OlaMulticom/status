export type DomainType = 'principal' | 'addon' | 'subdominio';
export type SitePriority = 'critical' | 'high' | 'normal' | 'low';
export type SiteCategory = 'manual' | 'whm' | 'externo' | 'api' | 'cdn';

export interface WhmInfo {
  type: DomainType;
  username: string;
  status: string;
  expirationDate?: string;
  renewalDate?: string;
  mailAccountsCount?: number | null;
}

export interface Site {
  name: string;
  url: string;
  category?: SiteCategory;
  priority?: SitePriority;
  whmInfo?: WhmInfo;
}

export interface SiteResult extends Site {
  status: number;
  online: boolean;
  responseTime: number;
  timestamp: string;
  ssl?: boolean;
  error?: string;
  attempts?: number;
}

export interface SiteStats {
  total: number;
  manual: number;
  whm: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
}

export interface CheckResult {
  timestamp: string;
  results: SiteResult[];
  stats: SiteStats;
}

export interface ServerInfo {
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

export interface SitesConfig {
  manualSites: Site[];
  whmSites: Site[];
  lastWhmSync: string | null;
  serverInfo: ServerInfo;
  lastUpdate: string;
}

export interface MonitorHistory {
  checks: CheckResult[];
}
