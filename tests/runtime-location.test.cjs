const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const { code } = transformSync(readFileSync(resolve(__dirname, '../src/extension.ts'), 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node18',
});

function startHost(remoteName, extensionKind) {
  const calls = { providers: 0, queries: 0, statusItems: 0, shown: 0, timers: 0 };
  class Provider {
    constructor() { calls.providers++; }
    async getUsage() { calls.queries++; return undefined; }
    updateConfig() {}
  }
  class Config {
    getClaudeConfig() { return {}; }
    getCustomObjects() { return []; }
    getStatusBarItems() { return ['claude', 'openai', 'custom:*']; }
    getRefreshInterval() { return 300; }
    onDidChangeConfiguration() { return { dispose() {} }; }
  }
  class StatusBar {
    constructor() { calls.statusItems++; }
    show() { calls.shown++; }
    update() {}
    dispose() {}
  }
  class Details { updateData() {} dispose() {} }
  const modules = {
    vscode: {
      env: { remoteName }, ExtensionKind: { UI: 1, Workspace: 2 },
      StatusBarAlignment: { Right: 2 },
      commands: { registerCommand() { return { dispose() {} }; } },
      workspace: { getConfiguration() { return { get(_key, fallback) { return fallback; } }; } },
    },
    './config': { ConfigManager: Config },
    './providers/claude-provider': { ClaudeUsageProvider: Provider },
    './providers/openai-provider': { OpenAIUsageProvider: Provider },
    './providers/custom-provider': { CustomUsageProvider: Provider },
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
    setInterval() { calls.timers++; return 1; }, clearInterval() {},
  });
  module.exports.activate({ extension: { extensionKind }, subscriptions: [] });
  return calls;
}

test('SSH window never starts local providers, queries, UI or timers, even with a UI override', () => {
  assert.deepEqual(startHost('ssh-remote', 1), {
    providers: 0, queries: 0, statusItems: 0, shown: 0, timers: 0,
  });
});

test('remote workspace host performs queries and creates the window status bar', () => {
  assert.deepEqual(startHost('ssh-remote', 2), {
    providers: 2, queries: 2, statusItems: 1, shown: 1, timers: 1,
  });
});

test('ordinary local window still performs queries and shows the status bar', () => {
  assert.deepEqual(startHost(undefined, 1), {
    providers: 2, queries: 2, statusItems: 1, shown: 1, timers: 1,
  });
});
