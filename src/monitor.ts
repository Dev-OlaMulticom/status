import 'dotenv/config'
import { MonitorService } from './services/monitor.service'
import { logger } from './utils/logger'

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Rejection')
  process.exit(254)
})

process.on('uncaughtException', (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught Exception')
  process.exit(254)
})

async function main(): Promise<void> {
  logger.info('Monitor starting...')

  const monitor = new MonitorService()

  try {
    const results = await monitor.run()
    const online = results.filter((r) => r.online).length
    const offline = results.length - online
    const stats = monitor.accountService.getStats()

    logger.info(
      {
        total: results.length,
        online,
        offline,
        manual: stats.manual,
        whm: stats.whm,
        uptime: `${monitor.calculateUptime()}%`,
        lastWhmSync: monitor.accountService.lastWhmSync ?? 'never',
      },
      'Monitor run complete',
    )

    if (offline > 0) {
      const offlineSites = results.filter((r) => !r.online)
      for (const site of offlineSites) {
        logger.warn(
          { name: site.name, url: site.url, error: site.error ?? `HTTP ${site.status}` },
          'Site offline',
        )
      }
    }
  } catch (error: any) {
    logger.fatal({ error: error.message }, 'Monitor run failed')
    process.exit(1)
  }
}

main()
