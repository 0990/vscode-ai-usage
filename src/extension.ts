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
let refreshTimer: ReturnType<typeof setInterval> | undefined;
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

  statusBar.show();

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

      // Refresh immediately after config change
      void refreshAll();
    })
  );

  // Start periodic refresh
  startRefreshTimer(configManager.getRefreshInterval());

  // Initial refresh
  void refreshAll();

  // Register disposable
  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
      }
      statusBar?.dispose();
      detailPanel?.dispose();
    },
  });

  console.log('[AI Usage Tracker] Extension activated');
}

function startRefreshTimer(intervalSeconds: number): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(() => {
    void refreshAll();
  }, intervalSeconds * 1000);
}

async function refreshAll(): Promise<void> {
  const generation = ++refreshGeneration;
  const providers = [...customProviders];
  const results = await Promise.allSettled([
    claudeProvider?.getUsage(),
    openaiProvider?.getUsage(),
    ...providers.map(provider => provider.getUsage()),
  ]);

  if (generation !== refreshGeneration) { return; }

  if (results[0].status === 'fulfilled' && results[0].value) {
    claudeData = results[0].value;
  } else if (results[0].status === 'rejected') {
    claudeData = {
      provider: 'claude',
      mode: 'subscription',
      lastUpdated: new Date(),
      error: `Unexpected error: ${results[0].reason}`,
    };
  }

  if (results[1].status === 'fulfilled' && results[1].value) {
    openaiData = results[1].value;
  } else if (results[1].status === 'rejected') {
    openaiData = {
      provider: 'openai',
      mode: 'subscription',
      lastUpdated: new Date(),
      error: `Unexpected error: ${results[1].reason}`,
    };
  }

  customData = providers.map((provider, index) => {
    const result = results[index + 2];
    if (result.status === 'fulfilled') { return result.value as CustomUsageData; }
    return {
      id: provider.config.id,
      name: provider.config.name,
      type: provider.config.type,
      unit: '$',
      usedLabel: provider.config.type === 'sub2api' ? '今日用量' : '累计已用',
      lastUpdated: new Date(),
      error: '余额查询失败，请检查对象配置和网络。',
    };
  });

  statusBar?.update(claudeData, openaiData, customData, visibleStatusBarItems);
  detailPanel?.updateData(claudeData, openaiData, customData);
}

export function deactivate(): void {
  refreshGeneration++;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  statusBar?.dispose();
  detailPanel?.dispose();
  console.log('[AI Usage Tracker] Extension deactivated');
}
