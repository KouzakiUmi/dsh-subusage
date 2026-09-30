# 订阅用量插件方案（dsh-subusage，暂名）

> 状态：**调研完成，尚未写代码**。2026-09-30 记录。
> 目标环境：DeepSeek Harness 0.2.0-rc.2 / 桌面 profile（desktop）。

---

## 1. 需求（按你的四条要求归纳）

1. **先做出来**：设置页里需要的信息全部 UI 填写；每个数据源带**状态灯**——拉取成功 🟢、失败 🔴。
2. **做成 OpenCode Go 那种设置页**（设置 → 独立分区，表单 + 保存）。
   - **自动检测已配置的模型商**，**继承环境里已有的 Key**；没拿到的可手动填写。
   - Cookie 类（小米）不好取就**直接拉一个登录页面**（Harness 本身是 Chromium，同源登录态可收）。
3. **药丸要匹配当前会话选择的模型**：选中哪家的模型，模型选择器左边就显示**那家**的订阅信息。

## 2. 现有功能检查：dsh-opencode-go 的"模型选择左边显示订阅信息"

**结论：功能正常（截图已确认）。** 实现要点（供新插件照抄）：

| 项 | 位置/行为 |
|---|---|
| 药丸组件 | `lib/client.js` → `UsagePill`（源 `src/client/UsagePill.tsx`，行 1547–1682） |
| 挂载点 | slot `conversation.input.right`，id `opencode-go-usage`，`order: 1000`（行 1685–1707），**渲染在模型选择器左侧** |
| 可见条件 | `state.current?.provider === "opencode-go"` 才渲染（行 1549）——**"匹配当前模型"的现成范式** |
| 药丸文案 | `Go · 5小时 2% · 周 13%`；点开弹层：5h/每周/每月 三条进度条 + 百分比 + 重置时间 + 状态色（≥80% 黄、≥100% 或 rate-limited 红） |
| 轮询 | 挂载即拉一次，`setInterval` 60s + `visibilitychange` 立即刷；失败保留同账号上次数据（`retainPrevious`）+ 错误原因 + "立即重试"按钮 |
| Host 侧取数 | Typert remote `opencodeGoUsage.read()`（`lib/index.js` 行 1594–1663）：`GET {baseURL}/usage`，Bearer key，10s 超时，1MiB 上限，瞬时 reset 重试一次；失败抛 `RemoteError('opencode-go/usage-unavailable', …, {retryable, retainPrevious, source})` |
| Key 解析 | `credentials.resolve(credentialRef(ref)) ?? launchEnvironmentOf(ctx).get(ref)`（行 1710–1712），`ref` 即配置里的 `apiKeyEnv` 字段——**"继承环境 Key"的现成范式** |
| 设置页挂载 | `settings.section` slot，id `opencode-go`，`order: 20`，`label` 来自 locale（行 1745–1751）；双路：`configForms` + `settingsScope.bind({namespace, decode})` |
| 数据契约 | `{rolling, weekly, monthly}: {status: ok\|rate-limited, percent, resetsAt}` + `source`（账号标识，用于判断能否保留旧数据） |

## 3. 调研结论：哪些模型商支持"凭 API Key 查订阅用量"

| 模型商 | 结论 | 接口 | 门槛 |
|---|---|---|---|
| OpenCode Go | ✅ 已实现 | `GET /usage`（Bearer） | 无（本插件自带） |
| **Kimi Coding** | ✅ **一个 key 就齐** | `GET https://api.kimi.com/coding/v1/usages`（`Bearer sk-kimi-…`），国内站 api.kimi.com、海外 api.kimi.ai | 无。官方 CLI `/usage` 走它，属未公开但社区工具广泛依赖（[kimi-code-usage](https://github.com/Golden0Voyager/kimi-code-usage) 等）。**注意**：必须是 Kimi Code 控制台 key，与 moonshot 开平台 key 不通 |
| **Z.ai / GLM Coding (CN)** | ⚠️ key 不够，要 3 个附加参数 | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | ① `bigmodel-organization`、② `bigmodel-project` 两个请求头（**必需**，缺 → 返回空 `data:{}`）③ `?type=2` 团队 / `1` 个人（缺 → 报"当前用户不存在 coding plan"）。三值去 [bigmodel.cn/coding-plan](https://bigmodel.cn/coding-plan/) 登录后 DevTools Network 抓一次（固定值）。响应语义见 [pi-glm-quota](https://github.com/focksor/pi-glm-quota)：`limits[]` 中 `CREDIT_LIMIT`，`unit:3`=5h 窗、`unit:6`=周窗，`percentage` 已用%，`nextResetTime` epoch ms。**存疑**：pi-glm-quota 说 `Authorization: <key>` 裸值，CodexBar 说 `Bearer <key>`，实现时两种都试或实测定 |
| **Xiaomi Token Plan (CN)** | ❌ **API Key 死路**；Cookie/登录页可做 | 控制台 `platform.xiaomimimo.com/api/v1/…`（balance / token-plan usage），需 `api-platform_serviceToken` + `userId` Cookie | `tp-`/`sk-` 推理 key 查余额一律 404（[CodexBar mimo 文档](https://github.com/steipete/CodexBar/blob/main/docs/mimo.md)、[MiMo 文档](https://mimo.mi.com/docs)）。→ 走需求 2 的"登录页面"路线 |
| xAI (grok-4.7) | ⚠️ 换把 key | `GET https://management-api.x.ai/v1/billing/teams/{team_id}/usage`、`/prepaid/balance` | 推理 key 查不了；要 Console→Settings→**Management Keys**（另一种 key）+ `team_id`。**本轮建议不做**，留扩展位 |
| DeepSeek | ✅ 有接口，但本机接法拿不到 | `GET https://api.deepseek.com/user/balance`（[官方文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)） | 本机走**账号登录**路由，API-key 路由已被全局禁用；要显示需另配 `DEEPSEEK_API_KEY`。**本轮建议不做**，留扩展位 |

> 另注：`dsh-all-usage` 是**本地会话统计**（从日志算 token/费用），与厂商订阅额度是两回事；它是小米之外"有用量感"的备胎。

## 4. 已完成的环境侦察

1. **三个 Key 都已在用户级环境变量里**（"继承环境 Key"成立）：
   - `ZAI_CODING_CN_API_KEY` ✅、`KIMI_CODING_API_KEY` ✅、`XIAOMI_TOKEN_PLAN_CN_API_KEY` ✅（另 `OPENCODE_API_KEY` ✅）。
   - 解析照抄 opencode-go：credentials 服务优先，回落 `launchEnvironmentOf`。
2. **已配置的模型商**（profile `cordis.patch.yml` → `llm-pi-ai` config）：`zai-coding-cn` / `kimi-coding` / `xiaomi-token-plan-cn`；默认模型 `xiaomi-token-plan-cn/mimo-v2.6-flash`。→ 设置页要探测的就是这三家。
3. **Chrome 直读 Cookie 已证不可行**（所以才需要登录页方案）：
   - Chrome 154 运行中，`Default\Network\Cookies` 被独占锁：`Copy-Item` 失败、SQLite `mode=ro` / `immutable=1` 失败、裸 `open()` PermissionError。
   - 且 Chrome 127+ 是 **v20 app-bound 加密**（Local State 有 `app_bound_encrypted_key`），就算解开文件锁，DPAPI 也解不了 v20。
4. **主窗口允许 `<webview>`**：主窗口 `webPreferences.webviewTag: primary`（app.asar ≈行 2342966）；其他辅助窗口都是 `false`。→ 设置页内嵌 webview 打开小米登录页**技术上可行**（路线 B）。
5. **壳内已有"登录窗口"先例可抄**（app.asar）：
   - `policyLoginTitle` 的独立 BrowserWindow（≈行 2341215，独立 `session: this.browserSession`）；
   - Anthropic/OpenAI OAuth 走**本地 loopback HTTP server** + `oauthSuccessHtml` 成功页（≈行 1099554/1101086）。
   - `setWindowOpenHandler`：http/https 一律 `shell.openExternal` + deny —— **`window.open` 打不开内嵌窗口**，别指望这条路。
6. **Host 进程形态**：`DeepSeek Harness.exe --expose-internals …\dsh-desktop-host\lib\index.js`（pid 29560，Electron 以 RUN_AS_NODE 方式跑，非主进程）。→ **Host 侧不能创建 BrowserWindow**（RUN_AS_NODE 无 Electron UI API）。登录窗口只能放 **client（renderer）侧**，或复用壳的既有窗口机制。
7. client 插件已有现成注入面可挂：`conversation.input.right`（药丸）、`settings.section`（设置页）、`modelDirectories`（判断当前 provider）、`remote.credentials`。

## 5. 拟定方案

新本地插件，暂名 **`dsh-subusage`**（源放 `~\.dsh\local-plugins\dsh-subusage\`，`file:` 依赖装进 desktop profile，自带 `cordis.patch.yml` insert + 进 `dsh.profile.bundles`）。

### Host（`lib/index.js`）
- Typert remote `subUsage.read(providerId)` → **归一化成 opencode-go 同款契约** `{rolling, weekly, monthly: {status, percent, resetsAt}, source}`（弹层渲染逻辑可整体复用）。
- 三个 adapter：
  - `kimi-coding`：Bearer env key，最简单，**先行实现**。
  - `zai-coding-cn`：裸值/Bearer + org/project/type 三参数（来自设置）。
  - `xiaomi-token-plan-cn`：带 Cookie 调 `platform.xiaomimimo.com/api/v1/…`（Cookie 来源见路线）。
- Key 解析统一走 credentials → env（继承 `apiKeyEnv` 命名约定）。
- 错误按 opencode-go 分级：`retryable` / `retainPrevious` / `source`。

### Client（`lib/client.js`）
- **药丸**：挂 `conversation.input.right`（order 避开 1000 冲突），读 `directory.current.provider`：
  - `opencode-go` → 不渲染（让原插件的药丸去显示，避免双药丸）；
  - `zai-coding-cn` / `kimi-coding` / `xiaomi-token-plan-cn` → 拉本插件 remote 显示对应家；
  - 其它 provider → 不渲染。
- **状态灯**：设置页顶部一个总灯 + 每行数据源一个灯；药丸 label 带 🟢/🔴。拉取成功 🟢，任何失败 🔴（附失败原因 + 重试）。
- **设置页**（`settings.section` slot，OpenCode Go 同款布局）：
  - 顶部：状态灯 + 最近刷新时间 + "立即刷新"；
  - 行 1：**自动检测**（读 llm-pi-ai 已配置 providers，与本插件支持表求交集），Key 来源标注"已继承环境变量 `XXX_API_KEY` ✅"或"未检测到 → 手动填写"；
  - 行 2 Z.ai：组织 ID / 项目 ID / 套餐类型（1/2）三个输入框 + 抓取指引文案；
  - 行 3 小米：Cookie 获取区（路线 A/B）+ 状态灯。

### 小米登录页三条候选路线（**待定，实现时先试 A**）
- **路线 A（客户端 webview 登录窗）**：设置页用主窗口的 `webviewTag:true` 能力开一个登录 webview（或壳允许的窗口形态），登录完成后从 webContents/session 拿 `serviceToken`/`userId` Cookie 存入本插件配置。**未验证点**：plugin client 是否能触达 webview 的 session/Cookie；`window.open` 已被 deny，需另找开法。
- **路线 B（loopback OAuth 式）**：照壳内 Anthropic/OpenAI 先例，Host 起本地 HTTP server + 拉起浏览器登录页，回调收凭据。**未验证点**：小米登录是否走可回调的 OAuth（大概率是纯会话 Cookie，不是 OAuth）→ 可能不成立。
- **路线 C（手动粘贴）**：设置页给文本框，从浏览器 DevTools 复制 `Cookie:` 头粘贴（CodexBar 的 Manual 模式）。**保底方案**，一定可行，先做进来兜底。

### 装载清单（沿用已踩过的坑）
- [ ] `~\.dsh\local-plugins\dsh-subusage\` + `package.json`（`dsh.manifestVersion`、`exports` 含 `./locale/*`、`./package.json`）
- [ ] 自带 `cordis.patch.yml` insert；**profile patch 若写 config 必须字段写全**（整体替换）
- [ ] `profiles\desktop\package.json`：`dependencies` 加 `file:` 项 + `dsh.profile.bundles` 数组补项（**bundles 是启动时读的 → 必须重启**）
- [ ] 装前检查 `pnpm-lock.yaml` 只读守卫、`allowBuilds` 布尔化（四坑见 SKILL §3）
- [ ] 验证：`cordis_inspect_*` 查 host 条目 + client Slot occupant `active: true`

## 6. 待决问题

1. **Z.ai Authorization 形态**（裸值 vs Bearer）——实现时实测定。
2. **小米登录页路线 A 的可行性**（plugin client 能否开 webview / 拿 Cookie）——先小实验再定，不行退路线 C。
3. **provider 检测数据源**：client 侧从哪读"llm-pi-ai 已配置的 providers 及其 apiKeyEnv"（`remote.llm` 目录？settingsScope？）——写码前先探。
4. xAI / DeepSeek 是否纳入本期（各差一把 key/账号路由问题），默认**不纳入**，remote 接口留 `providerId` 扩展位。

## 7. 下一步

1. 探 provider 检测数据源（问题 3）。
2. 小实验：client 侧 webview/登录窗 + Cookie 拿取（问题 2）→ 定路线 A 或 C。
3. 写插件骨架：Host remote（先 Kimi）→ 药丸 → 设置页 → 状态灯。
4. Z.ai adapter（实测 Authorization 形态）→ 小米 adapter。
5. 装载、重启、按交付清单验收。
