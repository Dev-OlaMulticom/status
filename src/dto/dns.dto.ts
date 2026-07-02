export interface DnsInfo {
  ipv4: string | null
  ipv6: string | null
  mx: string[]
  txt: string[]
  ns: string[]
  cname: string | null
}
