const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { loadCodexAuth, fetchCodexUsage, parseCodexUsage, getCodexAuthPath } = require('../src/providers/codex-usage.ts');
const { OpenAIUsageProvider } = require('../src/providers/openai-provider.ts');

const short = { used_percent: 12, limit_window_seconds: 18000, reset_at: 1900000000 };
const weekly = { used_percent: 34, limit_window_seconds: 604800, reset_after_seconds: 60 };
const response = (primary, secondary) => ({ rate_limit: { primary_window: primary, secondary_window: secondary } });

test('classifies normal and reversed windows by duration and converts reset times', () => {
  for (const data of [response(short, weekly), response(weekly, short)]) {
    const result = parseCodexUsage(data, 1000);
    assert.equal(result.fiveHour.percentage, 88);
    assert.equal(result.sevenDay.percentage, 66);
    assert.equal(result.fiveHour.unit, '%');
    assert.equal(result.fiveHour.resetAt.getTime(), 1900000000000);
    assert.equal(result.sevenDay.resetAt.getTime(), 61000);
  }
});

test('missing windows stay unavailable rather than becoming 100%', () => {
  for (const data of [response(weekly, null), response(undefined, weekly)]) {
    const result = parseCodexUsage(data);
    assert.equal(result.fiveHour, undefined);
    assert.equal(result.sevenDay.percentage, 66);
  }
  const result = parseCodexUsage(response(null, short));
  assert.equal(result.fiveHour.percentage, 88);
  assert.equal(result.sevenDay, undefined);
});

test('one known duration identifies the other window', () => {
  const { limit_window_seconds, ...noDuration } = short;
  assert.equal(parseCodexUsage(response(weekly, noDuration)).fiveHour.percentage, 88);
  assert.equal(parseCodexUsage(response(noDuration, weekly)).fiveHour.percentage, 88);
});

test('rejects malformed and ambiguous payloads without inventing quotas', () => {
  for (const data of [null, {}, { rate_limit: null }, response(null, null), response({ used_percent: 2 }, null)]) {
    assert.throws(() => parseCodexUsage(data));
  }
  for (const used_percent of [undefined, '12', NaN, Infinity]) {
    assert.throws(() => parseCodexUsage(response({ ...short, used_percent }, weekly)), /used_percent/);
  }
  assert.equal(parseCodexUsage(response({ ...short, used_percent: 150 }, weekly)).fiveHour.percentage, 0);
  assert.equal(parseCodexUsage(response({ ...short, used_percent: -2 }, weekly)).fiveHour.percentage, 100);
});

test('respects CODEX_HOME', () => {
  const previous = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = join(tmpdir(), 'custom-codex-home');
    assert.equal(getCodexAuthPath(), join(process.env.CODEX_HOME, 'auth.json'));
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});

test('reads credentials afresh and sends them only to the fixed usage endpoint', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  for (const token of ['test-token-one', 'test-token-two']) {
    await writeFile(authPath, JSON.stringify({ tokens: { access_token: token, account_id: 'test-account' } }));
    const result = await fetchCodexUsage(authPath, async options => {
      assert.equal(options.url, 'https://chatgpt.com/backend-api/wham/usage');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.headers['chatgpt-account-id'], 'test-account');
      return { statusCode: 200, headers: {}, body: JSON.stringify(response(short, weekly)) };
    });
    assert.equal(result.fiveHour.percentage, 88);
  }
});

test('handles missing, invalid and API-key-only credentials without leaking secrets', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-invalid-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  await assert.rejects(loadCodexAuth(authPath), /无法读取/);
  await writeFile(authPath, '{"tokens": "secret-fragment" INVALID');
  await assert.rejects(loadCodexAuth(authPath), error => !error.message.includes('secret-fragment'));
  for (const auth of [null, { OPENAI_API_KEY: 'test-api-key' }, { tokens: { access_token: 123 } }]) {
    await writeFile(authPath, JSON.stringify(auth));
    await assert.rejects(loadCodexAuth(authPath), /access_token/);
  }
  await writeFile(authPath, '\uFEFF' + JSON.stringify({ tokens: { access_token: 'test-token' } }));
  assert.deepEqual(await loadCodexAuth(authPath), { accessToken: 'test-token', accountId: undefined });
});

test('HTTP and JSON failures give useful errors and never echo response bodies', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  await writeFile(authPath, JSON.stringify({ tokens: { access_token: 'test-token' } }));
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(fetchCodexUsage(authPath, async () => ({
      statusCode: status, headers: {}, body: 'sensitive-response',
    })), error => error.message.includes(String(status)) && !error.message.includes('sensitive-response'));
  }
  await assert.rejects(fetchCodexUsage(authPath, async () => ({ statusCode: 200, headers: {}, body: '<html>secret</html>' })), /有效 JSON/);
});

test('cached responses retain their sample time and relative quota reset times', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-sample-time-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  await writeFile(authPath, JSON.stringify({ tokens: { access_token: 'test-token' } }));
  const fetchedAt = 1000000;
  const data = await fetchCodexUsage(authPath, async () => ({
    statusCode: 200, headers: {}, fetchedAt, body: JSON.stringify(response(short, weekly)),
  }));
  assert.equal(data.lastUpdated.getTime(), fetchedAt);
  assert.equal(data.sevenDay.resetAt.getTime(), fetchedAt + 60000);
});

test('provider defaults to local subscription credentials and exposes login errors', async () => {
  const provider = new OpenAIUsageProvider(join(tmpdir(), 'missing-ai-usage-auth', 'auth.json'));
  const result = await provider.getUsage();
  assert.equal(result.mode, 'subscription');
  assert.match(result.error, /无法读取/);
  assert.equal(result.fiveHour, undefined);
});
