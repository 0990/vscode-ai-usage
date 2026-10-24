import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import type { HttpResponse } from '../types';
import { DEFAULT_CACHE_TTL_MS, sharedQueryCache } from './shared-query-cache';

const DEFAULT_TIMEOUT = 15_000;

interface RequestOptions {
  url: string;
  method?: 'GET';
  headers?: Record<string, string>;
  timeout?: number;
  cacheTtlMs?: number;
}

function makeRequest(options: RequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.url);
    const isHttps = parsed.protocol === 'https:';

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': 'vscode-ai-usage-tracker/0.1.0',
        'Accept': 'application/json',
        ...options.headers,
      },
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    };

    const transport = isHttps ? https : http;

    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const headers: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          headers[key.toLowerCase()] = value;
        }
        resolve({
          statusCode: res.statusCode ?? 0,
          headers,
          body,
          fetchedAt: Date.now(),
        });
      });
      res.on('error', reject);
    });

    // Socket inactivity timeouts alone do not bound DNS lookup or connection setup.
    const deadline = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${options.timeout ?? DEFAULT_TIMEOUT}ms`));
    }, options.timeout ?? DEFAULT_TIMEOUT);
    req.once('close', () => clearTimeout(deadline));

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${options.timeout ?? DEFAULT_TIMEOUT}ms`));
    });

    req.on('error', reject);

    req.end();
  });
}

export async function httpRequest(options: RequestOptions): Promise<HttpResponse> {
  const headers = Object.entries(options.headers ?? {})
    .map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a.localeCompare(b));
  return sharedQueryCache.get(
    ['http', options.url, options.method ?? 'GET', headers],
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    async () => {
      try {
        return await makeRequest(options);
      } catch (error) {
        // Never persist transport errors containing URLs, credentials or proxy details.
        throw new Error(error instanceof Error && /^Request timed out after \d+ms$/.test(error.message)
          ? error.message : '网络请求失败（连接、代理或超时），请等待下个刷新周期。');
      }
    },
    response => response.statusCode === 429 ? parseRetryAfter(response.headers['retry-after']) : 0
  );
}

function parseRetryAfter(
  value: string | string[] | undefined
): number {
  if (!value) {return 0;}
  const str = Array.isArray(value) ? value[0] : value;
  if (/^\d+(\.\d+)?$/.test(str.trim())) {
    const milliseconds = Number(str) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  const date = Date.parse(str);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
