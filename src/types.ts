export interface UsageData {
  provider: 'claude' | 'openai';
  mode: 'subscription' | 'script';
  fiveHour?: QuotaInfo;
  sevenDay?: QuotaInfo;
  lastUpdated: Date;
  error?: string;
}

export type CustomObjectType = 'sub2api' | 'newapi';

export interface CustomObjectConfig {
  /** Stable identifier used by statusBar.items. */
  id: string;
  name: string;
  type: CustomObjectType;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface CustomUsageData {
  id: string;
  name: string;
  type: CustomObjectType;
  balance?: number;
  used?: number;
  unit: string;
  usedLabel: string;
  lastUpdated: Date;
  error?: string;
}

export interface QuotaInfo {
  unit: '%';
  used: number;
  total: number;
  remaining: number;
  /** 0-100, remaining percentage. */
  percentage: number;
  resetAt?: Date;
}

export interface ProviderConfig {
  claudeScriptCommand?: string;
  claudeScriptArgs?: string[];
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface UsageProvider {
  getUsage(): Promise<UsageData>;
  readonly name: string;
}
