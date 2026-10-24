import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';

export const DEFAULT_CACHE_TTL_MS = 300_000;

type Record<T> = {
  version: 1;
  expiresAt: number;
} & ({ state: 'done'; value: T } | { state: 'failed' | 'pending'; error: string });

/** Passive, per-user disk cache shared by extension hosts on the same machine. */
export class SharedQueryCache {
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly directory = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ai-usage-tracker', 'v1'),
    private readonly now: () => number = Date.now
  ) {}

  get<T>(key: unknown, ttlMs: number, query: () => Promise<T>, holdFor?: (value: T) => number): Promise<T> {
    const digest = createHash('sha256').update(JSON.stringify(key)).digest('hex');
    const existing = this.pending.get(digest);
    if (existing) { return existing as Promise<T>; }
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_CACHE_TTL_MS;
    const request = this.query(digest, ttl, query, holdFor).finally(() => this.pending.delete(digest));
    this.pending.set(digest, request);
    return request;
  }

  private async read<T>(path: string): Promise<Record<T> | undefined> {
    try {
      const record = JSON.parse(await readFile(path, 'utf8'));
      if (record?.version === 1 && Number.isFinite(record.expiresAt) && record.expiresAt > this.now() &&
          (record.state === 'done' ||
            (['failed', 'pending'].includes(record.state) && typeof record.error === 'string'))) {
        return record;
      }
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') { return; }
      throw new Error('无法读取共享查询缓存，请检查缓存目录权限。');
    }
    return undefined;
  }

  private result<T>(record: Record<T>): T {
    if (record.state !== 'done') { throw new Error(record.error); }
    return record.value;
  }

  private async write<T>(path: string, record: Record<T>): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async query<T>(digest: string, ttlMs: number, query: () => Promise<T>, holdFor?: (value: T) => number): Promise<T> {
    const path = join(this.directory, `${digest}.json`);
    const cached = await this.read<T>(path);
    if (cached && cached.state !== 'pending') { return this.result(cached); }

    let compromised = false;
    let release: () => Promise<void>;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      release = await lock(path, {
        realpath: false, stale: 10_000, update: 2_000,
        // These retries only wait for another window's file lock; they never call a provider.
        retries: { retries: 450, factor: 1, minTimeout: 100, maxTimeout: 100 },
        onCompromised: () => { compromised = true; },
      });
    } catch {
      throw new Error('共享查询缓存暂不可用或其它窗口仍在查询，请等待下个刷新周期。');
    }

    try {
      // Recheck after acquiring the lock: another process may have just completed the query.
      const latest = await this.read<T>(path);
      if (latest) { return this.result(latest); }

      // Reserve the entire period before making a request, including across a host crash/reload.
      await this.write<T>(path, {
        version: 1, expiresAt: this.now() + ttlMs, state: 'pending',
        error: '上次查询尚未完成或已中断，请等待下个刷新周期。',
      });
      let record: Record<T>;
      try {
        const value = await query();
        record = {
          version: 1, expiresAt: this.now() + Math.max(ttlMs, holdFor?.(value) || 0), state: 'done', value,
        };
      } catch (error) {
        record = {
          version: 1, expiresAt: this.now() + ttlMs, state: 'failed',
          error: error instanceof Error ? error.message : '查询失败，请等待下个刷新周期。',
        };
      }
      if (compromised) { throw new Error('共享查询锁已失效，请等待下个刷新周期。'); }
      await this.write(path, record);
      return this.result(record);
    } finally {
      await release().catch(() => { /* A lost lock must never cause an extra query. */ });
    }
  }
}

export const sharedQueryCache = new SharedQueryCache();
