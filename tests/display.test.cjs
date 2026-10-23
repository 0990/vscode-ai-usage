const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const items = [];
let panel;
const vscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Beside: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class {
    constructor(value = '') { this.value = value; }
    appendMarkdown(value) { this.value += value; return this; }
  },
  workspace: { getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue }) },
  window: {
    createStatusBarItem: () => {
      const item = {
        visible: false, disposed: false,
        show() { this.visible = true; }, hide() { this.visible = false; },
        dispose() { this.disposed = true; this.visible = false; },
      };
      items.push(item);
      return item;
    },
    createWebviewPanel: () => {
      panel = { webview: { html: '' }, onDidDispose() {}, dispose() {} };
      return panel;
    },
  },
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args);
};
const { ConfigManager } = require('../src/config.ts');
const { StatusBarManager } = require('../src/ui/status-bar.ts');
const { DetailPanelManager } = require('../src/ui/detail-panel.ts');
const { parseCodexUsage } = require('../src/providers/codex-usage.ts');
const { parseClaudeUsage } = require('../src/providers/claude-usage.ts');
Module._load = originalLoad;

test('settings expose quotas, custom objects and status-bar selection', () => {
  const manifest = require('../package.json');
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.deepEqual(Object.keys(manifest.contributes.configuration.properties).sort(), [
    'aiUsageTracker.claude.script.args', 'aiUsageTracker.claude.script.command',
    'aiUsageTracker.customObjects', 'aiUsageTracker.refreshInterval', 'aiUsageTracker.statusBar.items',
  ]);
  assert.equal(manifest.icon, 'media/icon.png');
  const { existsSync } = require('node:fs');
  const { resolve } = require('node:path');
  assert.ok(existsSync(resolve(__dirname, '..', manifest.icon)));
  assert.ok(existsSync(resolve(__dirname, '..', manifest.contributes.icons['ai-usage-claude'].default.fontPath)));
  assert.ok(existsSync(resolve(__dirname, '..', manifest.contributes.icons['ai-usage-chatgpt'].default.fontPath)));
  assert.equal(manifest.contributes.icons['ai-usage-chatgpt'].default.fontCharacter, '\\E002');
  const config = new ConfigManager();
  assert.equal(config.getRefreshInterval(), 300);
  assert.deepEqual(config.getClaudeConfig(), { claudeScriptCommand: '', claudeScriptArgs: [] });
  assert.deepEqual(config.getCustomObjects(), []);
  assert.deepEqual(config.getStatusBarItems(), ['claude', 'openai', 'custom:*']);
});

test('status visibility supports mixed selections, hide-all and custom removal', () => {
  const status = new StatusBarManager(2, 100);
  const claude = items.at(-2);
  const gpt = items.at(-1);
  const usage = parseClaudeUsage({ five_hour: { utilization: 24 } });
  const custom = {
    id: 'custom:one', name: '<游卡>', type: 'newapi', balance: 12.34,
    used: 2, unit: '$', usedLabel: '累计已用', lastUpdated: new Date(),
  };
  status.update(usage, { ...usage, provider: 'openai' }, [custom], ['openai', custom.id]);
  const relay = items.at(-1);
  assert.equal(claude.visible, false);
  assert.equal(gpt.visible, true);
  assert.equal(relay.visible, true);
  assert.match(relay.text, /12\.34/);
  assert.match(relay.tooltip, /累计已用：\$2\.00/);
  status.update(usage, usage, [custom], []);
  assert.equal(gpt.visible, false);
  assert.equal(relay.visible, false);
  status.update(undefined, undefined, [custom], ['custom:*']);
  assert.equal(relay.visible, true);
  const details = new DetailPanelManager();
  details.showPanel({}, undefined, undefined, [custom]);
  assert.match(panel.webview.html, /&lt;游卡&gt;/);
  assert.match(panel.webview.html, /\$12\.34/);
  status.update(undefined, undefined, [], ['custom:*']);
  assert.equal(relay.disposed, true);
});

test('startup shows selected providers while quotas are still loading', () => {
  const status = new StatusBarManager(2, 100);
  const claude = items.at(-2);
  const gpt = items.at(-1);
  status.show(['claude', 'openai']);
  assert.equal(claude.visible, true);
  assert.equal(gpt.visible, true);
  assert.match(claude.text, /loading~spin/);
  assert.match(gpt.text, /loading~spin/);

  const usage = parseClaudeUsage({ five_hour: { utilization: 24 } });
  status.update(usage, undefined, [], ['claude', 'openai']);
  assert.match(claude.text, /76%/);
  assert.match(gpt.text, /loading~spin/);
  status.show(['openai']);
  assert.equal(claude.visible, false);
  assert.equal(gpt.visible, true);
  status.show([]);
  assert.equal(claude.visible, false);
  assert.equal(gpt.visible, false);
});

test('Claude used percentages display as remaining percentages in both views', () => {
  const usage = parseClaudeUsage({ five_hour: { utilization: 24 }, seven_day: { utilization: 68 } });
  const status = new StatusBarManager(2, 100);
  const claudeItem = items.at(-2);
  status.update(usage, undefined);
  assert.ok(claudeItem.text.startsWith('$(ai-usage-claude) '));
  assert.equal(claudeItem.text, '$(ai-usage-claude) 76%(5h) | 32%(7d)');
  assert.match(claudeItem.tooltip.value, /Claude Usage/);
  const details = new DetailPanelManager();
  details.showPanel({}, usage, undefined);
  assert.match(panel.webview.html, /76% remaining/);
  assert.match(panel.webview.html, /32% remaining/);
});

test('subscription percentages reach the status bar, tooltip and detail panel', () => {
  const usage = parseCodexUsage({ rate_limit: {
    primary_window: { used_percent: 2, limit_window_seconds: 18000 },
    secondary_window: { used_percent: 6, limit_window_seconds: 604800 },
  } });
  const status = new StatusBarManager(2, 100);
  const gptItem = items.at(-1);
  status.update(undefined, usage);
  assert.ok(gptItem.text.startsWith('$(ai-usage-chatgpt) '));
  assert.equal(gptItem.text, '$(ai-usage-chatgpt) 98%(5h) | 94%(7d)');
  assert.match(gptItem.tooltip.value, /ChatGPT Usage/);
  assert.match(gptItem.tooltip.value, /Used: 2% \(remaining: 98%\)/);
  const details = new DetailPanelManager();
  details.showPanel({}, undefined, usage);
  assert.match(panel.webview.html, /5-Hour Window/);
  assert.match(panel.webview.html, /7-Day Window/);
  assert.match(panel.webview.html, /Used:<\/span><span>2%/);
  const weeklyOnly = { ...usage, fiveHour: undefined };
  status.update(undefined, weeklyOnly);
  assert.doesNotMatch(gptItem.text, /5h/);
  details.updateData(undefined, weeklyOnly);
  assert.doesNotMatch(panel.webview.html, /5-Hour Window/);
});
