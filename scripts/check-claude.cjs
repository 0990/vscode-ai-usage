require('./register-typescript.cjs');
const { ClaudeUsageProvider } = require('../src/providers/claude-provider.ts');

async function main() {
  const provider = new ClaudeUsageProvider();
  const result = await provider.getUsage();
  if (result.error) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  const summary = {};
  for (const [name, window] of [['5h', result.fiveHour], ['7d', result.sevenDay]]) {
    summary[name] = window ? { remainingPercent: window.percentage, resetAt: window.resetAt?.toISOString() } : null;
  }
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(() => { console.error('Claude 额度检查失败。'); process.exitCode = 1; });
