import type { UsageData, UsageProvider, ProviderConfig } from '../types';
import { fetchClaudeUsage } from './claude-usage';

export class ClaudeUsageProvider implements UsageProvider {
  readonly name = 'Claude';
  private subscriptionRequest?: Promise<UsageData>;

  constructor(private config: ProviderConfig = {}) {}

  updateConfig(config: ProviderConfig): void {
    this.config = config;
  }

  async getUsage(): Promise<UsageData> {
    try {
      if (!this.subscriptionRequest) {
        this.subscriptionRequest = fetchClaudeUsage(this.config).finally(() => {
          this.subscriptionRequest = undefined;
        });
      }
      return await this.subscriptionRequest;
    } catch (error) {
      return {
        provider: 'claude', mode: this.config.claudeScriptCommand ? 'script' : 'subscription',
        lastUpdated: new Date(),
        error: error instanceof Error ? error.message : 'Claude 额度查询失败。',
      };
    }
  }
}
