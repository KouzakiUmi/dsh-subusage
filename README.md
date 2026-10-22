<div align="center">

# 订阅用量显示

**额度与余额，不必离开对话。**

在 DeepSeek Harness 的模型选择器旁看余量；点开药丸，查看额度窗口、重置时间与余额。

[![npm](https://img.shields.io/npm/v/dsh-subusage?color=3b82f6&label=npm)](https://www.npmjs.com/package/dsh-subusage)
[![license](https://img.shields.io/badge/license-MIT-64748b)](#license--security--许可与安全)
[![DSH Core](https://img.shields.io/badge/DSH_Core-0.2.x-64748b)](#compatibility--兼容性)

[快速开始](#快速开始) · [功能预览](#功能预览) · [支持清单](#支持的数据--supported-data) · [凭据指引](docs/credentials.md)

<img src="https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/title.png" width="1200" alt="dsh-subusage：保留原标题图的深蓝构图，右侧展示真实 Codex 与 OpenCode Go 深浅主题用量弹层；虚构数据离线预览">

<sub>真实组件 · 虚构数据 · 真实组件离线预览，不是运行中的 DSH 截图</sub>

</div>

> **0.14.5**：修复 OpenDesign Cookie 失效却显示「数据不完整」的问题；已识别的认证错误明确报告登录/凭据失效，不再被另一额度池的成功结果掩盖。普通网络与服务故障仍独立降级。同步修正默认开关数量、凭据保存流程与实测覆盖说明。发布与本机升级分开；本页图片是虚构数据离线预览，不是实机验收证明。[查看更新记录](docs/changelog.md)。

## 快速开始

```console
dsh plugin --profile web add dsh-subusage
```

`web` 是示例 Profile，请替换为实际目标。**Desktop 使用目标桌面壳提供的 DSH Desktop CLI**，不要从独立公共 CLI 管理保留的 `desktop` Profile。

1. **启用插件**：按部署方式重载，让 Host 与 Client 一起生效；只刷新页面不保证 Host 已升级。
2. **配置需要的提供商**：打开 **设置 → 订阅用量 → 提供商管理**。填 API Key，或使用对应提供方插件的登录态；MiMo 可“登录并自动导入”。[不知道该填什么？](docs/credentials.md)
3. **回到对话**：选择该提供商的模型，输入区出现用量药丸。点开看明细；读取失败会说明原因，不把未知当充足。

**已经登录 DSH 的 DeepSeek 账号？** 默认开启的「DeepSeek 账号」直接读取宿主余额，不需要复制 token。独立 API Key 使用另一个「DeepSeek API」入口，两份余额不相加、不互相替代。[两种入口的区别](docs/providers.md#deepseek-api-与-deepseek-账号)

## 功能预览

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/readme/features-dark.png">
  <img src="https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/readme/features-light.png" width="1200" alt="三块真实组件：Codex 套餐用量、独立 DeepSeek 账号余额、Command Code 多账户轮换池；虚构数据离线预览">
</picture>

### 看额度：最紧张的窗口，先提醒你

一个窗口一根余量条。正常时保持简洁；周窗偏少、额度耗尽、读取失败时，药丸明确提示。点开后再看百分比、适用范围与重置倒计时，不需要先切到控制台。

### 看余额：金额直接显示，单位不混淆

无套餐窗口且数据完整时，药丸直接显示金额。人民币、美元与 credits 各按自己的规则展示；**余额不等于订阅额度，也不能盖过已耗尽的套餐**。DeepSeek API 与本机账号有各自的开关、凭据来源与余额。

### 管账户：需要时展开，不让长列表占满界面

Command Code 可在弹层和设置页切换固定账户，或查看自动轮换池的健康度。逐账户详情默认折叠，受限周期明确标注。**自动轮换模式的用量仍是默认账户，不跟随实际服务中的账户。**

## 支持什么

**29 条数据入口，新安装默认开启 13 条。** 按使用场景，主要分为：

| 你想看什么 | 代表提供商 |
|---|---|
| 订阅窗口与重置时间 | Kimi、MiMo、Codex、SuperGrok、MiniMax、Z.ai、OpenCode Go、OpenDesign |
| 账号钱包与 API 余额 | DeepSeek API / 账号、SiliconFlow、Novita、Hyperbolic、DeepInfra |
| 套餐、余额与多层预算 | Command Code、NanoGPT、OpenRouter、ZenMux、LiteLLM |
| 账号级套餐与企业席位 | 火山方舟 Agent Plan / Coding Plan |

[查看完整支持清单](#支持的数据--supported-data) · [查看哪些经过真实账号验证](#support-status--实测覆盖)

本插件**只显示用量，不注册模型路由**。Codex 默认关闭，避免与提供方自带药丸重复；需要统一展示时可手动开启。私有额度接口可能变化，数字仅供参考，不是计费依据。

## 也可以直接问 Agent

“看一下 Kimi 和 Codex 还剩多少额度。”

模型可调用只读工具 `subusage_quota`，读取与界面同源的额度与余额；可按提供商筛选，Command Code 可分别返回各账户状态。本机装了 [`dsh-antigravity-acp`](https://github.com/KouzakiUmi/dsh-antigravity-acp) 或 [`dsh-connect-trae`](https://github.com/dingminhua/dsh-connect-trae) 时，报告里还会带上它们所报的 Antigravity / Trae 额度（**联动项**：读它们自己算好的结果，不读凭据、不写设置）。不会通过该工具修改设置。[工具与 Host 服务契约](#额度查询-api)

## 使用前，先知道这三点

- **不猜数据**：查询失败、缓存与部分覆盖会明确标注；接口读取成功不保证仍可续用。
- **不把凭据放进截图或结果**：API Key、Cookie 与 OAuth token 不回填界面；但本插件手动配置仍可能明文落盘，**它不是加密凭据库**。
- **验证有范围**：历史真实账号记录覆盖 7 个入口，其余主要依靠桩测试；新图是虚构数据离线渲染，不能作为真实账号在线验收证明。[实测范围与风险](#support-status--实测覆盖)

<details>
<summary><strong>版本与验证范围：本页截图展示了什么？</strong></summary>

标题图和三功能特写由当前 `lib/client.js` 的真实组件生成，未制作平行 UI。画面使用虚构金额与账户；绿色余额图标、最多两位小数与独立 Codex Subscription OAuth 兼容纳入 **0.13.0**。OAuth 续约仍由凭据所属插件负责；未替代真实账号在线验收。

0.12.0 已发布双 DeepSeek 入口、分单位余额预警与 Command Code 详情折叠；该版本正常余额为灰色。历史截图与每轮验证范围见[更新记录](docs/changelog.md)和[开发说明](docs/development.md)。

</details>

---

# 技术文档

安装、配置与排障参考。日常使用先看上面的快速开始，需要定位具体接口或凭据来源时再展开下文。

## 支持的数据 / Supported data

共 **29 条 provider id**：新安装**有效默认开启 13 条、关闭 16 条**。另有 **4 条联动项**（`antigravity`、`trae`、`trae-global`、`trae-enterprise`）：它们没有自己的凭据、检测开关与设置卡片，只在本机运行对应兄弟插件（[`dsh-antigravity-acp`](https://github.com/KouzakiUmi/dsh-antigravity-acp) / [`dsh-connect-trae`](https://github.com/dingminhua/dsh-connect-trae)）时才出现在 `subusage_quota` 工具报告与 `quota()` 视图里，数据取自那些插件自己算好的额度（一个读它的 Cordis 服务，一个读它挂在本机的只读用量路由）。清单取自 [`lib/index.js`](lib/index.js) 的 `PROVIDERS`，有效默认值以 `defaultSettings()` / `parseStored()` 的组归一化为准：Ark 四路共用默认开启的组开关，团队两路也随组开启，不能只统计注册元数据。展示顺序与短名取自 [`lib/client.js`](lib/client.js) 的 `PROVIDER_META` / `PROVIDER_ORDER`。

| 提供商 | provider id | 额度类型 | 鉴权 | 默认 |
|---|---|---|---|---|
| DeepSeek API | `deepseek` | 余额（账户） | Bearer，与推理同一把 Key | 开 |
| DeepSeek 账号 | `deepseek-account` | 余额（本机账号充值） | 复用 DSH `deepseekAccount` 登录态，无独立 Key | 开 |
| Z.ai（中国） | `zai-coding-cn` | 订阅窗口 | Bearer（团队档另加组织 / 项目请求头） | 开 |
| Kimi Coding | `kimi-coding` | 订阅窗口 | Bearer | 开 |
| Xiaomi MiMo | `xiaomi-token-plan-cn` | 周期额度池 | 官方平台 Cookie（含登录流程） | 开 |
| OpenCode Go | `opencode-go` | 订阅窗口 | Bearer | 开 |
| Command Code | `commandcode` | 5 小时 / 周 / 月额度池 | 提供方插件的凭据链 | 开 |
| SuperGrok | `xai-oauth` | 周期池 | 共享 Grok CLI 登录文件，过期经 grok-kit 续约 | 开 |
| Codex (ChatGPT) | `openai-codex` | ChatGPT 订阅窗口 | 只读 Subscription 独立 OAuth（0.13.0 起）或 Codex CLI 登录文件 | 关 |
| MiniMax（中国） | `minimax-cn` | 短周期 / 周 | Bearer | 开 |
| ARK Agent Plan (arkcli) | `arkcli-agent-plan` | 订阅窗口（AFP） | IAM AK/SK 签名 | 开 |
| ARK Coding Plan (arkcli) | `arkcli-coding-plan` | 订阅窗口 | IAM AK/SK 签名 | 开 |
| Z.ai（国际） | `zai-coding` | 订阅窗口 | 裸 `authorization`，区域凭据独立 | 关 |
| Synthetic | `synthetic` | 滚动订阅池 | Bearer | 关 |
| NanoGPT | `nanogpt` | 日 / 周配额 + 余额 | Bearer（余额端点用 `x-api-key`） | 关 |
| MiniMax（国际） | `minimax` | 短周期 / 周 | Bearer | 关 |
| ARK Agent Plan Team (arkcli) | `arkcli-agent-plan-team` | 席位额度（AFP） | IAM AK/SK 签名 | 随 Ark 组（默认开） |
| ARK Coding Plan Team (arkcli) | `arkcli-coding-plan-team` | 席位额度 | IAM AK/SK 签名 | 随 Ark 组（默认开） |
| SiliconFlow | `siliconflow` | 余额 | Bearer，与推理同一把 Key | 关 |
| OpenRouter | `openrouter` | 限额窗口 + 余额 | 推理 Key（余额需 management / provisioning key） | 关 |
| Novita AI | `novita` | 余额 | Bearer | 关 |
| Hyperbolic | `hyperbolic` | 余额 | Bearer | 关 |
| DeepInfra | `deepinfra` | 余额 | Bearer | 关 |
| Chutes | `chutes` | 通用限额窗口 | Bearer | 关 |
| Ollama Cloud | `ollama-cloud` | session / 周 / 月 | 裸 `Authorization`（不加 `Bearer`） | 关 |
| Vercel AI Gateway | `vercel-ai-gateway` | 余额 | Bearer | 关 |
| ZenMux | `zenmux` | 5 小时 / 周窗口 + PAYG 余额 | **Management API Key** | 关 |
| LiteLLM | `litellm` | Key / 用户 / 团队预算 + 花费 | 虚拟 Key + **用户自填 proxy 地址** | 关 |
| OpenDesign | `opendesign` | Design Plan 5 小时 / 7 天窗口 + 套餐余额（订阅额度）、总额度（钱包合计 = 订阅 + 充值） | **控制台会话 Cookie**（不是模型调用的 sk- Key） | 关 |

- 各家的**窗口语义、明细字段与单位换算**（例如 ZenMux / Ollama 的 0–1 小数、Novita 的 1/10000 USD、Kimi 随套餐变化的窗口集合）见 [提供商清单与额度语义](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/providers.md)。
- 评估过但**不接入**的厂商与理由见 [提供商覆盖与取舍](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/provider-coverage.md)（含已由用户决策跳过的 Anthropic）。

非公开控制台接口可能变更；缺失或非法百分比不会直接当作零用量（Grok 完整成功 protobuf 的活跃周期可确认协议隐式零值）；「读取成功」只表示接口读取健康度，不保证仍有额度。

## Support status / 实测覆盖

### 已实测验证

下面保留**历史真实账号/接口实测记录**（本仓库开发机 + 各家的官方 CLI / 插件），只覆盖表中列出的范围；不等同于当前版本已安装并通过 GUI 端到端验收。

| 提供商 | 验证范围 | 凭据来源 |
|---|---|---|
| 火山方舟 Agent Plan（个人版，`arkcli-agent-plan`） | 5 小时 / 周 / 月 AFP 绝对值 + 日限额 + 档位 | 本机 IAM AK/SK 直连 `GetAFPUsage`，HTTP 200 |
| 火山方舟 Coding Plan（个人版，`arkcli-coding-plan`） | session / weekly / monthly 三个窗口 | 同一组 AK/SK 直连 `GetCodingPlanUsage`，HTTP 200 |
| Kimi Coding | 5 小时 / 周 / 月窗口 | 真实 Key |
| 小米 MiMo | 余额 + 套餐额度 | 真实平台会话 Cookie（含自动登录） |
| Command Code | 月额度 | 提供方插件的凭据链 |
| SuperGrok | 统一周池 + 加量余额 | 真实 `~/.grok/auth.json` |
| Codex (ChatGPT) | 主 / 次窗口 + 档位 | 真实 `~/.codex/auth.json`（本插件默认关闭） |
| OpenDesign | 历史接口实测（2026-10-18 / 20）：真实 workspaceId、Design Plan 扁平窗口、套餐余额 / 总额度（钱包合计）及零余额（当时界面文案为「月额度剩余 / 余额」）；本次认证失效修复只做隔离回归，未验收当前 GUI | 用户浏览器手动导入的控制台会话 Cookie；自动登录仍受 Cloudflare 阻碍 |
| Trae（联动，`trae` / `trae-global` / `trae-enterprise`） | 2026-10-23 对**运行中的 DSH** 实测：`region=cn` 返回 `signed-in` 的真实账号数据（积分包合计 / 已用 / 余量、Work 与通用两个桶、到期分组），企业版与国际版在该机返回 `signed-out` 时**不产生条目**；真实 `SubUsageService` 首次 527ms、缓存命中 0ms、`force` 552ms 且两次条目逐字一致 | 由 `dsh-connect-trae` 自己持有的登录态（本插件不读凭据、不碰上游）；尚未在装上新版本后从界面验收 |

### The X Subscription（新统一订阅）

沿用 `xai-oauth`，设置页入口为 **Grok (X / SuperGrok)**，不新增重复的 Cursor 用量池；额度工具可传 `X Subscription` 或 `grok`。凭据仍由 Grok CLI / dsh-grok-kit 管理，本插件不保存 Cookie 或 API Key。

- [官方套餐](https://docs.x.ai/x-subscription/pricing)：Plus / Premium / Super / Ultra；价格与倍数不用于反推绝对额度。
- [官方用量规则](https://docs.x.ai/x-subscription/usage-limits)：每个付费席位有一个共享周池，覆盖符合条件的 Grok、Grok Bot 与 Cursor 第一方用量；第三方模型与超额消费使用充值余额。团队周池按席位独立，充值余额共享。
- 复用 [官方 Grok CLI 计费链](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs)：`GET /v1/billing?format=credits` 与 `GET /v1/settings`。credits 格式 500 时，同一 OAuth Bearer 回退 `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`（gRPC-web）读取周池百分比。百分比、重置日期、套餐名和美元充值余额只取上游字段；不请求购买、合并账号或修改订阅。
- 代理有时只返回周期和余额，没有 `creditUsagePercent`。此时用同一凭据最多补查一次 consumer gRPC（6 秒），仅在周/月周期与 REST 一致时采纳百分比；完整成功 protobuf 的活跃当前周期省略 float 标量时，按官方协议认定已用 0%。补查失败、周期不一致或响应不完整仍保留套餐/余额并标记部分数据，不把按量消费上限当作订阅额度。官方 `Cent` 空对象 `{}` 表示零余额，缺失消息仍为未知。
- 验证边界：2026-10-16 已迁移账号上 REST `?format=credits` 持续 500，无 format 的旧月度形态 `monthlyLimit: 0` 不能当额度；同一凭据的 grok.com gRPC-web 返回周池百分比。新套餐四档与 gRPC 回退有隔离测试。此入口只读取当前登录身份，不提供工作区切换/全团队汇总。gRPC 回退拿不到 prepaidBalance 时不显示 0 余额。

### Cursor Pro 能作为 DSH 模型订阅吗？

**截至 2026-10-14，没有官方支持的直接接入方式。** [Cursor 官方 API 总览](https://cursor.com/docs/api)明确说明，Cloud Agents API 与 SDK 运行的是 Cursor Agent 工作流，不是独立的模型推理或 chat-completions API。因此，Cursor Pro 不能作为通用 API Key / OpenAI-compatible provider 直接供 DSH 自己的 Agent 调用；本插件也不注册模型路由，不新增一个看似可调用的 Cursor provider。

- [Cursor CLI 的 headless 模式](https://cursor.com/docs/cli/headless)可以被外部程序调用，但运行的是 **Cursor 自己的 Agent**，不是把 Pro 模型额度转交给 DSH。CLI / SDK 工具集成是另一种功能，不属于本插件当前范围。
- 官方 Admin / Analytics API 面向企业团队，不等同于个人 Cursor Pro 的订阅余量接口。本轮不新增个人 Cursor Pro 用量入口；这不表示所有非官方读取方法在技术上均不可行。
- 保留旧 Cursor Pro 不会自动与 Grok 合并额度；只有迁移到 The X Subscription 后，符合条件的第一方模型用量才进入新订阅的共享周池。Cursor 中第三方模型另用充值余额；共享计费不代表通用模型 API 授权。

### 未验证

其余提供商**只经过桩测试**——响应形态取自公开文档、第三方实现或抓包，**没有在真实账号上跑通过**：

> Z.ai（中国与国际）、OpenCode Go、MiniMax（中国与国际）、Synthetic、NanoGPT、SiliconFlow、DeepSeek API、DeepSeek 账号、OpenRouter、Novita、Hyperbolic、DeepInfra、Chutes、Ollama Cloud、Vercel AI Gateway、ZenMux、LiteLLM，以及火山方舟的**团队版席位**。

它们可能可用，也可能因为接口变更、字段差异或权限要求而失败。上表也只是既有账号、当时版本的验证记录，不是持续可用性保证。

如果你用了其中之一，不管成功还是失败，都欢迎[开 issue](https://github.com/KouzakiUmi/dsh-subusage/issues)——附上提供商名称、错误文案与 DSH 版本即可（**不要贴 Key 或 Cookie**）。失败和成功一样有用：失败帮我们修适配，成功帮我们把这一行挪进上表。

### 主要风险

- **额度数字仅供参考，不要当计费依据。** 部分额度接口未公开或半公开，字段语义可能变化；插件会按已核验单位换算金额与百分比，不猜缺失额度。
- **未验证的提供商会随接口变化而失效**（见上一节）。失效时在设置页关掉那一家的检测即可，其余不受影响；欢迎开 issue 帮我们补上。
- **凭据以明文落盘**：本插件的配置不是加密凭据库；Windows 上真正的访问边界取决于目录 ACL，`chmod` 不能替代它。
- **火山方舟是账号级读取**：一组 IAM AK/SK 能查到该账号名下**所有**套餐（Agent Plan、Coding Plan、团队席位）。把装了本插件的机器或配置文件交给别人时请注意这一点。
- **浏览器自动化**：支持自动登录的提供商（MiMo、OpenDesign）会启动一个隔离的 Chromium 会话——不点「登录并自动导入」就不会触发。**OpenDesign 这家会被其 Cloudflare 人机验证挡住，实际请按手动流程复制会话 Cookie**（见凭据表）。
- **收录不等于安全审计**：无论 DSH STORE 还是 awesome-dsh-plugin，收录只表示满足它们各自的清单规则，都不是对代码的安全审查。

## Compatibility / 兼容性

| 项目 | 值 | 来源 |
|---|---|---|
| 核心 peer 范围 | `@deepseek-ai/dsh` 及各核心包均为 `>=0.2.0-rc.1 <0.2.1-0 \|\| >=0.2.1-0 <0.3.0-0` | [`package.json`](package.json) 的 `peerDependencies` |
| Node.js | `>=22.19.0` | `engines` 与 `dsh.compatibility.node` |
| 已验证的 Core 版本 | `0.2.0-rc.2`、`0.2.1-alpha.1`、`0.2.1-alpha.2` | 实机运行；逐版本状态与验证方式见 `dsh.compatibility.dshReleases` |
| 最后验证日期 | `2026-10-11` | [开发与验证说明](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/development.md) |

> **范围里那个 `||` 分支不是冗余。** node-semver 只有在范围中**某个比较符与该版本的 `major.minor.patch` 元组完全一致、且自身带预发布标签**时，才放行预发布版本。所以 `>=0.2.0-rc.1 <0.3.0-0` 这种看起来覆盖 0.2.x 的写法会**静默排除** `0.2.1-alpha.1`——而它正是当前活跃版本。必须为每个 minor 元组各写一个带预发布标签的分支。

`dsh.compatibility.dshReleases` 逐版本声明已知状态：**只有实际验证过的标 `compatible`**，其余一律 `unknown`——没有证据不猜。本插件只依赖 Core 的**公开扩展 API 面**（Cordis 服务 `llm`/slots/locale/remote/settings/modelDirectories、4 个核心包的公开导出、client 基座的公开模块），不碰内部组件、不依赖桌面壳版本——这是 0.2.x 各版本实际全兼容的原因；`dshReleases` 记录的是**实测证据**，不是依赖声明。实际验证范围（在线接口、真实账号、浏览器像素验收等）见 [开发与验证说明](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/development.md)。这是树外 Host / Client bundle，通过 `cordis.patch.yml` 插入，不修改 DSH 核心、安装树或 ASAR。

## Install / 安装

| 来源 | 标识 | 说明 |
|---|---|---|
| npm | `dsh-subusage` | 已发布版本见 [npm](https://www.npmjs.com/package/dsh-subusage) |
| GitHub Release tarball | `https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz` | 资产名固定不带版本号 |
| 本地开发目录 | 仓库路径 | 以链接方式使用工作副本 |

```console
# npm 包名（推荐：预构建，免构建授权）
dsh plugin --profile web add dsh-subusage

# GitHub 固定 Commit（DSH STORE / awesome-dsh-plugin 只接受这种来源）
dsh plugin --profile <profile> add 'git+https://github.com/KouzakiUmi/dsh-subusage.git#<40 位完整 Commit>'

# GitHub Release tarball（资产名不带版本号，所以这个地址不会随发版而失效）
dsh plugin --profile <profile> add https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz

# 本地开发目录（link 工作副本）
dsh plugin --profile <profile> add D:\src\dsh-subusage
```

升级与卸载：

```console
dsh plugin --profile <profile> update dsh-subusage
dsh plugin --profile <profile> update dsh-subusage@https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz
dsh plugin --profile <profile> remove dsh-subusage
```

- `<profile>` 换成目标 profile；**Desktop 请使用随包 DSH CLI 或应用内插件管理页**，PATH 上的 npm 全局 `dsh` 不一定是它。参数与 profile 名以目标部署的 `dsh plugin --help` 为准；桌面插件页同样接受包名、GitHub 地址或本地目录。
- **不要用浮动分支**（`#main`）安装：市场与商店只认固定到完整 40 位 Commit 的来源，浮动分支无法核实你装到的到底是哪份代码。
- 安装只把包放进 profile，**不等于已启用**；按部署方式重载或重启，让 Host 与 Client 一起生效（只刷新页面不保证 Host 升级）。
- 只取压缩包：`npm pack dsh-subusage`；核对发布结果：`npm view dsh-subusage version dist-tags`。
- 本包**没有** `preinstall` / `install` / `postinstall` / `prepare` 脚本，安装期不执行任何代码；也不需要 pnpm 的 `allowBuilds` 授权。

## 前置：这几家需要提供方插件

绝大多数提供商只要一把 API Key 就能用。但下面几家要先装**提供方插件**——它们负责注册模型路由、完成登录并持有凭据；本插件只**读取**同一份凭据，不代为登录、也不保存它们。

| 提供商 | 前置提供方插件 | 凭据从哪来 |
| --- | --- | --- |
| Command Code | [`@mars-sea/dsh-commandcode-provider`](https://www.npmjs.com/package/@mars-sea/dsh-commandcode-provider) | 在该插件的设置页登录，或运行 `cmd login`（兜底读 `~/.commandcode/auth.json`） |
| SuperGrok | [`dsh-grok-kit`](https://github.com/KouzakiUmi/dsh-grok-kit) | 运行 `grok login`，登录文件 `~/.grok/auth.json` |
| Codex（ChatGPT 订阅） | [`dsh-codex-connect`](https://github.com/franksong2702/dsh-codex-connect) 或 [`dsh-codex-subscription`](https://github.com/WSL043/dsh-codex-subscription)（0.13.0 起兼容） | Connect / CLI：`codex login`；Subscription：在其设置页独立 OAuth 登录，无需 CLI |

> **Codex 默认关闭**：它的提供方插件本身就带一个用量药丸，两个并排只是重复信息。想要本插件这一份（比如想把 Codex 和别家放在一起看）可以在**提供商管理**里手动开启。
>
> 这几家的**凭据不在本插件的设置页里**：请用上表的登录方式。缺登录时本插件的卡片会直接给出对应的登录命令。

## Configuration / 配置

- **设置页路径**：设置 → **订阅用量** → 提供商管理。「没有检测到API的默认隐藏」默认开启；首次没有可见条目时管理区自动展开。关闭的提供商仍可配置凭据，只是不会发起用量请求。
- **凭据从哪来**：每一类凭据的**官网入口、环境变量名与界面填入位置**都写在[凭据获取指引](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/credentials.md)——包括火山的 IAM AK/SK（子用户还要挂 `ArkReadOnlyAccess` 且不限制到项目）、MiMo 的平台会话 Cookie、以及各家 API Key 的对照表。**注意推理 Key 与额度凭据不通用。**
- **默认开关策略**：新安装默认开启 13 条、默认关闭 16 条（**Codex 默认关闭**——它的提供方插件自带用量药丸）；开关即时保存，升级保留已保存的开关，不重算默认值。默认隐藏只影响显示，不会自动开启被关闭的提供商。
- **火山方舟是一组**：4 条路由共用同一组 IAM AK/SK，所以设置页只呈现**一张卡片、一个开关**（本机已装的第一条路由作为代表，都没装则用第一条），卡片里写明本机实际装了哪几条。这些 provider id 并没有合并——药丸仍按 id 匹配路由。旧插件 `@volcengine/ark-plan-api` 的两个国内路由（`ark-coding-plan-cn` / `ark-agent-plan-cn`）**已移除**：它们与 arkcli 的路由查同一份订阅，并列显示只会让人以为买了两个套餐；装了旧插件的用户，药丸仍按那两个 id 显示同一份数据（入口归并到 arkcli 路由）。
- **火山方舟不按路由收起**：它的额度走**账号级管控面**，一组 AK/SK 就能查到名下所有套餐（`GetCodingPlanUsage` 与 `GetAFPUsage` 是同一套协议、同一组凭据）。推理路由装没装只影响模型能不能用，**不影响额度能不能查**——所以只持有 Coding Plan、却没在 DSH 里配 coding-plan 路由时，那条额度照样会显示（前提是配了 AK/SK）。
- **凭据来源优先级**（`inherit` 模式）：**凭据服务 → 启动环境 → 旧手动配置兜底**；切到自定义（`manual`）模式时只使用保存的手动 Key。界面会区分这三种来源。
- **不接受本地 Key 的提供商**：`commandcode`（凭据链属提供方插件）、`xai-oauth`、`openai-codex`（只读各自 CLI 的登录文件），以及 MiMo（Cookie 会话）。
- **保存与验证分离**：凭据先确认持久化，再独立做在线验证；检测关闭的提供商只保存凭据、不发起验证，验证失败不代表保存失败。
- **出错时在卡片上修**：MiMo 未登录 / Cookie 被拒 → 「登录并自动导入」；Cookie 临近到期或已过期 → 「重新登录」；其他家缺凭据 → 「配置凭据」（展开该厂商编辑器并滚动过去）。正常状态不显示行动条。

<details>
<summary>凭据与环境：各家默认继承变量与说明（取自 <code>PROVIDERS[id].envName</code>）</summary>

「默认继承变量」指凭据服务 / 启动环境的默认引用名；留空表示不使用继承变量（凭据来自登录文件或官方平台会话）。

| 模型商 | 默认继承变量 | 说明 |
|---|---|---|
| DeepSeek API | `DEEPSEEK_API_KEY` | 余额型：`GET /user/balance` 返回账户余额，**与推理是同一把 Key** |
| DeepSeek 账号 | 无 | `deepseek-account` 路由；只读 DSH「账号与余额」中已登录账号的充值余额，**没有继承变量、也不使用独立 API Key**，请在 DSH 的账号与余额页面登录 |
| Z.ai（中国） | `ZAI_CODING_CN_API_KEY` | 团队套餐另填组织、项目 ID（作为 `bigmodel-organization` / `bigmodel-project` 请求头） |
| Z.ai（国际） | `ZAI_CODING_API_KEY` | 独立国际 Coding Plan Key，鉴权用裸 `authorization`，不带 `Bearer` |
| Kimi | `KIMI_CODING_API_KEY` | 需要 Kimi Coding Key，不是 Moonshot 开放平台 Key |
| Xiaomi MiMo | 界面不使用继承 Key | 通过官方平台 Cookie 会话读取（`envName` 只作为服务侧引用名保留） |
| OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go Key |
| MiniMax（国际） | `MINIMAX_API_KEY` | `minimax` 路由；国际站订阅 Key |
| MiniMax（中国） | `MINIMAX_CN_API_KEY` | `minimax-cn` 路由；中国站订阅 Key |
| Command Code | `COMMANDCODE_API_KEY` | 凭据由提供方插件管理，本页只读继承；兜底读取 `~/.commandcode/auth.json`（`cmd login`） |
| SuperGrok | 无 | `xai-oauth` 路由；读取 dsh-grok-kit / Grok CLI 共享的 OAuth 登录文件 `~/.grok/auth.json`（旧版 `~/.dsh/.xai-oauth-auth.json`），不保存凭据。access token 过期时**借 dsh-grok-kit（≥0.2.0）的官方登录链自动续约**——同一文件、同一把写锁、compare-and-write，不会顶掉共享登录态（本插件绝不自行裸 POST 刷新）；未安装 grok-kit 或续约失败时才提示手动重新登录。API Key（`XAI_API_KEY`）取不到订阅周池 |
| Codex | 无 | `openai-codex` 路由；0.13.0 起优先只读 Subscription 活动 OAuth 账号，再回退 CLI 文件（`$CODEX_HOME/auth.json` 或 `~/.codex/auth.json`，要求 `auth_mode` 为 `chatgpt`）；不保存或刷新 token，续约由所属插件负责 |
| 火山方舟 Ark（4 条路由） | `VOLC_ACCESSKEY` + `VOLC_SECRETKEY` | 额度查询要 **IAM Access Key 的 AK/SK 配对**，与推理 API Key（`ARKCLI_*_API_KEY` / `ARK_*_API_KEY`）**不是同一套**；4 条路由共用一组 AK/SK。这一组 AK/SK 能**同时**查到 Agent Plan 与 Coding Plan（含团队版席位）——不存在「Coding Plan 专用查询 key」 |
| SiliconFlow | `SILICONFLOW_API_KEY` | 余额型：`GET /v1/user/info` 返回账户余额，**与推理是同一把 Key** |
| OpenRouter | `OPENROUTER_API_KEY` | key 限额与用量用推理 key 即可；**账户余额需要 management / provisioning key**，普通 key 会被 403 拒——此时静默降级为只显示限额，不判失败 |
| Synthetic | `SYNTHETIC_API_KEY` | 模型订阅请求额度 |
| NanoGPT | `NANOGPT_API_KEY` | 也可手动填写 Usage only 管理令牌；配额之外还会读一次账户余额（余额端点用 `x-api-key` 而不是 Bearer；拿不到就静默降级，不影响配额） |
| Novita AI | `NOVITA_API_KEY` | 余额型，与推理同一把 Key；金额单位 **1/10000 USD** |
| Hyperbolic | `HYPERBOLIC_API_KEY` | 余额型；金额单位是**美分** |
| DeepInfra | `DEEPINFRA_API_KEY` | 余额型 |
| Chutes | `CHUTES_API_KEY` | 通用限额窗口 |
| Ollama Cloud | `OLLAMA_API_KEY` | 订阅窗口型；鉴权是**裸 `Authorization`**（本插件已按其要求发送） |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | 余额型；金额是**十进制字符串** |
| ZenMux | `ZENMUX_MANAGEMENT_API_KEY` | 额度端点**只认 Management API Key**（推理 key 不适用），所以变量名单独区分。在 <https://zenmux.ai/platform/management> 创建该 key |
| LiteLLM | `LITELLM_API_KEY` + 代理地址 | 自建网关：除虚拟 Key（**与推理同一把**）还要在凭据区填写自己的 proxy 地址。管理端点在 **proxy 根**——填了 `/v1` 也会被去掉，不会拼成 `/v1/key/info` |
| OpenDesign | `OPEN_DESIGN_COOKIE`（或在凭据区手填会话 Cookie） | 额度只在**控制台接口**上，鉴权是浏览器登录会话 Cookie——`sk-` 模型 Key 换的是 `amr-link.open-design.ai` 的模型响应，**没有额度端点**。**「登录并自动导入」会被站点 Cloudflare 挡住**，请手动取：在自己浏览器登录 open-design.ai → 进入「方案与余额」页 → `F12` → Network（筛 Fetch/XHR）→ `F5` 刷新 → 点状态 200 的 `coding-plan-usage` → Headers → Request Headers → 复制 `cookie` 字段的**完整值**（不要包含 `cookie:` 字段名，应含 `__Secure-better-auth.session_token`）→ 粘进凭据区先保存、再独立验证；认证失效会明确报告，不当作部分数据，此时重新复制会话 Cookie |

按 provider id 的字面映射（补齐上表按语义分组、未逐条列出的 4 条火山路由，逐条对应 `PROVIDERS[id].envName`）：

```text
deepseek                 DEEPSEEK_API_KEY
zai-coding-cn            ZAI_CODING_CN_API_KEY
zai-coding               ZAI_CODING_API_KEY
kimi-coding              KIMI_CODING_API_KEY
xiaomi-token-plan-cn     XIAOMI_TOKEN_PLAN_CN_API_KEY   （界面走官方平台 Cookie）
opencode-go              OPENCODE_API_KEY
commandcode              COMMANDCODE_API_KEY
xai-oauth                —                              （OAuth 登录文件）
openai-codex             —                              （OAuth 登录文件）
minimax                  MINIMAX_API_KEY
minimax-cn               MINIMAX_CN_API_KEY
synthetic                SYNTHETIC_API_KEY
nanogpt                  NANOGPT_API_KEY
siliconflow              SILICONFLOW_API_KEY
openrouter               OPENROUTER_API_KEY
novita                   NOVITA_API_KEY
hyperbolic               HYPERBOLIC_API_KEY
deepinfra                DEEPINFRA_API_KEY
chutes                   CHUTES_API_KEY
ollama-cloud             OLLAMA_API_KEY
vercel-ai-gateway        AI_GATEWAY_API_KEY
zenmux                   ZENMUX_MANAGEMENT_API_KEY
litellm                  LITELLM_API_KEY                （另需自填 proxy 地址）
arkcli-agent-plan        ARKCLI_AGENT_PLAN_API_KEY      （额度用 VOLC_ACCESSKEY / VOLC_SECRETKEY）
arkcli-coding-plan       ARKCLI_CODING_PLAN_API_KEY
arkcli-agent-plan-team   ARKCLI_AGENT_PLAN_TEAM_API_KEY
arkcli-coding-plan-team  ARKCLI_CODING_PLAN_TEAM_API_KEY
```

解析顺序（`inherit` 模式）：**凭据服务 → 启动环境 → 旧手动配置兜底**；自定义（`manual`）模式只使用保存的手动 Key。Cookie 与登录文件型凭据不走这条链，见 [MiMo 登录与 Cookie](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/providers.md#mimo-登录与-cookie) 与 [Codex ChatGPT 订阅凭据](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/providers.md#codex-chatgpt-订阅凭据)。修改启动环境后是否需要重启取决于目标部署，不能把「我已经改了环境变量」当作运行进程已经读到。

</details>

## Permissions & data / 权限与数据

**读取 / 写入的文件**

| 路径 | 用途 | 读写 |
|---|---|---|
| `~/.dsh/dsh-subusage.json` | 本插件自己的配置：开关、手动 Key、MiMo Cookie、Z.ai 组织 / 项目、LiteLLM 地址、火山 AK/SK、计时元数据 | 读写；POSIX 上新建目录 `0700`、临时文件 `0600`，替换前再收紧 |
| `~/.codex/auth.json`（或 `$CODEX_HOME/auth.json`） | Codex CLI 的 ChatGPT 登录（要求 `auth_mode: chatgpt`） | **只读**，不保存、不刷新 |
| `~/.grok/auth.json`（回退 `~/.dsh/.xai-oauth-auth.json`） | Grok CLI / dsh-grok-kit 的 OAuth 登录 | 平时只读；过期时经 grok-kit 官方链续约并写回同一文件，不自行裸刷 |
| `~/.commandcode/auth.json` | Command Code CLI（`cmd login`）的 Key | **只读**兜底 |

**网络访问**：只连上面清单里各家自己的额度 / 余额端点，以及 `platform.xiaomimimo.com`（MiMo 用量与登录）、`api.commandcode.ai`、`cli-chat-proxy.grok.com`、`grok.com`（仅 Grok credits 回退）、`chatgpt.com/backend-api`、`amr-api.open-design.ai`（OpenDesign 控制台额度）、火山管控面 `open.volcengineapi.com`，外加你自己填写的 LiteLLM proxy 地址。完整域名表见 [网络端点](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/providers.md#网络端点)。**`deepseek-account` 不自行发起 HTTP 请求**——它复用 DSH 的 `deepseekAccount` 服务，由宿主完成鉴权与余额请求（宿主服务可能按自身配置联网）；本插件不读取、导出或保存 OAuth token。MiMo 自动登录会另外打开官方平台页面，由你在该页面自行输入密码与验证码。**本插件没有自己的服务器，不做遥测，也不把你的数据发给任何第三方。**

**命令、进程与安装期行为**

| 项 | 情况 |
|---|---|
| 执行外部命令 | **不执行**。没有任何 shell 调用 |
| 生命周期脚本 | `preinstall` / `install` / `postinstall` / `prepare` **全部没有**；安装期不运行任何代码 |
| 运行依赖 | `playwright-core`（唯一一个）。只用于可选的自动登录（MiMo、OpenDesign）；**不下载浏览器**，用你本机已有的 Chrome/Chromium |
| 浏览器 | 只有你点「登录并自动导入」时才启动一个**隔离的**临时会话，五分钟未完成自动超时；不读你日常浏览器的配置、Cookie 或 profile |
| DSH 核心 | 不修改源码树、不碰任何 `@deepseek-ai/*` 包、不遮蔽官方插件清单；只用公开 Host 服务与 `cordis.patch.yml` 插入自己的行 |

**密钥如何处理**

- Key 与 Cookie **不回传页面**：读取接口不返回凭据本身，界面不回填已保存的秘密（Cookie 只在需要替换时输入）；公开设置只有 `hasKeys` / `hasCookie` 这类布尔状态与来源标记。
- **日志与产物不落盘**：真实 Key / Cookie 不会写进日志、测试、截图或读取结果；MiMo 响应在返回前做字段级 Cookie 脱敏。
- MiMo 自动登录使用**独立临时 Chrome 会话**：不读取日常 Chrome 配置，不读取密码 / 验证码字段，Cookie 不通过 RPC 返回页面；五分钟未完成自动超时。
- 计时元数据（`xiaomi.loginAt` / `xiaomi.expiresAt`）只是本地时间戳，不是秘密，也不参与凭据有效性判断。
- **这不是加密凭据库**：本版仍兼容本机 JSON 配置存储，凭据以明文落盘；加密凭据存储通道尚未实施。Windows 上的实际访问权限取决于目录 ACL，`chmod` 不能替代 ACL 或加密库。请不要上传、分享该配置文件，也不要把它写进日志或工单。

## 额度查询 API

**Agent 工具 `subusage_quota`**（模型可直接调用，只读：不写设置、不碰凭据）

| 参数 | 类型 | 说明 |
|---|---|---|
| `providers` | `string[]`（可选） | 限定范围。可传本插件的 provider id（`deepseek`、`zai-coding-cn`、`kimi-coding`…），也可直接传厂商名（`zai`、`kimi`、`mimo`、`minimax`、`commandcode`、`grok`、`codex`、`ark`、`deepseek`…）；大小写与 `-` `.` `_` 都无关。省略即读取全部 |
| `refresh` | `boolean`（可选） | `true` 绕过最多 60 秒的缓存，仅在确需最新数字时使用 |

调用约定（无可读条目时返回汇总与下一步，不伪造额度）：

- 模型手里的名字往往不是这里的 provider id（它更可能看到 DSH 的路由名，例如 `zai`），所以匹配是**宽松**的：一个名字命中多条路由时**全部返回**（`zai` → 中国版 + 国际版，`ark` → 4 条），每条各自带着真实 `state`（没启用的如实标 `disabled`），由调用方自己判断要看哪条。
- 一个名字都认不出时，返回里会**先**给一条说明（写明可用写法），**再读取全部路由，并按下述规则保留有数据或读取失败的条目**——数据先给出去，判断交给调用方，而不是回一个空结果。
- **点名的家原样返回，其余按「有没有数据」收起**：`providers: ["kimi"]` 时被点中的家即使没配凭据也照原样给出（用户问的正是「它为什么没数据」）；**不点名时**——以及名字一个都没认出来、走全量兜底时——省略检测已关闭、未配置凭据、以及接口没报告任何额度的条目，省略条数按**家**写进 `omitted`（同一家的多个 Command Code 账户只算一家），否则二十多条路由会把真正的数字淹掉。**读取失败的条目会保留**——那是「这次没读到」，不是「没配置」，省略掉只会把排障方向带偏；认不出的名字自己那行也保留。
- **Command Code 按账户各回一条**：账户清单读自提供方插件的 `llm-commandcode` 设置，每条带 `account`（账户名）、`accountActive`（当前激活的那个）与 `accountMode`（`fixed` 固定账户 / `auto` 自动轮换），激活账户排在最前。「还剩多少」与「现在实际用哪个账户」一次问清。
- **Trae 也是联动项**：本机运行 [`dsh-connect-trae`](https://github.com/dingminhua/dsh-connect-trae) 时最多出现三条——`trae`（国内版积分：`period` 窗口的百分比是「已用积分 / 积分包合计」，余量与 Work / 通用两个桶、积分到期提醒放 extras）、`trae-global`（国际版订阅状态：档位、试用期、是否买了套餐）与 `trae-enterprise`（**只在真有企业版账号时出现**，且照实说「企业租户额度只能在企业控制台看」，绝不把个人积分挪到企业标题下）。数据来自该插件注册在本机 web 服务器上的只读路由 `/plugins/dsh-connect-trae/usage?region=<cn|enterprise|ai>`（它自己的卡片读同一条），本插件只做换算：不读取它的凭据、不自己请求 Trae 上游、不写设置；取数结果缓存 60 秒，`refresh: true` 绕过。厂商名 `trae` 命中三块面板（与 `zai` / `ark` 同口径），单块面板没登录时静默，点名某一块（如 `trae-global`）却没登录时才回说明。
- **Antigravity 是联动项，不是本插件登记的 provider**：本机运行 [`dsh-antigravity-acp`](https://github.com/KouzakiUmi/dsh-antigravity-acp) 时，报告里会多一条 `providerId` 为 `antigravity` 的条目（可传 `antigravity` / `agy` / `antigravity-acp` 点名）。数据来自该插件自己的 Cordis 服务 `agyQuota`，本插件不读它的凭据、不请求上游、不写设置；插件不在场时顺带查询里不出现这一行，点名时会回一条「未检测到额度服务，装好并重启 DSH 后自动出现」的说明。它的 `windows[].percent` 同样是**已用**百分比（由官方下发的剩余比例换算），`groupLabel` 是它自己的分组（如 `Gemini Models`）。

**Host 服务**（Cordis `Service`，key 为 `subUsage`）：

```js
const service = ctx.get("subUsage");
const view = await service.quota({ providerIds: ["deepseek"], force: false });
// view = {
//   updatedAt,
//   providers: [{ providerId, label, state, windows, extras, coverage?, freshness?, lastSuccessAt?, error?,
//                 account?, accountActive?, accountMode?, availability?, availabilityReason? }]
// }
```

- `state`：`ok` | `no-key` | `no-cookie` | `error` | `disabled`
- `windows[].percent` 是**已用**百分比（0–100）；`extras` 放余额与套餐名等补充项。`budgetScope` / `detail.scope` 区分多预算和能力范围
- `availability?` 为 `included | paygo | blocked | unknown`，`availabilityReason?` 解释依据；读取成功、余额或健康百分比不能单独保证续用资格
- `account` / `accountActive` / `accountMode` 只在多账户的 Command Code 上出现（见下）；此时同一条路由会有**多条**条目（每个账户一条，`providerId` 相同），消费方按 `account` 区分
- 视图**刻意精简**：不返回设置，也不返回 `keySource` / `apiDetected` / 继承变量名等内部状态，第三方消费者拿不到任何与 Key 相关的字段。多账户路由（Command Code）连错误文案里的**凭据引用名**也会换成账户标签（`Account 2`），内部 `apiKeyEnv` 只留在本机界面那条通道里（用户要靠它定位该往哪个 ref 写凭据）
- 视图里**不出现值为 `undefined` 的字段**：字段缺席表示「这家没有报告」，而不是「报告了空」——带 `undefined` 的键会被调用方的 schema 校验判成型别错误
- 单家读取失败只影响它自己的条目，其余照常返回
- 与设置页共用同一份缓存（TTL 60 秒），频繁调用不会反复请求各家接口；多账户各按「路由 id + 账户引用名」占一份缓存，读全部账户不会互相驱逐
- 联动项（`antigravity` / `trae*`）不出现在本插件的设置页：它们没有凭据、没有检测开关，也没有可写的设置；取数有 15 秒独立预算，请求带取消信号（随 `dispose()` 与预算自断）；对方报错时只产出它自己那条 `state: "error"`（`error` 里有截断后的脱敏原因），其它家照常返回。**默认的全量查询遇到超时静默**（不制造噪声，对方缓存会随后补上），**点名**的查询超时仍如实报——否则问「Trae 还剩多少」会得到像「没登录」的空结果
- `quota()` 本身**不过滤**条目（第三方可能正需要「这家没配」这个事实）；`subusage_quota` 工具的不点名调用才省略空条目

## Troubleshooting / 常见问题

| 现象 | 排查方法 |
|---|---|
| 药丸不显示 | 依次确认：当前模型的 provider id 是否与上表一致（自定义 id 不会自动映射）→ 该家检测开关是否开启 → 是否被「没有检测到API的默认隐藏」收起（可在设置页临时关掉它）→ 运行中的 Host 与 Client 是否都已重载 |
| 设置页没有提供商标签 | 展开提供商管理，确认开关和凭据；无凭据的条目默认隐藏，可临时关闭自动隐藏查看指引 |
| 提示「无凭据 / 未检测到 Key」 | 先确认填的是**额度凭据**而不是推理 Key（两者不通用，见[凭据获取指引](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/credentials.md)），再按该家小节核对来源、环境变量与权限 |
| 提示「已保存」但仍是「无凭据」 | 凭据编辑要点「**保存设置**」才提交（提供商开关才是立即保存）；确认后若仍为空，把界面文案反馈上来 |
| 某家读取失败，其他家正常 | 单家失败只影响自己的条目。按文案分类处理：认证类（401 / 凭据被拒）换对应产品与区域的凭据；权限 / 未订阅类（403）检查账号权限与套餐；限流类等待退避后重试 |
| 显示认证失效 | 检查是否用了对应产品 / 区域的订阅 Key；MiMo 重新登录或导入 Cookie，OpenDesign 更新控制台会话 Cookie。认证错误不按「部分数据」展示，旧额度不会当作有效数据保留 |
| MiMo Cookie 过期 | 会话 Cookie 自签发起 24 小时有效。药丸与设置页会在 2 小时内 / 30 分钟内分别变黄、变橙，到期显示「Cookie 已过期，请重新登录」；重新登录或重新导入即重新计时。倒计时只是提醒，真实失效以官方接口返回为准 |
| 药丸显示「未记录登录时间」 | 凭据由旧版本保存，没有计时元数据；重新登录或重新导入一次后开始计时 |
| Kimi 缺少 7 天窗口，或提示结构错误 | 窗口集合按套餐体系下发：老套餐（节奏命名，如 Allegro）为 5 小时 + 7 天，新套餐（Go / Plus 命名）为 5 小时 + 月度总额。0.8.3 起按实际下发的窗口解析，不再要求 7 天窗口；升级后仍报 `Invalid Kimi usage response` 即为未识别的字段结构，插件不会猜测额度，可回报该响应 |
| 显示缓存、部分数据或额度未知 | 查看更新时间和错误说明；缓存来自之前的成功读取，部分数据不保证有可用额度，余额也不等于订阅余量 |
| 刷新后数字暂未变化 | 成功结果按提供商缓存 60 秒；手动刷新可跳过普通 TTL，但仍遵守限流退避和 `Retry-After` |
| MiMo 自动登录无法启动 | Host 所在机器需安装 Google Chrome 并有桌面环境；远程或无桌面部署使用手动导入 |
| 保存成功但验证失败 | 凭据已保存，检查网络、区域或账号后重试；保存与在线验证分别反馈 |
| 保存提示配置已改变 | 另一窗口或实例更新了设置；重新读取配置后再编辑，避免旧表单覆盖新值 |
| 升级后仍是旧界面或 RPC 不匹配 | 确认运行中的 Host 和 Client 都已重载；仅刷新页面不能保证 Host 升级 |
| Command Code 额度与实际账户不同 | 在 设置 → 订阅用量 的 Command Code 面板或用量的药丸弹层里都能切换提供方插件的服务账户（同一开关）：「自动轮换」时显示默认账户（顶层 Key）的用量，不跟随轮换中的实际服务账户，提供方自定义 `apiBase` 也不跟随。想一次看全部账户的余量与当前激活项，可让 Agent 调 `subusage_quota(providers: ["commandcode"])` |
| SuperGrok 提示认证失效 | access token 过期时插件会先经 dsh-grok-kit（≥0.2.0）的官方登录链自动续约同一共享登录文件，通常无需操作；只有未安装/旧版 dsh-grok-kit 或续约失败（如 refresh_token 已失效）才需在 设置 → Grok Kit 重新登录或运行 `grok login` 后重试。API Key（`XAI_API_KEY`）取不到订阅周池 |
| 火山方舟报签名或权限错误 | AK 与 SK 必须来自同一个 IAM 用户（跨来源拼凑只会 401 且看不出根因）；确认用的是 IAM Access Key 而不是方舟推理 API Key；403 多为未订阅或权限不足 |

## Development / 开发

| 路径 | 职责 |
|---|---|
| `lib/index.js` | 提供商适配、凭据解析、持久化、缓存、Host RPC 与 `subusage_quota` 工具 |
| `lib/client.js` | Client 模块、共享 store、设置页与模型药丸（含界面中英文文案） |
| `lib/volcengine.js` | 火山方舟 AK/SK 签名与窗口解析（纯函数、零依赖） |
| `lib/mimo-login.js` | 隔离 Chrome 登录、Cookie 提取与任务生命周期 |
| `cordis.patch.yml`、`package.json` | bundle 注册、入口、依赖与打包白名单 |
| `tests/`、`scripts/` | 桩网络 / 隔离文件系统回归；清单、打包、离线预览与浏览器检查 |
| `docs/` | 开发约定、提供商覆盖、UX 设计、发布与更新记录 |

没有源码转译步骤，直接维护 `lib/*.js`。基础检查不需要安装 DSH 或连接账号：

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
node --check lib/mimo-login.js
```

离线预览（生成 HTML，使用虚构用量与桩 Hook，不连接 DSH、不读取真实凭据）：

```powershell
foreach ($theme in @('dark', 'light')) {
  foreach ($width in @(530, 500, 499, 360)) {
    node scripts/render-ui-preview.mjs $width xiaomi-token-plan-cn $theme credentials
  }
}
node scripts/render-ui-preview.mjs 530 nanogpt light pill
node scripts/render-market-screenshots.mjs   # 市场截图：真实组件 → 紧凑裁剪 → 3x 密度 → assets/screenshots/
node scripts/check-browser-runtime.mjs   # 需要工作区可解析 playwright-core 且本机装有 Google Chrome
```

文档入口：[凭据获取指引](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/credentials.md)（每类凭据的官网入口、环境变量与填入位置、报错对照）、[开发与验证](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/development.md)（RPC 契约、缓存与凭据约定、离线预览与实机验收范围）、[提供商清单与额度语义](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/providers.md)、[提供商覆盖与取舍](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/provider-coverage.md)、[UX 设计](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/design-ux.md)、[发布与市场收录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/publish.md)、[更新记录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/changelog.md)、[审查记录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/code-review.md)。

> 打包说明：`package.json` 的 `files` 白名单是 `lib` / `cordis.patch.yml` / `README.md` / `LICENSE`，因此 `assets/title.png`、`assets/readme/`、`assets/screenshots/` 与 `docs/` **不进 npm 包**——图片通过 GitHub 绝对地址加载，npm 页面无需把图片打进包也能显示。改动白名单属于发布决策，需单独处理。

### 界面预览

以下为 0.13.3 的离线组件测试截图，使用虚构用量数据，不包含真实账号信息，也不是运行中的 DSH 截图。全部由 `node scripts/render-market-screenshots.mjs` 从真实组件生成：紧凑裁到内容边界、3x 像素密度，底部保留「非运行中的 DSH 截图」声明。这五张与根目录 [`screenshots.json`](screenshots.json) 的声明一一对应，市场详情页按该文件的顺序展示。

深色设置页：订阅用量面板给出当前提供商的结论、进度与 Cookie 到期提醒；下面是提供商管理，凭据编辑器默认展开。

![深色订阅设置页（离线测试预览）](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/settings-dark.png)

浅色用量弹层：顶部先给结论（额度充足 / 余量偏低 / 即将用尽…），下面是各窗口的剩余百分比、已用/总计与重置时间。药丸收起时每个窗口一根彩条，正常时不写字。

![浅色 NanoGPT 用量弹层（离线测试预览）](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/usage-popover-light.png)

<details>
<summary>查看轮换池展开后、能力作用域与余额药丸（虚构数据）</summary>

默认账户的额度已用尽，但轮换池里还有可用账户——两者分开表达，展开后逐个账户说明是每周还是每月额度触顶。

![默认账户限额但轮换池仍可用](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/account-pool-expanded-dark.png)

方舟 Agent Plan 的文本/向量额度与视觉/语音日限额分属两条额度线：日能力池用尽只影响后者，不等于整份套餐不可用。

![日能力池耗尽不等于全部套餐不可用](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/scoped-quota-dark.png)

余额药丸按币种与档位分级，不同厂商的 credits 不互相折算；读取失败显示「数据不完整」，而不是谎报未订阅。

![余额与套餐药丸的档位语义](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/balance-pills-dark.png)

</details>

0.13.0 的功能特写见[功能预览](#功能预览)。

真实 DSH Loader、实际账号在线接口与多账户映射仍未验收，截图不代表已通过这些检查。

## License & security / 许可与安全

MIT，见 [`package.json`](package.json) 的 `license` 字段。本项目与 DeepSeek Harness 及各服务商**无官方关联**；非公开接口可能随时变更，请以各服务商官方条款为准。

报告安全问题：请**不要**在公开 issue 里粘贴 Key、Cookie 或完整配置文件。优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私有渠道；该入口不可用时，也可以在 issue 中只描述问题与影响范围，凭据一律留空。任何复现步骤请先自行脱敏。
