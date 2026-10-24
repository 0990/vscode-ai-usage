# Changelog

## Unreleased

- Add a tag-triggered GitHub Actions workflow that validates versions, tests, packages and publishes the VSIX as a GitHub Release asset

## [0.3.2] - 2026-10-23

- Share HTTP and Claude script query results across windows/processes for the same host and system user, with separate cache keys for credentials and endpoints
- Cache both successful and failed queries for the refresh period; remove immediate HTTP retries and respect longer Retry-After deadlines on HTTP 429
- Reserve a query period before network/script work so reloads and interrupted hosts cannot immediately repeat a request
- Poll after each completed cycle and stop scheduling when the extension is disposed
- Restrict custom endpoint fallback to HTTP 404/405; do not retry failed queries through another route
- Preserve original sample/reset dates on cache hits and clarify separate Claude script program/argument settings

## [0.3.1] - 2026-10-23

- Show selected providers immediately with a loading indicator while quota requests are pending
- Update each provider independently so a slow remote request does not block other status bar results
- Bound network requests during DNS lookup and connection setup as well as socket inactivity

## [0.3.0] - 2026-10-23

- Add custom sub2api and newapi balance objects with add, edit, enable/disable and delete commands
- Add a multi-select command that controls exactly which built-in and custom objects appear in the status bar
- Show custom balances and usage in both the status bar and detailed dashboard
- Follow the reference project's root URL / `/v1` fallback behavior and keep API keys out of logs and errors

## [0.2.5] - 2026-10-23

- Run as a workspace extension: SSH windows require installation on the remote host
- Use the workspace host's credentials, environment and scripts; do not fall back to local queries in remote windows
- Explain local versus remote installation in the README

## [0.2.4] - 2026-10-23

- Enlarge the 5h / 7d artwork to reduce whitespace in the extension icon
- Show only provider icons and quotas in the status bar; retain provider names in tooltips

## [0.2.3] - 2026-10-23

- Redraw the extension icon as clearly labeled 5h / 7d quota progress bars
- Document Linux Claude script setup, installation on other machines, and Remote SSH execution with local status-bar display

## [0.2.2] - 2026-10-23

- Replace ChatGPT's terminal-style status-bar glyph with the OpenAI knot logo

## [0.2.1] - 2026-10-23

- Replace the extension icon with one pixel character and one quota bar
- Use the ESP32 OLED's Claude and Codex bitmaps as distinct native status-bar glyphs
- Replace the remaining generic GPT robot icon and document the reload needed after an extension update

## [0.2.0] - 2026-10-23

- Simplify to local ChatGPT/Claude subscription credentials and an optional Claude query script
- Keep only refresh interval, Claude script executable, and script arguments in Settings
- Remove API keys, admin keys, manual quotas, cost tracking, and built-in model probes
- Add a reference-style pixel Claude status-bar glyph and a new extension icon

## [0.1.0] - 2026-10-23

### Added
- Read local Claude Code OAuth credentials, environment tokens and settings tokens automatically
- Configurable Claude usage API, max_tokens=1 response-header probe, and local script query modes
- Parse reference claude-usage.sh tables/verbose headers and JSON with bounded script execution and regression coverage
- Auto-detect local Codex ChatGPT credentials (including CODEX_HOME) for real 5h/7d subscription quotas and reset times
- Classify subscription windows by duration; leave missing windows unavailable
- Local ChatGPT smoke check and credential/response regression tests
- Initial release
- Status bar display for Claude and ChatGPT usage quotas
- Claude OAuth subscription usage tracking
- Claude API rate-limit monitoring
- OpenAI Admin API organization usage tracking
- OpenAI API rate-limit monitoring
- Manual quota tracking mode
- Detailed webview panel with progress bars
- Color-coded status bar indicators
- SSH Remote workspace compatibility
- Configurable refresh interval
