import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { ClaudeUsageProvider } from './providers/claude-provider';
import { OpenAIUsageProvider } from './providers/openai-provider';
import { CustomUsageProvider } from './providers/custom-provider';
import { StatusBarManager } from './ui/status-bar';
import { DetailPanelManager } from './ui/detail-panel';
import {
  addCustomObject,
  manageCustomObjects,
  selectStatusBarItems,
  showConfigurationMenu,
} from './ui/configuration-commands';
import type { CustomUsageData, UsageData } from './types';

let statusBar: StatusBarManager | undefined;
let detailPanel: DetailPanelManager | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimerGeneration = 0;
let refreshIntervalSeconds = 300;
let claudeProvider: ClaudeUsageProvider | undefined;
let openaiProvider: OpenAIUsageProvider | undefined;
let claudeData: UsageData | undefined;
let openaiData: UsageData | undefined;
let customProviders: CustomUsageProvider[] = [];
let customData: CustomUsageData[] = [];
let visibleStatusBarItems = ['claude', 'openai', 'custom:*'];
let refreshGeneration = 0;

export function activate(context: vscode.ExtensionContext): void {
  // Even an old remote.extensionKind override must not query local credentials
  // or create a local status item in a remote workspace window.
  if (vscode.env.remoteName && context.extension.extensionKind !== vscode.ExtensionKind.Workspace) {
    console.log('[AI Usage Tracker] Skipping local activation in a remote window; install on the remote host.');
    return;
  }

  const configManager = new ConfigManager();

  // Initialize providers
  const claudeConfig = configManager.getClaudeConfig();
  claudeProvider = new ClaudeUsageProvider(claudeConfig);
  openaiProvider = new OpenAIUsageProvider();
  customProviders = configManager.getCustomObjects()
    .filter(object => object.enabled)
    .map(object => new CustomUsageProvider(object));
  visibleStatusBarItems = configManager.getStatusBarItems();

  // Initialize UI
  statusBar = new StatusBarManager(vscode.StatusBarAlignment.Right, 100);
  detailPanel = new DetailPanelManager();

  statusBar.show(visibleStatusBarItems);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aiUsageTracker.refresh', () => {
      vscode.window.showInformationMessage('AI Usage: Refreshing quotas...');
      return refreshAll();
    }),
    vscode.commands.registerCommand('aiUsageTracker.showDetails', () => {
      detailPanel?.showPanel(context, claudeData, openaiData, customData);
    }),
    vscode.commands.registerCommand('aiUsageTracker.configure', () => {
      return showConfigurationMenu(configManager);
    }),
    vscode.commands.registerCommand('aiUsageTracker.addCustomObject', () =>
      addCustomObject(configManager)),
    vscode.commands.registerCommand('aiUsageTracker.manageCustomObjects', () =>
      manageCustomObjects(configManager)),
    vscode.commands.registerCommand('aiUsageTracker.selectStatusBarItems', () =>
      selectStatusBarItems(configManager))
  );

  // Watch configuration changes
  context.subscriptions.push(
    configManager.onDidChangeConfiguration(event => {
      visibleStatusBarItems = configManager.getStatusBarItems();
      if (event.affectsConfiguration('aiUsageTracker.customObjects')) {
        // Never retain another account's balance after its URL/key changes.
        customData = [];
      }
      statusBar?.update(claudeData, openaiData, customData, visibleStatusBarItems);
      detailPanel?.updateData(claudeData, openaiData, customData);
      if (!event.affectsConfiguration('aiUsageTracker.customObjects') &&
          !event.affectsConfiguration('aiUsageTracker.claude') &&
          !event.affectsConfiguration('aiUsageTracker.refreshInterval')) { return; }
      claudeProvider?.updateConfig(configManager.getClaudeConfig());
      customProviders = configManager.getCustomObjects()
        .filter(object => object.enabled)
        .map(object => new CustomUsageProvider(object));
      visibleStatusBarItems = configManager.getStatusBarItems();

      // Restart refresh timer
      startRefreshTimer(configManager.getRefreshInterval());
    })
  );

  // Fetch once, then wait the configured period after every completed cycle.
  startRefreshTimer(configManager.getRefreshInterval());

  // Register disposable
  context.subscriptions.push({
    dispose: () => {
      refreshTimerGeneration++;
      refreshGeneration++;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      statusBar?.dispose();
      detailPanel?.dispose();
    },
  });

  console.log('[AI Usage Tracker] Extension activated');
}

function startRefreshTimer(intervalSeconds: number): void {
  const generation = ++refreshTimerGeneration;
  refreshIntervalSeconds = intervalSeconds;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  const refresh = async () => {
    try {
      await refreshAll();
    } finally {
      // The next cycle starts after completion, so a slow request cannot overlap a
      // timer tick or make a just-cached result skip an entire refresh cycle.
      if (generation === refreshTimerGeneration) {
        refreshTimer = setTimeout(() => { void refresh(); }, intervalSeconds * 1000);
      }
    }
  };
  void refresh();
}

async function refreshAll(): Promise<void> {
  const generation = ++refreshGeneration;
  const providers = [...customProviders];
  const publish = () => {
    statusBar?.update(claudeData, openaiData, customData, visibleStatusBarItems);
    detailPanel?.updateData(claudeData, openaiData, customData);
  };
  const refreshBuiltIn = async (provider: 'claude' | 'openai') => {
    let data: UsageData | undefined;
    try {
      data = await (provider === 'claude' ? claudeProvider : openaiProvider)?.getUsage(refreshIntervalSeconds);
    } catch {
      data = {
        provider, mode: 'subscription', lastUpdated: new Date(),
        error: '额度查询失败，请检查登录状态和网络。',
      };
    }
    if (generation !== refreshGeneration) { return; }
    if (provider === 'claude') { claudeData = data; } else { openaiData = data; }
    publish();
  };
  await Promise.all([
    refreshBuiltIn('claude'),
    refreshBuiltIn('openai'),
    ...providers.map(async provider => {
      let data: CustomUsageData;
      try {
        data = await provider.getUsage(refreshIntervalSeconds);
      } catch {
        data = {
          id: provider.config.id, name: provider.config.name, type: provider.config.type,
          unit: '$', usedLabel: provider.config.type === 'sub2api' ? '今日用量' : '累计已用',
          lastUpdated: new Date(), error: '余额查询失败，请检查对象配置和网络。',
        };
      }
      if (generation !== refreshGeneration) { return; }
      const byId = new Map(customData.map(value => [value.id, value]));
      byId.set(data.id, data);
      customData = providers.flatMap(value => {
        const result = byId.get(value.config.id);
        return result ? [result] : [];
      });
      publish();
    }),
  ]);
}

export function deactivate(): void {
  refreshGeneration++;
  refreshTimerGeneration++;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  statusBar?.dispose();
  detailPanel?.dispose();
  console.log('[AI Usage Tracker] Extension deactivated');
}
