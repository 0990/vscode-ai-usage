import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import type { HttpResponse } from '../types';

const DEFAULT_TIMEOUT = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

interface RequestOptions {
  url: string;
  method?: 'GET';
  headers?: Record<string, string>;
  timeout?: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function httpRequest(options: RequestOptions): Promise<HttpResponse> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await makeRequest(options);

      // Don't retry on client errors (4xx) except 429
      if (response.statusCode >= 400 && response.statusCode < 500 && response.statusCode !== 429) {
        return response;
      }

      // Retry on 429 or 5xx
      if (response.statusCode === 429 || response.statusCode >= 500) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = parseRetryAfter(response.headers['retry-after']);
          await sleep(retryAfter ?? RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}

function parseRetryAfter(
  value: string | string[] | undefined
): number | undefined {
  if (!value) {return undefined;}
  const str = Array.isArray(value) ? value[0] : value;
  const seconds = parseInt(str, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  return undefined;
}
