import { URL } from 'node:url';
import type {
  CustomObjectConfig,
  CustomUsageData,
  HttpResponse,
} from '../types';
import { httpRequest } from '../utils/http';

type Request = typeof httpRequest;
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function json(body: string, label: string): JsonObject {
  try {
    const value = object(JSON.parse(body));
    if (value) { return value; }
  } catch {
    // Do not include response bodies in errors: some relays return account details.
  }
  throw new Error(`${label} 未返回有效 JSON。`);
}

function currencySymbol(unit: unknown): string {
  if (typeof unit !== 'string' || !unit.trim() || unit.trim().toUpperCase() === 'USD') {
    return '$';
  }
  const value = unit.trim();
  return value.length <= 3 ? value : '$';
}

function validate(config: CustomObjectConfig): URL {
  if (config.type !== 'sub2api' && config.type !== 'newapi') {
    throw new Error('请选择 sub2api 或 newapi。');
  }
  if (!config.name.trim()) { throw new Error('请填写名称。'); }
  if (!config.apiKey.trim() || /[\r\n]/.test(config.apiKey)) {
    throw new Error('请填写有效的 API Key。');
  }
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error('Base URL 必须是有效的 HTTP/HTTPS 地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须是有效的 HTTP/HTTPS 地址，不能包含账号、查询参数或片段。');
  }
  return url;
}

async function relayGet(url: string, apiKey: string, request: Request): Promise<HttpResponse> {
  let response: HttpResponse;
  try {
    response = await request({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
  } catch {
    throw new Error('余额请求失败（网络、代理或超时）。');
  }
  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  return response;
}

function bucketCost(value: unknown): number {
  const bucket = object(value);
  return finite(bucket?.actual_cost) ?? finite(bucket?.cost) ?? 0;
}

async function fetchSub2api(
  base: string,
  config: CustomObjectConfig,
  request: Request
): Promise<CustomUsageData> {
  const response = await relayGet(`${base}/usage`, config.apiKey, request);
  const data = json(response.body, 'sub2api /usage');
  const quota = object(data.quota);
  const usage = object(data.usage);
  if (!('remaining' in data) && !('balance' in data) && !quota) {
    throw new Error('sub2api 响应缺少余额字段。');
  }
  const balance = finite(data.remaining) ?? finite(quota?.remaining) ?? finite(data.balance);
  if (balance === undefined) { throw new Error('sub2api 响应中的余额无效。'); }
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    balance,
    used: bucketCost(usage?.today),
    unit: currencySymbol(data.unit),
    usedLabel: '今日用量',
    lastUpdated: new Date(),
  };
}

async function fetchNewapi(
  base: string,
  config: CustomObjectConfig,
  request: Request
): Promise<CustomUsageData> {
  const subscription = json((await relayGet(
    `${base}/dashboard/billing/subscription`, config.apiKey, request
  )).body, 'newapi subscription');
  const usage = json((await relayGet(
    `${base}/dashboard/billing/usage`, config.apiKey, request
  )).body, 'newapi usage');
  const limit = finite(subscription.hard_limit_usd);
  const totalUsage = finite(usage.total_usage);
  if (limit === undefined || totalUsage === undefined) {
    throw new Error('newapi 响应缺少额度或用量字段。');
  }
  const used = totalUsage / 100;
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    balance: limit - used,
    used,
    unit: '$',
    usedLabel: '累计已用',
    lastUpdated: new Date(),
  };
}

async function fetchAtBase(
  base: string,
  config: CustomObjectConfig,
  request: Request
): Promise<CustomUsageData> {
  return config.type === 'sub2api'
    ? fetchSub2api(base, config, request)
    : fetchNewapi(base, config, request);
}

export async function fetchCustomUsage(
  config: CustomObjectConfig,
  request: Request = httpRequest
): Promise<CustomUsageData> {
  const parsed = validate(config);
  const base = parsed.toString().replace(/\/$/, '');
  const candidates = base.endsWith('/v1') ? [base] : [`${base}/v1`, base];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fetchAtBase(candidate, config, request);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('余额查询失败。');
}

export class CustomUsageProvider {
  constructor(readonly config: CustomObjectConfig) {}

  async getUsage(): Promise<CustomUsageData> {
    try {
      return await fetchCustomUsage(this.config);
    } catch (error) {
      return {
        id: this.config.id,
        name: this.config.name,
        type: this.config.type,
        unit: '$',
        usedLabel: this.config.type === 'sub2api' ? '今日用量' : '累计已用',
        lastUpdated: new Date(),
        error: error instanceof Error ? error.message : '余额查询失败。',
      };
    }
  }
}
