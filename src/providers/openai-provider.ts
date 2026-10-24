import type { UsageData, UsageProvider } from '../types';
import { fetchCodexUsage } from './codex-usage';

export class OpenAIUsageProvider implements UsageProvider {
  readonly name = 'ChatGPT';

  constructor(private readonly authPath?: string) {}

  async getUsage(intervalSeconds = 300): Promise<UsageData> {
    try {
      return await fetchCodexUsage(this.authPath, undefined, intervalSeconds * 1000);
    } catch (error) {
      return {
        provider: 'openai', mode: 'subscription', lastUpdated: new Date(),
        error: error instanceof Error ? error.message : 'ChatGPT 额度查询失败。',
      };
    }
  }
}
