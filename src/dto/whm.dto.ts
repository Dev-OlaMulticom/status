import { z } from 'zod'
import type { DomainType } from '../models/site.model'

export const WhmDomainRawSchema = z.object({
  domain: z.string(),
  user: z.string().optional(),
  username: z.string().optional(),
  suspended: z.union([z.boolean(), z.number()]).optional(),
  main_domain: z.string().optional(),
  parent_domain: z.string().optional(),
  ip: z.string().optional(),
  ipv4: z.string().optional(),
  addon: z.union([z.boolean(), z.number()]).optional(),
  sub_domain: z.union([z.boolean(), z.number()]).optional(),
  type: z.string().optional(),
  domain_type: z.string().optional(),
})

export type WhmDomainRaw = z.infer<typeof WhmDomainRawSchema>

export interface DomainInfo {
  domain: string
  username: string
  status: string
  type: DomainType
  mainDomain: string
  ip: string
  addon: boolean
  subdomain: boolean
  mailAccountsCount?: number | null
}

export interface AccountInfo {
  username: string
  domains: string[]
  suspended: boolean
  mailAccountsCount?: number | null
}

export interface WhmExtractResult {
  domains: DomainInfo[]
  accounts: AccountInfo[]
  timestamp: string
}

export interface WhmAccountDetail {
  username: string
  domain: string
  plan: string
  diskused: number
  diskquota: number
  diskpercent: number
  bwused: number
  bwquota: number
  bwpercent: number
  emailAccounts: number
  suspended: boolean
  ip: string
  startdate: string | null
}
