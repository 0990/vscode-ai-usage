import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { QuotaInfo, UsageData } from '../types';
import { httpRequest } from '../utils/http';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const FIVE_HOUR_MAX_SECONDS = 6 * 60 * 60;

export function getCodexAuthPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
}

export async function loadCodexAuth(authPath = getCodexAuthPath()): Promise<{
  accessToken: string;
  accountId?: string;
}> {
  let raw: string;
  try {
    raw = await readFile(authPath, 'utf8');
  } catch {
    throw new Error(`无法读取 Codex 凭据：${authPath}。请在插件运行的主机上使用 ChatGPT 账号登录 Codex。`);
  }

  let auth;
  try {
    auth = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    // Never include parser errors: they can contain fragments of the credential file.
    throw new Error('Codex auth.json 格式无效，请重新登录 Codex。');
  }
  const token = auth?.tokens?.access_token;
  const account = auth?.tokens?.account_id;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Codex 凭据缺少 tokens.access_token。请使用 ChatGPT 账号登录，API Key 登录不能查询订阅额度。');
  }
  return {
    accessToken: token.trim(),
    accountId: typeof account === 'string' && account.trim() ? account.trim() : undefined,
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function duration(window: unknown): number | undefined {
  if (!isObject(window)) { return undefined; }
  const seconds = window.limit_window_seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? seconds : undefined;
}

function toQuota(window: unknown, now: number): QuotaInfo | undefined {
  if (window === undefined || window === null) { return undefined; }
  if (!isObject(window) || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) {
    throw new Error('ChatGPT 额度响应中的 used_percent 无效。');
  }
  const used = Math.min(100, Math.max(0, window.used_percent));
  const remaining = 100 - used;
  let resetAt: Date | undefined;
  if (typeof window.reset_at === 'number' && Number.isFinite(window.reset_at) && window.reset_at > 0) {
    resetAt = new Date(window.reset_at * 1000);
  } else if (typeof window.reset_after_seconds === 'number' && Number.isFinite(window.reset_after_seconds) && window.reset_after_seconds >= 0) {
    resetAt = new Date(now + window.reset_after_seconds * 1000);
  }
  if (resetAt && !Number.isFinite(resetAt.getTime())) { resetAt = undefined; }
  return { used, total: 100, remaining, percentage: Math.round(remaining), resetAt, unit: '%' };
}

export function parseCodexUsage(data: unknown, now = Date.now()): UsageData {
  if (!isObject(data) || !isObject(data.rate_limit)) {
    throw new Error('ChatGPT 响应缺少 rate_limit，无法读取订阅额度。');
  }
  const primary = data.rate_limit.primary_window;
  const secondary = data.rate_limit.secondary_window;
  const primaryDuration = duration(primary);
  const secondaryDuration = duration(secondary);
  let fiveHour: unknown;
  let sevenDay: unknown;

  // Match the reference project: identify windows by duration, not their position.
  if (primaryDuration && secondaryDuration) {
    [fiveHour, sevenDay] = primaryDuration < secondaryDuration
      ? [primary, secondary] : [secondary, primary];
  } else if (primaryDuration) {
    [fiveHour, sevenDay] = primaryDuration <= FIVE_HOUR_MAX_SECONDS
      ? [primary, secondary] : [secondary, primary];
  } else if (secondaryDuration) {
    [fiveHour, sevenDay] = secondaryDuration <= FIVE_HOUR_MAX_SECONDS
      ? [secondary, primary] : [primary, secondary];
  } else {
    throw new Error('ChatGPT 响应缺少窗口时长，无法区分 5h 和 7d 额度。');
  }

  const result: UsageData = {
    provider: 'openai',
    mode: 'subscription',
    fiveHour: toQuota(fiveHour, now),
    sevenDay: toQuota(sevenDay, now),
    lastUpdated: new Date(now),
  };
  if (!result.fiveHour && !result.sevenDay) {
    throw new Error('ChatGPT 未返回可用的订阅额度窗口。');
  }
  return result;
}

export async function fetchCodexUsage(
  authPath?: string,
  request: typeof httpRequest = httpRequest
): Promise<UsageData> {
  // Read again on every refresh so Codex login/token rotation takes effect immediately.
  const auth = await loadCodexAuth(authPath || undefined);
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}` };
  if (auth.accountId) { headers['chatgpt-account-id'] = auth.accountId; }
  const response = await request({ url: USAGE_URL, method: 'GET', headers });
  if (response.statusCode === 401) {
    throw new Error('ChatGPT 登录已过期（HTTP 401），请在插件运行的主机上重新登录 Codex 后刷新额度。');
  }
  if (response.statusCode === 403) {
    throw new Error('ChatGPT 拒绝访问（HTTP 403），请检查账号权限及插件运行主机的网络。');
  }
  if (response.statusCode !== 200) {
    throw new Error(`ChatGPT 额度查询失败（HTTP ${response.statusCode}）。`);
  }
  let data: unknown;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new Error('ChatGPT 额度接口未返回有效 JSON。');
  }
  return parseCodexUsage(data);
}
