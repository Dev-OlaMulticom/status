import 'dotenv/config'
import Cloudflare from 'cloudflare'
import { logger } from './utils/logger'

async function checkCloudflare(): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN

  if (!token) {
    logger.error('CLOUDFLARE_API_TOKEN no está configurado en .env')
    process.exit(1)
  }

  logger.info('Verificando conexión con Cloudflare API...')

  const client = new Cloudflare({ apiToken: token })

  try {
    const user = await client.user.get()
    logger.info({
      email: (user as any)?.email,
      id: (user as any)?.id,
    }, '✅ Conexión exitosa - Usuario autenticado')

    const zones = await client.zones.list()
    const zoneList = (zones as any)?.result ?? []

    logger.info({ total: zoneList.length }, '📋 Zonas encontradas')

    for (const zone of zoneList) {
      logger.info({
        name: zone.name,
        status: zone.status,
        plan: zone.plan?.name ?? 'unknown',
        nameservers: zone.name_servers,
      }, `  🌐 Zona: ${zone.name}`)
    }

    logger.info('✅ Verificación de Cloudflare completada exitosamente')
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Error al conectar con Cloudflare API')
    if (error.message?.includes('Unauthorized') || error.message?.includes('authentication')) {
      logger.error('El token de API es inválido o no tiene permisos suficientes')
    }
    process.exit(1)
  }
}

checkCloudflare()
