const { spawn } = require('node:child_process');
const { mkdtempSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const executable = process.env.VSCODE_EXECUTABLE || join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
if (!existsSync(executable)) {
  console.error('Set VSCODE_EXECUTABLE to the VS Code executable.');
  process.exit(1);
}
const profile = mkdtempSync(join(tmpdir(), 'ai-usage-extension-host-'));
const resultPath = join(profile, 'test-result.json');
const env = { ...process.env, AI_USAGE_TEST_RESULT: resultPath };
// A terminal opened by VS Code inherits Electron/IPC flags. Isolate the test host.
for (const key of Object.keys(env)) {
  if (key.startsWith('VSCODE_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
}
const child = spawn(executable, [
  '--new-window', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
  '--user-data-dir', profile,
  '--extensions-dir', join(profile, 'extensions'),
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${join(root, 'tests', 'extension-host.cjs')}`,
], { env, windowsHide: true, stdio: 'inherit' });
const timer = setTimeout(() => {
  console.error(`VS Code extension tests timed out. Logs: ${profile}`);
  child.kill();
  process.exitCode = 1;
}, 90_000);
child.on('error', error => {
  clearTimeout(timer);
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', code => {
  clearTimeout(timer);
  if (code !== 0 || !existsSync(resultPath)) {
    console.error(`VS Code extension tests failed (exit ${code}). Logs: ${profile}`);
    process.exitCode = 1;
    return;
  }
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  console.log('VS Code extension activation, refresh and details passed:', result);
});
