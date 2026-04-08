import { clearApiCache } from './api-cache';

const scope = process.argv[2] as 'all' | 'whm' | 'cloudflare' | 'rdap' | undefined;

if (!scope || scope === 'all') {
  clearApiCache();
  console.log('✅ Cache cleared: all');
  process.exit(0);
}

if (scope === 'whm' || scope === 'cloudflare' || scope === 'rdap') {
  clearApiCache(scope);
  console.log(`✅ Cache cleared: ${scope}`);
  process.exit(0);
}

console.error('Usage: ts-node cache-tools.ts [all|whm|cloudflare|rdap]');
process.exit(1);
