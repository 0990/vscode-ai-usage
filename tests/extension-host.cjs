const assert = require('node:assert/strict');
const vscode = require('vscode');
const { writeFileSync } = require('node:fs');
require('../scripts/register-typescript.cjs');
const { OpenAIUsageProvider } = require('../src/providers/openai-provider.ts');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('ai-usage-tracker.ai-usage-tracker');
  assert.ok(extension, 'Extension is discoverable in VS Code');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'aiUsageTracker.refresh', 'aiUsageTracker.showDetails', 'aiUsageTracker.configure',
    'aiUsageTracker.addCustomObject', 'aiUsageTracker.manageCustomObjects', 'aiUsageTracker.selectStatusBarItems',
  ]) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }
  await vscode.commands.executeCommand('aiUsageTracker.refresh');
  await vscode.commands.executeCommand('aiUsageTracker.showDetails');
  const usage = await new OpenAIUsageProvider().getUsage();
  assert.equal(usage.error, undefined, usage.error);
  assert.equal(usage.mode, 'subscription');
  assert.ok(usage.fiveHour || usage.sevenDay);
  for (const quota of [usage.fiveHour, usage.sevenDay].filter(Boolean)) {
    assert.ok(quota.percentage >= 0 && quota.percentage <= 100);
  }
  const summary = {
    fiveHourRemaining: usage.fiveHour?.percentage,
    sevenDayRemaining: usage.sevenDay?.percentage,
  };
  console.log('AI_USAGE_EXTENSION_HOST_OK', JSON.stringify(summary));
  if (process.env.AI_USAGE_TEST_RESULT) {
    writeFileSync(process.env.AI_USAGE_TEST_RESULT, JSON.stringify(summary));
  }
};
