# 更新记录

以下按发布版本保留当时的功能与验证记录。旧版本的导航、登录方案及兼容性描述不代表当前行为；当前使用方法见 [README](../README.md)。

## 0.10.0：扩展至 30 条提供商、额度查询 API 与 UX 三改

> `0.9.0`（火山方舟首次接入与 SiliconFlow，npm 已发布）之后累积的改动都记在本节；火山方舟这一条线上后续做的扩展也并入本节。

- 新增三个 provider：`ark-coding-plan-cn`、`ark-agent-plan-cn`、`ark-coding-plan-byteplus`。**id 必须与官方插件 `@volcengine/ark-plan-api` 注册的路由逐字一致**（否则选中方舟模型时药丸不会出现），三者一律 `defaultEnabled: false`，需手动开启。
- 额度走管控面 OpenAPI：`POST https://open.volcengineapi.com/?Action=X&Version=2024-01-01`（BytePlus 走 `ark.ap-southeast-1.byteplusapi.com`）。Coding Plan 走 `GetCodingPlanUsage`（未收录于官方 API 概览，由官方 ark-cli 与多个第三方实现确证可用），Agent Plan 走有官方文档的 `GetAFPUsage`。
- 鉴权是火山通用 HMAC-SHA256 V4 签名，**与这些路由的推理 API Key 不是同一套凭据**：AK 与 SK 必须来自同一个 IAM 用户，三家共用一组 `settings.volc`，继承变量为 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`。签名要点：CanonicalHeaders 块尾换行后与 SignedHeaders 行之间有一个空行、Credential 首段是 8 位日期（不是完整 X-Date）、`host` 必须与实际域名一致、query 用 RFC3986 严格转义（`! ' ( ) *` 必须转义）。
- 窗口语义：Coding Plan 的 `Level ∈ {session, weekly, monthly}`、`Percent` 是**已用百分数 0–100**（0.39% 不会被放大成 39%）、`ResetTimestamp` 是**秒**；Agent Plan 的四个滚动窗口（5 小时 / 日 / 周 / 月）给 AFP 绝对值与 `PlanType`，`ResetTime` 是**毫秒**。Coding Plan 不返回绝对量，`Cap` 字段未在任何来源证实存在，故不显示明细。
- **HTTP 200 且窗口为空是「未订阅」而不是 0% 用量**，界面显式说明；401（签名/凭据）、403（权限或未订阅）、接口不存在三类失败分别给出不同行动项，401 的文案点名「要 IAM AK/SK，不是推理用的方舟 API Key」。
- 设置页新增 AK/SK 双字段凭据编辑（SK 为 password 且从不回显）：两个字段各自「留空表示不修改该项」，清除必须显式确认；只有一半凭据时按未配置处理，不拿半个签名去请求。共享凭据变化会让全部 Ark 条目一起失效，而不只是当前标签页。
- 测试：新增 `tests/test-volcengine.mjs`（签名固定向量与 Authorization 模板、host/SK/Action 绑定、严格转义、两种套餐的窗口解析与未订阅判定、401/403/404 错误映射、AK/SK keep/replace/clear 与半份凭据、共享凭据失效与 TTL 命中、Client 注册与补丁语义）与 `lib/volcengine.js`（零依赖纯函数）。`tests/helpers.mjs` 的子模块绝对路径重写改为遍历列表——否则临时目录里解析不到新增的 `lib` 子模块。`node tests/run-all.mjs` 与 `node scripts/check-manifest.mjs` 全部通过。

### 同版本：火山方舟全面覆盖（arkcli 官方 CLI 路由 + 企业版席位）

- **provider id 对齐官方 CLI**：`arkcli helper configure deepseek-harness` 把 provider 写成 `arkcli-<planType>`（本机实测 `arkcli-agent-plan`，凭据引用 `ARKCLI_AGENT_PLAN_API_KEY`），与旧插件 `@volcengine/ark-plan-api` 的 `ark-coding-plan-cn` / `ark-agent-plan-cn` / `ark-coding-plan-byteplus` 是**两套 id**。现在两条路线并存：`arkcli-agent-plan` / `arkcli-coding-plan` **默认开启**（对齐使用人数最多的安装方式；没配 AK/SK 时会被「没有检测到 API 的默认隐藏」收起），旧的三个保留兼容、label 标注 `legacy plugin` 且默认关闭。`short` 也做了区分（`ARK Plan` / `ARK Code` vs `Ark Agent` / `Ark Coding` / `Ark BytePlus`），避免设置页标签重名。
- **企业版/团队版席位覆盖**：新增 `arkcli-agent-plan-team` 与 `arkcli-coding-plan-team`（默认关闭）。额度挂在席位上，因此是**两步调用**：先 `ListSeatInfos`（带 `Scene`，Agent Plan 企业版 `agent_plan_enterprise`、Coding Plan 企业版 `coding_plan_enterprise`）取 `Result.Data[].SeatID`，再 `GetSeatAFPUsage` 或 `GetSeatInfoUsage` 查该席位。**多个席位时只读第一个，但如实标注总数**（`席位 <id>（共 N 个）`）——不假装看全；账号下没有可读席位时返回明确说明，而不是报错或画成 0%。
- 解析要点：AFP 席位的 `Quota=0` 表示该窗口不适用（不产出行）、`ResetTime` 是**毫秒**；Coding 席位的三个 usage 字段是**已用百分比**字符串、缺字段不产出行。`ShortTermUsage` 的语义在国内文档（"近 5 分钟用量"）与国际站英文文档（"5-hour usage percentage"）之间**冲突**，实现按短周期窗口处理，存疑记在 development.md。
- **按官方 API 契约核实后修正两处（原实现确有缺陷）**：①`GetSeatInfoUsage` **确实带 `Scene` 参数**，Coding Plan 企业版必须传**空字符串**——官方契约 schema、官方 ark-cli 源码与第三方实现三方一致，且传错值（如 `coding_plan`，不带 `_enterprise`）会**静默返回空 SeatID 而不报错**；②它的响应结构**站点间不同**（国际站 `Result.SeatInfoUsage.*`，中国站契约是 `Result.*` 直挂），原实现只认前者，在中国站会读不到数据——现两条路径都试。顺带确认并已兼容：`Quota`/`Used` 在契约里是 number、文档示例里是 string（双解析），`ResetTime` 零用量时可能是 `-1`/`0`（哨兵不输出）。
- 顺带把 volc 分支的签名请求抽成 `call(action, payload)`，个人版与席位版共用同一套签名与错误映射；`ListSeatInfos` 显式带 `PageNum`/`PageSize`（`Filter` 是契约层面的必填字段，即便为空对象也要发）。
- 测试：`tests/test-volcengine.mjs` 增加两段——席位解析（SeatID 列表 trim 并忽略无 ID 行、AFP 四窗口与零配额跳过、Coding 三字段与缺字段跳过、超 100 收敛到 100）与 Host 流程（两步调用、档位与席位标注、无席位时的说明、不回显 SK）。

### 同版本：Codex 真机验证（并修正两处只有真机才暴露的问题）

- 用本机 `~/.codex/auth.json` 的真实 ChatGPT 登录向 `GET https://chatgpt.com/backend-api/wham/usage` 发了一次**只读**请求：**HTTP 200**（token 已 9 天但未过期），`plan_type: "plus"`，`primary_window.window_seconds = 18000`、`secondary_window.window_seconds = 604800`——端点路径、鉴权与窗口命名全部对上。
- **修正 ①（真实缺陷）**：实测 `resets_at` 是 **Unix 秒数**，而实现只接受字符串，导致窗口解析正确、**重置时间被静默丢弃**。现两种形态都认（ISO 串与秒级数字，`reset_at` 同样处理），哨兵 `0` 仍不输出。桩测试用 ISO 串喂数据，所以此前一直是绿的。
- **修正 ②**：响应里的 `plan_type`（套餐档位，实测 `"plus"`）此前没有显示，现作为 `plan` 明细呈现。
- 真机还确认了 `credits: {has_credits: false, unlimited: false, balance: "0"}` 这类形态会被正确门禁掉（不显示成 0 余额）。
- 验证脚本放在 `debug/`（该目录被 gitignore，不入库）；`tests/test-codex.mjs` 增加秒级时间戳、`reset_at`、哨兵 0、`plan_type` 与真机响应形态的回归断言。

### 同版本：提供商覆盖与取舍记档

- 新增 [提供商覆盖与取舍](provider-coverage.md)：列出**当时**已支持的 26 家（含额度类型、鉴权与默认开关；现已扩到 30 条），并首次把**评估后不接入**的厂商与理由写成决策记录——避免同一个候选在没有新证据时被反复评估。
- 不接入的取舍：**Requesty**（只有花费、GET 带 body 属非标准调用、文档 host 不一致）、**Portkey**（单一花费端点且响应结构未证实）、**Groq**（普通 key 查不到，只有浏览器 Cookie 或 Enterprise 路径，与"只用凭据不抓会话"的架构冲突）、**Together / Cerebras**（未发现公开接口）、以及讯飞 / SCNet / CodeBuddy / 无问芯穹 / LongCat / 京东云（官方只有控制台）与已停服的潞晨云。
- 同时记档**已由用户决策跳过**的 Anthropic：接口本身可接入（`/api/oauth/usage` + Claude Code OAuth 登录文件），跳过的理由是地缘政治导致实际用户少——将来用户群变化时这是最值得回头做的一家。

### 同版本：LiteLLM（自建网关）接入

- 新增 `litellm`：`GET {proxyRoot}/key/info` 取 key 自身的预算与花费，再按响应里的 `team_id` / `user_id` 拉 `GET /team/info?team_id=` 或 `GET /user/info?user_id=` 拿更完整的预算视图。鉴权是虚拟 Key 的 Bearer，**与推理同一把**。
- **新增「用户可配置端点」能力**：LiteLLM 的地址是用户自己的 proxy，所以 `settings` 增加 `litellm.baseUrl`（非秘密字段，原样回显与回填），设置页在该 provider 的凭据区多一个「代理地址」输入框。地址经 `litellmRoot()` 规范化：**只接受 http(s)**（`file://`、`ftp://` 等一律按未配置处理），去掉尾部斜杠与常见的 `/v1` 后缀——管理端点在 proxy 根，不处理会拼成 `/v1/key/info` 直接 404；自建子路径（如 `/litellm`）保留。
- 缺地址按**凭据不完整**处理（`subusage/credentials`），给出「在设置里填写代理地址」的指引，并复用既有的行动条入口——而不是静默失败。
- **没有预算上限时不编造百分比**：`max_budget` 缺失或为 0（LiteLLM 用 0 表示不限）时只产出 `extras`，新增 `spend` 类别（标签「已用」/「Spent」）如实显示已用金额。接口不给 `budget_reset_at` 时不显示重置，不把金额渲染成倒计时（沿用调研里 CodexBar 的约定）。
- scoped 视图被拒（403）不影响整体：退回 key 自身的 `info`。
- 测试：新增 `tests/test-litellm.mjs`（地址规范化含 `file://`/非法输入/自建子路径、归一化的预算与无上限两条分支、user/team 优先与 scoped 降级、缺地址的凭据指引、端点落在 proxy 根、Client 的地址回填与补丁提交）。

### 同版本：ZenMux 与 NanoGPT 余额增强

- 新增 `zenmux`：订阅配额走 `GET /api/v1/management/subscription/detail`（`quota_5_hour.usage_percentage` 是 **0–1 小数**，另附 `used_flows`/`max_flows` 与 `resets_at`），PAYG 余额走 `GET /api/v1/management/payg/balance`（`total_credits` + `currency`）。
- **两个端点都只认 Management API Key**，推理 key 不适用——因此继承变量单独命名 `ZENMUX_MANAGEMENT_API_KEY`，并在 README 里给出创建入口，避免用户把推理 key 填进来。两个端点各拿各的：**余额被拒（403）不影响订阅配额**，条目仍是 `ok`；只有余额没有配额时标 `partial`。
- `nanogpt` 余额增强：在原配额请求之外追加 `POST https://nano-gpt.com/api/check-balance`（`{usd_balance}`）作为**增量条目**。注意它的鉴权头是 **`x-api-key` 而不是 `Bearer`**；余额端点失败或字段非法一律静默降级，既不给配额判定添乱，也不显示成 0。
- 测试：`tests/test-aggregators.mjs` 增加 ZenMux 归一化（0–1 小数、flows 明细、ISO 重置、仅余额时 partial、两端点全空才报错）与 Host 端到端（两请求、Management Key、余额 403 降级后仍 `ok`），以及 NanoGPT 余额为增量、缺失/非法不影响配额；`tests/test-new-providers.mjs` 同步 NanoGPT 的请求次数（多一次余额）与「余额端点用 POST + x-api-key」断言。

### 同版本：UX 三改（账户区折叠、待处理排序、计数跳转）

- **药丸里的 Command Code 账户区折叠**：账户多时账户列表会把上方的额度顶出视野。整块改为 `<details>`：标题行直接显示**当前账户 + 选项数量**，展开后的列表 `maxHeight: 240` + `overflowY: auto` 自行滚动——弹层高度不再随账户数增长。降级（提供方插件未运行）同样折起，只留一行说明。
- **待处理的 provider 排到 tab 前面**：读取失败与 Cookie 已过期权重最高（3），额度用尽与即将到期次之（2），数据不完整再次（1）。**「未配置凭据」刻意不计入**——那是用户自己的取舍，默认隐藏就是为收起它们，算进去会让每个还没配的厂商都来抢位置。同档内按登记顺序（显式比较索引），顺序不会自己抖动。排序只影响设置页的 tab 顺序，药丸匹配仍靠 provider id。
- **顶部「X/Y 家数据获取成功」变成跳转入口**：原来是个不可点的 `span`，现在是一枚按钮，点一下切到第一家没读成功的 provider；`aria-label` 说明会跳到哪家、共几家待处理；全部正常时禁用。它仍只表示**数据获取成功**，不代表还有额度。
- 测试：`tests/test-commandcode-accounts.mjs` 增加「账户区折进 details / summary 显示当前账户与数量 / 列表限高 240 滚动 / 降级同样折叠」断言；`tests/test-client-render.mjs` 增加「出错的那家排到最前 + 其余保持登记顺序 + 全部正常时顺序不变 + 计数按钮可点/禁用与无障碍名」断言。跨 realm 的 `PROVIDER_ORDER` 数组不能直接 `deepStrictEqual`（vm 上下文里创建的对象原型不同），这几处统一改用 JSON 比较。

### 同版本：额度查询 API（Agent 工具 + Host 服务）与用量面板内联行动条

- **新增 Agent 工具 `subusage_quota`**：模型可以直接查询各厂商剩余额度与余额，参数 `providers`（限定厂商）与 `refresh`（绕过最多 60 秒缓存）。经 `ctx.inject(["tools"], c => c.tools.register(defineTool({...})))` 注册，`execute` 里取 `ctx.get("subUsage")` 调服务。`package.json` 的 peerDependencies 增加 `@deepseek-ai/dsh-tools`。
- **新增对外只读方法 `quota(request)`**：`SubUsageService` 本来就 `extends TypertRemoteService extends cordis Service`（服务 key `subUsage`），其他插件直接 `ctx.get("subUsage").quota(...)` 即可，不必自己逐个厂商请求。返回 `{ updatedAt, providers: [{ providerId, label, state, windows, extras, coverage, freshness, lastSuccessAt, error? }] }`。
- **刻意不返回 settings 与内部状态**：`keySource` / `apiDetected` / 继承变量名一概不出现——第三方消费者只需要额度，不该知道本机配了哪些凭据。未知 `providerIds` 被忽略；单家失败只影响自己的条目（有测试断言视图里搜不到 `settings` / `keySource` / `apiDetected` 与 Key 本身）。
- **用量面板内联行动条（UX）**：设置页原本「状态在上、操作在下」，出错时得先展开底部「提供商管理」、找到那一家、再展开「连接与凭据」。现在面板在**真正需要处理时**给出行动条：MiMo 未登录/被拒 → 「登录并自动导入」；已过期或 2 小时内到期 → 「重新登录」；其它厂商缺凭据/被拒 → 「配置凭据」（展开该厂商编辑器并滚动过去）。**正常状态不显示**（还有几小时的倒计时不算事件），且凭据编辑仍复用下面那一份，不存在两套字段与两套校验。
- 测试：新增 `tests/test-quota-api.mjs`（视图形状与「不泄露内部状态」、未知 id 忽略、单家失败隔离、工具契约与参数映射、render 文案含未配置/已关闭/限流/缓存/失败原因）与 `tests/test-usage-action.mjs`（行动条判定：缺凭据、凭据被拒、已过期、2 小时/30 分钟档、正常倒计时不打扰、计时不可解析时不编造）；`tests/smoke-host.mjs` 断言 `subusage_quota` 已注册且带 object 根 schema；`tests/test-client-render.mjs` 断言 MiMo Cookie 失效时面板出现行动条、正常状态没有。

### 同版本：六家余额型聚合商与 MiniMax 国际版默认关闭

- 新增六家**余额型** provider（单体 GET + 一个余额数字，与各自推理同一把 Key）：`novita`、`hyperbolic`、`deepinfra`、`chutes`、`ollama-cloud`、`vercel-ai-gateway`。
- **各家单位与形状都不同，逐个显式换算，不做通用折算**：Novita 是 1/10000 USD（`10000` = $1.00）、Hyperbolic 是美分、DeepInfra 的可用余额是 `−stripe_balance`（接口用**负数**表示预付资金，正值代表欠款）、Chutes 给 `{quota, used}` 绝对量、Ollama Cloud 的 `limits.*.usage` 是 **0–1 小数**、Vercel 是十进制字符串。DeepInfra 欠款时单独提示「欠款 X USD」，不把负余额直接画出来。
- **Ollama Cloud 的鉴权是裸 `Authorization`**（不加 `Bearer `），实现里显式覆盖通用 Bearer——照抄别家实现时最容易漏这一点。
- 不编造重置时间：Chutes 与 OpenRouter 的接口都不给重置时刻，因此不输出 `resetsAt`，UI 也不显示倒计时。
- **MiniMax 国际版（`minimax`）改为默认关闭**（中国版保持默认开启）。用户要求：国际版实际使用少，默认收起。至此默认关闭共 15 项、默认开启 9 项（该批次时点；**当前**为 19 / 11，以 `lib/index.js` 的 `PROVIDERS` 为准）。
- 测试：新增 `tests/test-aggregators.mjs`（六家单位换算与边界、`{quota:0}` 不猜比例、Ollama 缺层跳过、DeepInfra 欠款分支、六家端点与鉴权头逐一断言，含 Ollama 的裸 Authorization）。`tests/test-minimax.mjs` 补上「国际版默认关闭 / 中国版默认开启」断言并在测前显式开启；`tests/test-client-behavior.mjs` 的可见 tab 列表移除 MiniMax 国际版，改用 MiniMax CN。

### 同版本：OpenRouter 接入

- 新增 `openrouter`：`GET /api/v1/key` 拿 key 级限额与日/周/月用量（**任意 key 可读**），`GET /api/v1/credits` 拿账户余额（`total_credits − total_usage`，**只对 management / provisioning key 开放**）。
- **余额端点被拒必须静默降级**：普通推理 key 调 `/credits` 会 403（上游文案 `Only management keys can perform this operation`），此时只显示限额与用量，条目仍是 `ok`——不因为附加信息拿不到就把整个 provider 判失败。
- 窗口：`limit − limit_remaining` 算已用比例，窗口名跟随 `limit_reset`（monthly / weekly / daily，未知归通用限额）；免费档没有 key 限额，但 `free_model_daily_requests` 是真实窗口，同样产出日窗口。`limit_reset` 只是周期名而**不是重置时刻**，因此不显示 `resetsAt`，不编造倒计时。
- 默认关闭（新增厂商约定）。
- 测试：新增 `tests/test-openrouter.mjs`（限额窗口与周期名映射、免费档日窗口、余额降级为空 extras、`limit_remaining` 越界不产生负用量、无可用信息才报错、Host 端到端两请求与 403 降级后仍 ok、Client 注册与"追加在末尾"的顺序约定）。

### 同版本：DeepSeek 官方余额

- 新增 `deepseek`：`GET https://api.deepseek.com/user/balance`，Bearer **与推理同一把 API Key**（[官方文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)）。这是当前唯一"主线 provider 也能查余额"的条目，默认开启。
- 余额型（不产出窗口）：金额是**字符串十进制**，取第一条可解析的 `balance_infos` 条目；货币码不合规时只显示金额而不编造单位。`is_available` 为 false 时额外提示"余额不足，请充值"——这是行动项，不是 0 元余额的展示问题。
- 非法或缺失一律报错，不当作 0。
- 测试：新增 `tests/test-deepseek.mjs`（归一化、余额不足提示、多币种与非法值、Host 端到端 Bearer 同 Key 与密钥不回显、Client 注册与余额兜底文案）。
- 顺带把 `PROVIDER_ORDER` 的顺序影响面收敛：新条目一律**追加在末尾**，避免插入位置移动既有索引（本轮插入 Codex 时正是这一点导致三处 `ids[N]` 断言错位，已改为按 id 字面量断言）。

### 同版本：OpenAI Codex（ChatGPT 订阅）接入

- 新增 `openai-codex`：`GET https://chatgpt.com/backend-api/wham/usage`，凭据是 **Codex CLI 的 ChatGPT 登录**（`$CODEX_HOME/auth.json` 或 `~/.codex/auth.json`），不是 `OPENAI_API_KEY`。
- 凭据门禁：`auth_mode` 必须是 `chatgpt`；API Key 模式（或只有 `OPENAI_API_KEY` 的文件）按**未配置**处理并给出 `codex login` 指引——API Key 取不到订阅额度，不拿它冒充订阅凭据。与 Grok 一致：**只读、不保存、不刷新 token**（token 由 Codex CLI 轮换，第三端刷新会互相顶掉），并拒绝一切本地凭据补丁。
- 窗口：`rate_limit.primary_window`（5 小时）/ `secondary_window`（7 天；免费档是 30 天，按 `window_seconds` 判断窗口名），各含 `used_percent` 与 `resets_at`。HTTP 200 但无窗口显示「未检测到订阅额度窗口」，不画成 0%。`credits` 只在真正报告可用余额时显示（`has_credits=false`、`unlimited`、余额 0 都不显示）。
- 默认**开启**：它对齐的是 DSH 内置的 `openai-codex` 路由，没登录时会被「没有检测到 API 的默认隐藏」自动收起，不会干扰未使用 Codex 的用户。
- 测试：新增 `tests/test-codex.mjs`（登录文件解析门禁与 `CODEX_HOME` 覆盖、窗口命名与限流、credits 门禁、Host 端到端 Bearer 请求与拒写凭据、no-key 指引、Client 注册）。`tests/test-client-render.mjs` 里原先把 `openai-codex` 当作"不支持的路由"的用例改用 `vrtx-gemini`（本机存在但本插件不覆盖），保留该覆盖意图。

### 同版本：SiliconFlow（硅基流动）余额型接入

- 新增 `siliconflow`：`GET https://api.siliconflow.cn/v1/user/info`，**与推理是同一把 API Key**（Bearer），返回账户余额（取 `totalBalance`，缺省回落 `balance`，两位小数，单位按该平台的人民币计价标为 CNY）。
- 这是本插件第一个**纯余额型** provider：余额没有上限也就没有百分比，因此**不产出额度窗口**，只产出 `extras` 的 `balance`。为此给药丸加了余额兜底文案——无窗口但有余额时显示「余额 X CNY」，而不是此前一律显示的「暂无额度数据」；既无窗口也无余额（或只有套餐名）时仍回落到明确占位，不出现空白药丸。
- 非法或缺失余额一律报错，不当作 0。
- 默认关闭（新增厂商约定）。
- 测试：新增 `tests/test-siliconflow.mjs`（归一化兜底与非法值报错、Host 端到端 Bearer 直连与密钥不回显、Client 注册与余额兜底文案）；`tests/test-client-render.mjs` 的药丸断言按新语义更新并补上「无窗口无余额仍占位」的反向用例。

### 同版本：SuperGrok 订阅用量接入

- 新增 `xai-oauth`（SuperGrok / X Premium 订阅）：经 dsh-grok-kit / Grok CLI 共享的 OAuth 登录直连官方 Grok CLI 计费代理 `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`（转发后端 `GetGrokCreditsConfig`），显示统一用量池已用百分比（`creditUsagePercent`，剩余 = 100 − 已用）、周期与重置时间（`currentPeriod`，通常每周）、套餐名与已购加量余额（美元，`prepaidBalance`）。
- 请求头对齐官方 CLI：`X-XAI-Token-Auth: xai-grok-cli`（`GrokComConfig.token_header` 的取值是字符串而非布尔）、`x-userid`（登录文件 `user_id`，缺失时回退 JWT `sub`）、`x-grok-client-version`；套餐名并行拉取 `GET /v1/settings` 的 `subscription_tier_display`（失败回退 billing 响应的 `subscription_tier`）。
- 凭据只读共享登录文件：优先 `~/.grok/auth.json`（槽位 `https://auth.x.ai::…`），回退 dsh-grok-kit 旧版 `~/.dsh/.xai-oauth-auth.json` 信封；不保存凭据、不自行刷新 token（避免与两端的 refresh-token 轮换互相顶掉），不接受手动 Key（API Key 路线取不到订阅周池）。缺凭据时提示在 Grok Kit 登录或运行 `grok login`。
- 响应两代形态兼容：新形态 `creditUsagePercent` + `currentPeriod`；旧形态按 `monthlyLimit`/`used`（美分）折算比例并归月账期窗口；`{}`（proto3 零值）解码为 0，无上限不折算。未知结构报错不猜额度。
- 测试：新增 `tests/test-supergrok.mjs`（归一化两代形态/周期归类/套餐两级回退/余额边界、登录文件各形态与槽位优先级、请求头、并行拉取、错误映射、缓存与 token 轮换失效、managed 边界）；`tests/test-contract.mjs` 补 `xai-oauth` 刷新契约与 managed 拒写断言；`tests/test-client-render.mjs` / `tests/test-client-behavior.mjs` / `tests/test-host-service.mjs` 同步提供商计数与索引。`node tests/run-all.mjs` 全部通过。

## 0.10.2：MiMo 登录入口修复、输入净化与凭据指引

- **修好 MiMo 的登录入口**：点「登录并自动导入」原来打开的是站点**首页**，而首页不会触发登录，用户还得自己点进控制台找登录按钮。现在直接落在**控制台套餐页**（`platform.xiaomimimo.com/console/plan-manage`）——那也正是读取 `tokenPlan/detail` 与 `tokenPlan/usage` 的页面；控制台历史上出现过 502（仅首页可用），因此保留回退到首页。设置页里那个「仅打开官网」的手动入口也一并改到控制台页。
- **输入净化覆盖到全部输入框**：AK/SK 之外，**普通 API Key** 与 **LiteLLM 代理地址**此前也把「含控制字符」当成错误**直接拒绝保存**——从网页或控制台复制时常带尾随换行，于是填了也存不上；**Z.ai 的组织/项目**则会把内部换行原样存进去。现在统一走 `stripInvisible`（剔除空白与零宽字符），只有**全空白**才拒绝（否则会把「清空」误当成「替换成空值」）。新增 `tests/test-input-sanitize.mjs` 覆盖这六个输入框。
- **保存后如实反馈**：火山 AK/SK 保存时若「你填了值、但实际没写进去」，界面直接给红色提示并指出改用环境变量，而不是笼统回一句「已保存」。
- **新增[凭据获取指引](credentials.md)**，并接到 README（Quick start / Configuration / Troubleshooting）与设置页里需要用户先去别处操作的凭据区（火山 AK/SK、MiMo、普通 Key、LiteLLM、Z.ai 团队档）。内容含：每类凭据的**官网入口、环境变量名、界面填入位置**；火山子用户的**创建与授权完整清单**（`ArkReadOnlyAccess` + 「限制到项目资源」选否，以及 `AccessKeySelfManageAccess` / `AccessKeyFullAccess` 的取舍）；一张**报错对照表**。设置页的火山凭据区还加了直达控制台「API 访问密钥」的链接。
- **Agent Plan 的额度按额度线分成两组展示**。官方口径（[套餐概览 · 额度刷新规则](https://ark.volcengine.com/region:cn-beijing/docs/agent-plan-personal-plan-overview#%E9%A2%9D%E5%BA%A6%E5%88%B7%E6%96%B0%E8%A7%84%E5%88%99)）里，**日限额只覆盖视觉模型、语音模型与 Harness**，而 5 小时 / 周 / 月属于文本 / 向量模型——两条不是同一条额度线，混排会让人把「日 50K > 周 35K」读成插件算错。现在按额度线分组显示（个人版与席位版共用同一组窗口定义），日限额排在最后并标注适用范围。**Coding Plan 不受影响**：官方只给 5 小时 / 周 / 月三条，本就是同一条线。
- **药丸的窗口短标签改成中文**：`W` / `M` / `D` 这类缩写要用户自己猜；现在走 locale，中文显示「周 / 月 / 日 / 5时」，英文用 `1w` / `1m` / `1d`。

## 0.10.1：RPC 版本窗口期兼容、按路由判定默认可见性、设置页排序

- **症状**：升级插件后只刷新页面（没重启 DSH）会看到 `typert gateway: subUsage/refresh: wire field "request" failed boundary validation`，界面一片空白，看不出该做什么。
- **根因**：Client bundle 刷新即生效，而 Host 要重启才换代码。新版 Client 会带着 Host 还不认识的 provider id（例如本批次新增的 `arkcli-*`）调用 `refresh`，而 Host 的 `parseQuery` 对未知 id **整体拒绝**；`save` 的 `providerId` 同样如此。于是「客户端已更新、Host 未重启」这个窗口期**必然**报错，且报错来自网关的边界校验，信息对用户毫无用处。
- **修法**：`refresh` 的未知 id 改为**过滤并单独列出**，由 `refresh` 回一条可读的 `subusage/unknown-provider` 条目（「本机运行中的 Host 版本较旧，不认识该提供商；重启 DSH 后生效」），其它提供商照常刷新；`save` 的未知 provider 放宽到 `persist` 里拒绝，让用户拿到同样的可读原因。**形状**错误（`providerIds` 非数组、缺 `force`、空 `providerId`）仍照旧拒绝。
- 契约测试同步更新：`tests/test-contract.mjs` 断言过滤行为与 `unknown` 列表，`tests/test-host-service.mjs` 断言那条可读条目。
- **默认可见性改为按「本机实际装了什么路由」判定**：provider id 就是路由 id，而路由由提供方插件/CLI 按你**实际持有的东西**写入——`arkcli helper` 只会为真正订阅的套餐写路由。所以只持有 Agent Plan 的账号不再看到默认开启的 Coding Plan。**两种套餐可以共存**，本机两条路由都在时两条都显示，不做二选一。判定是逐个 provider 进行的，且 `configured` 缺失（拿不到路由表）时按「未知」放行，不再谎报「全都没装」把所有标签清空；用户关掉「没有检测到 API 的默认隐藏」时同样不再按路由收起。
- **设置页的提供商管理把已启用的排到最前面**（组内保持登记顺序），不必每次往下翻找自己开了哪几家。


## 0.8.3：Kimi 月度窗口与响应形态兼容

- 修复「Invalid Kimi usage response」：`/coding/v1/usages` 的窗口集合按账户下发，部分账户只返回 `usages.limit_5h` + `limit_month_total`（无 `limit_7d`），而旧代码把 `limit_7d` 当必需字段，对这类 Key 一律判为结构非法。现在 `limit_5h` / `limit_7d` / `limit_month_total` 各自按下发内容成窗；`limit_month_code` 是月池的 Code 份额而非独立预算，不单独成窗。月池是最外层窗口，耗尽时连坐 5 小时与 7 天窗口。
- 旧形态兜底：没有比例池时，用 `limits[]` 中 `window.duration=300` / `TIME_UNIT_MINUTE` 项的 `limit` / `remaining` 反推 5 小时窗口，再用顶层 `usage` 的 `limit` / `remaining` 反推周额度；未知结构仍报错，不猜测额度。
- 测试：`tests/test-cascade.mjs` 覆盖月池耗尽连坐 5 小时、连坐来源标注与反向不连坐；`tests/test-host-service.mjs` 用实测现行响应（`limit_5h` + 月池 + `booster_wallet`）与旧绝对形态断言窗口集合与百分比。`node tests/run-all.mjs` 全部通过。

## 0.8.2：Command Code 账户切换同步控制用量显示

- 药丸弹层内的账户切换不再只影响提供方插件：切换后药丸本体与弹层上方的用量窗口同步改为显示所选账户的额度。显示账户跟随账户区的当前固定项（含初始 describe 发现的固定账户）；选择「自动轮换」时仍显示默认账户（顶层 Key）的用量，弹层标注明确说明不跟随实际服务账户。
- Client store 维护显示账户状态，所有 Command Code 读取（初始读取、刷新、定时轮询、设置页刷新）自动携带；切换账户时旧账户在途数据立即失效并强制重拉。Host 端 `read`/`refresh` RPC 新增可选 `commandCodeAccount` 参数（缺省/空串 = 默认账户），额外账户按其凭据引用名（`apiKeyEnv`）从凭据服务 → 启动环境解析 Key，与提供方插件 `slots()`/`resolveRef` 同一通道；缓存指纹计入账户，不同账户不串缓存，entry 新增 `account` 字段标注所属账户。
- 兼容性：read 的 `request` 参数在两端描述符声明 `acceptsUndefined`，缺参/undefined 按全量默认账户查询处理——旧版 Client bundle（无参 read）与新 Host 共存的窗口期内初始读取优雅降级，而不是整体失败。
- 弹层在用量窗口上方新增「上方用量：{账户}」标注行；账户区提示文案同步更新。设置页 Command Code 帮助文案改为说明显示所选账户的额度。
- 测试：`tests/test-commandcode.mjs` 覆盖按账户解析 Key（凭据服务/环境/缺失/非法引用名）、账户切换不复用缓存、同账户 TTL 命中与 query 校验；`tests/test-commandcode-accounts.mjs` 覆盖 store 显示账户状态、readAll/refresh 携带参数与弹层标注渲染；`tests/test-host-service.mjs`、`tests/test-client-behavior.mjs` 同步 RPC 契约断言，`tests/test-contract.mjs` 的两端描述符比较无需改动即覆盖 read 新参数。`node tests/run-all.mjs` 全部通过。

## 0.8.1：发布渠道修复

- 与 0.8.0 同一功能集（MiMo Cookie 有效期监控、Command Code 药丸账户切换）；0.8.0 已发布 GitHub Release（build-3e929375bf14）但未到达 npm。
- CI 新增 npm 自动发布：GitHub Release 之后用仓库 Secret `NPM_TOKEN` 发布同一构建验证过的 tarball，registry 已有该版本时跳过；手动发布流程保留为兜底。详见 [发布说明](publish.md)。

## 0.8.0：MiMo Cookie 有效期监控与 Command Code 药丸账户切换

### Command Code 药丸账户切换

- Command Code 用量药丸弹层新增「Command Code 账户」区：列出自动轮换、默认账户与各额外账户（label 与 id 规则对齐提供方插件 `slots()`），点击即切换 `activeAccount`，当前项高亮。
- 读写走 DSH settings remote 的 `llm-commandcode` namespace，与 Command Code 提供方插件设置页完全同一通道与 op 形式（固定账户 set；回自动按组合层 base 决定写空串或 unset）。切换即时生效于提供方插件的后续请求，无需重启。
- 账户列表来自 settings describe，不发起任何计费请求；提供方插件未运行或 namespace 不可用时区块降级为「账户列表不可用」，不影响用量显示。
- 药丸与弹层的额度数字仍为默认账户（顶层 Key）的用量，不随切换改变，弹层文案明确说明。切换失败（含 revision 冲突）保留失败原因并回读 Host 实际状态。
- 新增 `tests/test-commandcode-accounts.mjs` 覆盖账户列表解析、activeAccount 判定、mutate 通道、并发拒绝、失败回读与弹层渲染。

### MiMo Cookie 有效期监控

- 官方 MiMo 会话 Cookie 自签发起 **24 小时**有效。自动登录与手动导入都在凭据写入的同一刻开始计时，落盘 `xiaomi.loginAt` / `xiaomi.expiresAt`；自动登录额外参考浏览器观测到的 Cookie 过期时间，取更早者。
- 用量药丸新增凭据时效提示：剩余 2 小时内 ⚠ 黄、30 分钟内 ⚠ 橙、已过期 ✕ 红，文案「Cookie N 后到期 / 已过期，请重新登录」。额度已用尽时仍优先显示额度告警；药丸弹层常驻显示剩余时间与到期时刻。
- 设置页「MiMo 登录与凭据」显示登录时间与剩余生效时间，并说明 24 小时有效期。旧版本保存的 Cookie 没有计时记录，界面明确写「未记录登录时间」，不编造倒计时。
- 倒计时只用于展示：归零不改变凭据可用性，真实失效仍以官方接口返回为准；接口已判定凭据失效时，药丸主文案仍是失败原因，不被倒计时覆盖。计时字段是本地元数据，不是秘密，Cookie 本身不经 RPC 回传，计时则作为非敏感信息随 `settings.xiaomi` 与 entry 的 `cookieExpiresAt` 下发。
- 新增 `tests/test-mimo-cookie-expiry.mjs` 覆盖 Host 计时/落盘/下发/清除/损坏字段与 Client 四档提醒、药丸优先级、弹层与设置页文案；离线布局预览的 MiMo 假数据改为「临近到期」档位。

两项功能均通过离线回归、清单校验与组件预览核对；真实 DSH 实机验收与真实账号在线验证仍待完成。

## 0.7.0：审查修复与新增订阅商

- 新增 `zai-coding`（国际版）、`synthetic`、`nanogpt`：新安装与旧配置升级均默认关闭，即使有环境凭据也不请求用量。可在「提供商管理」手动开启；原有七项的默认值和用户已保存开关保持不变。
- Z.ai 国际版依据[官方查询脚本](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)直连监控接口，区域凭据独立；补齐 `TOKENS_LIMIT` 格式。Synthetic 使用[官方 quotas API](https://dev.synthetic.new/docs/synthetic/quotas)，只读取模型订阅请求池。
- NanoGPT 使用[官方订阅用量 API](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage)，显示每日/每周输入 Token 及试用 Token 池；支持手动填写 `sk-nano-mgmt-…` [Usage only 管理令牌](https://docs.nano-gpt.com/api-reference/management-api)，自动选择只读管理接口。忽略图像池，未开通、缺数据、降级响应不会显示虚假剩余额度。
- 修复额度重置时绕过 `Retry-After`、保存一家凭据导致其他用量消失，以及首次读取失败后无法重新初始化的问题。
- 空状态自动展开提供商管理；刷新错误始终在工具栏下可见；药丸弹层适应窄屏和深浅主题。
- Host/Client 必须一起更新。已做离线回归与浏览器布局检查，未使用真实账号在线验证。详见[审查记录](code-review.md)。

## 0.6.0：提供商管理与默认隐藏

- 设置 → 订阅用量底部新增默认折叠的「提供商管理」：七个提供商/区域独立开启或关闭，立即持久化；关闭后隐藏用量标签与药丸，停止订阅用量请求，不删除凭据、不修改模型路由。
- 新增「没有检测到API的默认隐藏」开关，默认开启。按实际 Key / MiMo Cookie 是否存在判断，不以模型路由是否注册或接口是否成功判断；认证失败、网络错误仍展示异常。
- 管理区始终列出全部提供商：每家开关与「连接与凭据」在同一卡片，就地展开编辑；MiMo 为「登录与凭据」，Command Code 为只读凭据来源。移除跨区域「配置」跳转，隐藏/关闭条目仍可就地编辑。
- 上方只显示用量，查看用量与正在编辑的提供商独立，切换用量不丢失草稿；保存结果和错误在管理区就地反馈。关闭自动隐藏后，无凭据条目恢复指引，手工关闭的提供商不会被自动重新开启。
- 开关保存与凭据保存互相隔离，脏草稿期间锁定开关，多窗口使用 revision 防止覆盖；仅改变默认隐藏不清除 Host 用量缓存。
- 所有导航与套餐选择改为按钮，窄屏自然换行，整个设置页不使用下拉列表。
- **Host 与 Client 必须一起加载新版**。本地 link 安装直接指向工作区；磁盘更新不代表正在运行的 Host/Client 已重载，必要时重启 DSH。在线账号与真实应用界面仍需验收。

## 0.5.0：MiniMax 订阅检测

- 新增 `minimax` / `minimax-cn`，分别继承 `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`，也可在设置中保存独立的订阅 Key。区域之间不自动尝试或转发 Key。
- 直连对应区域的 `/v1/token_plan/remains`，只显示 `general` 或旧版 `MiniMax-M*` 编程池，忽略视频/图像池，不累加共享额度。
- 显示短周期和周已用百分比及重置时间；优先采用 `remaining_percent`，计数明细按[官方 CLI 消歧规则](https://github.com/MiniMax-AI/cli/blob/main/src/utils/quota.ts)校准，无法匹配时只显示百分比。旧版无百分比响应按剩余计数解释。
- 无上限、未报告或零总计且无百分比的窗口不绘制，标记部分数据；没有可绘制窗口时额度未知。不推断套餐名称，周加量不折算额外百分比。
- 设置导航扩展为七个区域条目，内部宽度 ≤699px 时切换选择框。
- **Host 与 Client 必须一起更新**；未执行在线账号验收或安装。接口参考：[官方 Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq)、[官方 CLI 端点](https://github.com/MiniMax-AI/cli/blob/main/src/client/endpoints.ts)。

## 0.4.1：补齐 Command Code 月额度

- 显示月额度剩余，并按已知套餐总额计算月已用百分比和已用/上限；例如 GOAT 总额 70、剩余 55.86，显示已用 14.14 / 70（20.2%）。
- 套餐及账期来自 `/alpha/billing/subscriptions`，失败时可回退 credits 内的 planId；没有账期时不编造重置日期。
- 月总额是[提供方插件套餐表](https://github.com/Mars-Sea/dsh-commandcode-provider/blob/main/src/capabilities.ts)的快照，不是计费接口直接报告的硬上限；未知套餐只显示剩余金额并标记部分数据。套餐变更后需核对更新。
- 月余额不包含已购/赠送余额；月池耗尽不据此连坐周/5小时窗口。
- 修复非法重置日期导致整包失败，以及旧配置中的 Command Code 手动 Key 绕过托管凭据来源的问题。
- 修复 MiMo 普通刷新/缓存中的接口 Cookie 回显；脱敏正确处理分号后空格和带引号的值。
- 修复 Netscape Cookie 导入：兼容注释、`#HttpOnly_` 域前缀及 TAB 末列空值，仍严格过滤外域。
- MiMo 登录只锁定本厂商的手动导入/清除，不再阻止其他厂商更换 Key，也不产生实际未执行的待清除提示。

## 0.4.0：Command Code 用量显示

- **支持 Command Code**：该路由由另一个插件 [`@mars-sea/dsh-commandcode-provider`](https://github.com/Mars-Sea/dsh-commandcode-provider) 注册；本插件显示其 5 小时 / 每周 / 月额度池、重置时间、套餐（planId）、月剩余与已购 + 赠送余额，周窗用尽会连坐 5 小时窗口。
- **快速直连刷新**：不消费提供方插件的用量服务（它按账户逐个串行多端点、超时预算长，作为药丸来源太慢），改为自读同一凭据后并行直连 `/alpha/billing/credits` 和 `/alpha/billing/subscriptions`（各 10 秒超时）；不读取请求统计、不串行遍历账户。
- **同一凭据来源**：凭据服务 `COMMANDCODE_API_KEY` → 启动环境 → `~/.commandcode/auth.json`（`cmd login` 写入，解析方式与提供方插件一致）。本插件**不保存** Command Code 凭据；Key、登录与多账户在 设置 → Command Code 管理。
- **已知限制**：多账户轮换或固定 `activeAccount` 时显示默认（顶层 Key）账户的额度，可能与实际服务账户不同；提供方插件里自定义 `apiBase` 不会被跟随。
- **五等宽导航**：设置页厂商导航改为五等宽单行，窄内容区（≤499px）切换为选择框。

**两端必须同时更新**：旧 Host 会拒绝含 `commandcode` 的刷新请求。

## 0.3.0：按钮式凭据与 MiMo 自动登录

- **凭据按钮**：默认只展示当前来源；通过「更换 / 清除」进入编辑，再保存或取消，不再使用「保持 / 替换 / 清除」下拉菜单。
- **自动登录导入**：点击「登录并自动导入」，使用隔离的临时 Chrome 窗口完成官方登录，由 Host 验证并保存必需 Cookie。
- **原生菜单对比度**：剩余套餐/provider 选项显式配对系统前景和背景，避免深色界面出现白底白字。

### 延续的设置与可靠性改进

- **五等宽导航**：`Z.ai / Kimi / MiMo / OpenCode Go / Command` 单行显示，窄内容区改成选择框，不出现换行。
- **用量为主**：凭据与帮助折叠；顶部提供刷新当前/全部，保存按钮仅出现在编辑区。
- **共享刷新**：按厂商缓存与合并在途请求，药丸和设置页共享结果，活跃厂商每分钟检查更新。
- **两条状态轴**：数据获取成功不等于额度可用；额度不足、认证失效、缓存和部分数据均有独立说明。
- **准确限额**：原始比例决定是否限流，不把 99.5% 提前当作 100%；较长周期限额才向内层窗口连坐。
- **凭据来源**：可选择继承或自定义；读取结果不再回传完整 Key/Cookie。
- **编辑保护**：按厂商增量保存，未保存编辑不被刷新覆盖；配置版本检查防止多窗口旧表单覆盖新配置。
- **MiMo Cookie 验证**：支持标准串、多行 KV、成对 name/value、TAB 清单和 JSON 导出；解析失败保留原文，不再失焦自动破坏输入。
