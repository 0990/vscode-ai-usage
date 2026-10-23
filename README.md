# AI Usage Tracker

在 VS Code 状态栏显示 ChatGPT 和 Claude 的 **5h / 7d 剩余额度**及重置时间。

自动读取工作区所在主机的登录凭据，无需在插件中填写密钥或配额。Claude 还支持使用自定义脚本查询。

## 使用

1. 在工作区所在主机的 Codex 和 Claude Code 中分别登录订阅账号；SSH 工作区使用远程登录用户。
2. 将本项目生成的 VSIX 安装到对应主机：普通窗口安装本机，SSH 窗口安装远端。
3. 状态栏显示剩余百分比，点击查看详情；执行 `AI Usage: Refresh Quotas` 手动刷新。

ChatGPT 默认读取 `$CODEX_HOME/auth.json`，未设置时读取 `~/.codex/auth.json`。Claude 自动读取 `CLAUDE_CODE_OAUTH_TOKEN`、运行主机的 `settings.json` 中的同名环境变量，或 `~/.claude/.credentials.json`。支持 `CLAUDE_CONFIG_DIR` 和 `CLAUDE_SETTINGS_FILE`。所有路径、环境变量和网络请求都属于插件实际运行的主机。

插件在每次刷新时重新读取凭据，不修改凭据文件、不输出 Token。未登录或登录过期时显示提示；缺失窗口不会显示为 100%。Claude 的 macOS 钥匙串暂未集成，可通过环境变量、设置文件或脚本提供查询。

普通窗口在本机执行；Remote SSH 窗口仅在远程执行。SSH 主机未安装插件时，该窗口不显示额度状态栏，也不回退查询本机账号。远端安装并启用后，结果显示在当前 VS Code 状态栏。

插件图标直接展示 **5h / 7d 两条进度条**，便于识别用途。

## 设置与状态栏显示

打开 VS Code 设置，搜索 `aiUsageTracker`。

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `refreshInterval` | 300 | 刷新间隔（秒），最小 30 |
| `claude.script.command` | 空 | 可选的脚本程序，留空使用运行主机的凭据查询 |
| `claude.script.args` | `[]` | 脚本程序的参数数组 |
| `statusBar.items` | `claude, openai, custom:*` | 状态栏可见项；推荐用多选命令修改 |
| `customObjects` | `[]` | 自定义 sub2api / newapi 余额对象 |

执行 `AI Usage: Settings` 可打开快捷设置菜单：

- `Choose Status Bar Items`：多选 Claude、ChatGPT 和已启用的自定义对象，状态栏只显示选中项。
- `Add Custom Object`：依次填写名称、`sub2api` / `newapi` 类型、Base URL 和 API Key。
- `Manage Custom Objects`：编辑、启用/停用或删除已有对象。
- `Open All Extension Settings`：打开 VS Code 原生设置页。

Claude 与 ChatGPT 状态栏只显示服务图标及额度；自定义对象显示信用卡图标、名称和余额。悬停可查看详情，点击任意一项打开统一详情页。Claude 使用 ESP32 工程 OLED 中的像素小人，GPT 使用 OpenAI 结形图标，颜色随 VS Code 主题显示。

## 自定义余额对象

自定义对象与 `esp32-ai-usage` 一致，支持：

- `sub2api`：请求 `{base}/v1/usage`，显示余额和今日用量。
- `newapi`：请求 OpenAI billing 兼容的 `subscription` 与 `usage` 接口，显示余额和累计已用。

Base URL 可填写站点根地址或带 `/v1` 的地址；根地址会先尝试 `/v1`，失败后回退根地址。API Key 通过 `Authorization: Bearer ...` 发送，不会写入日志或错误信息。它保存在插件运行主机的 VS Code 用户设置中；不要把包含该设置的 `settings.json` 提交到代码仓库。

更新插件后，如当前窗口仍显示旧版星光或通用机器人，请执行一次 `Developer: Reload Window`，让运行中的扩展宿主和图标字体加载新版本。

## Claude 脚本查询

在插件运行那一端的 VS Code 设置中配置程序和参数，即自动切换为脚本查询。清空程序路径即可恢复凭据查询。本机执行时使用用户设置；远程执行时使用 `Preferences: Open Remote Settings (JSON)`。

### Windows

使用提供的 `claude-usage.sh` 示例，在本机用户 `settings.json` 中填写：

```json
{
  "aiUsageTracker.claude.script.command": "C:\\Program Files\\Git\\bin\\bash.exe",
  "aiUsageTracker.claude.script.args": [
    "C:/Users/xujialong/Downloads/claude-usage.sh",
    "-v"
  ]
}
```

请按实际安装位置调整程序路径。脚本自行读取凭据，并需要 Bash、curl、Python 3、awk 和支持 `-d` 的 date。若使用 WSL，请配置 WSL 中的脚本路径和凭据。

### Linux（含 Remote SSH 远程主机）

先把 `claude-usage.sh` 放到 Linux 主机上，并确保该主机有 Bash、curl、Python 3、awk 和 GNU coreutils 的 `date`。例如：

```bash
mkdir -p "$HOME/.local/bin"
cp /path/to/claude-usage.sh "$HOME/.local/bin/claude-usage.sh"
chmod 700 "$HOME/.local/bin/claude-usage.sh"
/bin/bash "$HOME/.local/bin/claude-usage.sh" -v
```

将 `/path/to/claude-usage.sh` 改为实际源文件位置。先确认命令能正常输出额度，再填写配置。假设 Linux 用户为 `alice`：

```json
{
  "aiUsageTracker.claude.script.command": "/bin/bash",
  "aiUsageTracker.claude.script.args": [
    "/home/alice/.local/bin/claude-usage.sh",
    "-v"
  ]
}
```

请替换为实际 Linux 用户的绝对路径，参数中的 `~` 不会自动展开。Linux 本机运行时写入用户设置；Remote SSH 远程运行时写入 **Remote Settings**，不要沿用 Windows 的 `bash.exe` 或 `C:/...` 路径。

附件脚本从进程环境变量 `CLAUDE_CODE_OAUTH_TOKEN` 或 `~/.claude/settings.json` 的 `env.CLAUDE_CODE_OAUTH_TOKEN` 读取 Token，并支持 `CLAUDE_SETTINGS_FILE`。它不会读取 `.credentials.json`；仅有 Claude Code 登录文件时，可留空脚本程序，使用插件默认查询。

终端里临时 `export` 的变量不一定会传给已经运行的扩展宿主。脚本在终端成功、在插件里失败时，请检查脚本可读取的设置文件，以及扩展宿主继承的环境。远程运行使用的是远程用户的文件、环境和网络。

### 脚本输出格式

支持脚本输出：附件风格的普通表格、`-v` 响应头、下列 JSON。推荐 `-v`，可保留使用率精度及 Unix 重置时间。JSON 中的 `utilization` 为已使用百分比，插件自动换算为剩余百分比；缺失窗口可省略或设为 null。

```json
{
  "five_hour": { "utilization": 24, "resets_at": "2026-10-23T12:30:00Z" },
  "seven_day": { "utilization": 68, "resets_at": "2026-10-30T02:20:20Z" }
}
```

脚本必须成功退出，超时固定为 30 秒。程序和参数分别传递，不展开 `~` 或管道；不要把 Token 放进参数。脚本原始输出及错误输出不会写入错误提示。附件通过最小推理请求取响应头，会消耗少量额度，建议保持默认的刷新间隔。

## 如何选择安装到本机还是远程

安装位置由**当前窗口的工作区位置**决定，无需配置 `remote.extensionKind`。本插件声明 `extensionKind: ["workspace"]`，因此 SSH 窗口必须在远程安装后才能运行。参见 [VS Code 扩展宿主说明](https://code.visualstudio.com/api/advanced-topics/extension-host#preferred-extension-location)。

### 安装到本机 / 其它电脑

1. 打开普通本机 VS Code 窗口，确认左下角没有 `SSH: ...` 连接标记。
2. 将 **`ai-usage-tracker-0.3.0.vsix`** 复制到该电脑。
3. 扩展视图右上角 `...` → `Install from VSIX...`，或命令面板执行 `Extensions: Install from VSIX...`，选择安装包。

也可以在该电脑的普通本机终端执行：

```bash
code --install-extension ./ai-usage-tracker-0.3.0.vsix --force
```

安装后执行 `Developer: Reload Window`。目标机器需要 VS Code 1.85 或更新版本；直接安装 VSIX 无需 Node.js、npm 或重新编译，脚本模式的依赖需单独准备。随后在插件实际运行的机器上登录 Codex / Claude Code，或准备 Claude 查询脚本及其凭据。

通过 VSIX 安装后，后续版本可重新安装新的 VSIX。操作方式参见 [VS Code 官方 VSIX 安装说明](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)。

### 安装到 SSH 远程主机

1. 使用 Remote SSH 连接目标主机并打开远程目录，确认左下角显示 `SSH: <主机名>`。
2. 如果本机已安装插件，在扩展视图找到 AI Usage Tracker，点击 **`Install in SSH: <主机名>`**。本机副本在该 SSH 窗口不会执行。
3. 如果尚未安装，或需更新手头的 VSIX，在这个 SSH 窗口执行 `Extensions: Install from VSIX...`，选择新版 VSIX；工作区扩展会安装到该远程主机。扩展视图的 `SSH: <主机名> - Installed` 分组可确认位置。
4. 执行 `Developer: Reload Window`。远程安装与本机安装各自独立，连接另一台 SSH 主机时需要在那台主机上单独安装。

这个安装提示与截图中的 `Install in SSH: ...` 行为一致，属于 VS Code 的工作区扩展安装机制。安装位置和分组说明见 [Remote SSH 官方文档](https://code.visualstudio.com/docs/remote/ssh#_managing-extensions)。

也可先将 VSIX 上传到远端，例如 `/tmp/ai-usage-tracker-0.3.0.vsix`，再在 **VS Code SSH 窗口的集成终端**中执行：

```bash
code --install-extension /tmp/ai-usage-tracker-0.3.0.vsix --force
```

这里的 `code` 是远程会话提供的 CLI。普通本机终端中的 `code --install-extension` 安装到本机；VS Code SSH 集成终端中的同一命令安装到当前远端，不是由 VSIX 文件存放在本地还是远程来单独决定。

## Remote SSH 的额度与凭据

| 当前窗口 / 安装情况 | 执行位置 | 凭据与脚本来源 | 状态栏 |
|---------------------|----------|----------------|--------|
| 普通本机窗口，本机已安装 | 本机 | 本机用户 | 显示 |
| SSH 窗口，仅本机已安装 | 不运行 | 不读取 | 不显示 |
| SSH 窗口，远程已安装并启用 | 远程 SSH 主机 | 远程登录用户 | 在本机 VS Code 显示远端额度 |

远端安装后，还需使用同一 SSH 用户在远程登录 Codex / Claude Code，或准备 Claude 脚本和凭据；远端网络须能访问相应接口。如使用脚本，在 `Preferences: Open Remote Settings (JSON)` 中填写前面的 Linux 配置，使用远程绝对路径。

通过 `Developer: Show Running Extensions` 可检查该扩展是否位于远程扩展宿主。数据通过 VS Code 的远程扩展机制更新到本机状态栏，无需额外开放服务端口；插件不复制本机凭据到远程。

**旧版本迁移：** 如果之前按旧文档配置了 `remote.extensionKind`，请删除其中 `ai-usage-tracker.ai-usage-tracker` 的覆盖项，采用新版默认规则。尤其不要保留 `["ui"]` 覆盖；即使强制本机加载，新版也不会在 SSH 窗口创建本机状态栏或查询本机账号。

远端已安装但状态栏没有显示时，先执行 `Developer: Reload Window`，再运行 `AI Usage: Choose Status Bar Items` 确认已勾选 Claude / ChatGPT。从 0.3.1 起，选中的服务启动后立即显示加载图标，各服务分别更新；未登录或网络失败时显示警告，可点击查看详情。旧版会等所有请求完成后才显示，远端连接缓慢时可能一直看不到任何项目。如果仍不显示，右键状态栏确认 `Claude Usage` / `ChatGPT Usage` 没有被 VS Code 隐藏，并通过 `Developer: Show Running Extensions` 检查远端激活情况。

## 开发与打包

```bash
npm ci
npm run lint
npm test
npm run package -- --allow-missing-repository
```

`npm run package` 调用 `vsce package`，并先通过 `vscode:prepublish` 自动执行生产构建。它将扩展清单、`out/extension.js`、图标等资源打包为根目录下的 `ai-usage-tracker-<版本>.vsix`；`.vscodeignore` 排除源码、测试、依赖目录和构建产物目录。无需手工压缩文件。

在 VS Code 中执行 `Extensions: Install from VSIX...` 安装生成的文件，或按 F5 启动开发宿主。

- `npm run check:chatgpt`：使用本机凭据验证 ChatGPT 额度。
- `npm run check:claude`：使用本机凭据验证 Claude 额度，需先登录。
- `npm run test:extension`：扩展宿主测试，使用本机凭据。

### GitHub Actions：推送 Tag 自动发布 Release

工作流文件为 `.github/workflows/release.yml`。将本工程（包括工作流和 `package-lock.json`）提交到 GitHub 仓库后，**推送版本 Tag 就会自动创建带 VSIX 附件的 GitHub Release**：

1. 检出该 Tag 对应的代码，使用 Node.js 24。
2. 校验 Tag、`package.json` 和 `package-lock.json` 的版本一致。
3. 执行 `npm ci`、类型检查、离线测试和生产打包。
4. 发布名为该 Tag 的 Release，附加 `ai-usage-tracker-<版本>.vsix`，并自动生成发布说明。

Tag 支持 `v0.3.1` 或 `0.3.1` 两种形式，须与插件版本完全对应。版本不匹配或检查失败时不会发布。普通分支推送不会触发该发布流程。

例如从 `0.3.0` 发布下一版 `v0.3.1`，先确保代码已提交到 GitHub 仓库，再执行：

```bash
npm version patch --no-git-tag-version
git add .
git commit -m "Release v0.3.1"
git tag v0.3.1
git push origin HEAD
git push origin v0.3.1
```

在 GitHub 仓库的 **Actions → Release VSIX** 查看执行状态；成功后到 **Releases → 对应版本 → Assets** 下载 VSIX。发布使用 GitHub 自动提供的 `GITHUB_TOKEN` 和工作流声明的 `contents: write` 权限，不需要额外创建 PAT，也不需要 ChatGPT / Claude 凭据。它发布的是 GitHub Release 附件，不会发布到 VS Code Marketplace。

状态栏字形源文件为 `scripts/build-icons.py`，修改后可运行 `npm run icons:build`（需要 Python fonttools）。插件图标由 ImageGen 绘制，提示词见 `scripts/icon-prompt.md`。
