import { writeToPath } from 'fast-csv';
import { format as formatDate } from 'date-fns';
import { logger } from '../utils/logger';
import type { SiteResult } from '../models/site.model';

export interface ExportRow {
  name: string;
  url: string;
  category: string;
  status: string;
  online: string;
  responseTimeMs: string;
  statusCode: string;
  ssl: string;
  whmType: string;
  whmUsername: string;
  expirationDate: string;
  mailAccounts: string;
  timestamp: string;
  error: string;
}

/**
 * Export site results to a CSV file using fast-csv.
 */
export function exportToCsv(results: SiteResult[], outputPath?: string): Promise<string> {
  const timestamp = formatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss');
  const filePath = outputPath ?? `export-${timestamp}.csv`;

  const rows: ExportRow[] = results.map((r) => ({
    name: r.name,
    url: r.url,
    category: r.category ?? '',
    status: r.online ? 'online' : 'offline',
    online: String(r.online),
    responseTimeMs: String(r.responseTime),
    statusCode: String(r.status),
    ssl: String(r.ssl ?? false),
    whmType: r.whmInfo?.type ?? '',
    whmUsername: r.whmInfo?.username ?? '',
    expirationDate: r.whmInfo?.expirationDate ?? '',
    mailAccounts: String(r.whmInfo?.mailAccountsCount ?? ''),
    timestamp: r.timestamp,
    error: r.error ?? '',
  }));

  return new Promise((resolve, reject) => {
    writeToPath(filePath, rows, { headers: true })
      .on('finish', () => {
        logger.info({ filePath, rows: rows.length }, 'CSV export complete');
        resolve(filePath);
      })
      .on('error', (err) => {
        logger.error({ error: err.message }, 'CSV export failed');
        reject(err);
      });
  });
}
