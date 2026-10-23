import * as vscode from 'vscode';
import type { CustomObjectConfig, CustomObjectType, ProviderConfig } from './types';

export class ConfigManager {
  private static readonly SECTION = 'aiUsageTracker';

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(ConfigManager.SECTION);
  }

  getClaudeConfig(): ProviderConfig {
    return {
      claudeScriptCommand: this.config.get<string>('claude.script.command', '').trim(),
      claudeScriptArgs: this.config.get<string[]>('claude.script.args', []),
    };
  }

  getRefreshInterval(): number {
    return Math.max(30, this.config.get<number>('refreshInterval', 300));
  }

  getCustomObjects(): CustomObjectConfig[] {
    const raw = this.config.get<unknown[]>('customObjects', []);
    if (!Array.isArray(raw)) { return []; }

    const seen = new Set<string>();
    const objects: CustomObjectConfig[] = [];
    for (const value of raw) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { continue; }
      const item = value as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const type = item.type === 'sub2api' || item.type === 'newapi'
        ? item.type as CustomObjectType : undefined;
      if (!id || !name || !type || seen.has(id)) { continue; }
      seen.add(id);
      objects.push({
        id,
        name,
        type,
        baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '',
        apiKey: typeof item.apiKey === 'string' ? item.apiKey.trim() : '',
        enabled: item.enabled !== false,
      });
    }
    return objects;
  }

  getStatusBarItems(): string[] {
    const raw = this.config.get<unknown[]>('statusBar.items', ['claude', 'openai', 'custom:*']);
    if (!Array.isArray(raw)) { return ['claude', 'openai', 'custom:*']; }
    return [...new Set(raw.filter((value): value is string => typeof value === 'string')
      .map(value => value.trim()).filter(Boolean))];
  }

  async saveCustomObjects(objects: CustomObjectConfig[]): Promise<void> {
    await this.config.update('customObjects', objects, vscode.ConfigurationTarget.Global);
  }

  async saveStatusBarItems(items: string[]): Promise<void> {
    await this.config.update('statusBar.items', [...new Set(items)], vscode.ConfigurationTarget.Global);
  }

  onDidChangeConfiguration(callback: (event: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(ConfigManager.SECTION)) { callback(e); }
    });
  }
}
