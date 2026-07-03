import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import type { GasServiceSync } from '../dto/gas.dto'
import { gasSaveServices } from '../providers/gas.provider'
import { env } from '../utils/env'
import { logger } from '../utils/logger'

const QUEUE_FILE = 'gas-service-queue.json'
const BATCH_SIZE = 10
const DELAY_BETWEEN_BATCHES_MS = 2_000

export interface GasQueueItem {
  dominio: string
  site: boolean
  email: boolean
  updatedAt: string
}

export interface GasQueueState {
  items: GasQueueItem[]
  lastProcessed: string | null
  totalProcessed: number
  totalErrors: number
}

function loadQueue(): GasQueueState {
  try {
    if (!existsSync(QUEUE_FILE)) {
      return { items: [], lastProcessed: null, totalProcessed: 0, totalErrors: 0 }
    }
    const data = JSON.parse(readFileSync(QUEUE_FILE, 'utf8')) as GasQueueState
    if (!Array.isArray(data.items)) data.items = []
    return data
  } catch {
    return { items: [], lastProcessed: null, totalProcessed: 0, totalErrors: 0 }
  }
}

function saveQueue(state: GasQueueState): void {
  writeFileSync(QUEUE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * Enqueue a service update. If same dominio already queued, merge (latest wins).
 */
export function enqueueServiceUpdate(
  dominio: string,
  site: boolean,
  email: boolean,
): void {
  if (!env.gas.enabled || !env.gas.apiKey) return

  const state = loadQueue()

  // Deduplicate: if dominio already in queue, update it
  const existing = state.items.find((i) => i.dominio === dominio)
  if (existing) {
    existing.site = site
    existing.email = email
    existing.updatedAt = new Date().toISOString()
  } else {
    state.items.push({
      dominio,
      site,
      email,
      updatedAt: new Date().toISOString(),
    })
  }

  saveQueue(state)
  logger.debug({ dominio, queueSize: state.items.length }, 'Service update enqueued')
}

/**
 * Enqueue multiple service updates at once.
 */
export function enqueueServiceUpdates(
  updates: Array<{ dominio: string; site: boolean; email: boolean }>,
): void {
  if (!env.gas.enabled || !env.gas.apiKey) return
  if (updates.length === 0) return

  const state = loadQueue()

  for (const u of updates) {
    const existing = state.items.find((i) => i.dominio === u.dominio)
    if (existing) {
      existing.site = u.site
      existing.email = u.email
      existing.updatedAt = new Date().toISOString()
    } else {
      state.items.push({
        dominio: u.dominio,
        site: u.site,
        email: u.email,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  saveQueue(state)
  logger.debug({ count: updates.length, queueSize: state.items.length }, 'Service updates enqueued')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Process the queue: send batched service updates to GAS.
 * Respects rate limits with delays between batches.
 */
export async function processGasQueue(): Promise<{
  processed: number
  errors: number
  remaining: number
}> {
  if (!env.gas.enabled || !env.gas.apiKey) {
    return { processed: 0, errors: 0, remaining: 0 }
  }

  const state = loadQueue()

  if (state.items.length === 0) {
    return { processed: 0, errors: 0, remaining: 0 }
  }

  logger.info({ queueSize: state.items.length }, 'Processing GAS service queue')

  let processed = 0
  let errors = 0

  // Process in batches
  for (let i = 0; i < state.items.length; i += BATCH_SIZE) {
    const batch = state.items.slice(i, i + BATCH_SIZE)
    const payload: GasServiceSync[] = batch.map((item) => ({
      dominio: item.dominio,
      site: item.site,
      email: item.email,
      updatedAt: item.updatedAt,
    }))

    const ok = await gasSaveServices(payload)

    if (ok) {
      processed += batch.length
    } else {
      errors += batch.length
    }

    // Delay between batches to avoid overloading GAS
    if (i + BATCH_SIZE < state.items.length) {
      await delay(DELAY_BETWEEN_BATCHES_MS)
    }
  }

  // Update state: remove only successfully processed items
  // Failed items stay in queue for retry on next run
  if (processed > 0) {
    state.items = state.items.slice(processed)
  }
  state.lastProcessed = new Date().toISOString()
  state.totalProcessed += processed
  state.totalErrors += errors
  saveQueue(state)

  logger.info(
    { processed, errors, remaining: state.items.length },
    'GAS service queue processed',
  )

  return { processed, errors, remaining: state.items.length }
}

/**
 * Get current queue status without processing.
 */
export function getQueueStatus(): {
  pending: number
  lastProcessed: string | null
  totalProcessed: number
  totalErrors: number
} {
  const state = loadQueue()
  return {
    pending: state.items.length,
    lastProcessed: state.lastProcessed,
    totalProcessed: state.totalProcessed,
    totalErrors: state.totalErrors,
  }
}

/**
 * Clear the queue (for manual reset).
 */
export function clearQueue(): void {
  if (existsSync(QUEUE_FILE)) {
    unlinkSync(QUEUE_FILE)
    logger.info('GAS service queue cleared')
  }
}
