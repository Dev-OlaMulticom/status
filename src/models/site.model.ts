export type DomainType = 'principal' | 'addon' | 'subdominio'
export type SitePriority = 'critical' | 'high' | 'normal' | 'low'
export type SiteCategory = 'manual' | 'whm' | 'externo' | 'api' | 'cdn'

export interface WhmInfo {
  type: DomainType
  username: string
  status: string
  expirationDate?: string
  renewalDate?: string
  mailAccountsCount?: number | null
}

export interface WhmUsageInfo {
  diskUsedMb: number | null
  diskQuotaMb: number | null
  diskPercent: number | null
  bwUsedMb: number | null
  bwQuotaMb: number | null
  bwPercent: number | null
  plan: string | null
  startdate: string | null
}

export interface CloudflareSiteInfo {
  zoneId: string | null
  zoneName: string | null
  sslMode: string | null
  securityLevel: string | null
  alwaysUseHttps: boolean | null
  dnssecEnabled: boolean | null
  totalRecords: number
  nameservers: string[]
  proxied: boolean | null
}

export interface Site {
  name: string
  url: string
  category?: SiteCategory
  priority?: SitePriority
  whmInfo?: WhmInfo
  whmUsage?: WhmUsageInfo
  cloudflareInfo?: CloudflareSiteInfo
}

export type HostingProvider = 'whm' | 'cloudflare' | 'both' | 'unknown'

export interface SiteResult extends Site {
  status: number
  online: boolean
  responseTime: number
  timestamp: string
  ssl?: boolean
  error?: string
  attempts?: number
  ip?: string | null
  cloudflareIp?: string | null
  hosting?: HostingProvider
  dnsRecords?: {
    a: string[]
    aaaa: string[]
    cname: string | null
    mx: string[]
    txt: string[]
    ns: string[]
  }
}

export interface SiteStats {
  total: number
  manual: number
  whm: number
  byCategory: Record<string, number>
  byPriority: Record<string, number>
}

export interface CheckResult {
  timestamp: string
  results: SiteResult[]
  stats: SiteStats
}

export interface ServerInfo {
  host: string
  ip: string | null
  plan: string
  system: string
  reverseDns?: string | null
  whoisOrg?: string | null
  whoisCountry?: string | null
  whoisNetName?: string | null
  whoisAsn?: string | null
  httpServer?: string | null
  osGuess?: string | null
  isp?: string | null
  asName?: string | null
  geoCity?: string | null
  geoRegion?: string | null
  geoCountry?: string | null
  geoTimezone?: string | null
  ipApiSource?: string | null
  probedAt?: string
}

export interface SitesConfig {
  manualSites: Site[]
  whmSites: Site[]
  lastWhmSync: string | null
  serverInfo: ServerInfo
  lastUpdate: string
  cloudflareOverview?: {
    totalZones: number
    accountEmail: string | null
    lastSync: string | null
  }
  whmUsage?: WhmUsageSummary
}

export interface WhmUsageSummary {
  totalDiskUsedMb: number
  totalDiskQuotaMb: number
  totalBwUsedMb: number
  totalBwQuotaMb: number
  totalAccounts: number
}

export interface SiteAnalytics {
  zoneId?: string
  zoneName?: string
  totalRequests?: number
  requests?: number
  threats: number
  pageViews?: number
  pageviews?: number
  fetchAt?: string
  lastUpdated?: string
}

export interface MonitorHistory {
  checks: CheckResult[]
}
