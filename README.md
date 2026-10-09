# dsh-subusage —— DeepSeek Harness 订阅用量显示

在模型选择器旁显示当前提供商的订阅余量，点击查看各周期用量、重置时间和套餐信息。设置页集中管理二十六个提供商/区域的检测开关与凭据。

支持 **DeepSeek 官方（余额）/ Z.ai Coding（中国与国际）/ Kimi Coding / Xiaomi MiMo / OpenCode Go / Command Code / SuperGrok（xAI Grok OAuth 订阅）/ Codex（ChatGPT Plus/Pro/Team 订阅）/ MiniMax（国际与中国）/ Synthetic / NanoGPT（配额 + 余额）/ 火山方舟 Ark（Coding Plan 中国、Agent Plan 中国、Coding Plan BytePlus）/ SiliconFlow / OpenRouter / Novita / Hyperbolic / DeepInfra / Chutes / Ollama Cloud / Vercel AI Gateway / ZenMux / LiteLLM（自建网关）**。

## 安装与快速开始

当前仓库版本 **0.9.0**，可从 GitHub Release 获取。npm 自动发布采用 Trusted Publishing（GitHub OIDC）；可用版本见 [npm](https://www.npmjs.com/package/dsh-subusage)。安装时使用目标 DSH 部署提供的插件管理器或 CLI，并启用本 bundle：

| 来源 | 安装标识或下载地址 |
|---|---|
| npm | `dsh-subusage`；支持 npm 源的插件管理器可使用该包名 |
| GitHub | `https://github.com/KouzakiUmi/dsh-subusage` |
| 安装包 | [最新 GitHub Release 安装包](https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz) |

只需取得 npm 最新压缩包时可运行 `npm pack dsh-subusage`；指定版本前可用 `npm view dsh-subusage version` 核对发布结果。普通 `npm install` 或下载压缩包并不等于已经在 DSH 中启用插件；具体安装参数以目标部署的帮助信息为准。

开发目标是 **DeepSeek Harness 0.2.0-rc.2**。核心 peer 范围为 `>=0.2.0-rc.1 <0.3.0-0`，允许该范围内的预发布版本；声明范围不代表所有版本均已实机验证。

1. 安装并启用 bundle，按部署方式重载或重启，使 Host、Client 与依赖一起生效。
2. 打开 **设置 → 订阅用量 → 提供商管理**，为需要的订阅配置凭据。
3. **Z.ai 国际、Synthetic、NanoGPT、火山方舟 Ark 三家、SiliconFlow、OpenRouter、Novita、Hyperbolic、DeepInfra、Chutes、Ollama Cloud、Vercel AI Gateway、MiniMax 国际版、ZenMux、LiteLLM**默认关闭，必须手动开启（共十七项）。其余九项默认开启；升级保留已保存的开关。
4. 点击「刷新当前」检查结果；选中对应提供商的模型后，输入区显示余量药丸。

「没有检测到API的默认隐藏」默认开启。首次没有可见条目时，管理区自动展开；关闭的提供商仍可配置凭据，但不会请求用量。插件不注册模型路由，药丸按提供商 ID 匹配，配置表见下文。

## 使用

### 药丸

选中已开启且未被默认隐藏的模型商时显示，例如 `✓ 余 87%`、`⚠ 7d 余 12%`、`✕ 7d 已达限额`。多窗口取最差一窗，点击看完整详情。Command Code 药丸弹层底部可切换提供方插件的服务账户（自动轮换 / 默认账户 / 各额外账户，与其设置页同一开关，即时生效）；切换后药丸与弹层上方的用量同步改为所选账户的额度（自动轮换时仍显示默认账户/顶层 Key 的用量，弹层有标注说明）。关闭默认隐藏后，缺凭据时显示配置指引；可保留的临时网络错误会明确标注缓存，而非冒充当前成功。

### 设置

设置 → **订阅用量**：

1. 在「提供商管理」逐家开启/关闭，按需切换「没有检测到API的默认隐藏」；开关即时保存。
2. 上方按钮标签仅切换用量视图，窄屏自动换行；查看百分比、额度明细、重置时间与套餐。
3. 展开底部「提供商管理」，在目标厂商卡片展开「连接与凭据」，无需跳转即可编辑隐藏或关闭的厂商。
4. 更改来源、替换或清除凭据；MiMo 登录与 Cookie 导入也在本行完成。切换用量不影响编辑，切换另一家编辑器须先保存或取消，空输入不会清除原值。
5. 凭据保存先确认持久化，再独立验证。检测关闭的厂商只保存凭据，不发起用量验证；验证失败不意味着保存失败。

顶部 `X/Y 家数据获取成功` 仅表示接口读取健康度。厂商图标/颜色表达额度与异常情况；例如读取成功后仍可能显示「已达限额」。未获取额度的部分数据不能视为可用。

### 出错时直接在卡片上修

设置页原本是「状态在上、操作在下」：用量面板告诉你 Cookie 已过期，但修复入口在底部收起的「提供商管理」里，要先展开、再找到那一家、再展开「连接与凭据」。现在用量面板会在**真正需要处理时**内联一条行动条：

| 情形 | 卡片上给出的动作 |
|---|---|
| MiMo 未登录 / Cookie 被拒 | 「登录并自动导入」+「手动填写」 |
| MiMo Cookie 已过期或 2 小时内到期 | 「重新登录」+「手动填写」 |
| 其它厂商缺凭据或凭据被拒 | 「配置凭据」——展开该厂商的编辑器并滚动过去 |

**正常状态不显示行动条**：还有几小时的倒计时不算事件，避免它变成常驻噪音。行动条只是「把入口送到眼前」，凭据编辑仍然复用下面那一份编辑器，不存在两套字段或两套校验。

同一类问题的另外两处也一起处理了：

- **待处理的排到 tab 前面**：读取失败、Cookie 已过期最急，额度用尽与即将到期次之，数据不完整再次；**「未配置凭据」刻意不算**（那是用户自己的取舍，默认隐藏就是为收起它们），否则每个还没配的厂商都会来抢位置。同档内保持登记顺序，所以顺序不会自己抖动。
- **顶部「X/Y 家数据获取成功」是可点击的**：一下就切到第一家没读成功的；全部正常时按钮禁用，不做无意义的跳转。

### 药丸里的 Command Code 账户区

账户多的时候，账户列表会把上方的额度顶出视野。现在整块折进一个可展开区：标题行直接显示**当前账户与选项数量**，展开后的列表自身限高滚动（240px），弹层高度不再随账户数增长。降级状态（提供方插件未运行）同样折起，只留一行说明。

### 凭据与环境

| 模型商 | 默认继承变量 | 说明 |
|---|---|---|
| DeepSeek | `DEEPSEEK_API_KEY` | 余额型：`GET /user/balance` 返回账户余额，**与推理是同一把 Key** |
| Z.ai | `ZAI_CODING_CN_API_KEY` | 团队套餐另填组织、项目 ID |
| Z.ai 国际 | `ZAI_CODING_API_KEY` | `zai-coding`，默认关闭，独立国际 Coding Plan Key |
| Synthetic | `SYNTHETIC_API_KEY` | `synthetic`，默认关闭，模型订阅请求额度 |
| NanoGPT | `NANOGPT_API_KEY` | `nanogpt`，默认关闭；也可手动填写 Usage only 管理令牌。配额之外还会读一次账户余额（余额端点用 `x-api-key` 而不是 Bearer；拿不到就静默降级，不影响配额） |
| ZenMux | `ZENMUX_MANAGEMENT_API_KEY` | 额度端点**只认 Management API Key**（推理 key 不适用），所以变量名单独区分。在 <https://zenmux.ai/platform/management> 创建该 key |
| LiteLLM | `LITELLM_API_KEY` + 代理地址 | 自建网关：除虚拟 Key（**与推理同一把**）还要在凭据区填写自己的 proxy 地址。管理端点在 **proxy 根**——填了 `/v1` 也会被去掉，不会拼成 `/v1/key/info` |
| Kimi | `KIMI_CODING_API_KEY` | 需要 Kimi Coding Key，不是 Moonshot 开平台 Key；窗口集合按套餐体系下发（老套餐 5 小时 + 7 天，新套餐 Go / Plus 为 5 小时 + 月度） |
| MiMo | 不使用 API Key | 通过控制台 Cookie 会话读取 |
| OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go Key |
| MiniMax 国际 | `MINIMAX_API_KEY` | `minimax` 路由；国际站订阅 Key |
| MiniMax 中国 | `MINIMAX_CN_API_KEY` | `minimax-cn` 路由；中国站订阅 Key |
| Command Code | `COMMANDCODE_API_KEY` | 凭据由提供方插件管理，本页只读继承；也兜底读取 `~/.commandcode/auth.json`（`cmd login`） |
| SuperGrok | 不使用 API Key | `xai-oauth` 路由；只读 dsh-grok-kit / Grok CLI 共享的 OAuth 登录文件 `~/.grok/auth.json`（旧版 `~/.dsh/.xai-oauth-auth.json`），不保存、不刷新 token |
| 火山方舟 Ark | `VOLC_ACCESSKEY` + `VOLC_SECRETKEY` | 三个路由由**官方插件** [`@volcengine/ark-plan-api`](https://www.npmjs.com/package/@volcengine/ark-plan-api) 注册（`ark-coding-plan-cn` / `ark-agent-plan-cn` / `ark-coding-plan-byteplus`）；额度查询要 **IAM Access Key 的 AK/SK 配对**，与这里的推理 API Key（`ARK_*_API_KEY`）**不是同一套**，三家共用一组 AK/SK |
| SiliconFlow | `SILICONFLOW_API_KEY` | 余额型：`GET /v1/user/info` 返回账户余额，**与推理是同一把 Key** |
| Codex | 不使用 API Key | `openai-codex` 路由由 DSH 内置或 `dsh-codex-connect` 等插件提供；只读 Codex CLI 的 ChatGPT 订阅登录文件（`$CODEX_HOME/auth.json` 或 `~/.codex/auth.json`，要求 `auth_mode` 为 `chatgpt`），不保存、不刷新 token。**API Key 模式（`auth_mode` 不是 `chatgpt`）取不到订阅额度**，此时按未配置处理 |
| OpenRouter | `OPENROUTER_API_KEY` | key 限额与用量用推理 key 即可；**账户余额需要 management / provisioning key**，普通 key 会被 403 拒——此时静默降级为只显示限额，不判失败 |
| Novita / Hyperbolic / DeepInfra / Chutes / Ollama Cloud / Vercel AI Gateway | `NOVITA_API_KEY` / `HYPERBOLIC_API_KEY` / `DEEPINFRA_API_KEY` / `CHUTES_API_KEY` / `OLLAMA_API_KEY` / `AI_GATEWAY_API_KEY` | 余额型聚合商，**与各自推理同一把 Key**。注意 Ollama Cloud 的鉴权是**裸 `Authorization`**（本插件已按其要求发送），且各家金额单位不同（见下表） |

Z.ai（中国与国际）/ Kimi / OpenCode Go / MiniMax / Synthetic / NanoGPT 的继承模式按凭据服务 → 启动环境 → 旧手动配置兜底解析；自定义模式仅使用保存的手动 Key。Command Code 仅沿用提供方凭据来源链，不接受本插件的手动 Key；MiMo 仅使用 Cookie；SuperGrok 仅使用共享 OAuth 登录文件（API Key 路线取不到订阅周池）。界面区分凭据服务、启动环境和自定义来源。修改启动环境后是否需要重启取决于目标部署，不能把用户环境即时变化当作已经被运行进程读到。

### MiMo 登录与 Cookie

推荐使用 MiMo「登录与凭据」中的 **登录并自动导入**：

1. 先保存或取消当前编辑，再开始登录。
2. 插件调用 `playwright-core`，打开**独立临时 Chrome 会话**的官方平台；密码、验证码由你在官方页面自行输入，插件不读取这些字段，也不读取日常 Chrome 配置。
3. Host 从该会话获取适用于官方 API 的 `api-platform_serviceToken` 和 `userId`（包括 HttpOnly Cookie），先验证账户接口，再保存并更新用量；Cookie 不通过 RPC 返回页面。
4. 可随时取消或关闭登录窗口；五分钟未完成会超时并关闭。取消、认证失败、网络验证未完成或同一 MiMo 配置已被外部修改时不覆盖凭据。
5. 账户验证成功但无订阅额度时可以保存登录，界面明确显示「额度未知」，不冒充有额度。

需要已安装 **Google Chrome**。新增依赖仅 `playwright-core`，不下载浏览器；缺少 Chrome 时显示错误。当前实现针对 Host 所在机器的可见浏览器，远程/无桌面环境请使用手动导入；真正账号登录与平台接口仍需由用户验收。

备用 **手动导入**：打开 <https://platform.xiaomimimo.com> 自行登录，从 DevTools → Application → Cookies 获取 Name/Value 或导出 JSON，再粘贴并保存。必须包含上述两个字段。导入错误会显示原因并保留原文，认证过期时重新登录。界面的「仅打开官网」链接不会自动导入日常浏览器的 Cookie。

JSON 中有域名的条目按 `platform.xiaomimimo.com` 的 Cookie 域规则过滤，无关站点的 Cookie 不导入。TAB 清单只读取 Name/Value，不把 Domain/Path 混入值；Netscape 导出支持注释和 `#HttpOnly_` 域前缀，并保留可选 Cookie 的空值（两个必需字段仍须非空）。

### Cookie 有效期与到期提醒

官方会话 Cookie **自签发起 24 小时有效**。无论自动登录还是手动导入，保存凭据的同一刻开始计时，并记录在 `~/.dsh/dsh-subusage.json` 的 `xiaomi.loginAt` 与 `xiaomi.expiresAt`（毫秒时间戳，**只是计时元数据，不是秘密**，不参与凭据有效性判断）。

| 剩余时间 | 用量药丸 | 设置页「登录与凭据」 |
|---|---|---|
| 超过 2 小时 | 保持原余量文案 | 显示登录时间与剩余时间 |
| 2 小时内 | ⚠ 黄色药丸，文案「Cookie N 小时后到期」 | 黄色提示剩余时间 |
| 30 分钟内 | ⚠ 橙色药丸，同文案 | 橙色提示 |
| 已到期 | ✕ 红色药丸，文案「Cookie 已过期，请重新登录」 | 红色提示 |
| 额度已用尽 | 仍优先显示额度告警 | — |

药丸弹层常驻显示剩余时间与到期时刻。到期只是**提醒**：插件不会因为倒计时归零就停用 Cookie，是否真的失效仍以官方接口返回为准（失效时按认证错误处理，重新登录即可）。倒计时也永远不会盖过接口的判定——官方已判定凭据失效时，药丸显示的是失效原因而非剩余时间（唯一例外是「已过期」本身，因为它就是重新登录的提示）。若浏览器报告的 Cookie 过期时间早于 24 小时，以更早者为准；旧版本保存的 Cookie 没有计时记录，界面会明确说明「未记录登录时间」而不是编造倒计时。

**安全说明**：Key/Cookie 不再通过用量读取接口回传，界面不回填已保存的秘密；但本版仍兼容原本机 JSON 配置存储，**不是加密凭据库**。该配置位于 `~/.dsh/dsh-subusage.json`，新建目录/临时文件在 POSIX 上按 `0700`/`0600` 创建，替换前再次收紧文件权限；Windows 的实际访问权限仍取决于目录 ACL，`chmod` 不能替代 ACL 或加密库。请勿上传、分享或写入日志。隔离浏览器仅用于你主动发起的官方登录；它不是后台扫描或导入日常浏览器全部凭据的工具。加密凭据存储通道仍未实施。

### 火山方舟 Ark 凭据

火山方舟的套餐额度走**管控面 OpenAPI**（`open.volcengineapi.com`，HMAC-SHA256 签名），只能用 **IAM Access Key**（AK/SK 配对）：推理用的方舟 API Key 交给上游会被拒绝，两者是两套凭据。三个 Ark 路由共用这一组 AK/SK。

1. 在火山引擎控制台创建 Access Key，建议用子用户并只授予方舟只读权限（额度接口不接受主账号之外的其它鉴权方式）。
2. 打开 **设置 → 订阅用量 → 提供商管理**，展开火山方舟任意一家的「连接与凭据」，填入 AccessKey ID 与 SecretAccessKey 并保存。
3. 或在启动环境里设置 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`；也可以先把凭据写进 DSH 凭据服务，由「继承凭据 / 环境变量」模式读取。

AK 与 SK 必须来自同一个 IAM 用户：跨来源拼凑只会得到 401（`SignatureDoesNotMatch`），而报错本身看不出根因。两个字段各自「留空表示不修改该项」，清除要显式点「清除 AK/SK」——只有一半凭据时按未配置显示，不会拿半个签名去请求。

额度按 provider 分派 Action：Coding Plan 走 `GetCodingPlanUsage`，Agent Plan 走 `GetAFPUsage`。账号没有对应套餐时接口返回 **HTTP 200 且窗口为空**，界面显示「未检测到该套餐订阅」，不会画成 0% 用量。401（签名/凭据）、403（权限或未订阅）、接口不存在三类失败分别给出不同的行动项。

> `GetCodingPlanUsage` 并未出现在官方 API 概览里（由官方 ark-cli 与多个第三方实现确证可用），存在变更风险；`GetAFPUsage` 有官方文档。

### Codex（ChatGPT 订阅）凭据

Codex 的订阅额度走 ChatGPT 后端的私有接口（`GET https://chatgpt.com/backend-api/wham/usage`），凭据是 **Codex CLI 自己的 ChatGPT 登录**，不是 `OPENAI_API_KEY`：

- 登录文件：`$CODEX_HOME/auth.json`，默认 `~/.codex/auth.json`。
- 必须 `auth_mode` 为 `chatgpt`。若该文件是 API Key 模式，插件按「未配置」处理并在界面上说明——API Key 取不到订阅额度，不拿它去冒充订阅凭据。
- 插件**只读**这个文件：不保存、不刷新 token（token 由 Codex CLI 自己轮换，第三端刷新会互相顶掉）。请用 `codex login` 完成登录。

窗口取 `rate_limit.primary_window`（5 小时）与 `secondary_window`（7 天；免费档是 30 天，按 `window_seconds` 判断窗口名）。`resets_at` 实测是 **Unix 秒数**（ISO 串也兼容），`plan_type` 作为套餐档位显示。`credits` 只在接口真正报告了可用余额时显示，`has_credits=false`、`unlimited` 或余额为 0 都不显示，不会把「没有额度」画成 0。接口返回 HTTP 200 但没有任何窗口时显示「未检测到订阅额度窗口」，不当作 0% 用量。

> 这是未公开的私有接口（CodexBar / cc-switch / QuotaRadar 三家实现互相印证），官方没有文档承诺，存在变更风险。

### 额度查询 API（给其他插件与 Agent）

**Agent 工具**：`subusage_quota`。模型可以直接调用它查询各厂商的剩余额度与余额，参数 `providers`（可选，限定厂商 id）与 `refresh`（可选，绕过最多 60 秒的缓存）。工具**只读**：不写设置、不碰凭据。

**Host 侧服务**：本插件的 Host 服务 key 是 `subUsage`（cordis `Service`），其他插件可以直接消费：

```js
const service = ctx.get("subUsage");
const view = await service.quota({ providerIds: ["deepseek"], force: false });
// view = { updatedAt, providers: [{ providerId, label, state, windows, extras, coverage, freshness, lastSuccessAt, error? }] }
```

**只读且刻意精简**：`quota()` 不返回设置，也不返回 `keySource` / `apiDetected` / 继承变量名等内部状态——第三方消费者只需要额度，不需要知道本机配了哪些凭据，更不该碰到任何与 Key 相关的字段。`providerIds` 里的未知 id 会被忽略；单家读取失败只影响它自己的条目，其余照常返回。

数据与设置页共用同一份缓存（TTL 60 秒），所以频繁调用不会反复打各家厂商接口。

## 支持的数据

| 模型商 | 窗口 | 明细 |
|---|---|---|
| DeepSeek | 无窗口（余额型） | 账户余额（`balance_infos` 的币种与总额）；余额不可用时提示充值，不显示成 0 元 |
| Z.ai 中国 | 5 小时、每周（按响应） | Token / Credits 配额、套餐档 |
| Z.ai 国际 | 5 小时、每周（按响应） | Token / Credits 配额，区域凭据独立 |
| Synthetic | 滚动订阅池 | 已用/总请求次数、重置时间 |
| NanoGPT | 每日、每周、试用周期（按响应） | 输入 Token 数、重置时间；不包含图像额度 |
| Kimi | 5 小时、7 天、月度（按账户下发） | 已用百分比、套餐档 |
| MiMo | 本周期额度池 | 用量明细、重置时间、套餐与余额 |
| OpenCode Go | 滚动、每周、每月 | 已用百分比、重置时间 |
| MiniMax 国际 / 中国 | 短周期（通常 5 小时）、每周 | 通用/编程池已用百分比、可信计数明细、重置时间 |
| Command Code | 5 小时、每周、月额度池 | 已用/上限（月总额为套餐快照）、重置/账期、套餐（planId）、月剩余、已购 + 赠送余额 |
| SuperGrok | 周期池（通常每周，旧账户为月账期） | 统一用量池已用百分比（剩余 = 100 − 已用）、重置时间、套餐名（subscription_tier_display）、已购加量余额（美元） |
| Ark Coding Plan（中国 / BytePlus） | 5 小时、周、月 | 已用百分比、重置时间（接口只给百分比，不返回绝对量） |
| Ark Agent Plan（中国） | 5 小时、日、周、月 | AFP 已用/配额绝对值与百分比、重置时间、套餐档位（Small / Medium / Large / Max） |
| SiliconFlow | 无窗口（余额型） | 账户余额（元）。余额没有上限也就没有百分比，药丸直接显示余额，弹层与设置页列出明细 |
| Codex | 5 小时、7 天（免费档的次窗口是 30 天） | 已用百分比、重置时间；`credits` 只在真正报告了可用余额时显示（`has_credits=false`、`unlimited`、余额为 0 都不显示，不画成 0） |
| OpenRouter | 按 key 限额周期（月/周/日）；免费档另有每日免费请求窗口 | 已用比例与限额明细；有 management key 时显示账户余额（`total_credits − total_usage`）。接口不给具体重置时刻，故不显示重置时间 |
| Novita / Hyperbolic / Vercel AI Gateway | 无窗口（余额型） | 账户余额（美元）。单位换算按各家接口：Novita 是 **1/10000 USD**、Hyperbolic 是**美分**、Vercel 是**十进制字符串** |
| DeepInfra | 无窗口（余额型） | 可用余额＝`−stripe_balance`（接口用负数表示预付资金）；欠款时单独提示，不显示成负余额 |
| Chutes | 通用限额窗口 | `{quota, used}` 绝对量；接口不给重置时刻，故不显示重置时间 |
| Ollama Cloud | session / 周 / 月 | `limits.*.usage` 是 **0–1 小数**；缺层跳过该窗口而不判失败 |
| ZenMux | 5 小时滚动窗口 | `usage_percentage` 是 **0–1 小数**，另附 flows 明细与 `resets_at`；有 Management Key 时显示 PAYG 余额。两个端点各拿各的——余额被拒不影响配额 |
| NanoGPT | 日 / 周 / 试用周期（按响应） | 输入 Token 数、重置时间、账户状态；另有账户余额（美元） |
| LiteLLM | 预算周期（`budget_reset_at` 存在时才显示重置） | 已用 / 预算与百分比；**没有预算上限时不编造百分比**，只如实显示已用金额 |

非公开控制台接口可能变更；缺失或非法百分比不会当作零用量。部分数据、未知额度和暂时失败有明确状态，不能据此保证推理接口一定可用。

评估过但未接入的厂商（Requesty / Portkey / Groq / Together / Cerebras 等）及理由见 [提供商覆盖与取舍](docs/provider-coverage.md)，其中包括已由用户决策跳过的 Anthropic。

Kimi 的窗口集合随套餐体系变化：老套餐（节奏命名，如 Allegro）返回 5 小时与 7 天，新套餐（Go / Plus 命名）返回 5 小时与月度总额，因此同一插件在不同账号上显示的窗口数可以不同；月度池里的 Code 份额不是独立预算，不单独成窗。插件按接口实际下发的窗口解析，不要求固定集合。


## 常见问题

| 现象 | 排查方法 |
|---|---|
| 设置页没有提供商标签 | 展开提供商管理，确认开关和凭据；无凭据的条目默认隐藏，可临时关闭自动隐藏查看指引 |
| 已配置凭据却没有药丸 | 确认当前模型的提供商 ID 与支持表一致、检测已开启；自定义 ID 可在设置页查看，但不会自动映射 |
| 显示认证失效 | 检查是否用了对应产品/区域的订阅 Key；MiMo 重新登录或导入 Cookie；旧额度不会当作有效数据保留 |
| Kimi 缺少 7 天窗口，或提示结构错误 | 窗口集合按套餐体系下发：老套餐（节奏命名，如 Allegro）为 5 小时 + 7 天，新套餐（Go / Plus 命名）为 5 小时 + 月度总额。0.8.3 起按实际下发的窗口解析，不再要求 7 天窗口；升级后仍报「Invalid Kimi usage response」即为未识别的字段结构，插件不会猜测额度，可回报该响应 |
| 显示缓存、部分数据或额度未知 | 查看更新时间和错误说明；缓存来自之前的成功读取，部分数据不保证有可用额度，余额也不等于订阅余量 |
| 刷新后数字暂未变化 | 成功结果按提供商缓存 60 秒；手动刷新可跳过普通 TTL，但仍遵守限流退避和 Retry-After |
| MiMo 自动登录无法启动 | Host 所在机器需安装 Google Chrome 并有桌面环境；远程或无桌面部署使用手动导入 |
| 药丸提示「Cookie N 小时后到期」 | MiMo 会话 Cookie 自签发起 24 小时有效，按提示重新登录即可续期；手动导入同样重新计时 |
| 药丸显示「未记录登录时间」 | 凭据由旧版本保存，没有计时元数据；重新登录或重新导入一次后开始计时 |
| 保存成功但验证失败 | 凭据已保存，检查网络、区域或账号后重试；保存与在线验证分别反馈 |
| 保存提示配置已改变 | 另一窗口或实例更新了设置；重新读取配置后再编辑，避免旧表单覆盖新值 |
| 升级后仍是旧界面或 RPC 不匹配 | 确认运行中的 Host 和 Client 都已重载；仅刷新页面不能保证 Host 升级 |
| Command Code 额度与实际账户不同 | 可在药丸弹层切换提供方插件的服务账户（activeAccount），切换后药丸与弹层用量同步显示所选账户的额度；「自动轮换」时仍显示默认账户（顶层 Key）的用量，不跟随轮换中的实际服务账户，提供方自定义 apiBase 也不跟随 |
| SuperGrok 提示认证失效 | 登录文件里的 OAuth token 会过期；在 设置 → Grok Kit 重新登录、运行 `grok login`，或让 Grok 侧使用一次以刷新共享登录文件后重试。API Key（`XAI_API_KEY`）取不到订阅周池 |

## 提供商 ID 与默认开关

| 提供商 | ID | 新安装默认值 |
|---|---|---|
| Z.ai 中国 | `zai-coding-cn` | 开启 |
| Kimi Coding | `kimi-coding` | 开启 |
| MiMo | `xiaomi-token-plan-cn` | 开启 |
| OpenCode Go | `opencode-go` | 开启 |
| Command Code | `commandcode` | 开启 |
| SuperGrok | `xai-oauth` | 开启 |
| MiniMax 国际 | `minimax` | 开启 |
| MiniMax 中国 | `minimax-cn` | 开启 |
| Z.ai 国际 | `zai-coding` | **关闭** |
| Synthetic | `synthetic` | **关闭** |
| NanoGPT | `nanogpt` | **关闭** |

开关只控制本插件的订阅检测与显示，关闭后保留凭据。默认隐藏只影响显示，不自动开启被关闭的提供商。新增三项在旧配置升级时也保持关闭。

## 界面预览

以下为 0.7.0 的离线组件测试截图，使用虚构用量数据，不包含真实账号信息，也不是运行中的 DSH 截图。市场截图由根目录的 `screenshots.json` 声明。

深色设置页：查看订阅用量、管理凭据与提供商；新增三家默认关闭。

![深色订阅设置页（离线测试预览）](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/settings-dark.png)

浅色用量弹层：查看每日与每周额度、用量明细。

![浅色 NanoGPT 用量弹层（离线测试预览）](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/usage-popover-light.png)


## 开发、发布与文档

基础检查无需安装 DSH 或连接账号：

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
node --check lib/mimo-login.js
```

推送到 `main` 后，GitHub Actions 检查并发布提交对应的 GitHub Release。推送与包版本一致的 `vX.Y.Z` 标签后，受 npm 信任的 `release.yml` 通过 Trusted Publishing 自动发布新 npm 版本；已有版本跳过。发布产物不会自动安装或重启 DSH。

- [开发与验证](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/development.md)：RPC、缓存、凭据、离线预览与实机验收。
- [UX 设计](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/design-ux.md)：导航、状态、编辑保护与弹层行为。
- [发布与市场收录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/publish.md)：GitHub Release、npm、条目与截图维护。
- [更新记录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/changelog.md)：各版本功能变化。
- [0.7.0 审查记录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/code-review.md)：修复、接口来源和验证边界。

测试使用虚构凭据、桩网络和离线组件。真实 DSH Loader、实际账号在线接口与多账户映射尚未验收；截图不代表已通过这些检查。

## 许可

MIT。与 DeepSeek Harness 及各服务商无官方关联。
