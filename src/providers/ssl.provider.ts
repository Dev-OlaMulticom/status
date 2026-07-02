import { differenceInDays } from 'date-fns'
import sslChecker from 'ssl-checker'
import { getCached } from '../cache/cache.service'
import type { SslInfo } from '../dto/ssl.dto'
import { logger } from '../utils/logger'

const SSL_TTL = 24 * 60 * 60 * 1000

/**
 * Check the SSL certificate for a hostname using ssl-checker.
 */
export async function checkSsl(hostname: string, bypassCache = false): Promise<SslInfo> {
  const result = await getCached<SslInfo>({
    namespace: 'ssl',
    keyParts: [hostname],
    ttlOverrideMs: SSL_TTL,
    bypassCache,
    fetcher: async () => {
      try {
        const data = await sslChecker(hostname, { method: 'GET', port: 443, timeout: 10000 })
        const expiresAt = data.validTo ? new Date(data.validTo).toISOString() : null
        const daysRemaining = expiresAt ? differenceInDays(new Date(expiresAt), new Date()) : null
        return {
          valid: data.valid ?? false,
          expiresAt,
          daysRemaining,
          issuer: null,
        }
      } catch (error: any) {
        logger.debug({ hostname, error: error.message }, 'SSL check failed')
        return { valid: false, expiresAt: null, daysRemaining: null, issuer: null }
      }
    },
  })

  if (result.source !== 'network') {
    logger.debug({ hostname, source: result.source }, 'SSL cache hit')
  }

  return result.value
}
