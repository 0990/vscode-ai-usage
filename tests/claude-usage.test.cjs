const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { loadClaudeToken, parseClaudeUsage, parseClaudeHeaders, parseClaudeScriptOutput, fetchClaudeUsage, runClaudeScript } = require('../src/providers/claude-usage.ts');
const { ClaudeUsageProvider } = require('../src/providers/claude-provider.ts');

const windows = {
  five_hour: { utilization: 23.5, resets_at: '2026-10-23T12:30:00Z' },
  seven_day: { utilization: 68, resets_at: '2026-10-30T02:20:20Z' },
};
const headers = {
  'anthropic-ratelimit-unified-5h-utilization': '0.235',
  'anthropic-ratelimit-unified-5h-reset': '1792758600',
  'anthropic-ratelimit-unified-7d-utilization': '0.68',
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-claude-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, credentials: join(dir, '.credentials.json'), settings: join(dir, 'settings.json') };
}

test('credential priority: process env, settings env, local OAuth file; reread after login', async t => {
  const f = await fixture(t);
  const config = { credentialsPath: f.credentials, settingsPath: f.settings };
  await writeFile(f.credentials, JSON.stringify({ claudeAiOauth: { accessToken: 'file-token' } }));
  await writeFile(f.settings, JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'settings-token' } }));
  assert.equal(await loadClaudeToken(config, { CLAUDE_CODE_OAUTH_TOKEN: 'env-token' }), 'env-token');
  assert.equal(await loadClaudeToken(config, {}), 'settings-token');
  await writeFile(f.settings, '{}');
  assert.equal(await loadClaudeToken(config, {}), 'file-token');
  await writeFile(f.credentials, JSON.stringify({ claudeAiOauth: { accessToken: 'new-token' } }));
  assert.equal(await loadClaudeToken(config, {}), 'new-token');
});

test('CLAUDE_CONFIG_DIR and CLAUDE_SETTINGS_FILE override local defaults', async t => {
  const f = await fixture(t);
  await writeFile(f.credentials, JSON.stringify({ claudeAiOauth: { accessToken: 'custom-home-token' } }));
  assert.equal(await loadClaudeToken({}, { CLAUDE_CONFIG_DIR: f.dir }), 'custom-home-token');
  const other = join(f.dir, 'other.json');
  await writeFile(other, JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'custom-settings-token' } }));
  assert.equal(await loadClaudeToken({}, { CLAUDE_CONFIG_DIR: f.dir, CLAUDE_SETTINGS_FILE: other }), 'custom-settings-token');
});

test('missing or malformed credentials give useful errors without exposing contents', async t => {
  const f = await fixture(t);
  const config = { credentialsPath: f.credentials, settingsPath: f.settings };
  await assert.rejects(loadClaudeToken(config, {}), /未找到 Claude 登录凭据/);
  await writeFile(f.credentials, '{"secret":"token-fragment" INVALID');
  await assert.rejects(loadClaudeToken(config, {}), error => /JSON/.test(error.message) && !error.message.includes('token-fragment'));
  await writeFile(f.credentials, JSON.stringify({ claudeAiOauth: { accessToken: 123 } }));
  await assert.rejects(loadClaudeToken(config, {}), /未找到/);
});

test('usage API uses percentages while message headers use fractions', () => {
  const api = parseClaudeUsage(windows);
  const probe = parseClaudeHeaders(headers);
  for (const result of [api, probe]) {
    assert.equal(result.fiveHour.percentage, 77);
    assert.equal(result.fiveHour.used, 23.5);
    assert.equal(result.sevenDay.percentage, 32);
    assert.equal(result.fiveHour.unit, '%');
    assert.equal(result.fiveHour.resetAt.toISOString(), '2026-10-23T12:30:00.000Z');
  }
  assert.equal(parseClaudeUsage({ five_hour: null, seven_day: windows.seven_day }).fiveHour, undefined);
  assert.equal(parseClaudeHeaders({ 'Anthropic-Ratelimit-Unified-5h-Utilization': '0' }).fiveHour.percentage, 100);
});

test('reject missing/invalid quotas instead of manufacturing unused windows', () => {
  for (const data of [{}, null, { five_hour: {} }, { five_hour: { utilization: '23' } }, { five_hour: { utilization: -1 } }]) {
    assert.throws(() => parseClaudeUsage(data));
  }
  for (const value of ['', 'NaN', '0.1garbage', '1.1', '-0.2']) {
    assert.throws(() => parseClaudeHeaders({ 'anthropic-ratelimit-unified-5h-utilization': value }));
  }
  assert.throws(() => parseClaudeHeaders({}));
  assert.throws(() => parseClaudeUsage({ five_hour: { utilization: 2, resets_at: 'bad date' } }));
});

test('default query is a GET; a 403 never triggers a consuming request or exposes the body', async () => {
  let requests = 0;
  await assert.rejects(fetchClaudeUsage({}, async options => {
    requests++;
    assert.equal(options.method, 'GET');
    assert.equal(options.url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { statusCode: 403, headers: {}, body: 'secret-response-body' };
  }, async () => 'test-token'), error => /user:profile/.test(error.message) && !error.message.includes('secret-response-body'));
  assert.equal(requests, 1);
  const result = await fetchClaudeUsage({}, async () => ({ statusCode: 200, headers: {}, body: JSON.stringify(windows) }), async () => 'test-token');
  assert.equal(result.sevenDay.percentage, 32);
});

test('no local login gives a credential error before any request is made', async () => {
  let requests = 0;
  await assert.rejects(fetchClaudeUsage({}, async () => {
    requests++;
    throw new Error('No network call expected');
  }, async () => { throw new Error('Local login missing'); }), /Local login missing/);
  assert.equal(requests, 0);
});

test('parses attachment table, verbose headers and JSON without reversing used/remaining', () => {
  const table = 'window     used  status     reset(Asia/Singapore)\r\n5h          24%  allowed    2026-10-23 20:30\r\n7d          68%  allowed    -\r\noverage: allowed\r\n';
  const parsed = parseClaudeScriptOutput(table);
  assert.equal(parsed.fiveHour.percentage, 76);
  assert.equal(parsed.fiveHour.resetAt.toISOString(), '2026-10-23T12:30:00.000Z');
  assert.equal(parsed.sevenDay.percentage, 32);
  const verbose = Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n' + table;
  assert.equal(parseClaudeScriptOutput(verbose).fiveHour.used, 23.5);
  assert.equal(parseClaudeScriptOutput(JSON.stringify(windows)).fiveHour.used, 23.5);
  assert.throws(() => parseClaudeScriptOutput('ERROR: failed'));
  assert.throws(() => parseClaudeScriptOutput(table.replace('Asia/Singapore', 'Unknown/Zone')));
  assert.throws(() => parseClaudeScriptOutput('anthropic-ratelimit-unified-5h-status: allowed\n' + table));
});

test('executes a configured script with literal arguments, without requiring local credentials', async t => {
  const f = await fixture(t);
  const script = join(f.dir, 'usage script.cjs');
  await writeFile(script, `if (process.argv[2] !== 'literal; & space') process.exit(2); console.log(${JSON.stringify(JSON.stringify(windows))});`);
  const result = await fetchClaudeUsage({
    claudeScriptCommand: process.execPath,
    claudeScriptArgs: [script, 'literal; & space'],
  }, async () => { throw new Error('No network call expected'); });
  assert.equal(result.fiveHour.percentage, 77);
});

test('script failures/timeouts are bounded and do not expose command arguments or stderr', async () => {
  await assert.rejects(runClaudeScript({}), /script.command/);
  await assert.rejects(runClaudeScript({ claudeScriptCommand: process.execPath, claudeScriptArgs: ['-e', "console.error('secret-token'); process.exit(1)", 'private-arg'] }), error => !/secret-token|private-arg/.test(error.message));
  await assert.rejects(runClaudeScript({ claudeScriptCommand: process.execPath, claudeScriptArgs: ['-e', 'setInterval(() => {}, 1000)'] }, 1000), /超时/);
});

test('provider coalesces overlapping script refreshes and exposes script errors without API fallback', async () => {
  const provider = new ClaudeUsageProvider({ claudeScriptCommand: process.execPath, claudeScriptArgs: ['-e', `setTimeout(() => console.log(${JSON.stringify(JSON.stringify(windows))}), 50)`] });
  const [first, second] = await Promise.all([provider.getUsage(), provider.getUsage()]);
  assert.strictEqual(first, second);
  assert.equal(first.mode, 'script');
  provider.updateConfig({ claudeScriptCommand: '__missing-ai-usage-script__' });
  assert.match((await provider.getUsage()).error, /执行失败/);
});
