const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const { code } = transformSync(readFileSync(resolve(__dirname, '../src/extension.ts'), 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node18',
});

function startHost(remoteName, extensionKind, usage = {}) {
  const calls = { providers: 0, queries: 0, statusItems: 0, shown: 0, timers: 0 };
  const updates = [];
  const commands = new Map();
  const timers = new Map();
  class Provider {
    constructor(config) { calls.providers++; this.config = config; }
    async getUsage(interval) { calls.queries++; assert.equal(interval, 300); return usage[this.kind]?.(); }
    updateConfig() {}
  }
  class Config {
    getClaudeConfig() { return {}; }
    getCustomObjects() { return usage.customObjects ?? []; }
    getStatusBarItems() { return ['claude', 'openai', 'custom:*']; }
    getRefreshInterval() { return 300; }
    onDidChangeConfiguration() { return { dispose() {} }; }
  }
  class StatusBar {
    constructor() { calls.statusItems++; }
    show() { calls.shown++; }
    update(claude, openai, custom) { updates.push({ claude, openai, custom }); }
    dispose() {}
  }
  class Details { updateData() {} dispose() {} }
  const modules = {
    vscode: {
      env: { remoteName }, ExtensionKind: { UI: 1, Workspace: 2 },
      StatusBarAlignment: { Right: 2 },
      commands: { registerCommand(name, handler) { commands.set(name, handler); return { dispose() {} }; } },
      window: { showInformationMessage() {} },
      workspace: { getConfiguration() { return { get(_key, fallback) { return fallback; } }; } },
    },
    './config': { ConfigManager: Config },
    './providers/claude-provider': { ClaudeUsageProvider: class extends Provider { kind = 'claude'; } },
    './providers/openai-provider': { OpenAIUsageProvider: class extends Provider { kind = 'openai'; } },
    './providers/custom-provider': { CustomUsageProvider: class extends Provider { get kind() { return this.config.id; } } },
    './ui/configuration-commands': {
      addCustomObject() {}, manageCustomObjects() {}, selectStatusBarItems() {}, showConfigurationMenu() {},
    },
    './ui/status-bar': { StatusBarManager: StatusBar },
    './ui/detail-panel': { DetailPanelManager: Details },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) { assert.ok(name in modules, name); return modules[name]; },
    console: { log() {} },
    setTimeout(callback, delay) { const id = {}; calls.timers++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  module.exports.activate({ extension: { extensionKind }, subscriptions: [] });
  return { calls, updates, commands, timers, extension: module.exports };
}

test('SSH window never starts local providers, queries, UI or timers, even with a UI override', () => {
  assert.deepEqual(startHost('ssh-remote', 1).calls, {
    providers: 0, queries: 0, statusItems: 0, shown: 0, timers: 0,
  });
});

test('remote workspace host performs queries and creates the window status bar', async () => {
  const host = startHost('ssh-remote', 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(host.calls, {
    providers: 2, queries: 2, statusItems: 1, shown: 1, timers: 1,
  });
});

test('ordinary local window still performs queries and shows the status bar', async () => {
  const host = startHost(undefined, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(host.calls, {
    providers: 2, queries: 2, statusItems: 1, shown: 1, timers: 1,
  });
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a slow SSH provider does not delay another provider or hide its error', async () => {
  const claude = deferred();
  const openai = deferred();
  const host = startHost('ssh-remote', 2, {
    claude: () => claude.promise, openai: () => openai.promise,
  });
  const quota = { provider: 'openai', fiveHour: { percentage: 80 } };
  openai.resolve(quota);
  await flush();
  assert.equal(host.updates.length, 1);
  assert.equal(host.updates[0].openai, quota);
  assert.equal(host.updates[0].claude, undefined);
  claude.reject(new Error('network unavailable'));
  await flush();
  assert.match(host.updates.at(-1).claude.error, /额度查询失败/);
  assert.equal(host.updates.at(-1).openai, quota);
  host.extension.deactivate();
});

test('refresh and deactivation prevent old in-flight results from updating the UI', async () => {
  const old = deferred();
  const current = deferred();
  let queries = 0;
  const host = startHost('ssh-remote', 2, {
    claude: () => (++queries === 1 ? old.promise : current.promise),
    openai: () => new Promise(() => {}),
  });
  void host.commands.get('aiUsageTracker.refresh')();
  const quota = { provider: 'claude', fiveHour: { percentage: 70 } };
  current.resolve(quota);
  await flush();
  assert.equal(host.updates.length, 1);
  assert.equal(host.updates[0].claude, quota);
  old.resolve({ provider: 'claude', fiveHour: { percentage: 10 } });
  await flush();
  assert.equal(host.updates.length, 1);
  host.extension.deactivate();
  const pending = deferred();
  const disposed = startHost('ssh-remote', 2, {
    claude: () => pending.promise, openai: () => new Promise(() => {}),
  });
  disposed.extension.deactivate();
  pending.resolve(quota);
  await flush();
  assert.equal(disposed.updates.length, 0);
  assert.equal(disposed.timers.size, 0, 'an in-flight completion cannot restart polling after deactivation');
});

test('failed queries wait a full configured cycle and never create an immediate retry', async () => {
  const host = startHost('ssh-remote', 2, {
    claude: () => { throw new Error('HTTP 429'); },
    openai: () => { throw new Error('offline'); },
  });
  await flush();
  assert.equal(host.calls.queries, 2);
  assert.equal(host.timers.size, 1);
  const [id, timer] = host.timers.entries().next().value;
  assert.equal(timer.delay, 300000);
  host.timers.delete(id);
  timer.callback();
  await flush();
  assert.equal(host.calls.queries, 4);
  assert.equal(host.timers.size, 1);
  host.extension.deactivate();
  assert.equal(host.timers.size, 0);
});

test('custom balances update independently and retain configuration order', async () => {
  const first = deferred();
  const second = deferred();
  const host = startHost('ssh-remote', 2, {
    claude: () => new Promise(() => {}), openai: () => new Promise(() => {}),
    customObjects: [
      { id: 'custom:first', name: 'First', type: 'sub2api', enabled: true },
      { id: 'custom:second', name: 'Second', type: 'newapi', enabled: true },
    ],
    'custom:first': () => first.promise, 'custom:second': () => second.promise,
  });
  second.resolve({ id: 'custom:second', balance: 20 });
  await flush();
  assert.deepEqual(Array.from(host.updates.at(-1).custom, value => value.id), ['custom:second']);
  first.resolve({ id: 'custom:first', balance: 10 });
  await flush();
  assert.deepEqual(Array.from(host.updates.at(-1).custom, value => value.id), ['custom:first', 'custom:second']);
  host.extension.deactivate();
});
