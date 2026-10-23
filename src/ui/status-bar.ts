import * as vscode from 'vscode';
import type { CustomUsageData, UsageData, QuotaInfo } from '../types';

export class StatusBarManager {
  private claudeItem: vscode.StatusBarItem;
  private openaiItem: vscode.StatusBarItem;
  private readonly customItems = new Map<string, vscode.StatusBarItem>();

  constructor(alignment: vscode.StatusBarAlignment, priority: number) {
    this.claudeItem = vscode.window.createStatusBarItem(alignment, priority);
    this.openaiItem = vscode.window.createStatusBarItem(alignment, priority - 1);

    this.claudeItem.command = 'aiUsageTracker.showDetails';
    this.openaiItem.command = 'aiUsageTracker.showDetails';

    this.claudeItem.name = 'Claude Usage';
    this.openaiItem.name = 'ChatGPT Usage';
  }

  update(
    claudeData: UsageData | undefined,
    openaiData: UsageData | undefined,
    customData: CustomUsageData[] = [],
    visibleItems: string[] = ['claude', 'openai', 'custom:*']
  ): void {
    const visible = new Set(visibleItems);
    if (visible.has('claude')) {
      this.updateProviderItem(this.claudeItem, claudeData, '$(ai-usage-claude)', 'Claude');
    } else {
      this.claudeItem.hide();
    }
    if (visible.has('openai')) {
      this.updateProviderItem(this.openaiItem, openaiData, '$(ai-usage-chatgpt)', 'ChatGPT');
    } else {
      this.openaiItem.hide();
    }

    const current = new Set(customData.map(data => data.id));
    for (const [id, item] of this.customItems) {
      if (!current.has(id)) {
        item.dispose();
        this.customItems.delete(id);
      }
    }
    customData.forEach((data, index) => {
      let item = this.customItems.get(data.id);
      if (!item) {
        item = vscode.window.createStatusBarItem(
          vscode.StatusBarAlignment.Right,
          98 - index
        );
        item.command = 'aiUsageTracker.showDetails';
        this.customItems.set(data.id, item);
      }
      item.name = `${data.name} Balance`;
      if (visible.has(data.id) || visible.has('custom:*')) {
        this.updateCustomItem(item, data);
      } else {
        item.hide();
      }
    });
  }

  private updateProviderItem(
    item: vscode.StatusBarItem,
    data: UsageData | undefined,
    icon: string,
    label: string
  ): void {
    if (data) {
      this.updateItem(item, data, icon, label);
      return;
    }
    item.text = `${icon} $(loading~spin)`;
    item.tooltip = `${label}: 正在查询额度，点击查看详情`;
    item.backgroundColor = undefined;
    item.show();
  }

  private updateCustomItem(item: vscode.StatusBarItem, data: CustomUsageData): void {
    if (data.error || data.balance === undefined) {
      item.text = '$(credit-card) $(warning)';
      item.tooltip = `${data.name} (${data.type})\n${data.error ?? '暂无余额数据'}\n` +
        `更新时间：${data.lastUpdated.toLocaleTimeString()}`;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      item.show();
      return;
    }

    item.text = `$(credit-card) ${this.safeStatusText(data.name)}: ${this.formatMoney(data.unit, data.balance)}`;
    const lines = [
      `${data.name} (${data.type})`,
      `余额：${this.formatMoney(data.unit, data.balance)}`,
    ];
    if (data.used !== undefined) {
      lines.push(`${data.usedLabel}：${this.formatMoney(data.unit, data.used)}`);
    }
    lines.push(`更新时间：${data.lastUpdated.toLocaleTimeString()}`, '点击查看详情');
    item.tooltip = lines.join('\n');
    item.backgroundColor = data.balance < 0
      ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    item.show();
  }

  private formatMoney(unit: string, value: number): string {
    return `${unit}${value.toFixed(2)}`;
  }

  private safeStatusText(value: string): string {
    return value.replace(/\$\(/g, '$ (').replace(/[\r\n]/g, ' ');
  }

  private updateItem(
    item: vscode.StatusBarItem,
    data: UsageData,
    icon: string,
    label: string
  ): void {
    if (data.error && !data.fiveHour && !data.sevenDay) {
      item.text = `${icon} $(warning)`;
      item.tooltip = this.buildErrorTooltip(label, data);
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      item.show();
      return;
    }

    const parts: string[] = [];
    let worstPercentage = 100;

    if (data.fiveHour) {
      parts.push(`${data.fiveHour.percentage}%(5h)`);
      worstPercentage = Math.min(worstPercentage, data.fiveHour.percentage);
    }
    if (data.sevenDay) {
      parts.push(`${data.sevenDay.percentage}%(7d)`);
      worstPercentage = Math.min(worstPercentage, data.sevenDay.percentage);
    }
    if (parts.length === 0) {
      item.text = `${icon} --`;
      item.tooltip = `${label}: No usage data available\nLast updated: ${data.lastUpdated.toLocaleTimeString()}`;
      item.backgroundColor = undefined;
      item.show();
      return;
    }

    item.text = `${icon} ${parts.join(' | ')}`;
    item.tooltip = this.buildTooltip(label, data);

    // Color coding based on worst percentage
    if (worstPercentage <= 10) {
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (worstPercentage <= 25) {
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      item.backgroundColor = undefined;
    }

    item.show();
  }

  private buildTooltip(label: string, data: UsageData): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown(`### ${label} Usage\n\n`);
    md.appendMarkdown(`**Source**: ${data.mode === 'script' ? 'Local script' : 'Local credentials'}\n\n`);

    if (data.fiveHour) {
      md.appendMarkdown(this.formatQuotaSection('5-Hour Window', data.fiveHour));
    }
    if (data.sevenDay) {
      md.appendMarkdown(this.formatQuotaSection('7-Day Window', data.sevenDay));
    }
    if (data.error) {
      md.appendMarkdown(`$(warning) **Warning**: ${data.error}\n\n`);
    }

    md.appendMarkdown(`---\n\n*Last updated: ${data.lastUpdated.toLocaleTimeString()}*\n\n`);
    md.appendMarkdown(`*Click to show details*`);

    return md;
  }

  private buildErrorTooltip(label: string, data: UsageData): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown(`### $(warning) ${label} Usage Error\n\n`);
    md.appendMarkdown(`${data.error}\n\n`);
    md.appendMarkdown(`---\n\n*Click to show details*`);

    return md;
  }

  private formatQuotaSection(title: string, quota: QuotaInfo): string {
    const bar = this.buildProgressBar(quota.percentage);
    const resetStr = quota.resetAt
      ? `\nResets: ${quota.resetAt.toLocaleString()}`
      : '';

    return `**${title}**\n\n` +
      `${bar} ${quota.percentage}% remaining\n\n` +
      `Used: ${quota.used}% (remaining: ${quota.remaining}%)${resetStr}\n\n`;
  }

  private buildProgressBar(percentage: number): string {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    const filledChar = '█';
    const emptyChar = '░';
    return `\`${filledChar.repeat(filled)}${emptyChar.repeat(empty)}\``;
  }

  show(visibleItems: string[] = ['claude', 'openai', 'custom:*']): void {
    this.update(undefined, undefined, [], visibleItems);
  }

  hide(): void {
    this.claudeItem.hide();
    this.openaiItem.hide();
    for (const item of this.customItems.values()) { item.hide(); }
  }

  dispose(): void {
    this.claudeItem.dispose();
    this.openaiItem.dispose();
    for (const item of this.customItems.values()) { item.dispose(); }
    this.customItems.clear();
  }
}
