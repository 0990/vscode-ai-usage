const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readdir, readFile, writeFile, mkdir, stat, utimes } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const http = require('node:http');
const { SharedQueryCache } = require('../src/utils/shared-query-cache.ts');
const { httpRequest } = require('../src/utils/http.ts');
const exec = promisify(execFile);

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-usage-shared-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'cache');
}

test('successes and failures survive host reloads and expire only after the configured cycle', async t => {
  const root = await directory(t);
  let now = 1000000, calls = 0;
  const query = async () => { calls++; return { remaining: 80 }; };
  const firstHost = new SharedQueryCache(root, () => now);
  const secondHost = new SharedQueryCache(root, () => now);
  await Promise.all([firstHost.get('claude', 300000, query), secondHost.get('claude', 300000, query)]);
  assert.equal(calls, 1);
  assert.deepEqual(await new SharedQueryCache(root, () => now).get('claude', 300000, query), { remaining: 80 });
  now += 299999;
  await secondHost.get('claude', 300000, query);
  assert.equal(calls, 1);
  now++;
  await secondHost.get('claude', 300000, query);
  assert.equal(calls, 2);

  const fail = async () => { calls++; throw new Error('HTTP 429'); };
  await assert.rejects(firstHost.get('chatgpt', 300000, fail), /429/);
  await assert.rejects(new SharedQueryCache(root, () => now).get('chatgpt', 300000, fail), /429/);
  assert.equal(calls, 3);
  now += 300000;
  await assert.rejects(secondHost.get('chatgpt', 300000, fail), /429/);
  assert.equal(calls, 4);
});

test('independent extension processes share both a successful result and a failed request', async t => {
  for (const mode of ['success', 'failure']) {
    const root = await directory(t);
    const args = ['--require', resolve('scripts/register-typescript.cjs'),
      resolve('tests/fixtures/cache-worker.cjs'), root, 'same-account', mode];
    const results = await Promise.all(Array.from({ length: 4 }, () => exec(process.execPath, args)));
    const samples = results.map(result => JSON.parse(result.stdout));
    for (const sample of samples) assert.deepEqual(sample, mode === 'success'
      ? { value: { remaining: 70 } } : { error: 'HTTP 429' });
    assert.equal((await readFile(join(root, 'requests.txt'), 'utf8')).trim(), 'request');
  }
});

test('accounts/channels are isolated and credentials are hashed rather than written into cache keys', async t => {
  const root = await directory(t);
  const cache = new SharedQueryCache(root);
  let calls = 0;
  for (const key of [['http', 'claude', 'private-token-A'], ['http', 'claude', 'private-token-B'], ['http', 'chatgpt', 'private-token-A']]) {
    await cache.get(key, 300000, async () => ++calls);
  }
  assert.equal(calls, 3);
  const files = await readdir(root);
  assert.equal(files.length, 3);
  for (const name of files) {
    assert.match(name, /^[a-f0-9]{64}\.json$/);
    assert.doesNotMatch(await readFile(join(root, name), 'utf8'), /private-token/);
    if (process.platform !== 'win32') assert.equal((await stat(join(root, name))).mode & 0o777, 0o600);
  }
  if (process.platform !== 'win32') assert.equal((await stat(root)).mode & 0o777, 0o700);
});

test('an interrupted host reserves the rest of the cycle and abandoned locks can recover', async t => {
  const root = await directory(t);
  await mkdir(root, { recursive: true });
  let now = Date.now(), calls = 0;
  const digest = createHash('sha256').update(JSON.stringify('interrupted')).digest('hex');
  const file = join(root, `${digest}.json`);
  await writeFile(file, JSON.stringify({ version: 1, expiresAt: now + 300000, state: 'pending', error: '查询已中断，下个周期再查' }));
  await mkdir(`${file}.lock`);
  const abandoned = new Date(Date.now() - 20000);
  await utimes(`${file}.lock`, abandoned, abandoned);
  const cache = new SharedQueryCache(root, () => now);
  const query = async () => ++calls;
  await assert.rejects(cache.get('interrupted', 300000, query), /中断/);
  assert.equal(calls, 0);
  now += 300000;
  assert.equal(await cache.get('interrupted', 300000, query), 1);
});

test('cache filesystem failures stop the query instead of bypassing shared protection', async t => {
  const root = await directory(t);
  await mkdir(root, { recursive: true });
  const blocker = join(root, 'not-a-directory');
  await writeFile(blocker, 'blocked');
  let calls = 0;
  await assert.rejects(new SharedQueryCache(blocker).get('key', 300000, async () => ++calls), /缓存/);
  assert.equal(calls, 0);
});

test('429/5xx/network failures make one HTTP attempt and are shared until the next cycle', async t => {
  const requests = new Map();
  const server = http.createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) || 0) + 1);
    if (req.url === '/network') { req.socket.destroy(); return; }
    const code = req.url.includes('429') ? 429 : req.url === '/500' ? 500 : 200;
    const retryAfter = req.url === '/429-long' ? '600'
      : req.url === '/429-date' ? new Date(Date.now() + 600000).toUTCString()
      : req.url === '/429-zero' ? '0' : undefined;
    res.writeHead(code, retryAfter ? { 'retry-after': retryAfter } : {});
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const path of ['/200', '/429', '/429-zero', '/429-long', '/429-date', '/500', '/network']) {
    const options = { url: `http://127.0.0.1:${server.address().port}${path}`, cacheTtlMs: 50 };
    const queries = await Promise.allSettled([httpRequest(options), httpRequest(options), httpRequest(options)]);
    if (path === '/network') assert.equal(queries[0].status, 'rejected');
    else assert.equal(queries[0].value.statusCode, path.includes('429') ? 429 : path === '/500' ? 500 : 200);
    assert.equal(requests.get(path), 1);
    await new Promise(resolve => setTimeout(resolve, 75));
    await httpRequest(options).catch(() => {});
    assert.equal(requests.get(path), ['/429-long', '/429-date'].includes(path) ? 1 : 2);
  }
});
