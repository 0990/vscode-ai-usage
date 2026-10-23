require('./register-typescript.cjs');
const { OpenAIUsageProvider } = require('../src/providers/openai-provider.ts');

async function main() {
  const provider = new OpenAIUsageProvider();
  const usage = await provider.getUsage();
  if (usage.error) {
    console.error(usage.error);
    process.exitCode = 1;
    return;
  }
  const summary = { mode: usage.mode, updated: usage.lastUpdated.toISOString() };
  for (const [label, quota] of [['5h', usage.fiveHour], ['7d', usage.sevenDay]]) {
    summary[label] = quota ? { remainingPercent: quota.percentage, resetAt: quota.resetAt?.toISOString() } : null;
  }
  // Only quota data is printed; credentials and raw API responses stay private.
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(() => {
  console.error('ChatGPT 额度检查失败。');
  process.exitCode = 1;
});
