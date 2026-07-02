export interface CloudflareDnsRecord {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean | null
  createdOn: string | null
  modifiedOn: string | null
}

export interface CloudflareDnsSec {
  status: string
  enabled: boolean
  algorithm: string | null
  digest: string | null
  digestType: string | null
}

export interface CloudflareZoneSettings {
  sslMode: string | null
  minTlsVersion: string | null
  securityLevel: string | null
  alwaysUseHttps: boolean | null
  http2: boolean | null
  http3: boolean | null
  brotli: boolean | null
  rocketLoader: boolean | null
  emailObfuscation: boolean | null
  ipGeolocation: boolean | null
}

export interface CloudflareAccountInfo {
  id: string
  email: string
}

export interface CloudflareZoneSummary {
  id: string
  name: string
  status: string
  paused: boolean
  plan: string
  ssl: string | null
  nameServers: string[]
  createdOn: string | null
  modifiedOn: string | null
  originalRegistrar: string | null
  originalDnsHost: string | null
  totalDnsRecords: number
  aRecords: string[]
  aaaaRecords: string[]
  cnameRecords: string[]
  mxRecords: string[]
  txtRecords: string[]
  nsRecords: string[]
  settings: CloudflareZoneSettings | null
  dnssec: CloudflareDnsSec | null
}

export interface CloudflareOverview {
  account: CloudflareAccountInfo | null
  totalZones: number
  zones: CloudflareZoneSummary[]
  timestamp: string
}
