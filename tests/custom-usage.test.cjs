const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchCustomUsage } = require('../src/providers/custom-provider.ts');
const config = {
  id: 'custom:test', name: '游卡', type: 'sub2api', baseUrl: 'https://relay.example',
  apiKey: 'test-secret', enabled: true,
};
const response = body => ({ statusCode: 200, headers: {}, body: JSON.stringify(body) });

test('sub2api handles root/v1 URLs, zero balances, nested balances and actual daily cost', async () => {
  for (const baseUrl of ['https://relay.example', 'https://relay.example/v1/']) {
    for (const [body, expected] of [
      [{ remaining: 0, balance: 99, usage: { today: { actual_cost: 0, cost: 2 } } }, 0],
      [{ quota: { remaining: 12.34 }, usage: { today: { actual_cost: 1.5 } } }, 12.34],
      [{ balance: 8 }, 8],
    ]) {
      const data = await fetchCustomUsage({ ...config, baseUrl }, async options => {
        assert.equal(options.url, 'https://relay.example/v1/usage');
        assert.equal(options.headers.Authorization, 'Bearer test-secret');
        return response(body);
      });
      assert.equal(data.balance, expected);
      assert.equal(data.used, body.usage?.today?.actual_cost ?? 0);
      assert.equal(data.usedLabel, '今日用量');
    }
  }
});

test('root endpoint fallback stays on the configured origin', async () => {
  const urls = [];
  const data = await fetchCustomUsage(config, async options => {
    urls.push(options.url);
    return urls.length === 1 ? { statusCode: 404 } : response({ remaining: 7 });
  });
  assert.deepEqual(urls, ['https://relay.example/v1/usage', 'https://relay.example/usage']);
  assert.equal(data.balance, 7);
});

test('newapi converts cents and allows depleted/negative balances', async () => {
  for (const total_usage of [200, 1200]) {
    const urls = [];
    const data = await fetchCustomUsage({ ...config, type: 'newapi' }, async options => {
      urls.push(options.url);
      return response(options.url.endsWith('/subscription') ? { hard_limit_usd: 10 } : { total_usage });
    });
    assert.deepEqual(urls, [
      'https://relay.example/v1/dashboard/billing/subscription',
      'https://relay.example/v1/dashboard/billing/usage',
    ]);
    assert.equal(data.used, total_usage / 100);
    assert.equal(data.balance, 10 - total_usage / 100);
    assert.equal(data.usedLabel, '累计已用');
  }
});

test('invalid configuration never makes a request', async () => {
  for (const baseUrl of ['file:///tmp/test', 'https://user:pass@relay.example', 'https://relay.example?key=test', 'https://relay.example/#test']) {
    await assert.rejects(fetchCustomUsage({ ...config, baseUrl }, async () => {
      assert.fail('must not request');
    }), /Base URL/);
  }
});

test('malformed balances, HTTP errors and network errors never reveal response secrets', async () => {
  for (const body of [{}, { remaining: '100' }, { remaining: null }]) {
    await assert.rejects(fetchCustomUsage(config, async () => response(body)), /余额/);
  }
  for (const request of [
    async () => ({ statusCode: 403, body: 'test-secret' }),
    async () => ({ statusCode: 200, body: 'test-secret INVALID JSON' }),
    async () => { throw new Error('network error with test-secret'); },
  ]) {
    await assert.rejects(fetchCustomUsage(config, request), error => !error.message.includes('test-secret'));
  }
});
