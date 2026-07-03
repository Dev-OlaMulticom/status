import Dexie, { type EntityTable } from 'dexie';

export interface DomainService {
  id?: number;
  domain: string;
  site: boolean;
  email: boolean;
  updatedAt: string;
}

const db = new Dexie('OlamulticomDomainServices') as Dexie & {
  services: EntityTable<DomainService, 'id'>;
};

db.version(1).stores({
  services: '++id, domain, site, email, updatedAt',
});

export { db };

export async function getAllServices(): Promise<Map<string, DomainService>> {
  const all = await db.services.toArray();
  const map = new Map<string, DomainService>();
  for (const s of all) {
    map.set(s.domain, s);
  }
  return map;
}

export async function upsertService(domain: string, field: 'site' | 'email', value: boolean): Promise<void> {
  const existing = await db.services.where('domain').equals(domain).first();
  if (existing) {
    await db.services.update(existing.id!, { [field]: value, updatedAt: new Date().toISOString() });
  } else {
    await db.services.add({
      domain,
      site: field === 'site' ? value : false,
      email: field === 'email' ? value : false,
      updatedAt: new Date().toISOString(),
    });
  }
  // Enqueue for GAS sync
  enqueueForGasSync(domain);
}

// ─── GAS Sync Queue ─────────────────────────────────────────────────────────
// Stores pending service updates in localStorage to be synced to GAS by the backend.

const GAS_QUEUE_KEY = 'olamulticom_gas_service_queue';
const GAS_QUEUE_VERSION = 1;

type GasQueueEntry = {
  dominio: string;
  site: boolean;
  email: boolean;
  updatedAt: string;
};

type GasQueue = {
  version: number;
  items: GasQueueEntry[];
};

function loadGasQueue(): GasQueue {
  try {
    const raw = localStorage.getItem(GAS_QUEUE_KEY);
    if (!raw) return { version: GAS_QUEUE_VERSION, items: [] };
    const parsed = JSON.parse(raw) as GasQueue;
    if (!Array.isArray(parsed.items)) return { version: GAS_QUEUE_VERSION, items: [] };
    return parsed;
  } catch {
    return { version: GAS_QUEUE_VERSION, items: [] };
  }
}

function saveGasQueue(queue: GasQueue): void {
  try {
    localStorage.setItem(GAS_QUEUE_KEY, JSON.stringify(queue));
  } catch { /* Storage full — silently drop */ }
}

function enqueueForGasSync(domain: string): void {
  const queue = loadGasQueue();

  // Read current state from Dexie to get latest values
  db.services.where('domain').equals(domain).first().then((svc) => {
    if (!svc) return;

    const existing = queue.items.find((i) => i.dominio === domain);
    if (existing) {
      existing.site = svc.site;
      existing.email = svc.email;
      existing.updatedAt = svc.updatedAt;
    } else {
      queue.items.push({
        dominio: domain,
        site: svc.site,
        email: svc.email,
        updatedAt: svc.updatedAt,
      });
    }

    saveGasQueue(queue);
  }).catch(() => { /* Ignore */ });
}

/**
 * Get pending GAS sync queue for export (used by backend or admin panel).
 */
export async function getGasSyncQueue(): Promise<GasQueueEntry[]> {
  return loadGasQueue().items;
}

/**
 * Clear the GAS sync queue after backend processes it.
 */
export function clearGasSyncQueue(): void {
  localStorage.removeItem(GAS_QUEUE_KEY);
}

/**
 * Get queue count for UI display.
 */
export function getGasQueueCount(): number {
  return loadGasQueue().items.length;
}
