const { appendFile } = require('node:fs/promises');
const { join } = require('node:path');
const { SharedQueryCache } = require('../../src/utils/shared-query-cache.ts');
const [directory, key, mode] = process.argv.slice(2);
const cache = new SharedQueryCache(directory);
cache.get(key, 300000, async () => {
  await appendFile(join(directory, 'requests.txt'), 'request\n');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (mode === 'failure') throw new Error('HTTP 429');
  return { remaining: 70 };
}).then(value => process.stdout.write(JSON.stringify({ value })),
  error => process.stdout.write(JSON.stringify({ error: error.message })));
