# 部署记录与 OpenRouter 接入（2026-11-22）

## 1. 本次新增：OpenRouter 免费模型

| 项 | 内容 |
|---|---|
| 提供方 | `moonshot`（原 Kimi）/ `openrouter`，默认 `openrouter` |
| 默认模型 | `baidu/ernie-5.5-flash-preview:free`（实测中文回复稳定、`cost: 0`） |
| 备用免费模型 | `inclusionai/ling-3.2-flash:free`、`google/gemma-4-31b-it:free` |
| 密钥文件 | `runtime/openrouter-key`（0600），与 `runtime/kimi-key` 并列 |
| 接口 | `https://openrouter.ai/api/v1/chat/completions`，OpenAI 兼容 |

代码改动：

- `agent/ai-config.mjs`：新增 `providers` 表、`openrouterFreeModels`；`completionRequest`
  按提供方生成请求体——Kimi 保留 `reasoning_effort` / `prompt_cache_options` /
  `max_completion_tokens`，OpenRouter 改用 `max_tokens` 并剔除这些 Moonshot 专属字段。
- `agent/server.mjs`：`generate()` 按提供方取 base URL 与密钥，OpenRouter 追加
  `HTTP-Referer` / `X-Title` 头；报错文案改为提供方名。
- `agent/settings.mjs`：支持保存 `openrouterKey`，状态里增加 `openrouterConfigured`。
- `agent/kimi-stream.mjs`：报错文案由「Kimi」改为「模型」（OpenRouter 也走同一 SSE 解析）。
- 界面：连接设置增加 OpenRouter Key 输入；「AI 模型与用量」增加提供方下拉与模型名输入。
- 测试：新增 4 条（OpenAI 兼容请求体、提供方切换的模型回落、模型名校验、切换后保持），
  `agent` 85/85 通过；应用下游补丁后 `test-addons` 59/59 通过。

注意：免费池会 429。`ling` 与 `gemma` 在实测中多次被上游限流；`ernie` 稳定。
推理型免费模型（如 `nemotron-3.5-lightning`）会把预算烧在思考上，正文可能为空，
`completionText` 会因此报「未返回正文」，不建议用于草稿。

## 2. 本机部署

| 项 | 值 |
|---|---|
| 代码位置 | `.../outputs/项目源码交接_2026-11-22/MengxiEcho-4.2.5-agent.17.3-auto/` |
| 运行时 | `/opt/homebrew/opt/node@24/bin/node`（v24.22.3，keg-only，不影响默认 node@22） |
| 运行时目录 | `~/Library/Application Support/MengxiEcho/runtime/`（0700） |
| 存档目录 | `~/Downloads/My0511存档/` |
| 常驻方式 | `~/Library/LaunchAgents/com.mengxi.echo.agent.plist`，KeepAlive，崩溃自动拉起 |
| 监听 | `127.0.0.1:17851` |
| 日志 | `runtime/logs/agent.log`、`runtime/logs/agent.err.log` |

管理命令：

```bash
launchctl kickstart -k gui/$(id -u)/com.mengxi.echo.agent   # 重启
launchctl bootout gui/$(id -u)/com.mengxi.echo.agent        # 停止
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mengxi.echo.agent.plist  # 启动
```

扩展加载目录：`dist/extension`（已注入 `key`、`http://127.0.0.1:17851/*` 权限、
`version_name 4.2.5-agent.17.3-auto`，并已用 `patches/poster.js`、`patches/api.js`
覆盖上游原版——顺序必须与 `scripts/build.mjs` 一致：先复制上游快照，再打下游补丁）。Chrome → `chrome://extensions` → 开发者模式 →
「加载已解压的扩展程序」→ 选该目录。

## 3. 验证结果

- Telegram `getMe`：`ok=true`，机器人 `@my0511dodothinkapprovalbot`（My0511）。
- OpenRouter：密钥有效（`limit: 2`，`usage: 0`），`ernie-5.5-flash-preview:free`
  经 Agent `/ai` 端到端返回中文回复，约 4 秒，`cost: 0`。
- 服务：launchd `state = running`，监听 17851，启动日志正常。

## 4. 尚未完成（需人工）

1. Chrome 加载 `dist/extension`。
2. 工作台填「本机配对码」→ 连接本地服务。
3. Telegram 向机器人发送 `/start <绑定码>` 完成本人账号绑定。
4. 需要自动发表时，再打开工作台开关（默认关闭）。

配对码与绑定码 15 分钟有效，过期后重启服务重新生成（绑定码也可在界面点「生成新的绑定码」）。

## 5. 环境副作用

`brew install node@24` 顺带升级了 `simdjson`，导致原有 `node@22` 无法启动；
已用 `brew reinstall node@22` 修复至 v22.23.5。默认 `node` 仍是 22，本项目显式使用 24。

## 6. 界面裁剪与上游校验（2026-11-22 追加）

上游运行在 Edge、下游运行在 Chrome，cookies 与浏览器指纹天然隔离。因此只裁**界面**，
不动**运行时**，也不动上游采集能力。

### 裁剪

`downstream-excludes.json` 列出 11 个上游界面文件，打包时排除：

```
popup.html / popup.js / popup.css / popup-post.js
options.html / options.js
posting.html / posting.js / posting-bulk.js
toggle-button.js / control.html
```

扩展顶层文件从 34 个降到 24 个。`control.css` 保留（下游 `workbench.html` 在用），
`offscreen.html` 保留（`background.js` 解析页面要用，且无界面）。

连带改动：

- 清单里 `action.default_popup` 指向 `addons/launcher.html`，`options_page` 删除。
- `patches/alerts.js`：通知点击原先打开上游 `control.html`，改为打开下游 `addons/workbench.html`。
  这是第 3 个下游补丁，与 `poster.js`、`api.js` 同一机制。

### 校验（三层，均可独立运行）

```bash
node scripts/verify-upstream.mjs    # 随时核对源码与上游锁
node scripts/package-local.mjs      # 校验 → 排除 → 打补丁 → 打包 → 复核
```

1. **打包前**：48 个上游文件逐个比对 `upstream-lock.json`，任一漂移即中止。
2. **排除项合法性**：被排除的文件必须仍在上游锁中，避免误删来路不明的文件。
3. **打包后**：随包发出的上游文件（除排除项、补丁项、manifest/icons）再比对一次；
   并检查 `extension/` 下没有未登记的文件。

`scripts/verify-upstream.mjs` 当前输出：

```
上游核心文件：48 个
  一致随包：34 个
  排除（上游界面）：11 个
  下游补丁覆盖：3 个 —— extension/alerts.js, extension/api.js, extension/poster.js
校验通过。
```

### 免费模型选择与测试

工作台「AI 模型与用量」新增：

- 「模型名」改为可输入 + 下拉，下拉由 `POST /ai-models` 从 OpenRouter 拉取，只列
  `:free` 模型，缓存 1 小时。
- 「测试当前模型」按钮调用 `POST /ai-test`：用当前提供方与模型发一次 2048 token 的
  真实请求，返回耗时、正文与用量，不占用每日调用额度。

实测（同一把密钥）：

| 模型 | 结果 |
|---|---|
| `baidu/ernie-5.5-flash-preview:free` | 3.5 s，正文可用 |
| `inclusionai/ling-3.2-flash:free` | 60 s 超时（免费池拥塞） |

结论：免费池不稳定，选模型前先用「测试当前模型」跑一次，别等草稿生成失败才发现。
