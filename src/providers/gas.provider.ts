import type { GasApiResponse, GasDomain, GasListParams, GasServiceSync } from '../dto/gas.dto'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

const GAS_TIMEOUT_MS = 30_000

function getBaseUrl(): string {
  return env.gas.apiUrl
}

function getKey(): string {
  return env.gas.apiKey ?? ''
}

function buildGetUrl(action: string, params: Record<string, string> = {}): string {
  const url = new URL(getBaseUrl())
  url.searchParams.set('action', action)
  url.searchParams.set('key', getKey())
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  return url.toString()
}

/**
 * Follow GAS redirect chain using Node.js https module.
 * Google Apps Script web apps have a 3x redirect chain:
 *   /exec → googleusercontent.com/macros/echo → script.google.com → echo → 200
 * Node.js fetch hangs on these redirects, so we use https.get with manual redirect handling.
 */
function httpsGet(targetUrl: string, timeoutMs: number, depth = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('GAS: too many redirects'))

    const https = require('https')
    const req = https.get(targetUrl, {
      headers: { 'User-Agent': 'Node.js/20' },
      timeout: timeoutMs,
    }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return httpsGet(res.headers.location, timeoutMs, depth + 1).then(resolve, reject)
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('GAS: request timeout')) })
    req.on('error', reject)
  })
}

async function gasFetchWithRedirect<T>(url: string): Promise<GasApiResponse<T>> {
  try {
    const result = await httpsGet(url, GAS_TIMEOUT_MS)
    if (result.status !== 200) {
      return { ok: false, error: `HTTP ${result.status}` }
    }
    return JSON.parse(result.body) as GasApiResponse<T>
  } catch (error: any) {
    logger.debug({ error: error.message }, 'GAS API fetch failed')
    return { ok: false, error: error.message }
  }
}

/**
 * Send action to GAS via GET with payload parameter.
 * Google Apps Script echo proxy only supports GET — POST is blocked (405).
 * The GAS script must handle `payload` param for write actions.
 */
async function gasAction<T>(
  action: string,
  data?: Record<string, unknown>,
): Promise<GasApiResponse<T>> {
  try {
    const url = new URL(getBaseUrl())
    url.searchParams.set('action', action)
    url.searchParams.set('key', getKey())
    if (data) {
      url.searchParams.set('payload', JSON.stringify(data))
    }

    const result = await httpsGet(url.toString(), GAS_TIMEOUT_MS)
    if (result.status !== 200) {
      return { ok: false, error: `HTTP ${result.status}` }
    }
    return JSON.parse(result.body) as GasApiResponse<T>
  } catch (error: any) {
    logger.debug({ error: error.message }, 'GAS action failed')
    return { ok: false, error: error.message }
  }
}

/** Legacy wrapper for GET requests */
async function gasFetch<T>(url: string, options?: RequestInit): Promise<GasApiResponse<T>> {
  return gasFetchWithRedirect<T>(url)
}

export async function gasListDomains(params: GasListParams = {}): Promise<GasDomain[]> {
  if (!env.gas.enabled || !env.gas.apiKey) return []

  const queryParams: Record<string, string> = {}
  if (params.status) queryParams.status = params.status
  if (params.servidor) queryParams.servidor = params.servidor
  if (params.tipo) queryParams.tipo = params.tipo
  if (params.q) queryParams.q = params.q
  if (params.limit) queryParams.limit = String(params.limit)
  if (params.offset) queryParams.offset = String(params.offset)

  const url = buildGetUrl('list', queryParams)
  const result = await gasFetch<GasDomain[]>(url)

  if (!result.ok) {
    logger.warn({ error: result.error }, 'GAS list domains failed')
    return []
  }

  return Array.isArray(result.data) ? result.data : []
}

/**
 * Fetch ALL domains from GAS, handling pagination automatically.
 */
export async function gasListAllDomains(): Promise<GasDomain[]> {
  if (!env.gas.enabled || !env.gas.apiKey) return []

  const PAGE_SIZE = 50
  const allDomains: GasDomain[] = []
  let offset = 0

  while (true) {
    const batch = await gasListDomains({ limit: PAGE_SIZE, offset })
    allDomains.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return allDomains
}

export async function gasGetDomain(id: string): Promise<GasDomain | null> {
  if (!env.gas.enabled || !env.gas.apiKey) return null

  const url = buildGetUrl('get', { id })
  const result = await gasFetch<GasDomain>(url)

  if (!result.ok || !result.data) {
    logger.debug({ id, error: result.error }, 'GAS get domain failed')
    return null
  }

  return result.data
}

export async function gasCreateDomain(
  data: Partial<GasDomain>,
): Promise<GasDomain | null> {
  if (!env.gas.enabled || !env.gas.apiKey) return null

  const result = await gasAction<GasDomain>('create', { data })

  if (!result.ok || !result.data) {
    logger.warn({ dominio: data.dominio, error: result.error }, 'GAS create domain failed')
    return null
  }

  logger.info({ dominio: data.dominio, id: result.data.id }, 'GAS domain created')
  return result.data
}

export async function gasUpdateDomain(
  id: string,
  data: Partial<GasDomain>,
): Promise<boolean> {
  if (!env.gas.enabled || !env.gas.apiKey) return false

  const result = await gasAction<GasDomain>('update', { id, data })

  if (!result.ok) {
    logger.warn({ id, error: result.error }, 'GAS update domain failed')
    return false
  }

  logger.debug({ id }, 'GAS domain updated')
  return true
}

export async function gasComment(
  id: string,
  comentarios: string,
): Promise<boolean> {
  if (!env.gas.enabled || !env.gas.apiKey) return false

  const result = await gasAction('comment', { id, data: { comentarios } })

  if (!result.ok) {
    logger.warn({ id, error: result.error }, 'GAS comment failed')
    return false
  }

  logger.debug({ id }, 'GAS comment added')
  return true
}

export async function gasDeleteDomain(id: string): Promise<boolean> {
  if (!env.gas.enabled || !env.gas.apiKey) return false

  const result = await gasAction('delete', { id })

  if (!result.ok) {
    logger.warn({ id, error: result.error }, 'GAS delete domain failed')
    return false
  }

  logger.info({ id }, 'GAS domain deleted')
  return true
}

/**
 * Save service status (site/email) for a batch of domains to GAS.
 * Uses the `save_services` action with payload parameter.
 * GAS script must handle this action in doGet(e) with e.parameter.payload.
 */
export async function gasSaveServices(
  services: GasServiceSync[],
): Promise<boolean> {
  if (!env.gas.enabled || !env.gas.apiKey) return false
  if (services.length === 0) return true

  const result = await gasAction('save_services', { services })

  if (!result.ok) {
    logger.warn({ count: services.length, error: result.error }, 'GAS save_services failed')
    return false
  }

  logger.debug({ count: services.length }, 'GAS services saved')
  return true
}
