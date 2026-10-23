import type { UsageData, UsageProvider } from '../types';
import { fetchCodexUsage } from './codex-usage';

export class OpenAIUsageProvider implements UsageProvider {
  readonly name = 'ChatGPT';

  constructor(private readonly authPath?: string) {}

  async getUsage(): Promise<UsageData> {
    try {
      return await fetchCodexUsage(this.authPath);
    } catch (error) {
      return {
        provider: 'openai', mode: 'subscription', lastUpdated: new Date(),
        error: error instanceof Error ? error.message : 'ChatGPT 额度查询失败。',
      };
    }
  }
}
