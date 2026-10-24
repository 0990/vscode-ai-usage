import type { UsageData, UsageProvider, ProviderConfig } from '../types';
import { fetchClaudeUsage } from './claude-usage';

export class ClaudeUsageProvider implements UsageProvider {
  readonly name = 'Claude';

  constructor(private config: ProviderConfig = {}) {}

  updateConfig(config: ProviderConfig): void {
    this.config = config;
  }

  async getUsage(intervalSeconds = 300): Promise<UsageData> {
    try {
      return await fetchClaudeUsage(this.config, undefined, undefined, intervalSeconds * 1000);
    } catch (error) {
      return {
        provider: 'claude', mode: this.config.claudeScriptCommand ? 'script' : 'subscription',
        lastUpdated: new Date(),
        error: error instanceof Error ? error.message : 'Claude 额度查询失败。',
      };
    }
  }
}
