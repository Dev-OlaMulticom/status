import pLimit from 'p-limit'
import type { GasDomain } from '../dto/gas.dto'
import {
  gasListAllDomains,
  gasCreateDomain,
  gasUpdateDomain,
} from '../providers/gas.provider'
import type { SiteResult } from '../models/site.model'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

const CONCURRENCY = 3

export interface GasSyncResult {
  created: number
  updated: number
  errors: number
  timestamp: string
}

/**
 * Map local SiteResult data to GAS domain format.
 */
export function mapSiteToGasDomain(site: SiteResult): Partial<GasDomain> {
  const hostname = (() => {
    try { return new URL(site.url).hostname } catch { return site.url }
  })()

  const effectiveIp = site.cloudflareIp ?? site.ip ?? null
  const isWhm = effectiveIp === '31.97.169.57'
  const isCf = site.cloudflareIp !== null
  let servidor = 'Não'
  if (isWhm && isCf) servidor = 'WHM+CF'
  else if (isWhm) servidor = 'WHM'
  else if (isCf) servidor = 'CF'
  else if (effectiveIp) servidor = 'Fora'

  const tipo = site.whmInfo?.type === 'principal' || site.whmInfo === undefined ? 'Conta' : 'Adicionado'
  const subtipo = site.whmInfo?.username ?? ''

  let vencimento = ''
  if (site.whmInfo?.expirationDate) {
    const d = new Date(site.whmInfo.expirationDate)
    if (!Number.isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0')
      const month = d.toLocaleDateString('pt-BR', { month: 'long' })
      const year = d.getFullYear()
      vencimento = `${day}/${month.charAt(0).toUpperCase() + month.slice(1)}/${year}`
    }
  }

  let dias_restantes = 0
  if (site.whmInfo?.expirationDate) {
    const ms = new Date(site.whmInfo.expirationDate).getTime() - Date.now()
    dias_restantes = Math.ceil(ms / (1000 * 60 * 60 * 24))
  }

  return {
    dominio: hostname,
    tipo,
    subtipo,
    status: site.online ? 'Online' : 'Offline',
    vencimento,
    dias_restantes,
    servidor,
    servidor_ip: effectiveIp ?? '',
  }
}

/**
 * Sync local monitor results to GAS.
 * For each domain, check if it exists in GAS; if not, create it; if so, update status.
 */
export async function syncToGas(sites: SiteResult[]): Promise<GasSyncResult> {
  if (!env.gas.enabled || !env.gas.apiKey) {
    return { created: 0, updated: 0, errors: 0, timestamp: new Date().toISOString() }
  }

  logger.info({ count: sites.length }, 'Starting GAS sync')

  const existingDomains = await gasListAllDomains()
  const existingMap = new Map<string, GasDomain>()
  for (const d of existingDomains) {
    existingMap.set(d.dominio.toLowerCase(), d)
  }

  const limit = pLimit(CONCURRENCY)
  let created = 0
  let updated = 0
  let errors = 0

  const results = await Promise.allSettled(
    sites.map((site) =>
      limit(async () => {
        const hostname = (() => {
          try { return new URL(site.url).hostname } catch { return site.url }
        })()
        const gasData = mapSiteToGasDomain(site)
        const existing = existingMap.get(hostname.toLowerCase())

        if (existing) {
          const changed =
            existing.status !== gasData.status ||
            existing.servidor !== gasData.servidor ||
            existing.servidor_ip !== gasData.servidor_ip

          if (changed) {
            const ok = await gasUpdateDomain(existing.id, {
              status: gasData.status,
              servidor: gasData.servidor,
              servidor_ip: gasData.servidor_ip,
            })
            if (ok) updated++
            else errors++
          }
        } else {
          const result = await gasCreateDomain(gasData)
          if (result) created++
          else errors++
        }
      }),
    ),
  )

  for (const r of results) {
    if (r.status === 'rejected') errors++
  }

  const syncResult: GasSyncResult = {
    created,
    updated,
    errors,
    timestamp: new Date().toISOString(),
  }

  logger.info(syncResult, 'GAS sync complete')
  return syncResult
}

/**
 * Pull all domains from GAS and return them.
 */
export async function pullFromGas(): Promise<GasDomain[]> {
  if (!env.gas.enabled || !env.gas.apiKey) return []
  return gasListAllDomains()
}
