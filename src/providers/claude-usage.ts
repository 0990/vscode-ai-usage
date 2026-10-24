import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { HttpResponse, ProviderConfig, QuotaInfo, UsageData } from '../types';
import { httpRequest } from '../utils/http';
import { DEFAULT_CACHE_TTL_MS, sharedQueryCache } from '../utils/shared-query-cache';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
    throw new Error(`无法读取 Claude 凭据或设置文件：${path}`);
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`Claude 文件格式无效：${path}。请检查 JSON 或重新登录。`);
  }
}

export async function loadClaudeToken(
  paths: { credentialsPath?: string; settingsPath?: string } = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const token = text(env.CLAUDE_CODE_OAUTH_TOKEN);
  if (token) { return token; }
  const home = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const settings = await readJson(paths.settingsPath || env.CLAUDE_SETTINGS_FILE || join(home, 'settings.json'));
  if (object(settings) && object(settings.env)) {
    const settingsToken = text(settings.env.CLAUDE_CODE_OAUTH_TOKEN);
    if (settingsToken) { return settingsToken; }
  }
  const credentials = await readJson(paths.credentialsPath || join(home, '.credentials.json'));
  if (object(credentials) && object(credentials.claudeAiOauth)) {
    const localToken = text(credentials.claudeAiOauth.accessToken);
    if (localToken) { return localToken; }
  }
  throw new Error('未找到 Claude 登录凭据。请在插件运行的主机上登录 Claude Code，或配置 CLAUDE_CODE_OAUTH_TOKEN / 查询脚本。');
}

function resetDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '' || value === '-') { return undefined; }
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value));
  const date = numeric ? new Date(Number(value) * 1000) : typeof value === 'string' ? new Date(value) : undefined;
  if (!date || !Number.isFinite(date.getTime())) { throw new Error('Claude 额度重置时间无效。'); }
  return date;
}

function quota(used: unknown, reset?: unknown): QuotaInfo {
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) {
    throw new Error('Claude 额度使用率无效，必须为 0–100 的数值。');
  }
  return { used, total: 100, remaining: 100 - used, percentage: Math.round(100 - used), unit: '%', resetAt: resetDate(reset) };
}

function usage(fiveHour?: QuotaInfo, sevenDay?: QuotaInfo): UsageData {
  if (!fiveHour && !sevenDay) { throw new Error('Claude 未返回可用的 5h/7d 额度，缺失窗口不会按 100% 显示。'); }
  return { provider: 'claude', mode: 'subscription', fiveHour, sevenDay, lastUpdated: new Date() };
}

export function parseClaudeUsage(data: unknown): UsageData {
  if (!object(data)) { throw new Error('Claude 额度响应不是有效对象。'); }
  const parse = (window: unknown): QuotaInfo | undefined => {
    if (window === undefined || window === null) { return undefined; }
    if (!object(window)) { throw new Error('Claude 额度窗口无效。'); }
    return quota(window.utilization, window.resets_at);
  };
  return usage(parse(data.five_hour), parse(data.seven_day));
}

export function parseClaudeHeaders(headers: HttpResponse['headers']): UsageData {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) { normalized[key.toLowerCase()] = value; }
  const parse = (period: string): QuotaInfo | undefined => {
    const prefix = `anthropic-ratelimit-unified-${period}`;
    const value = normalized[`${prefix}-utilization`];
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) { return undefined; }
    if (!raw.trim()) { throw new Error('Claude 响应头的使用率为空。'); }
    const reset = normalized[`${prefix}-reset`];
    return quota(Number(raw) * 100, Array.isArray(reset) ? reset[0] : reset);
  };
  return usage(parse('5h'), parse('7d'));
}

export function parseClaudeScriptOutput(output: string): UsageData {
  const cleaned = output.replace(/^\uFEFF/, '').trim();
  if (cleaned.startsWith('{')) {
    let data: unknown;
    try { data = JSON.parse(cleaned); } catch { throw new Error('Claude 脚本输出不是有效 JSON。'); }
    return parseClaudeUsage(data);
  }
  const headers: HttpResponse['headers'] = {};
  for (const line of cleaned.split(/\r?\n/)) {
    const match = /^(anthropic-ratelimit-unified-[\w-]+):\s*(.*?)\s*$/i.exec(line);
    if (match) { headers[match[1].toLowerCase()] = match[2]; }
  }
  // The attachment's -v output preserves full precision and Unix reset timestamps.
  if (Object.keys(headers).length > 0) { return parseClaudeHeaders(headers); }

  const zone = /reset\(([^)]+)\)/.exec(cleaned)?.[1];
  const offsets: Record<string, string> = { 'Asia/Singapore': '+08:00', 'Asia/Shanghai': '+08:00', UTC: 'Z', 'Etc/UTC': 'Z' };
  const windows: Record<string, QuotaInfo> = {};
  for (const line of cleaned.split(/\r?\n/)) {
    const row = /^(5h|7d)\s+(\d+(?:\.\d+)?)%\s+\S+\s+(.+?)\s*$/.exec(line);
    if (!row) { continue; }
    const reset = row[3];
    let resetAt: string | undefined;
    if (reset !== '-') {
      if (!zone || !offsets[zone] || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(reset)) {
        throw new Error('Claude 脚本表格的重置时间或时区无法识别，请使用 -v 响应头或 JSON 输出。');
      }
      resetAt = reset.replace(' ', 'T') + ':00' + offsets[zone];
    }
    windows[row[1]] = quota(Number(row[2]), resetAt);
  }
  return usage(windows['5h'], windows['7d']);
}

export function runClaudeScript(config: ProviderConfig, timeout = 30000): Promise<UsageData> {
  const command = config.claudeScriptCommand?.trim();
  if (!command) { return Promise.reject(new Error('请配置 claude.script.command 和 claude.script.args。')); }
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) {
    return Promise.reject(new Error('Claude 脚本超时必须在 1000–120000 毫秒之间。'));
  }
  return new Promise((resolve, reject) => {
    execFile(command, config.claudeScriptArgs ?? [], {
      timeout, maxBuffer: 1024 * 1024, windowsHide: true, shell: false,
    }, (error, stdout) => {
      if (error) {
        // execFile errors include command arguments and stderr; do not expose either.
        const code = error as NodeJS.ErrnoException & { killed?: boolean };
        reject(new Error(code.killed ? 'Claude 查询脚本执行超时。' : 'Claude 查询脚本执行失败，请检查程序路径、参数、依赖和登录状态。'));
        return;
      }
      try { resolve({ ...parseClaudeScriptOutput(stdout), mode: 'script' }); } catch (parseError) { reject(parseError); }
    });
  });
}

export async function fetchClaudeUsage(
  config: ProviderConfig = {},
  request: typeof httpRequest = httpRequest,
  tokenLoader: () => Promise<string> = loadClaudeToken,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS
): Promise<UsageData> {
  if (config.claudeScriptCommand?.trim()) {
    const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const paths = [process.env.CLAUDE_SETTINGS_FILE || join(home, 'settings.json'), join(home, '.credentials.json')];
    // Script credentials remain the script's responsibility; only inspect file metadata.
    const files = await Promise.all(paths.map(async path => {
      const file = await stat(path).catch(() => undefined);
      return [path, file?.mtimeMs, file?.size];
    }));
    const result = await sharedQueryCache.get([
      'claude-script', config.claudeScriptCommand.trim(), config.claudeScriptArgs ?? [],
      homedir(), files, process.env.CLAUDE_CODE_OAUTH_TOKEN,
    ], cacheTtlMs, () => runClaudeScript(config));
    // JSON cache records must retain the original sample/reset dates in the UI.
    const date = (value: Date) => new Date(value instanceof Date ? value.getTime() : value);
    const window = (value?: QuotaInfo) => value && {
      ...value, resetAt: value.resetAt ? date(value.resetAt) : undefined,
    };
    return { ...result, lastUpdated: date(result.lastUpdated), fiveHour: window(result.fiveHour), sevenDay: window(result.sevenDay) };
  }
  const token = await tokenLoader();
  const headers = {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };
  const response = await request({ url: 'https://api.anthropic.com/api/oauth/usage', method: 'GET', headers, cacheTtlMs });
  if (response.statusCode === 401) { throw new Error('Claude 登录失效（HTTP 401），请在插件运行的主机上重新登录 Claude Code。'); }
  if (response.statusCode === 403) {
    throw new Error('Claude 额度查询被拒绝（HTTP 403）。当前 Token 可能缺少 user:profile 权限；可配置 Claude 查询脚本。');
  }
  if (response.statusCode !== 200) { throw new Error(`Claude 额度查询失败（HTTP ${response.statusCode}）。`); }
  let data: unknown;
  try { data = JSON.parse(response.body); } catch { throw new Error('Claude 额度接口未返回有效 JSON。'); }
  return { ...parseClaudeUsage(data), lastUpdated: new Date(response.fetchedAt ?? Date.now()) };
}
