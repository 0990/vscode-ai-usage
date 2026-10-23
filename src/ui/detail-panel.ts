import * as vscode from 'vscode';
import type { CustomUsageData, UsageData, QuotaInfo } from '../types';

export class DetailPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private claudeData: UsageData | undefined;
  private openaiData: UsageData | undefined;
  private customData: CustomUsageData[] = [];

  showPanel(
    context: vscode.ExtensionContext,
    claudeData: UsageData | undefined,
    openaiData: UsageData | undefined,
    customData: CustomUsageData[] = []
  ): void {
    this.claudeData = claudeData;
    this.openaiData = openaiData;
    this.customData = customData;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.html = this.getWebviewContent();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'aiUsageDetails',
      'AI Usage Details',
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getWebviewContent();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  updateData(
    claudeData: UsageData | undefined,
    openaiData: UsageData | undefined,
    customData: CustomUsageData[] = []
  ): void {
    this.claudeData = claudeData;
    this.openaiData = openaiData;
    this.customData = customData;
    if (this.panel) {
      this.panel.webview.html = this.getWebviewContent();
    }
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private getWebviewContent(): string {
    const claudeHtml = this.claudeData
      ? this.renderProviderCard('Claude', '✨', this.claudeData, '#d97706')
      : '<div class="card disabled"><h2>✨ Claude</h2><p>Not configured</p></div>';

    const openaiHtml = this.openaiData
      ? this.renderProviderCard('ChatGPT', '🤖', this.openaiData, '#10a37f')
      : '<div class="card disabled"><h2>🤖 ChatGPT</h2><p>Not configured</p></div>';
    const customHtml = this.customData.map(data => this.renderCustomCard(data)).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Usage Details</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    h1 {
      font-size: 1.5em;
      margin-bottom: 20px;
      color: var(--vscode-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .card.disabled {
      opacity: 0.5;
    }
    .card h2 {
      margin: 0 0 12px 0;
      font-size: 1.2em;
    }
    .card .mode {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
    }
    .quota-section {
      margin-bottom: 16px;
    }
    .quota-section h3 {
      margin: 0 0 8px 0;
      font-size: 0.95em;
      color: var(--vscode-foreground);
    }
    .progress-container {
      background: var(--vscode-progressBar-background, #333);
      border-radius: 4px;
      height: 20px;
      overflow: hidden;
      margin-bottom: 6px;
      position: relative;
    }
    .progress-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
      position: relative;
    }
    .progress-label {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 0.75em;
      font-weight: bold;
      color: white;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
      white-space: nowrap;
    }
    .progress-green { background: linear-gradient(90deg, #22c55e, #16a34a); }
    .progress-yellow { background: linear-gradient(90deg, #eab308, #ca8a04); }
    .progress-red { background: linear-gradient(90deg, #ef4444, #dc2626); }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .stats .label { font-weight: 500; }
    .error {
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      padding: 8px 12px;
      margin-top: 8px;
      font-size: 0.85em;
    }
    .updated {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      text-align: right;
    }
    .divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 16px 0;
    }
  </style>
</head>
<body>
  <h1>📊 AI Usage Dashboard</h1>
  ${claudeHtml}
  ${openaiHtml}
  ${customHtml}
  <div class="updated">Dashboard auto-refreshes with status bar</div>
</body>
</html>`;
  }

  private renderCustomCard(data: CustomUsageData): string {
    const name = this.escapeHtml(data.name);
    let content = `<div class="card">
  <h2 style="border-left: 3px solid #3b82f6; padding-left: 10px;">💳 ${name}</h2>
  <div class="mode">${data.type} • Updated: ${data.lastUpdated.toLocaleTimeString()}</div>`;
    if (data.balance !== undefined) {
      content += `<div class="stats">
    <span class="label">Balance:</span><span>${this.escapeHtml(this.formatMoney(data.unit, data.balance))}</span>`;
      if (data.used !== undefined) {
        content += `<span class="label">${this.escapeHtml(data.usedLabel)}:</span>` +
          `<span>${this.escapeHtml(this.formatMoney(data.unit, data.used))}</span>`;
      }
      content += '</div>';
    }
    if (data.error) {
      content += `<div class="error">⚠️ ${this.escapeHtml(data.error)}</div>`;
    }
    return content + '</div>';
  }

  private formatMoney(unit: string, value: number): string {
    return `${unit}${value.toFixed(2)}`;
  }

  private renderProviderCard(
    name: string,
    icon: string,
    data: UsageData,
    accentColor: string
  ): string {
    let content = `<div class="card">
  <h2 style="border-left: 3px solid ${accentColor}; padding-left: 10px;">${icon} ${name}</h2>
  <div class="mode">Source: ${data.mode === 'script' ? 'Local script' : 'Local credentials'} • Updated: ${data.lastUpdated.toLocaleTimeString()}</div>`;

    if (data.fiveHour) {
      content += this.renderQuotaSection('5-Hour Window', data.fiveHour);
    }
    if (data.sevenDay) {
      content += this.renderQuotaSection('7-Day Window', data.sevenDay);
    }
    if (data.error) {
      content += `<div class="error">⚠️ ${this.escapeHtml(data.error)}</div>`;
    }

    content += '</div>';
    return content;
  }

  private renderQuotaSection(title: string, quota: QuotaInfo): string {
    const pct = quota.percentage;
    const colorClass = pct > 50 ? 'progress-green' : pct > 25 ? 'progress-yellow' : 'progress-red';
    const resetStr = quota.resetAt
      ? `<span class="label">Resets:</span><span>${quota.resetAt.toLocaleString()}</span>`
      : '';

    return `<div class="quota-section">
  <h3>${title}</h3>
  <div class="progress-container">
    <div class="progress-bar ${colorClass}" style="width: ${pct}%;">
      <span class="progress-label">${pct}% remaining</span>
    </div>
  </div>
  <div class="stats">
    <span class="label">Used:</span><span>${quota.used.toLocaleString()}%</span>
    <span class="label">Remaining:</span><span>${quota.remaining.toLocaleString()}%</span>
    ${resetStr}
  </div>
</div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
