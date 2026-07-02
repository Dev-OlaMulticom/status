import got from 'got'
import { getCached } from '../cache/cache.service'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

export interface HttpCheckResult {
  online: boolean
  statusCode: number
  responseTimeMs: number
  redirectUrls: string[]
  finalUrl: string
  error?: string
}

/**
 * Check the HTTP/HTTPS availability of a URL using got.
 * Never uses ICMP ping — always HTTP.
 */
export async function checkUrl(url: string, useCache = false): Promise<HttpCheckResult> {
  const check = async (): Promise<HttpCheckResult> => {
    const start = Date.now()
    try {
      const response = await got(url, {
        timeout: { request: env.monitor.timeoutMs },
        retry: { limit: 0 },
        followRedirect: true,
        headers: { 'User-Agent': env.monitor.userAgent },
        throwHttpErrors: false,
      })

      const responseTimeMs = Date.now() - start
      const statusCode = response.statusCode

      return {
        online: statusCode >= 200 && statusCode < 400,
        statusCode,
        responseTimeMs,
        redirectUrls: response.redirectUrls?.map(String) ?? [],
        finalUrl: String(response.url ?? url),
      }
    } catch (error: any) {
      const responseTimeMs = Date.now() - start
      logger.debug({ url, error: error.message }, 'HTTP check failed')
      return {
        online: false,
        statusCode: 0,
        responseTimeMs,
        redirectUrls: [],
        finalUrl: url,
        error: String(error?.message ?? error),
      }
    }
  }

  if (!useCache) return check()

  const result = await getCached<HttpCheckResult>({
    namespace: 'http',
    keyParts: [url],
    fetcher: check,
  })

  return result.value
}

/**
 * Fetch a JSON payload from a URL using got.
 */
export async function fetchJson<T = unknown>(url: string, timeoutMs?: number): Promise<T> {
  const response = await got<T>(url, {
    timeout: { request: timeoutMs ?? env.monitor.timeoutMs },
    retry: { limit: 1 },
    headers: { 'User-Agent': env.monitor.userAgent },
    responseType: 'json',
  })
  return response.body
}
