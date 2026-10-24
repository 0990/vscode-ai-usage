// Keep fake quota/error samples out of the user's live shared cache.
if (!process.env.AI_USAGE_TEST_CACHE_HOME) {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'ai-usage-tests-'));
  process.env.AI_USAGE_TEST_CACHE_HOME = directory;
  process.env.XDG_CACHE_HOME = directory;
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}
