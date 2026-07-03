import type { SiteAnalytics } from '../models/site.model'
import { getCached } from '../cache/cache.service'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

export type ZoneAnalytics = SiteAnalytics

interface AnalyticsTotals {
  all: {
    requests: { all: number }
    threats: { all: number }
    pageviews: { all: number }
  }
}

/**
 * Fetch total requests (visits) for a Cloudflare zone using the Analytics API.
 * Uses the dashboard endpoint with date range for the last 30 days.
 */
export async function getZoneAnalytics(
  zoneId: string,
  zoneName: string,
): Promise<ZoneAnalytics | null> {
  if (!env.cloudflare.apiToken) return null

  const result = await getCached<ZoneAnalytics | null>({
    namespace: 'cloudflare',
    keyParts: ['analytics', zoneId],
    ttlOverrideMs: 60 * 60 * 1000, // 1 hour cache
    fetcher: async () => {
      try {
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - 30)

        const dateStart = startDate.toISOString().split('T')[0]
        const dateEnd = endDate.toISOString().split('T')[0]

        const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/analytics/dashboard?since=${dateStart}T00:00:00Z&until=${dateEnd}T23:59:59Z&continuous=true`

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${env.cloudflare.apiToken}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          logger.debug(
            { zoneId, zoneName, status: response.status },
            'Cloudflare analytics fetch failed',
          )
          return null
        }

        const payload = (await response.json()) as {
          success: boolean
          result?: AnalyticsTotals
        }

        if (!payload.success || !payload.result) {
          logger.debug({ zoneId, zoneName }, 'Cloudflare analytics: no data')
          return null
        }

        const totals = payload.result
        return {
          zoneId,
          zoneName,
          totalRequests: totals.all?.requests?.all ?? 0,
          threats: totals.all?.threats?.all ?? 0,
          pageViews: totals.all?.pageviews?.all ?? 0,
          fetchAt: new Date().toISOString(),
        }
      } catch (error: any) {
        logger.debug(
          { zoneId, zoneName, error: error.message },
          'Cloudflare analytics fetch error',
        )
        return null
      }
    },
  })

  return result.value
}
