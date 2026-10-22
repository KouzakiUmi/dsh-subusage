# 提供商清单与额度语义

本文件是 [README](../README.md) 「支持的数据」的展开版：凭据继承变量、各家窗口语义与逐家补充说明。

事实源是同仓库代码，不是文档维护者的记忆：

| 内容 | 事实源 |
|---|---|
| provider id、`label`、`envName`、`defaultEnabled`、火山方舟的 `volcAction` / `volcHost` / `volcRegion` | [`lib/index.js`](../lib/index.js) 顶部的 `PROVIDERS` |
| 设置页与药丸用的短名、展示顺序、`managedByPlugin` / `volc` 标记 | [`lib/client.js`](../lib/client.js) 顶部的 `PROVIDER_META` / `PROVIDER_ORDER` |

## 1. 清单与默认开关

29 条 provider id 的总表（提供商 / id / 额度类型 / 鉴权 / 新安装默认开关）见 [README 的「支持的数据」](../README.md#支持的数据--supported-data)。新安装的**有效默认值为开启 13 条、关闭 16 条**，以 `defaultSettings()` 和 `parseStored()` 的组归一化结果为准：注册元数据原始为 11 开 / 18 关，但火山方舟的 4 条路由共用默认开启的组开关，团队两条也随组开启，不能只按 `defaultEnabled` 统计有效值。Codex 仍默认关闭，避免与提供方自带药丸重复。设置页里这 29 条合并成 **26 张卡片**；历史已保存开关继续合并，不按新安装数量覆盖。

新增厂商须同时改 `PROVIDERS`、`PROVIDER_META` / `PROVIDER_ORDER`、帮助文案、README 与默认值测试；未获明确需求的新订阅商一律 `defaultEnabled: false`，原有偏好通过存储合并保留。

## 2. 凭据解析顺序

各家「默认继承变量」与逐家说明的完整表格维护在 [README 的「凭据与环境」折叠表](../README.md#configuration--配置)（取自 `PROVIDERS[id].envName`），本文件不重复维护同一份事实。留空表示不使用继承变量（凭据来自登录文件或官方平台会话）。

解析顺序（`inherit` 模式）：**凭据服务 → 启动环境 → 旧手动配置兜底**；自定义（`manual`）模式只使用保存的手动 Key。由提供方插件管理的模型商（`commandcode` / `xai-oauth` / `openai-codex`）不接受本插件的手动 Key。Cookie 与登录文件型凭据不走这条链，见第 4 节。火山方舟的 AK/SK 还必须**同源配对**：两个字段要么都来自凭据服务、要么都来自启动环境、要么都用本机保存值，跨来源拼接只会 401 且报错看不出根因。修改启动环境后是否需要重启取决于目标部署，不能把用户环境即时变化当作已经被运行进程读到。

## 3. 窗口与明细

| 模型商 | 窗口 | 明细 |
|---|---|---|
| DeepSeek API（`deepseek`） | 无窗口（余额型） | 账户余额（`balance_infos` 的币种与总额）；`is_available=false` 提示充值，不显示成 0 |
| DeepSeek 账号（`deepseek-account`） | 无窗口（余额型） | 复用本机 `deepseekAccount` 服务返回的充值余额；默认开启、无独立 Key。别名 `deepseek-official` 指向本条 |
| Z.ai（中国 / 国际） | 5 小时、每周（按响应） | Token / Credits 配额、套餐档 |
| Kimi | 5 小时 + 7 天或月度（按账户下发） | 已用百分比、套餐档 |
| Xiaomi MiMo | 本周期额度池 | 用量明细、重置时间、套餐与余额。**没有窗口时（无订阅或套餐读不到）才回落到纯余额药丸**，套餐仍可读时窗口优先 |
| OpenCode Go | 滚动、每周、每月 | 已用百分比、重置时间 |
| Command Code | 5 小时、每周、月额度池 | 已用 / 上限（月总额来自套餐快照）、重置 / 账期、`planId`、月剩余、已购 + 赠送余额 |
| SuperGrok | 周期池（通常每周，旧账户为月账期） | 统一用量池已用百分比（剩余 = 100 − 已用）、重置时间、套餐名、已购加量余额（美元） |
| Codex | 按档位与实际时长；Pro 系列可只有周窗 | 百分比、重置、套餐、Credits 与企业支出限制；无限 Credits 单独说明 |
| MiniMax（国际 / 中国） | 短周期（通常 5 小时）、每周 | 通用 / 编程池已用百分比、可信计数明细、重置时间 |
| Ark Agent Plan（arkcli / 旧插件路由） | 5 小时、日、周、月 | AFP 已用 / 配额绝对值与百分比、重置时间、套餐档位（Small / Medium / Large / Max） |
| Ark Coding Plan（arkcli；兼容旧国内路由别名） | 5 小时、周、月 | 已用百分比、重置时间（接口只给百分比，不返回绝对量） |
| Ark 企业版 / 团队版（`arkcli-*-plan-team`） | 席位上的额度窗口 | 先用 `ListSeatInfos` 取 SeatID，再查该席位的用量 |
| SiliconFlow | 无窗口（余额型） | 账户余额（元）。余额没有上限也就没有百分比，药丸直接显示余额 |
| OpenRouter | 按 key 限额周期（月 / 周 / 日）；免费档另有每日免费请求窗口 | 已用比例与限额明细；有 management key 时显示账户余额（`total_credits − total_usage`）。接口不给具体重置时刻，故不显示重置时间 |
| Synthetic | 滚动订阅池 | 已用 / 总请求次数、重置时间 |
| NanoGPT | 日 / 周 / 试用周期（按响应） | 输入 Token 数、重置时间、账户状态；另有账户余额（美元） |
| Novita / Hyperbolic / Vercel AI Gateway | 无窗口（余额型） | 账户余额（美元），单位换算按各家接口，见 [README 的「凭据与环境」折叠表](../README.md#configuration--配置) |
| DeepInfra | 无窗口（余额型） | 可用余额 = `−stripe_balance`（接口用负数表示预付资金）；欠款时单独提示，不显示成负余额 |
| Chutes | 通用限额窗口 | `{quota, used}` 绝对量；接口不给重置时刻，故不显示重置时间 |
| Ollama Cloud | session / 周 / 月 | `limits.*.usage` 是 **0–1 小数**；缺层跳过该窗口而不判失败 |
| ZenMux | 5 小时 / 周滚动窗口 | `usage_percentage` 是 **0–1 小数**，另附 flows 明细与 `resets_at`；有 Management Key 时显示 PAYG 余额。两个端点各拿各的——余额被拒不影响配额；**订阅端点失败时保留余额但标部分数据并写明「套餐状态暂不可确认」，不据此宣称未订阅** |
| LiteLLM | 独立 Key / User / Team 预算周期 | 各层已用 / 预算、百分比和可用重置；**没有预算上限时不编造百分比**，只如实显示已用金额 |
| OpenDesign（`opendesign`） | Design Plan 5 小时 / 7 天窗（按套餐下发；plan model credits 无窗、按账期） | 已用 / 上限（credits 整数）与重置时间、档位（Go / Plus / Pro / Max）。窗口接口不下发百分比，由 `usedCredits / limitCredits` 算；个人工作区另读 `/api/v1/billing/summary`：钱包合计（订阅 + 充值）显示为**总额度**、订阅额度（换算成美元）显示为**套餐余额**——两者是**两个池**，旧文案「月额度剩余 / 余额」会被读成同份额度的两个比较值（0.15.0 起改名，见 [界面文案](#opendesign-额度文案)）。两个端点对普通取数故障独立降级；认证/凭据错误不参与降级，应明确提示登录失效或凭据被拒，且不沿用旧额度缓存。零余额照常显示且不影响 Design Plan 窗口；不按模型倍率或套餐价格推算钱包上限。**5 小时窗不是每个套餐都有**，只有 7 天窗不构成缺数据 |

非公开控制台接口可能变更；缺失或非法百分比不会当作零用量。部分数据、未知额度和暂时失败有明确状态，不能据此保证推理接口一定可用。

> **AFP 窗口有不同作用域。** 5 小时/周属于文本约束，日窗按实际 API 的日能力分组，月窗为共享总池；文本周窗不能连坐日能力，共享月耗尽仍影响各能力。各窗口单位相同也不代表限额可互相比较。
>
> 个人版语音/Harness 与企业 API 的日规则描述存在差异，本插件保留接口分组，不从模型名猜额外豁免。总览提示“部分能力额度已用尽”，不等于所选模型一定受限；具体接口字段与边界见[开发说明](development.md#额度语义修正0112)。

Kimi 的窗口集合随套餐体系变化：老套餐（节奏命名，如 Allegro）返回 5 小时与 7 天，新套餐（Go / Plus 命名）返回 5 小时与月度总额，因此同一插件在不同账号上显示的窗口数可以不同；月度池里的 Code 份额不是独立预算，不单独成窗。插件按接口实际下发的窗口解析，不要求固定集合。

### 余额的显示与预警

余额型条目（`deepseek`、`deepseek-account`、`siliconflow`、`novita`、`hyperbolic`、`deepinfra`、`vercel-ai-gateway`）**不要求本机装有对应的模型路由**：官方余额与本机账号余额都独立于推理入口，手动模式或已存 Key 的账号照样能查。火山方舟同样按账号级管控面而非推理路由收起。

药丸与弹层对余额的规则（与 [UX 设计](design-ux.md) 的 `computeStatus` 章节一致）：

- **有有效套餐窗口时窗口优先**，余额只在弹层 extras 里出现。负余额不抹掉仍然有效的套餐窗口；套餐耗尽也不因为钱包里还有余额就被盖过——官方接口明确给出 PAYG / included 续用建议时，那条建议仍单独保留。
- **纯余额药丸只在「没有窗口且数据完整」时出现**，即读取成功、`coverage` 为完整。缓存、部分数据或读取失败仍是降级态，余额只在依据行里补充。
- **分级阈值是产品预警，不是汇率换算**，也不代表「还能跑多少次」：人民币 < 1 元红、1–5 元黄、≥ 5 元绿；美元 < 0.2 红、0.2–1 黄、≥ 1 绿（0.13.0 起；0.12.0 正常余额为灰）。展示最多两位小数，阈值仍用原始金额。`credits` 及其它没有跨厂商统一价值的单位，只在**已解析的非正余额**时标红，正余额保持灰色——不同厂商的 credits 面值不可比，按绝对量分级只会凭空制造价值感。
- **累计花费不套用余额阈值**。`spend` / `*-spend` 是已花金额，不是可用余额。

## 4. 逐家补充说明

### 火山方舟 Ark 凭据

方舟的套餐额度走**管控面 OpenAPI**（`open.volcengineapi.com`，HMAC-SHA256 签名），只能用 **IAM Access Key**（AK/SK 配对）：推理用的方舟 API Key 交给上游会被拒绝，两者是两套凭据。4 条路由共用一组 AK/SK。

1. 在火山引擎控制台创建 Access Key，建议用子用户并只授予方舟只读权限。
2. 打开 **设置 → 订阅用量 → 提供商管理**，展开火山方舟任意一家的「连接与凭据」，填入 AccessKey ID 与 SecretAccessKey 并保存。
3. 或在启动环境里设置 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`；也可以先把凭据写进 DSH 凭据服务，由「继承凭据 / 环境变量」模式读取。

AK 与 SK 必须来自同一个 IAM 用户：跨来源拼凑只会得到 401（`SignatureDoesNotMatch`），而报错本身看不出根因。两个字段各自「留空表示不修改该项」，清除要显式点「清除 AK/SK」——只有一半凭据时按未配置显示，不会拿半个签名去请求。

额度按 provider 分派 Action：Coding Plan 走 `GetCodingPlanUsage`，Agent Plan 走 `GetAFPUsage`。账号没有对应套餐时，接口可能返回 **HTTP 200 且窗口为空**，或已核验的 HTTP 404 未订阅业务信封，界面显示「未检测到该套餐订阅」，不会画成 0% 用量。401（签名 / 凭据）、403（权限或未订阅）、接口不存在三类失败分别给出不同的行动项。

provider id 必须与注册这些路由的插件**逐字一致**（arkcli 官方 CLI 写 `arkcli-<planType>`，旧插件 `@volcengine/ark-plan-api` 写 `ark-*-plan-*`），否则选中方舟模型时药丸不会出现。

> `GetCodingPlanUsage` 并未出现在官方 API 概览里（由官方 ark-cli 与多个第三方实现确证可用），存在变更风险；`GetAFPUsage` 有官方文档。

### Codex ChatGPT 订阅凭据

订阅额度走 ChatGPT 后端的私有接口（`GET https://chatgpt.com/backend-api/wham/usage`），凭据是 **ChatGPT OAuth 登录**，不是 `OPENAI_API_KEY`。0.13.0 增加 [dsh-codex-subscription](https://github.com/WSL043/dsh-codex-subscription) 的独立 OAuth 只读兼容：

- 优先只读 DSH 凭据服务中的 `codex-subscription/accounts` grant（version 1），取 `activeId` 对应账号；该记录存在但损坏时明确报错，不回退到别的账号。
- 没有活动账号记录时依次读取 `OPENAI_CODEX_SUBSCRIPTION_OAUTH`、`WSL043_OPENAI_CODEX_OAUTH` 单账号引用；再回落到 CLI 登录文件。独立插件无需安装或登录 CLI。
- 不写入、迁移或刷新另一插件的 OAuth，不在界面或用量结果中暴露 token。过期 / 401 仍需由凭据所属插件完成续约；仅凭只读兼容不能承诺其完整刷新生命周期。

- 登录文件：`$CODEX_HOME/auth.json`，默认 `~/.codex/auth.json`。
- 必须 `auth_mode` 为 `chatgpt`。若是 API Key 模式，插件按「未配置」处理并在界面上说明。
- 插件**只读**这个文件：不保存、不刷新 token（token 由 Codex CLI 自己轮换，第三端刷新会互相顶掉）。请用 `codex login` 完成登录。

窗口按接口实际时长解析；Pro / ProLite / ProMax 缺时长时按周，其他未知档位不强猜 5 小时。旧个人档保留兼容。`credits` 余额须有真实报告，`unlimited` 单独解释；没有 rate_limit 仍保留企业 Credits 与 spend_control。所选 accountId 随请求头发送并参与缓存指纹；额外模型池尚未映射时标 partial。

> 这是未公开的私有接口（CodexBar / cc-switch / QuotaRadar 三家实现互相印证），官方没有文档承诺，存在变更风险。

### SuperGrok 凭据

`xai-oauth` 路由由 dsh-grok-kit 注册。插件读取 Grok CLI / dsh-grok-kit 共享的 OAuth 登录文件（`~/.grok/auth.json`，回退 `~/.dsh/.xai-oauth-auth.json`），不保存凭据；access token 过期时借 dsh-grok-kit（≥0.2.0）的官方登录链（`new XaiOAuthSession().models.getAuth("xai")`）续约并由该链写回同一文件（同一把写锁、compare-and-write，非本插件裸刷），未安装 grok-kit 或续约失败才提示手动重新登录；API Key 路线取不到订阅周池。用量优先走官方 CLI 的计费代理（`cli-chat-proxy.grok.com` 的 `/v1/billing?format=credits`）；该格式在部分统一计费账号上 500 时，用同一 OAuth Bearer 回退 `grok.com` 的 `GetGrokCreditsConfig` gRPC-web。REST 成功但缺百分比时也最多补查一次（6 秒）；仅当 gRPC 周期与 REST 一致才采纳。完整成功 protobuf 中，活跃周/月周期省略的隐式 float 表示已用 0%；其它缺字段、补查失败或周期不匹配保持部分数据，不把充值支出当订阅用量。

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

### OpenDesign 凭据

OpenDesign（open-design.ai，Powerformer）的订阅额度走**控制台接口**（`amr-api.open-design.ai`），鉴权是**浏览器登录会话 Cookie**。它与 `sk-` 开头的模型 API Key 是两套：那把 Key 只换模型响应（`amr-link.open-design.ai` 的 `/v1/models`、`/v1/chat/completions`）；对 `amr-link` 的 `/v1/credits`、`/v1/usage`、`/v1/balance` 等路径做过**无凭据探测**、一律 404，带 Key 时是否另有端点**未验证**，因此本插件不用 `sk-` Key 查额度。

**推荐手动导入**。卡片里的「登录并自动导入」（与 MiMo 同一套流程）在 OpenDesign 上**走不通**：插件启动的临时 Chrome 过不了站点的 Cloudflare 人机验证（2026-10-18 实测，即使已把 `navigator.webdriver` 压成 false 也一样），登录窗口会停在挑战处。该入口保留着，等站点放宽时可用；日常请按下面的手动步骤。

手动导入（设置 → 订阅用量 → 提供商管理 → **OpenDesign** 卡片）：

1. 在**你自己日常的浏览器**里登录 <https://open-design.ai>，进入「方案与余额」页（`/cloud/dashboard`）。
2. `F12` 打开 DevTools → **Network** 面板 → 筛 **Fetch/XHR**。
3. 按 `F5` 刷新，点开状态为 **200** 的 `coding-plan-usage` 请求。
4. 在 **Headers → Request Headers** 里找到 `cookie:` 这一行，复制**整行值**——它应当包含 `__Secure-better-auth.session_token`，那就是登录态本身。
5. 粘进卡片里标签为「会话 Cookie」的输入框并保存。**手动填写先保存，再独立验证**；启用的提供商保存后会刷新额度，验证失败不等于保存失败，关闭检测时只保存、不联网。自动登录是另一条路径：只有验证通过才提交 Cookie，不能与手动保存混淆。

也可以导出 `OPEN_DESIGN_COOKIE` 环境变量。手动填的值必须含 `=`（形如 `name=value; name2=value2`），否则按「凭据不完整」直接报错，而不是发一次注定 401 的请求。

Cookie 落在通用的手动 Key 槽，并把凭据模式切成 manual，不额外记录登录时间。已识别的认证错误（如接口返回 401）明确报告登录/凭据失效，不再归为「数据不完整」，也不沿用旧额度；此时重新复制会话 Cookie 并保存后验证即可。普通网络或服务故障仍允许钱包与 Design Plan 独立降级。

额度语义按官方 [Model credits and usage](https://open-design.ai/model-credits/)：**7 天与 5 小时两个窗只约束 Design Plan 额度**——Go 两个都有，Plus / Pro / Max 只有 7 天窗；plan model credits 不受这两个窗约束、按账期发放与重置，两者共用同一份消费记录。所以窗口集合按接口实际下发的 `durationSeconds` 解析，不从套餐名反推。

> 这是未公开的控制台私有接口，契约由 **2026-10-18 真实账号实测**得出（不是从文档或前端 bundle 推的——0.14.0 那次就是推错了才在 0.14.2 改过来）。官方没有文档承诺，存在变更风险。

### DeepSeek API 与 DeepSeek 账号

两条入口**完全独立**：各自的开关、各自的缓存条目、各自的余额来源，互不共享也不互相覆盖。

| | `deepseek`（DeepSeek API） | `deepseek-account`（DeepSeek 账号） |
|---|---|---|
| 鉴权 | `DEEPSEEK_API_KEY`，与推理同一把 Key | **没有凭据可填**：复用本机 `deepseekAccount` 服务的登录态 |
| 网络 | `GET https://api.deepseek.com/user/balance` | **不发起任何请求**，DSH 自己完成鉴权与投影 |
| 新安装默认 | 开 | 开 |
| 别名 | — | `deepseek-official` |

账号入口**不读取、导出或保存 OAuth token，也不使用 `DEEPSEEK_API_KEY`**；请在 DSH 的 设置 → 账号与余额 登录。本插件拿到的是投影后的余额列表，只解析币种与金额并据此显示余额，不保留原始对象。它与其它余额型条目一样不要求本机装有对应模型路由。

### OpenDesign 额度文案

弹层与设置页的两个美元数字按池子命名，**不要**改回通用标签：

- `monthly-balance`（`balances.subscriptionCredits ÷ creditsPerUsd`）→ **套餐余额**（en `Plan balance`）
- `balance`（`balanceUsd`，订阅 + 充值）→ **总额度**（en `Total balance`）

通用 provider 的「月额度剩余 / 余额」保持原样（Command Code 那条确实是月池）。OpenDesign 的 5 小时 / 7 天窗口仍按已用百分比展示，与这两个美元数字互不换算。

### Antigravity（联动项）

`antigravity` **不是本插件登记的 provider id**，也不出现在设置页：本机运行 [`dsh-antigravity-acp`](https://github.com/KouzakiUmi/dsh-antigravity-acp)（包名 `dsh-bundle-antigravity-host`）时，它注册的 Cordis 服务 `agyQuota` 已经算好套餐额度快照，本插件只读那份快照并折算成同样的条目形状，并入 `quota()` 视图与 `subusage_quota` 报告。

- 换算：它报**剩余**（`remainingPct` 或 0..1 的 `remainingFraction`），对外 `percent` 是**已用** = 100 − 剩余；`window` / `name` 归到 `5h` / `week` / `month` / `day` / `period`；组名进 `groupLabel`（它说明这条百分比约束哪批模型，单组也保留）。
- `disabled` 窗口表示「此窗口对本账号不可用」，**不等于**已达限额，因此不产出窗口、只在 extras 里留一条说明；没有比例就不产出窗口（绝不补 0）；接口只给比例不给绝对值，所以不写 `detail.used/limit`。
- AI Credits 余额进 `balance`（单位 `credits`）、套餐名进 `plan`；刷新失败但手里有上次成功数据时由提供方插件标 `stale`，本插件照实报 `freshness: "stale"`。
- 取数有 15 秒独立预算，请求本身带取消信号（`AbortSignal.any([controller.signal, timeout])`，随 `dispose()` abort）；对方的报错只影响这一条（`state: "error"`，`error` 截断到 200 字符）。**默认（不点名）全量查询遇到超时静默**——对方冷启动可达 45s，一次超时不该在默认报告里顶出一条 error（它的缓存随后会被补上）；**点名**查询超时仍如实报。插件不在场时顺带查询里不出现该条目；**点名**却检测不到服务时回一条可执行说明，而不是空结果。

### Trae（联动项）

`trae` / `trae-global` / `trae-enterprise` **不是本插件登记的 provider id**，也不出现在设置页。本机运行 [`dsh-connect-trae`](https://github.com/dingminhua/dsh-connect-trae)（v4.3.0，非本仓库项目）时，它把三个 tab 的用量挂在**本机 web 服务器**的只读路由上（它自己的卡片读同一条）：

```
GET /plugins/dsh-connect-trae/usage?region=<cn|enterprise|ai>
```

本插件从 Cordis 的 `webServer` 服务取回环 origin（`getOrigin()`，如 `http://127.0.0.1:3080`），带上自己的 `Origin` 头请求这条路由——对方只校验 loopback，所以这个头既能过校验，也不依赖「没有 Origin 头」这种默认行为。**不读它的凭据、不自己请求 Trae 上游、不写设置**：登录态、设备号、token 刷新与并发都由它负责，本插件只换算它的答案。

- `region=cn` → `trae`：积分制。响应里的 `credits.total / consumed / available` 是积分包的**合计上限 / 已用 / 余量**（绝对值），所以 `period` 窗口的 `percent` = `consumed / total`，`detail` 带 `used / limit / remaining`（单位 `credits`）。**`total = 0` 时不给百分比**，只报余量。余量进 `balance`；Work 积分 / 通用积分两个桶与积分包到期提醒（对方四档：已过期 / 24 小时 / 3 天 / 7 天）进 `note`。
- `region=ai` → `trae-global`：订阅制，**没有积分字段**（对方文档如此），只有 `payStatus`：档位（`payIdentityStr`，如 `Free` / `Pro`）进 `plan`，试用期与「未订阅付费套餐」进 `note`。
- `region=enterprise` → `trae-enterprise`：**只在真有企业版账号时才算一块面板**（`accounts[].enterprise`）。企业租户额度对方自己也读不到（所有租户额度端点 404），所以只写一条说明；**绝不把个人积分挪到企业标题下**——那会让人以为租户余额就那么点。
- 通道语义：HTTP **404 = 插件没装**（静默缺席）；其它非 2xx、非 JSON、带 `{ error }` 信封或超时，才折叠成该条目自己的 `state: "error"`。取数结果缓存 **60 秒**，`refresh: true` 绕过。
- 点名：厂商名 `trae` 命中三块面板（与 `zai` / `ark` 同口径，全部去读、缺席静默）；点名 `trae-global` 这类**单块**名字却没登录时，回一条可执行说明。

> 契约来源：该插件 `lib/index.d.ts` 的 `TraeWebUsage`、`TraeWebCredits`、`TraeWebPayStatus` 与 `lib/index.js` 里的 `traeWebUsage()` / `registerTraeUsageRoute()`（本机安装版本 4.3.0）。它是第三方插件，路由与字段若在升级中改动，本插件会以「无法识别的响应用」或该条目的 error 呈现，而不会编造数字。

### Command Code 账户

Command Code 的凭据由提供方插件 `@mars-sea/dsh-commandcode-provider` 管理，本插件只读继承，并在**两处**提供同一份账户切换：药丸弹层底部，以及 设置 → 订阅用量 的 Command Code 用量面板（同一个控制器、同一个组件、与提供方插件设置页同一开关）。「自动轮换」时仍显示默认账户（顶层 Key）的用量，不跟随轮换中的实际服务账户；提供方自定义 `apiBase` 也不跟随。月总额按已知套餐快照推算，未知套餐只显示月剩余；月池耗尽不代表已购 / 赠送池不可用。

账户多时账户列表折进可展开区，列表自身限高滚动（240px），弹层高度不随账户数增长；折叠标题直接给出**现在是哪一个账户**（固定账户写「账户名 · 使用中」，自动轮换写「自动轮换」）与选项数量。切换后设置页用量面板与药丸一起改看所选账户的额度。

**一次读全部账户**：`subusage_quota` 与 Host 的 `subUsage.quota()` 在涉及 Command Code 时会**按账户各返回一条**（`account` / `accountActive` / `accountMode`，当前激活的排最前），数据来自同一批计费接口、按「路由 id + 账户引用名」各占一份缓存（TTL 60 秒），因此读全部账户不会把彼此的缓存顶掉。账户清单读自提供方插件的 `llm-commandcode` 设置（带 `redactSecrets` 只读非秘密字段、不额外请求接口）：默认账户 + 各额外账户（id 取凭据引用名，label 空白回退 `Account N`），无凭据引用、重复引用与登记未完成的账户不列——与提供方插件 `slots()` 的唯一差异是**不支持「字面 Key」账户**（`accounts[].apiKey` 直接写在提供方配置里的那种）：那种 Key 按引用名解析不到，列出来只会选中即「未配置凭据」，所以设置页与工具两处都跳过它；代价是**把这种账户固定为 `activeAccount` 时本插件读不到该 id，会按「自动轮换」显示**（提供方插件的设置页仍会显示它被固定）。

### 网络端点

| 用途 | 域名 |
|---|---|
| 各订阅 / 余额接口 | `api.deepseek.com`、`open.bigmodel.cn`、`api.z.ai`、`api.kimi.com`、`opencode.ai`、`api.siliconflow.cn`、`openrouter.ai`、`api.synthetic.new`、`nano-gpt.com`、`api.novita.ai`、`api.hyperbolic.ai`、`api.deepinfra.com`、`api.chutes.ai`、`ollama.com`、`ai-gateway.vercel.sh`、`zenmux.ai`、`api.minimax.io`、`api.minimaxi.com` |
| 会话 / 登录文件型 | `platform.xiaomimimo.com`（MiMo 用量与登录）、`api.commandcode.ai`（Command Code 计费）、`cli-chat-proxy.grok.com`（SuperGrok 计费代理）、`grok.com`（credits 格式失败时的 GetGrokCreditsConfig gRPC-web）、`chatgpt.com/backend-api`（Codex 订阅用量）、`amr-api.open-design.ai`（OpenDesign 控制台额度：先读 `/v1/workspaces/current` 取 workspaceId，再读该工作区的 coding-plan-usage） |
| 火山方舟管控面 | `open.volcengineapi.com` |
| 自建网关 | 用户自填的 LiteLLM proxy 地址（只去掉 `/v1` 这类版本段，其余路径原样保留） |
| 复用宿主账号请求链 | `deepseek-account`：调用本机 `deepseekAccount` 服务，由 DSH 完成鉴权与余额请求；宿主服务可能按自身配置联网，本插件不另发 HTTP、不复制 token |

除上面这些，插件不访问其他网络地址；MiMo 自动登录会额外打开官方平台页面，由你在该页面自行完成登录。
