# 提供商清单与额度语义

本文件是 [README](../README.md) 「支持的数据」的展开版：凭据继承变量、各家窗口语义与逐家补充说明。

事实源是同仓库代码，不是文档维护者的记忆：

| 内容 | 事实源 |
|---|---|
| provider id、`label`、`envName`、`defaultEnabled`、火山方舟的 `volcAction` / `volcHost` / `volcRegion` | [`lib/index.js`](../lib/index.js) 顶部的 `PROVIDERS` |
| 设置页与药丸用的短名、展示顺序、`managedByPlugin` / `volc` 标记 | [`lib/client.js`](../lib/client.js) 顶部的 `PROVIDER_META` / `PROVIDER_ORDER` |

## 1. 清单与默认开关

30 条 provider id 的总表（提供商 / id / 额度类型 / 鉴权 / 新安装默认开关）只维护在 [README 的「支持的数据」](../README.md#支持的数据--supported-data) 一处，避免同一份事实在两处漂移：**默认开启 11 条、默认关闭 19 条**（`PROVIDERS[id].defaultEnabled !== false`）。

新增厂商须同时改 `PROVIDERS`、`PROVIDER_META` / `PROVIDER_ORDER`、帮助文案、README 与默认值测试；未获明确需求的新订阅商一律 `defaultEnabled: false`，原有偏好通过存储合并保留。

## 2. 凭据解析顺序

各家「默认继承变量」与逐家说明的完整表格维护在 [README 的「凭据与环境」折叠表](../README.md#configuration--配置)（取自 `PROVIDERS[id].envName`），本文件不重复维护同一份事实。留空表示不使用继承变量（凭据来自登录文件或官方平台会话）。

解析顺序（`inherit` 模式）：**凭据服务 → 启动环境 → 旧手动配置兜底**；自定义（`manual`）模式只使用保存的手动 Key。由提供方插件管理的模型商（`commandcode` / `xai-oauth` / `openai-codex`）不接受本插件的手动 Key。Cookie 与登录文件型凭据不走这条链，见第 4 节。火山方舟的 AK/SK 还必须**同源配对**：两个字段要么都来自凭据服务、要么都来自启动环境、要么都用本机保存值，跨来源拼接只会 401 且报错看不出根因。修改启动环境后是否需要重启取决于目标部署，不能把用户环境即时变化当作已经被运行进程读到。

## 3. 窗口与明细

| 模型商 | 窗口 | 明细 |
|---|---|---|
| DeepSeek | 无窗口（余额型） | 账户余额（`balance_infos` 的币种与总额）；`is_available=false` 提示充值，不显示成 0 |
| Z.ai（中国 / 国际） | 5 小时、每周（按响应） | Token / Credits 配额、套餐档 |
| Kimi | 5 小时 + 7 天或月度（按账户下发） | 已用百分比、套餐档 |
| Xiaomi MiMo | 本周期额度池 | 用量明细、重置时间、套餐与余额 |
| OpenCode Go | 滚动、每周、每月 | 已用百分比、重置时间 |
| Command Code | 5 小时、每周、月额度池 | 已用 / 上限（月总额来自套餐快照）、重置 / 账期、`planId`、月剩余、已购 + 赠送余额 |
| SuperGrok | 周期池（通常每周，旧账户为月账期） | 统一用量池已用百分比（剩余 = 100 − 已用）、重置时间、套餐名、已购加量余额（美元） |
| Codex | 5 小时、7 天（免费档的次窗口是 30 天） | 已用百分比、重置时间、`plan_type`；`credits` 只在真正报告了可用余额时显示 |
| MiniMax（国际 / 中国） | 短周期（通常 5 小时）、每周 | 通用 / 编程池已用百分比、可信计数明细、重置时间 |
| Ark Agent Plan（arkcli / 旧插件路由） | 5 小时、日、周、月 | AFP 已用 / 配额绝对值与百分比、重置时间、套餐档位（Small / Medium / Large / Max） |
| Ark Coding Plan（arkcli / 旧插件路由 / BytePlus） | 5 小时、周、月 | 已用百分比、重置时间（接口只给百分比，不返回绝对量） |
| Ark 企业版 / 团队版（`arkcli-*-plan-team`） | 席位上的额度窗口 | 先用 `ListSeatInfos` 取 SeatID，再查该席位的用量 |
| SiliconFlow | 无窗口（余额型） | 账户余额（元）。余额没有上限也就没有百分比，药丸直接显示余额 |
| OpenRouter | 按 key 限额周期（月 / 周 / 日）；免费档另有每日免费请求窗口 | 已用比例与限额明细；有 management key 时显示账户余额（`total_credits − total_usage`）。接口不给具体重置时刻，故不显示重置时间 |
| Synthetic | 滚动订阅池 | 已用 / 总请求次数、重置时间 |
| NanoGPT | 日 / 周 / 试用周期（按响应） | 输入 Token 数、重置时间、账户状态；另有账户余额（美元） |
| Novita / Hyperbolic / Vercel AI Gateway | 无窗口（余额型） | 账户余额（美元），单位换算按各家接口，见 [README 的「凭据与环境」折叠表](../README.md#configuration--配置) |
| DeepInfra | 无窗口（余额型） | 可用余额 = `−stripe_balance`（接口用负数表示预付资金）；欠款时单独提示，不显示成负余额 |
| Chutes | 通用限额窗口 | `{quota, used}` 绝对量；接口不给重置时刻，故不显示重置时间 |
| Ollama Cloud | session / 周 / 月 | `limits.*.usage` 是 **0–1 小数**；缺层跳过该窗口而不判失败 |
| ZenMux | 5 小时滚动窗口 | `usage_percentage` 是 **0–1 小数**，另附 flows 明细与 `resets_at`；有 Management Key 时显示 PAYG 余额。两个端点各拿各的——余额被拒不影响配额 |
| LiteLLM | 预算周期（`budget_reset_at` 存在时才显示重置） | 已用 / 预算与百分比；**没有预算上限时不编造百分比**，只如实显示已用金额 |

非公开控制台接口可能变更；缺失或非法百分比不会当作零用量。部分数据、未知额度和暂时失败有明确状态，不能据此保证推理接口一定可用。

> **Agent Plan 的四个 AFP 窗口不是同一条额度线。** 官方「套餐概览 → 额度刷新规则」的口径是：**5 小时限额**按首次请求时间滚动刷新、**周限额**每周一 00:00 重置、**月限额**每订阅月第 1 日重置——这三条属于**文本 / 向量模型**；而**日限额只在视觉模型、语音模型与 Harness 上生效**（语音模型与 Harness 本身**没有** 5 小时与周限额）。
>
> 因此**日窗口与其余三个窗口之间没有包含关系，数值不可互相比**：「日 50K > 周 35K」是正常现象，不代表映射错误或额度异常。插件按字段名原样映射（`Used` → 已用、`Quota` → 总计），固定按 5 小时 → 日 → 周 → 月 展示，**不重排、不推算**，并在日窗口的明细里标出它的适用范围。
>
> 依据：[套餐概览 · 额度刷新规则](https://ark.volcengine.com/region:cn-beijing/docs/agent-plan-personal-plan-overview#%E9%A2%9D%E5%BA%A6%E5%88%B7%E6%96%B0%E8%A7%84%E5%88%99)、[获取套餐 AFP 额度 · 响应参数](https://ark.volcengine.com/region:cn-beijing/docs/get-afp-usage-api#%E5%93%8D%E5%BA%94%E5%8F%82%E6%95%B0)。

Kimi 的窗口集合随套餐体系变化：老套餐（节奏命名，如 Allegro）返回 5 小时与 7 天，新套餐（Go / Plus 命名）返回 5 小时与月度总额，因此同一插件在不同账号上显示的窗口数可以不同；月度池里的 Code 份额不是独立预算，不单独成窗。插件按接口实际下发的窗口解析，不要求固定集合。

## 4. 逐家补充说明

### 火山方舟 Ark 凭据

方舟的套餐额度走**管控面 OpenAPI**（`open.volcengineapi.com` 或 BytePlus 的 `ark.ap-southeast-1.byteplusapi.com`，HMAC-SHA256 签名），只能用 **IAM Access Key**（AK/SK 配对）：推理用的方舟 API Key 交给上游会被拒绝，两者是两套凭据。7 条路由共用一组 AK/SK。

1. 在火山引擎控制台创建 Access Key，建议用子用户并只授予方舟只读权限。
2. 打开 **设置 → 订阅用量 → 提供商管理**，展开火山方舟任意一家的「连接与凭据」，填入 AccessKey ID 与 SecretAccessKey 并保存。
3. 或在启动环境里设置 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`；也可以先把凭据写进 DSH 凭据服务，由「继承凭据 / 环境变量」模式读取。

AK 与 SK 必须来自同一个 IAM 用户：跨来源拼凑只会得到 401（`SignatureDoesNotMatch`），而报错本身看不出根因。两个字段各自「留空表示不修改该项」，清除要显式点「清除 AK/SK」——只有一半凭据时按未配置显示，不会拿半个签名去请求。

额度按 provider 分派 Action：Coding Plan 走 `GetCodingPlanUsage`，Agent Plan 走 `GetAFPUsage`。账号没有对应套餐时接口返回 **HTTP 200 且窗口为空**，界面显示「未检测到该套餐订阅」，不会画成 0% 用量。401（签名 / 凭据）、403（权限或未订阅）、接口不存在三类失败分别给出不同的行动项。

provider id 必须与注册这些路由的插件**逐字一致**（arkcli 官方 CLI 写 `arkcli-<planType>`，旧插件 `@volcengine/ark-plan-api` 写 `ark-*-plan-*`），否则选中方舟模型时药丸不会出现。

> `GetCodingPlanUsage` 并未出现在官方 API 概览里（由官方 ark-cli 与多个第三方实现确证可用），存在变更风险；`GetAFPUsage` 有官方文档。

### Codex ChatGPT 订阅凭据

订阅额度走 ChatGPT 后端的私有接口（`GET https://chatgpt.com/backend-api/wham/usage`），凭据是 **Codex CLI 自己的 ChatGPT 登录**，不是 `OPENAI_API_KEY`：

- 登录文件：`$CODEX_HOME/auth.json`，默认 `~/.codex/auth.json`。
- 必须 `auth_mode` 为 `chatgpt`。若是 API Key 模式，插件按「未配置」处理并在界面上说明。
- 插件**只读**这个文件：不保存、不刷新 token（token 由 Codex CLI 自己轮换，第三端刷新会互相顶掉）。请用 `codex login` 完成登录。

窗口取 `rate_limit.primary_window`（5 小时）与 `secondary_window`（7 天；免费档是 30 天，按 `window_seconds` 判断窗口名）。`credits` 只在接口真正报告了可用余额时显示，`has_credits=false`、`unlimited` 或余额为 0 都不显示。接口返回 HTTP 200 但没有任何窗口时显示「未检测到订阅额度窗口」，不当作 0% 用量。

> 这是未公开的私有接口（CodexBar / cc-switch / QuotaRadar 三家实现互相印证），官方没有文档承诺，存在变更风险。

### SuperGrok 凭据

`xai-oauth` 路由由 dsh-grok-kit 注册。插件只读 Grok CLI / dsh-grok-kit 共享的 OAuth 登录文件（`~/.grok/auth.json`，回退 `~/.dsh/.xai-oauth-auth.json`），不写、不刷新 token；API Key 路线取不到订阅周池。用量走官方 CLI 的计费代理（`cli-chat-proxy.grok.com`）。

### MiMo 登录与 Cookie

推荐使用 MiMo「登录与凭据」中的 **登录并自动导入**：

1. 先保存或取消当前编辑，再开始登录。
2. 插件调用 `playwright-core`，打开**独立临时 Chrome 会话**的官方平台；密码、验证码由你在官方页面自行输入，插件不读取这些字段，也不读取日常 Chrome 配置。
3. Host 从该会话获取适用于官方 API 的 `api-platform_serviceToken` 和 `userId`（包括 HttpOnly Cookie），先验证账户接口，再保存并更新用量；Cookie 不通过 RPC 返回页面。
4. 可随时取消或关闭登录窗口；五分钟未完成会超时并关闭。取消、认证失败、网络验证未完成或同一 MiMo 配置已被外部修改时不覆盖凭据。
5. 账户验证成功但无订阅额度时可以保存登录，界面明确显示「额度未知」，不冒充有额度。

需要已安装 **Google Chrome**。新增依赖仅 `playwright-core`，不下载浏览器；缺少 Chrome 时显示错误。当前实现针对 Host 所在机器的可见浏览器，远程 / 无桌面环境请使用手动导入。

备用 **手动导入**：打开 <https://platform.xiaomimimo.com> 自行登录，从 DevTools → Application → Cookies 获取 Name/Value 或导出 JSON，再粘贴并保存。必须包含上述两个字段。JSON 中有域名的条目按 `platform.xiaomimimo.com` 的 Cookie 域规则过滤；TAB 清单只读取 Name/Value，Netscape 导出支持注释和 `#HttpOnly_` 域前缀。

官方会话 Cookie **自签发起 24 小时有效**。无论自动登录还是手动导入，保存凭据的同一刻开始计时，并记录在 `~/.dsh/dsh-subusage.json` 的 `xiaomi.loginAt` 与 `xiaomi.expiresAt`（毫秒时间戳，**只是计时元数据，不是秘密**，不参与凭据有效性判断）。

| 剩余时间 | 用量药丸 | 设置页「登录与凭据」 |
|---|---|---|
| 超过 2 小时 | 保持原余量文案 | 显示登录时间与剩余时间 |
| 2 小时内 | ⚠ 黄色药丸，文案「Cookie N 小时后到期」 | 黄色提示剩余时间 |
| 30 分钟内 | ⚠ 橙色药丸，同文案 | 橙色提示 |
| 已到期 | ✕ 红色药丸，文案「Cookie 已过期，请重新登录」 | 红色提示 |
| 额度已用尽 | 仍优先显示额度告警 | — |

到期只是**提醒**：插件不会因为倒计时归零就停用 Cookie，是否真的失效仍以官方接口返回为准。官方已判定凭据失效时，药丸显示的是失效原因而非剩余时间（唯一例外是「已过期」本身）。若浏览器报告的 Cookie 过期时间早于 24 小时，以更早者为准；旧版本保存的 Cookie 没有计时记录，界面会明确说明「未记录登录时间」。

### Command Code 账户

Command Code 的凭据由提供方插件 `@mars-sea/dsh-commandcode-provider` 管理，本插件只读继承，并在药丸弹层提供账户切换（自动轮换 / 默认账户 / 各额外账户，与其设置页同一开关）。「自动轮换」时仍显示默认账户（顶层 Key）的用量，不跟随轮换中的实际服务账户；提供方自定义 `apiBase` 也不跟随。月总额按已知套餐快照推算，未知套餐只显示月剩余；月池耗尽不代表已购 / 赠送池不可用。

账户多时账户列表折进可展开区，列表自身限高滚动（240px），弹层高度不随账户数增长。

### 网络端点

| 用途 | 域名 |
|---|---|
| 各订阅 / 余额接口 | `api.deepseek.com`、`open.bigmodel.cn`、`api.z.ai`、`api.kimi.com`、`opencode.ai`、`api.siliconflow.cn`、`openrouter.ai`、`api.synthetic.new`、`nano-gpt.com`、`api.novita.ai`、`api.hyperbolic.ai`、`api.deepinfra.com`、`api.chutes.ai`、`ollama.com`、`ai-gateway.vercel.sh`、`zenmux.ai`、`api.minimax.io`、`api.minimaxi.com` |
| 会话 / 登录文件型 | `platform.xiaomimimo.com`（MiMo 用量与登录）、`api.commandcode.ai`（Command Code 计费）、`cli-chat-proxy.grok.com`（SuperGrok 计费代理）、`chatgpt.com/backend-api`（Codex 订阅用量） |
| 火山方舟管控面 | `open.volcengineapi.com`、`ark.ap-southeast-1.byteplusapi.com` |
| 自建网关 | 用户自填的 LiteLLM proxy 地址（只去掉 `/v1` 这类版本段，其余路径原样保留） |

除上面这些，插件不访问其他网络地址；MiMo 自动登录会额外打开官方平台页面，由你在该页面自行完成登录。
