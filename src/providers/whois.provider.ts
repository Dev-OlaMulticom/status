import whoiser from 'whoiser';
import { logger } from '../utils/logger';
import { getCached } from '../cache/cache.service';
import { getRdapDates } from './rdap.provider';
import type { WhoisInfo } from '../dto/whois.dto';

const WHOIS_TTL = 24 * 60 * 60 * 1000;

function firstString(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (Array.isArray(val) && val.length > 0) return String(val[0]).trim() || null;
  return null;
}

function parseDate(val: unknown): string | null {
  const s = firstString(val);
  if (!s) return null;
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch { /* fall through */ }
  return null;
}

/**
 * Query WHOIS data for a domain using whoiser.
 * Falls back to RDAP if WHOIS fails.
 */
export async function getWhoisInfo(domain: string, bypassCache = false): Promise<WhoisInfo> {
  const result = await getCached<WhoisInfo>({
    namespace: 'whois',
    keyParts: [domain],
    ttlOverrideMs: WHOIS_TTL,
    bypassCache,
    fetcher: async () => {
      try {
        const data = await whoiser(domain, { timeout: 8000, raw: false });
        const tld = Object.values(data)[0] as any ?? {};

        const expirationDate =
          parseDate(tld['Expiry Date']) ??
          parseDate(tld['Registry Expiry Date']) ??
          parseDate(tld['Expiration Date']);

        const createdDate =
          parseDate(tld['Created Date']) ??
          parseDate(tld['Creation Date']) ??
          parseDate(tld['Registration Time']);

        const registrar = firstString(tld['Registrar']);
        const ns = Array.isArray(tld['Name Server'])
          ? tld['Name Server'].map(String)
          : typeof tld['Name Server'] === 'string'
            ? [tld['Name Server']]
            : [];
        const status = Array.isArray(tld['Domain Status'])
          ? tld['Domain Status'].map(String)
          : typeof tld['Domain Status'] === 'string'
            ? [tld['Domain Status']]
            : [];

        return { expirationDate, createdDate, registrar, nameservers: ns, status };
      } catch (error: any) {
        logger.debug({ domain, error: error.message }, 'WHOIS failed, falling back to RDAP');
        const rdap = await getRdapDates(domain, bypassCache);
        return {
          expirationDate: rdap.expirationDate,
          createdDate: null,
          registrar: null,
          nameservers: [],
          status: [],
        };
      }
    },
  });

  if (result.source !== 'network') {
    logger.debug({ domain, source: result.source }, 'WHOIS cache hit');
  }

  return result.value;
}
