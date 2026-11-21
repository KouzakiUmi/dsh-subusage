# dsh-subusage 维护约定

## 目的与边界

在 DSH 对话输入区显示当前模型提供商的订阅额度或余额，并提供设置页与只读 `subusage_quota` 工具。插件不注册模型路由；各订阅的凭据、额度单位和账号边界保持独立。功能与支持范围见 [README](README.md)，接口与验证说明见 [开发文档](docs/development.md)。

## 结构与设计

- `lib/index.js` 是 Host 实现，负责凭据解析、额度查询、缓存、设置持久化和远端接口；公开设置不得包含秘密。**秘密落盘加密**：`lib/secret-box.js` 用 AES-256-GCM 加密 `~/.dsh/dsh-subusage.json` 中的秘密值（`keys[id]`、`instanceSecrets`、小米 `xiaomi.cookie`/`xiaomi.renewal`、火山 AK/SK），封套 `enc:v1:<iv>:<tag>:<ct>`，32 字节随机密钥存 `<config>.key`（0600）；旧明文值读取兼容并在下次保存自动加密，解密失败按空、密钥文件损坏抛 `subusage/key-corrupt`。只有用户输入与登录得到的秘密加密；凭据引用名（keyRefs/credentialRefs/env 名）与环境变量来源不存值不加密。回归见 [test-secret-storage.mjs](tests/test-secret-storage.mjs)。
- **Provider 归一化模块化**：全部归一化函数按形态分入 `lib/providers/{shared,subscriptions,balances,session,newapi}.js`（shared 是 `createWindowApi` 通信面）。模块只经参数 `api`（含 failure / windowRow / windowKindFromSeconds / windowExtrasResult / cascadeRateLimited / numeric / linkedProviders）与宿主通信，不直引 DSH 核心包；纯计算模块（credit-packages、connect-usage 的 accountMetadata）可相对直引。`lib/index.js` 保留同名薄包装器（`export function normalizeX(args, api = windowApi) { return mod.normalizeX(args, api) }`）；默认参数只在缺省时求值一次，透传 `now` 等时间实参不得在调用处重写。新增内置 provider：一个模块文件 + `PROVIDERS`/设置管线注册 + Client `PROVIDER_META`/`PROVIDER_ORDER` + go-panel 别名表 + 计数断言同步。架构分层与扩展路径见 [docs/architecture.md](docs/architecture.md)。
- `lib/client.js` 是 Client 实现，负责设置页、药丸和客户端数据订阅；不引入 Node.js 模块。设置页「自定义连接」区块（`ConnectionsBlock`/`InstanceEditor`/`RouteBindingsBlock`）提供连接实例 CRUD、四态探测向导（测试连接不保存，请求携带 `adapterId`）、映射编辑器（探测响应树**点选映射**自动生成 JSON Pointer + 14 个手写字段兜底 + mappingLock 逐字段锁；点选与锁定不废弃当前探测结果）、DisplayProfile（primaryMetric/hiddenElementIds）与 Recipe 导入导出；配套 RPC `subUsage/getCatalog|detectInstance|exportRecipe|importRecipe`（export/import 保留直连位置参数兼容），两端 method/codec 清单由 `test-contract.mjs` 比对。点选映射端到端回归见 [test-mapping-picker.mjs](tests/test-mapping-picker.mjs)（有状态 React 桩走真实编辑器路径）。
- **newapi 一等适配器**（New API / One API 站点入口）：`lib/adapters/declarative/newapi.js` + `lib/providers/newapi.js` 的 `classifyNewApiUsage` 纯核心共享，两路归一化不漂移。字段映射与单位换算（500000 quota = 1 Credits）内置，编辑器对 `draft.adapterId === "newapi"` 隐藏映射编辑器并显示内置提示（DisplayProfile 保留）；`baseUrlMode: "newapi-root"` 声明站点根归一（`recipeNormalizedBaseUrl`，runtime 与探测共用，剥末层 `/v1`/`/api`）；探测签名 `lib/detection/recipes.js` 的 New API 分支排在 openai-credit-grants 之前（有限令牌三元组与 OpenAI grants 同形，无信封判据会把 quota 当 USD），`code:false` 信封按认证拒绝。表单占位符一律本地化并说明格式（`text("如 X", "e.g. X")`），不留裸英文示例。回归见 [test-newapi-adapter.mjs](tests/test-newapi-adapter.mjs)。
- **设置页视觉系统**：设置页（`SubusageSection` 及其子区）只用 `lib/client.js` 里的 `UI_*` 常量与 `ui*` 原语（开关、分段选择、分组列表、设置行、绑定编辑器、提示条），不另写散落的边框/按钮内联样式；中性色由 `currentColor` 派生，强调色同 `INFO`。悬停/聚焦/禁用态由根节点内渲染的 `SETTINGS_CSS`（作用域 `.sus-root` / `.sus-editor`）提供，CSS 文本不得含 `> & " <`（离线预览会转义）。原语是普通函数调用而不是组件元素，测试按 props 断言；`role="switch"` 的数量、`aria-label`、`aria-pressed` 和按钮文字是测试契约。新增 `useState` 只能追加在已有 Hook 之后（`test-client-render.mjs` 按下标预置状态）。离线视觉检查：`node scripts/render-ui-preview.mjs 530 <provider> dark|light [credentials]` 生成 HTML 后用浏览器截图。
- **`lib/go-panel.js` 是 DSH Go 原生面板**（纯函数、无 IO）：`package.json` 的 `dshGo` 清单声明 `panels.usage`（`session.tab`，对话详情「插件」页签），Host 经 `ctx.inject(["dshGo"], …)` 调 `ctx.dshGo.panel` 注册视图/数据/刷新动作。药丸在 Go 岛内不注册（Client 检测 `data-dsh-go-island` 后跳过 `conversation.input.right`，桌面行为不变）。当前模型按官方投影从 `model/selection` + `request/header` 还原，`ROUTE_USAGE_ID` 与 Client `ROUTE_PROVIDER_ALIAS` 同表（test-go-panel.mjs 逐键比对，改一处必须改两处）。数据走 `service.quota()` 缓存：60 秒轮询、会话事件即时重推、刷新动作 `force`。命中卡与池收窄与药丸同口径（含「遥测先归属再采信」，见 Magpie 一节）。视图只用声明式组件与 `data.*` 绑定，窗口/附加行各截断 8 条。
- **`lib/quota-entry.js` 是统一 wire 契约（QuotaEntry）的唯一事实源**：所有 provider/联动/聚合器只喂数据——每个额度元素自己声明 `order`/`label`/`amount.unit`；状态推断、覆盖率、阈值告警、布局、i18n、弹层密度由管线与渲染端口统一负责。元素类型 `window`（百分比窗口）/ `amount`（余额·附赠·钱包·套餐·花费）/ `package`（额度包）/ `plan` / `status` / `note`，组合维度是「账户 × 池 × 元素」。出边界统一 `canonicalizeEntry()`：`ofmAccounts`→`linkedAccounts` 折叠、quotas↔windows/extras 双向补齐、恒为数组。**`quotas` 在场即权威**（含 `[]`）：数组存在就按它派生 legacy，整体缺席才从 windows/extras 转。元素 `id` 稳定身份；`poolScope:"independent"` 只标真独立预算（Antigravity，groupLabel 不自动升级）；`amount.unitId` 是聚合键（按 `unitIdOf` 同义归一，未知单位不猜）；`componentOf` 元素是总额分项、合计跳过；`diagnostics[]` 留规范化丢弃/降级记录。完整契约见 [docs/quota-entry.md](docs/quota-entry.md)。
- **一体化额度查询与药丸显示平台**（架构见 [研究报告](docs/unified-quota-platform-report.md)）：`lib/quota-entry.js` 扩展 `subject`（`key | user | group | seat | account`）与 `aggregation`（`balance: allow | forbid`），`canSumBalanceElement`/`sumAccountBalances` 阻断同用户多把分组 Key 的共享钱包重复累加；`lib/http/` 提供 RFC 6901 JSON Pointer、白名单转换器、安全 URL 归一（禁止公网明文 HTTP、拦截跨源重定向、保留反代子路径与 `/v1` 去重）及只读执行器；`lib/credentials/` 封装统一凭据解析链（内置 provider：`routeEnvs` → `keyRefs` → `builtinEnvs` → `manualSecret`；**自定义实例不含 routeEnvs**，只有 `credentialRefs` → `builtinEnvs` → `manualSecret`——路由绑定只决定药丸归属，不把别的路由的 Key 借给实例）与只读鉴权头注入；`lib/adapters/declarative/` 提供 `sub2api`、`litellm` 与 `custom-http` 声明式适配器；`lib/detection/` 实现 4 态自动探测（`identified` / `needs-review` / `auth-required` / `unsupported`）、数值守恒与五大歧义检测、`mappingLock` 锁定保护及 `sanitizePreview` 预览脱敏；`lib/platform/` 管理 `ConnectionInstance`、`DisplayProfile`（含语义护栏与缺失目标优雅降级）、`RouteBinding`、动态目录及 Recipe 脱敏导入导出。修改展示配置或路由绑定不失效正式额度缓存。回归见 [test-sub2api.mjs](tests/test-sub2api.mjs)、[test-detection-inference.mjs](tests/test-detection-inference.mjs)、[test-display-profile.mjs](tests/test-display-profile.mjs) 与 [test-platform-runtime.mjs](tests/test-platform-runtime.mjs)。
- **wire 输出必须 lossless JSON**：DSH typert 对 RPC/工具返回值逐值校验，嵌套 `undefined` 属性、`NaN`/`Infinity`/`-0`、符号键（如 `QUOTA_SOURCE`）、非普通对象、带洞数组任一处违规整条作废（火山 `resetsAt: undefined` 曾让 `subusage_quota` 全量报错）。规则：**字段缺席就不要写属性**，不得写 `x: undefined`；`resetsAt`/`owned_by`/`groupLabel` 等可选字段一律条件展开。`quota()` 白名单与 `readLinked`/`linkedStep`/`result()` 出口统一过 `wireJson()` 深度净化兜底，回归见 [test-wire-lossless.mjs](tests/test-wire-lossless.mjs)（与 typert `visitJsonValue` 同口径的扫描谓词）。
- 代码直接维护在 `lib/`，修改后运行 `npm run check`，其中包括隔离回归与发布清单检查。隔离测试不替代真实账号或 GUI 验收。
- 凭据与登录适配遵循各提供商既有来源和生命周期；药丸路由别名不得顺带更改查询端点或账号选择。

## Antigravity 与独立插件联动

- 联动项不进 `PROVIDERS` / `PROVIDER_META` / `PROVIDER_ORDER`（没有凭据槽与普通设置卡片），登记在 Host 的 `LINKED_PROVIDERS` 与 Client 的 `PILL_LINKED_META`；改这几处表必须双端同步并更新 `tests/test-contract.mjs`。每个联动项有独立开关：Antigravity 走既有 `visibility.antigravity`（默认开启），其余全部走 `visibility.linked[id]` 逐项表（缺省全开、补丁逐键合并）；关闭时 quota() 与 readLinked() 同样静默缺席，Client 清除旧条目并拦截迟到响应。设置页管理区为横向分组 tab：**模型厂**（自研模型订阅）→ **聚合商**（`PROVIDER_META.aggregator` 标记的不自研模型、只做路由/中转的上游：opencode-go / openrouter / zenmux / vercel-ai-gateway / litellm / apigoto，外加本地网关 Magpie 的联动开关）→ **客户端代理**（Antigravity / Trae×3 / WorkBuddy×2 / Raccoon / Loomy，本身不提供 API、由第三方插件或本机直取读额度）→ **OFM**（十个渠道）→ **自定义连接** → **绑定与匹配**（显示与匹配开关、provider 映射、路由绑定、Magpie 分组绑定，固定在最后一页）。
- **Antigravity 一条、两个提供方插件通道**：`channels: ["agyQuota", "antigravityAuth"]`。`agyQuota` 是 dsh-antigravity-acp 的 `read({force})` → `QuotaSnapshot`（带 plan + credits，优先）；`antigravityAuth` 是本机实际安装的 dsh-tool-antigravity 经 `ctx.provide` 暴露的服务，`usage(signal?, force?)` → `QuotaStatusView`（gemini / non-gemini 两组、5h / weekly 两窗）。`linkedSnapshot()` 只在「服务取不到 / 没有方法」时回落，服务在场但回失败快照**不**回落；归一化分别走 `normalizeAntigravity` / `normalizeAntigravityAuthView`，字段形状照抄对方类型声明，不编绝对值。`rate-limited` 是查询限流，不是额度耗尽。
- **兄弟插件的 HTTP 路由只能由页面代取**：`/plugins/*` 走连接层 `admit()`，要求浏览器 cookie；宿主进程请求一律 403（实测 Trae/WorkBuddy/小浣熊/Loomy 七条同时失败）。所以 `CLIENT_FETCH_VIA`（trae-route / workbuddy-route / desktop-route）改由渲染进程同源 fetch 原始响应，宿主用 `subUsage/linkedStep` 以「注入数据源」的方式复用 `linkedProvider` 的原有归一化与缺席指引（不要另写一条归一化分支，否则缺席语义会静默丢失）。禁止把归一化复制到前端，也禁止退回「宿主自己发本机 HTTP」；客户端只在宿主不认识 `linkedStep` 时回退。成功读数按渠道 60 秒复用，失败/缺席不缓存。OFM 走进程内 Fetch、Antigravity 走 Cordis 服务，不受影响。
- 联动药丸走独立 Typert 方法 `subUsage/readLinked`：Client 路由 `google-antigravity` → 联动 id `antigravity`（`ROUTE_PROVIDER_ALIAS`），独立 Trae / WorkBuddy / Raccoon / Loomy 与 OFM 也登记在联动表。Host 结果只回 `{ updatedAt, entries }`，**不回 settings**，避免轮询顶掉设置快照；两端 codec 与方法白名单必须同步。联动 id 跳过普通 provider 的凭据 / 路由存在性过滤；所有联动项都遵守 `linkedEnabled` 门（Antigravity 对应 `visibility.antigravity`，其余对应 `visibility.linked[id]`），关闭时移除旧条目并阻止迟到响应复活药丸。开启且未装插件时显示缺席原因。
- 点名联动查询的空 `entries` 表示移除该请求目标的旧额度；Client 仅接受当前请求代的移除信号，不覆盖设置快照，后续轮询可恢复其他窗口重新开启的联动。回归覆盖跨窗口关闭/恢复及关闭前在途成功、缺席和失败响应。
- Antigravity 的模型分组是独立额度池：同池内取最紧窗口，跨池按实际报告的组数计数；部分池耗尽只作黄色提醒，全部已报告池耗尽才标红。药丸、横幅与悬浮说明共用分池结论；分池横幅只展示一句紧凑结论，逐池余量和重置时间留在窗口卡片与悬浮说明中，避免展开后重复列举。缓存/部分/失败状态优先保留数据质量提示。显示名将 Gemini / Claude-GPT / `gemini-argon` 的已知组名转为可读的中英文，原始 `groupLabel` 保留池身份，未知组名原样显示；不猜当前模型所属池、不补造缺席池。
- 缺席语义：不点名的全量查询静默；点名（含 `google-antigravity` / `dsh-tool-antigravity` 等别名）回一条列出两个插件名的安装指引；`unauthenticated` 点名时给「去 dsh-tool-antigravity 完成 Google 授权（`/antigravity-auth login`）」指引。

## OFM 联动与手机药丸

- 十个渠道以 `ofm-*` 登记，由 [ofm.js](lib/ofm.js) 经 Connection 的进程内 Fetch 调用 `usage.badge` 与 `account.list`；完整范围、鉴权来源及限制见 [联动说明](docs/ofm.md)。Host 可按索引引用检查凭据非空存在性，只回状态，引用名和秘密不出 Host；不自行登录、签到或写提供方设置。OFM `preference` 是显示偏好，不是账号模式，不能生成无依据的当前账号。
- 工具按账号展开，药丸用 `linkedAccounts`（规范名，`ofmAccounts` 别名在边界收编时折叠）保留稳定 `accountId` 与独立额度；纯余额多账号按用户选择在 Client 显示同单位总额度，原始结果仍逐账号独立，查看账号只改变弹层，不修改实际推理账号。凭据存在/记录有效期不能当上游鉴权成功。索引删除、停用或缺凭据不能复活旧额度；不同单位不合计，包到期不作窗口重置，Cline 窗口按账号 ID 匹配。
- 独立 Trae / WorkBuddy 由 [connect-usage.js](lib/connect-usage.js) 经各自公开 GET 接口读取，按插件、区域和账号 ID 隔离。池行真实字段是 `accountId`，`current` 不与旧绑定的 `selected` 混用；Trae 池关闭不推固定，WorkBuddy 固定还需 `selectionExplicit`。企业 Trae 不读个人积分替代；WorkBuddy 批量只有总余额时仍视已读余额完整，缺少可选的积分包明细另记说明；真实账号余额缺失/刷新失败仍为部分或旧数据，明确选中状态矛盾时丢弃未知归属的完整包。
- 独立 Raccoon / Loomy 由 [desktop-usage.js](lib/desktop-usage.js) 消费单当前账号 `/status`。Raccoon `probeKey` 丢弃后才缓存，Loomy 缓存不伪造账号归属/容量/请求采样时间。两种模型药丸仅在独立接口缺席时回落 OFM；工具分别报告真实来源，避免自动回落重复。`ofm-trae` / `ofm-minimax` 仍为独立查询 ID。
- 独立读取缓存由 reader 统一维护，缺席不缓存，强制刷新有代次保护、卸载不回填。不要在 Host 再包一层无排序缓存。提供方 GET 可能自行镜像登录、续期或更新运行时账号池，文档须按实际生命周期说明。
- DSH Go `panel` 网页岛中，药丸详情进入文档流向下展开，外层负责滚动；样式按岛标记自动生效并随 Client 卸载清理。桌面仍为绝对定位弹层。**Go 岛内药丸现在不注册**（额度改走 `dshGo` 原生面板，见上节），岛样式只为仍在跑的旧客户端包兜底。离线浏览器检查见 [脚本](scripts/check-ofm-mobile.mjs)，Android 真机验收单独记录。

## Magpie 本地聚合网关（yetone/magpie）

- 联动项 `via: "magpie"`，由 [magpie-usage.js](lib/magpie-usage.js) 在 Host 进程内只读回环 GET（默认 `http://127.0.0.1:3425`）；**不进 `CLIENT_FETCH_VIA`**，三条 `magpie-*` 路由经 `ROUTE_PROVIDER_ALIAS` 归到同一项。
- **只读**：不碰 `?kept=0` 与 POST `/refresh`（会写提供方侧）。缺席 = `undefined → null`；`data:[]` 是「网关在场但没卡」。缓存 60 秒、代次保护、`dispose()` 清理。
- **卡视图与池收窄、路由命中顺序、遥测归属**的完整规则（窗口名归一 / 积分型窗口 / 纯余额卡 / Antigravity 4 份去重与分池 / 模型→池 / 模型→渠道卡 / 自建 `magpie-*` 绑定 / live > 归组 > 上次路由 / 「遥测先归属再采信」）见 [docs/magpie.md](docs/magpie.md)。这些规则改一处就会让药丸显示别人的额度，**改前必读**。
- 回归见 [test-magpie-link.mjs](tests/test-magpie-link.mjs)；分组与折叠两形态在 [test-pill-density.mjs](tests/test-pill-density.mjs) 的密度表里。

## 读取与拉取解耦：条目暂存 + 数据源通道

两条独立的解耦，缺一个就会退回到「一失败就什么都看不到」：

- **条目暂存**（[snapshot-store.js](lib/snapshot-store.js)）：DSH 重启 / 插件重载 / 隔一分钟再打开设置时，过去所有条目都要重新打一遍上游。「显示」走暂存（`read` 带 `cachedOnly: true`，零上游请求）；「拉取」只由显式 `refresh`、tab 激活与药丸轮询触发。落盘 `<config 目录>/dsh-subusage-cache.json`（0600、tmp+rename 原子写、条目上限 200 / 文件上限 2 MiB），只存 `state === "ok"` 的净化条目（落盘前过 `hasSecretShape` 闸门）；读不到暂存的条目回 `state: "loading"`（「还没读过」≠「读不到」），暂存条目按 age 标 `freshness`（TTL 内 `fresh`、外 `stale`）。
- **可重试失败自动重拉**（`scheduleRetry`/`clearRetry`，宿主内建调度器）：缓存行落 `retryAt > 0`（仅可重试失败）时排一个计时器，`due = max(retryAt, at + TTL)`——命中条件是「retryAt 未到 **或** 年龄在 TTL 内」，在 retryAt 单独触发照样命中缓存空跑，必须两者都过。回调用「句柄同对象」比对丢弃已被取代的旧排期，重拉走**非 force** 的完整读取链（凭据失效 / 开关关掉 / 代次竞争全由既有机制挡）；`scheduleTimer`/`clearTimer` 注入可选，默认 `setTimeout` + `handle.unref?.()`（不留住宿主进程）。不可重试错误、`no-key`/`disabled`、身份解析超时、联动项与 ingest 一律不排（后者本来就是推送/页面代取）。**失败元数据（错误内容 / retryAt / failures）刻意不落盘**——重启后旧失败条目回 `loading`，由 Client 自愈兜底；`dispose()`、`invalidateProvider()`、指纹变化与凭据超时都会撤销挂起的计时器。回归：[test-auto-retry.mjs](tests/test-auto-retry.mjs)。
- **Host 后台扫描**（`startSweep`/`sweep`）：拉取不挂在任何 UI 事件上——`apply()` 传 `sweepIntervalMs: TTL` + `sweepWarmupMs: 5000`，插件启动 5 秒后做第一轮全量，之后每 60 秒续一轮非 force `refresh`，缓存自己保鲜、可重试失败的退避计时器第一轮就长出来。`sweepSkip` 跳过：ingest（推送方负责）、开关关闭、`no-key`/`no-cookie`/`disabled`/不可重试错误的既有结论行（这些状态只随 `invalidateProvider` 失效，每轮重判纯属空转）。`loading` 不跳——重启后暂存只回放 ok 条目，loading 正是冷启动要补的。每轮跑完才续排（自节流、不重叠），`dispose()` 撤钟。**默认关、构造选项显式开**：隔离测试注入假计时器，默认挂周期计时器会把所有「队列里只剩重试计时器」的断言弄脏。回归：[test-sweep.mjs](tests/test-sweep.mjs)。
- **数据源通道**（`service.sourceChannel(cacheKey)` → `fetchProvider(..., sources)`）：一个 provider 可能有多个上游端点（MiMo 的余额 / 套餐详情 / 套餐用量，Z.ai 的套餐额度 / 账户余额）。**每一路独立取数、独立落暂存**：这一路这次失败（非认证）就用上一次成功响应顶上并标 `stale`，不牵连另一路。原始响应按 `Map<cacheKey, {source: {body, at}}>` 存（每条目 ≤16 路、全局 ≤400 条），与条目暂存分开——**整条 entry 判失败时，某一路单独的成功结果仍要留着**。
- **失败判据按「本次真的读到了什么」算，不按「有没有可回放的旧数据」算**：两路都没有新数据 → 整条失败，抛真实错误（保留既有 error / 退避 / `retryable` 语义）；一路新数据 + 一路失败或回落 → 成功，但 `coverage: "partial"`。把「全是旧暂存」当成功会静默掩掉退避与上次成功时间，用户会以为数据是新的。
- **认证失败不回落**：凭据被拒时拿旧数据顶上会掩盖「需要重新登录」。
- **冷启动 loading 兜底（Client 自愈）**：`readAll` 首屏 `cachedOnly` 拿到结果后，把 `state === "error" || "loading"` 的条目逐个发一次非 force `refresh`——error 是退避未到点时的温和补刀（退避期内缓存命中不会发请求），loading 是重启后暂存只回放 ok 条目、其余从未读到时的补拉。有了 Host sweep 后它是第二层保险：覆盖 sweep  warmup 前的 5 秒空窗与「插件开了但 Host 是旧版」的形态。Host 重试计时器重启即丢、失败元数据不落盘（暂存是有界可丢弃缓存，不是历史库）。回归：[test-client-behavior.mjs](tests/test-client-behavior.mjs) 的自愈断言。
- 已知用途：Z.ai 退掉 Coding Plan 后额度端点不再下发窗口，但「财务中心」账户余额照常可读（`GET {站点}/api/biz/account/query-customer-account-report`，中国区；国际站结构未用真实 Key 验证过，暂不接入）→ 按量计费展示余额而非判「无法读取」。MiMo 没有 Token Plan 时三路同样各自独立。
- **失效与开关**：`invalidateProvider()`（凭据 / 开关变化）同时删条目暂存与数据源暂存；`dispose()` 时 flush。文件损坏 / 版本不符 / 超大一律当空；`options.snapshotPath === null` 关闭整层（隔离测试常用）。Windows 上 `stat.mode` 恒显示 `666`、`chmod` 只能切只读位，实际保护来自 `~/.dsh` 的用户 ACL。
- 回归：[test-snapshot.mjs](tests/test-snapshot.mjs)（条目暂存边界）、[test-source-decoupling.mjs](tests/test-source-decoupling.mjs)（Z.ai 退订 / 双路并存 / 双路失败仍失败 / 一路回落标 partial / 余额归一化 / MiMo `items: null` / 路由归并）、[test-client-behavior.mjs](tests/test-client-behavior.mjs) 的首屏 `cachedOnly` 断言。

## 联动来源：逐项开关 + 按路由绑定（不再自动回退）

- **旧行为已废除**：联动项过去采用隐式回退链，前一级缺席就静默换成下一级（换来源 = 换账号，可能连单位都不同）。现在每个来源是**独立可选项**：来源 key 固定为 `local`（本机直取）/ `plugin`（兄弟插件登录态，Antigravity 两个提供方通道算同一个）/ `ofm`（Our Free Model）/ `magpie`（Magpie 网关），由 [sources.js](lib/platform/sources.js) 按条目元数据推导（`linkedSourceKeys`）。（Unified Router / 原 `dsh-eac-router` 的 `router` 来源与回退接入已整体移除。）
- **两级控制**（`settings.sources`，白名单 `validateSourcePrefs`）：`disabled[linkedId] = sourceKey[]` 逐来源停用；`bindings[routeId] = { linkedId, source }` 把某条模型路由固定到「某条目的某个来源」。补丁**整体替换**（不做逐键合并），空对象即全部清空；未知条目、条目未声明的来源、非法路由 id 一律拒绝（不静默丢用户的绑定）。
- **解析顺序**（`resolveLinkedSources`）：路由绑定命中该条目 → **只**返回绑定的那一个（被停用即无来源）；否则返回「主来源组」`defaultSourceOrder`：本机直取（若有）→ 该条目原生那一级（plugin / ofm / magpie）。`ofm` **不在**独立插件条目的主来源组里——要用必须显式绑定。空数组 = 这轮没有可用来源，按缺席处理并给安装/登录指引，绝不自己挑一个顶上。
- `local` 与原生来源不是回退关系：两者读**同一批本机账号**（直取 vs 插件路由），保留组内顺序即可；跨账号边界的补位（→ OFM）才需要用户显式绑定。
- **wire 契约**：`readLinked` 与 `linkedStep` 增加可选 `routeId`（≤64，形状不对按未传处理，不拒整条请求）。药丸把当前模型路由带下去：`reader(id, selectedRoute, routeId)` → `activate` 记进 `routedRoute`，刷新时附在请求上；没有 routeId 的上下文（设置页轮询、工具、`quota()`）走主来源组。绑定生效**只在**药丸路径，全量报告不受影响。
- **公开投影**：`publicSettings.sources` 带 `disabled` / `bindings` / `available`（每个条目的可用来源，供设置页直接渲染开关）/ `labels`；Client 不复制推导规则。设置页「绑定与匹配」分组的「来源」区列出**可用来源 ≥2** 的条目逐项开关，「来源绑定」区复用 `uiBindings`（路由 → 条目 · 来源）。
- `sources` 不参与 `querySettingsHash`（与 `routeBindings` 同口径）：它只决定读哪个来源，不该让正式额度缓存失效；联动读数自有 60 秒缓存。
- 回归见 [test-sources.mjs](tests/test-sources.mjs)（推导/解析/校验/未绑定不补位/绑定单选/停用/全停用/设置管线）与 [test-client-render.mjs](tests/test-client-render.mjs) 的来源区块断言。

## 兄弟插件登录态型 provider（SuperGrok / Codex / Copilot / Devin）

- 共同形态：路由由提供方插件注册，**凭据属于对方**（登录由它发起、续期由它负责），本插件只读同一份来源直连上游额度接口，不保存秘密、不写回、也不在设置页提供本地 Key 编辑（`PROVIDERS[id].managedByPlugin = true` 同时拒绝 save 的凭据补丁）。归一化都放在 [session.js](lib/providers/session.js)，不新建模块文件——它们同属「会话 / 登录态」形态。
- Grok 是唯一会写的例外：借 grok-kit 官方会话链续约同一个登录文件（同一把写锁、compare-and-write），因为它的 access token 只有数小时且对方没有后台刷新；其余三家一律不刷新。Devin 也不刷新——登录态的生命周期归提供方插件。
- **Devin（`devin` / dsh-devin-provider）**：凭据解析与对方 `resolveCredential` **同序**——`cli` 模式读 `%APPDATA%\devin\credentials.toml` 的 `windsurf_api_key`（缺失回落保存的 grant）、`reference` 模式按账号的 `apiKeyRef` 走凭据服务 / 启动环境、其余模式读凭据库 grant `dsh-devin-provider/<accountId>` 的 `payload.key`；没有凭据服务时回落 `<state 目录>/credentials/<id>.json`。多账号只取它 `activeAccountId` 指的那一个。取数走官方 Connect JSON `POST {server}/exa.seat_management_pb.SeatManagementService/GetUserStatus`（凭据在请求体 `metadata.apiKey`，不走 Authorization 头）。
- **Devin 三条不能踩的细节**：① Connect JSON 序列化的 protobuf **int64 字段是字符串**（2026-11-16 实测 `overageBalanceMicros: "-77928"`），只认 `number` 会让真实账户静默少一行额度——百分比与微单位金额都要两种形态都认；② 百分比缺席按 proto3 JSON 零值省略判：`billingStrategy == BILLING_STRATEGY_QUOTA` 且窗口重置时间在时，百分比没下发 = 剩余 0%、该窗已用尽（2026-11-21 实测 `weeklyQuotaRemainingPercent` 在 0 剩余时整字段缺席，devin 插件同口径画满格已用）——不画的话「周用尽、日 100%」会被吞成「只有日窗满额」；非 quota 套餐或连重置时间都没有时才是真正没下发，不补造窗口；③ 站点地址只接受 https 或**回环** http（`isLoopbackHost`，自建反代形态），拒绝公网明文与带内嵌账号的写法——这个 URL 会把 session token 带出去；优先级 `WINDSURF_API_SERVER_URL` → 账号自己的 `server` → 全局设置 `serverUrl` → 官方默认。
- 回归：[test-supergrok.mjs](tests/test-supergrok.mjs)、[test-codex.mjs](tests/test-codex.mjs)、[test-copilot.mjs](tests/test-copilot.mjs)、[test-devin.mjs](tests/test-devin.mjs)。这类上游多数没有公开文档，字段形状按对方实现 + 真机响应核对，不按文档猜。

## 本机直取（不经兄弟插件）

- 目标：Raccoon / Loomy / Qoder / Qoder 中国版 / ZCode / Trae 六个渠道，优先由本插件**自己**读本机凭据、自己调上游只读额度接口，而不是转发 OFM 或兄弟插件的 HTTP 路由。实现见 [local-usage.js](lib/local-usage.js)。
- 凭据来源三条：① 账号池渠道走 `ctx.get("credentials").resolve(ref)`，ref 取自 `$DSH_HOME/channel-pack/state.json` 的 `accounts[].credentialRef`；② **不要自己解析 `.credentials.yaml`**（那是同一份数据的脆弱副本）；③ Trae 的凭据由 [trae-auth.js](lib/trae-auth.js) 解密，读取必须走注入的 `io.readFileSync` 而不是 `node:fs`，否则隔离测试会真读本机凭据并向上游发请求。**全部账号在账号池 `$DSH_HOME/.trae-auth.<region>.json`（v2 `{version, credentials:[...]}`）里；客户端 `storage.json` 只有「当前登录」那一个**——只读 `storage.json` 会漏掉其他账号。两处字段名不同（池是 `accessToken`/`accountName`/`expiresAtMs`，客户端是 `token`/`account.username`/`expiredAt`）。
- 顺序：`linkedSnapshot()` 里直取优先，页面药丸与工具共用完整账号池；不同来源 ID 域不按昵称拼接。**全部账号都读不到就返回 `undefined`**（没凭据 / 已过期 / 上游拒绝），静默让位给原有来源链；只要有一个账号读到就照实返回，失败的行各自带原因。上游应答成功但没下发数字（企业版账号）算「可达」，要显示原因而不是装作缺席——两者不能混为一谈。读失败不落缓存，用户重新登录后下一轮立即恢复。
- **只读两条铁律**：① 不替用户刷新 token——EAC 会周期性轮换 `refresh_token`，两边同时持刷新权会把对方顶下线；② 不碰任何写接口（Loomy 每日签到、ZCode 领取），打开面板不该变成意外签到。
- 各家契约差异必须逐家核对，不可套用：Raccoon 用 `Bearer` + `X-Org-Code`（组织码缺失只能读个人池）；Loomy 只认 `token` 头且成功码是字符串 `"000000"`，缺官方可用总量且每日分项未知时不把永久积分冒充总积分；Qoder 用 `security_oauth_token` 优先 + `Cosy-ClientType: 10`，企业版 `displayMode === "enterprise"` 不下发数字；ZCode 用 `zcode_jwt` + 必需 `X-Device-Mid`，单位是 token 不是积分；Trae 用 `Cloud-IDE-JWT` + POST `web_user_ent_usage`，剩余按 `credits_limit - credits_amount` 算，汇总与包都没数字时不补造 0。两处易错：ZCode 的 `balances: []` 是「0 个桶」的合法形态（如实显示 0 token），只有字段整体缺失才算形状变化；Trae 的逐包额度要 `product_extra.package_extra` 优先、包名只认 `display_desc`（`package_name` 是产品名，会让几个包同名）。Trae 还只支持中国版账号（凭据自带 `region`），非 CN 不发请求。
- Trae 那一层是**复刻客户端私有格式**：密文布局、四张 64 字节盐常量与 `aes` / `aes-private` 两种头都照抄已装的 `dsh-connect-trae`。客户端大版本换格式时解密会失败，此时必须返回 `undefined` 让直取回退，**不要试图猜新格式**。`~/.trae-cn/trae-jwt-token` 是 CLI 的另一族 JWT（401 / code 1001），不要拿它兜底。
- 已知取舍（有意保留，不要当成遗漏去「修」）：① `linkedSteps` 的 60 秒页面代取缓存在直取之上仍会各算一份，最坏陈旧度接近 120 秒；② `ofm-trae` 的直取实际读的是 Trae **中国版**桌面客户端，查询 ID 保持不变、显示名按真实直取来源标为 Trae，`trae-global` / `trae-enterprise` 不走直取；③ 上游 `code` 与注入依赖的 `error.message` 会进公开文案，新模块本身不往结果、缓存或日志里放 token。
- 未做的渠道要写明原因：Cline / LobsterAI 本机没有任何凭据；MiniMax 的 token 只有约 4.5 小时且自刷新可能与 MiniMax Code 的 `auth.lock` / `generation` 抢权（按用户决定本轮不做，要做就得先定「不刷新、过期即提示重登」这条线）。

## 手动 provider 匹配

- `visibility.manualMatching` 默认关闭；`visibility.providerMappings` 保存订阅 ID 到多个模型 provider ID 的映射。
- 下拉列表来源是 Host 当前 `llm.listProviders()` 的 ID，不是硬编码候选列表；一个模型 provider 只能绑定一个订阅。
- 手动绑定只影响药丸选择订阅，优先于内置路由别名；未绑定路由继续自动匹配，关闭开关保留映射。`routeBindings`（路由→实例绑定）同属手动层：`manualMatching` 关闭时保留不生效；统一解析顺序为 `routeBindings` → 实例 `routeIds`（实例自身声明，不受开关门控）→ `providerMappings` → `magpieRoutes` 绑定键（路由 id → `magpie`，不受开关门控）→ 内置别名，Host `resolveRouteTarget`、Client 药丸与 `goPanelUsageId` 三处同口径。
- 不改变检测开关、凭据、查询端点、额度缓存含义或工具报告的订阅 ID。实际选中模型的药丸 reader 以独立上下文跳过订阅原始路由 ID 的存在性过滤，刷新和轮询保持该上下文；设置页的原有过滤不变，药丸仍遵守检测开关、缺凭据隐藏和订阅状态判断。
- 火山 `volcengine-agent-plan` / `volcengine-coding-plan` 对应现有 Ark Agent / Coding 订阅；OpenDesign `opendesign-corouter-plan` / `opendesign-corouter-paid` 共用 OpenDesign 订阅。新增别名须核对提供方实际注册 ID。

## 中转聚合商的额度口径

- 「聚合商」分组现有 6 家中转上游（opencode-go / openrouter / zenmux / vercel-ai-gateway / litellm / apigoto）：它们不自研模型、只做路由/中转，`PROVIDER_META.aggregator` 只是设置页分组标记，不改变额度语义（siliconflow / novita 等单一上游推理平台仍留在「模型厂」）。
- `apigoto` 只读官方额度接口，与推理共用同一把 Key；不注册路由、不写上游。（2026-10-31 按用户决策移除 `unorouter` 与 `qnaigc`：它们只给 Key 级余额或时间范围内的花费，没有窗口与订阅语义，信息量不足以撑起一个入口）。
- 额度语义如实照搬，不套用别家的显示方式：`apigoto` 是订阅窗口 + 套餐内剩余金额 + 充值钱包（两个池，钱包为 0 不是告警）。
- 花费一律用 `spend`，不要放进 `balance`：余额行的告警阈值与「还剩多少」文案会把花费读成可用额度。
- 时间字段按语义区分：`apigoto` 的 `subscription.expires_at` 是套餐到期日，不是窗口重置时间，不写进 `resetsAt`；它以「套餐到期 …（还有 N 天）」说明行显示，已过期改写为「套餐已于 … 到期」，不显示「还有 0 天」。
- 徽标只放套餐名（`plan`），到期/策略/模式/积分走 `note` 说明行：徽标是标题行里的一小块，塞进结论会被挤成一串。`policy_name` 与套餐名相同则不重复占行，`points` 为 0 不占行，`mode` 只翻译认得出的取值。
- 归一化走同一返回结构 `windowExtrasResult({ windows, extras, coverage })` 与窗口档位 `windowKindFromSeconds()`；额度端点只登记在 `PROVIDERS[id].usageUrl`，不在 `fetchProvider` 里散写 URL。
- 附加行 kind 只用 `plan` / `balance` / `spend` / `note`，不产 `account` 附加行，避免工具文本把单 Key 读成多账户标注。

## 凭据解析与多 Key 监控

- `inherit` 模式的解析顺序：**路由实际 `apiKeyEnv`（`llm.listConfigurableProviders()` + settings 里的路由 profile）→ `keyRefs[id]` 额外引用名 → 内置 `envName` / `envAliases` → 手动 Key 兜底**；每个引用名内部先凭据服务、后启动环境。`manual` 模式仅在手上有 Key（或完整 AK/SK）时生效，缺失时继续走继承链。
- `keyRefs` 是每个 provider 最多 8 个凭据引用名，只存名字不存 Key 值；`publicSettings.keyRefs` 按 provider 暴露数组。managed（commandcode / oauth / copilot 等）与火山 provider 拒绝该字段。
- 额外 Key 通过 `provider(id, settings, force, ref)` 独立查询与缓存（缓存键 `id@ref`），结果挂在主条目的 `keyAccounts`；药丸与用量面板只认主条目（即 DSH 实际调用的 Key），额外 Key 不参与药丸选择。
- 清除手动 Key 或 Ark AK/SK 时同步把该 provider 的 `keyMode` 重置为 `inherit`，避免「删了 Key，环境变量读不到」；旧配置里 `manual` 但无 Key 的条目也按继承解析。
- 回归覆盖引用名持久化/校验、路由 Key 优先于额外名与内置名、额外 Key 额度与缓存隔离、清除后回落、managed/volc 拒绝，以及客户端草稿与保存补丁。

## OpenDesign 药丸计费来源

- 参考模型感知药丸的分发方式，将当前 `opendesign-corouter-plan` / `opendesign-corouter-paid` 路由分类传入药丸；两者共用账号用量缓存，不按模型复制余额。
- 套餐路由在新鲜、完整的成功快照下标注使用套餐额度；任一窗口用尽后标注使用余额。确认无订阅时同样标注余额；过期、部分、失败或已过窗口重置点的套餐读数不推断当前计费来源。
- 付费路由标注使用余额；套餐窗口保留用于查看订阅状态，窗口告警与余额使用说明需明确区分。未知路由不按模型名称猜测分类，手动映射到其他订阅时不保留 OpenDesign 标注。
- 这只是药丸展示，不修改模型路由、服务端计费、凭据或查询端点。回归覆盖路由切换、套餐耗尽与恢复、数据未知、弹层说明及原有显示开关。

## 设置页快捷登录

- 用量面板与凭据编辑器可选中不同提供商；快捷登录必须显式使用当前用量面板的 provider ID，不能复用编辑器的登录 API。
- MiMo 过期、续期或首次登录快捷入口应直接启动对应登录任务，并展开该提供商的编辑器展示进度和失败信息；下方配置登录继续使用当前编辑器目标。
- **MiMo 两条登录通道的按钮规则**：扫码（`channel: "qr"`）是推荐的主按钮，浏览器登录是次按钮，手机引擎（无浏览器）只有扫码；两者共用组件级任务状态，二维码 / 浏览器进度 / 失败提示只在发起它的通道下渲染，取消入口只有一个，任一进行中另一个按钮禁用；用量面板快捷条同构，扫码入口要展开编辑器（二维码在那里显示）。Host 开始任一登录时取消另一个进行中的任务。
- **MiMo 自动续期**：只有扫码登录会保存续期材料（`xiaomi.renewal` = `userId` + `passToken` + `deviceId`，与 Cookie 同在 0600 的 `~/.dsh/dsh-subusage.json`，公开设置只暴露 `autoRenew` / `renewExpiresAt`）。Cookie 距到期不足 10 分钟、已过期或被上游拒绝时由 `mimoRenewIfDue()` 取数前静默续期；材料只跟着它换出的 Cookie 走——手动 / 浏览器登录与清除凭据一律丢弃，扫码的第 4 个回调实参是 `passToken` 有效期、不能给 Cookie 计时封顶。`passToken` 被拒不重试（等用户重新扫码），网络 / 形状类失败按 1 / 10 分钟重试；登录任务进行中不续期。有续期材料时 Client 不显示 Cookie 倒计时（`cookieRenewable`），续期失败才提示重新扫码（`renewFailed`）。续期协议未用真实账号长期验证，不得在文档里写成已实机验证。细节见 [开发文档](docs/development.md)，回归见 `tests/test-mimo-renew.mjs`。
- 登录前保留未保存草稿保护、组件级重复启动保护及最新设置 revision 校验。切换编辑器时，恢复状态请求不能覆盖新启动的任务；卸载只清理界面轮询，不取消 Host 登录任务。
- MiMo 扫码各阶段返回的 Cookie 按名称合并、后值覆盖前值；保存续期材料使用实际换票时的最新 `passToken` / `deviceId`，设备信息不只取首次响应。额度缓存命中时重新计算 Cookie 有效期与可续期状态，避免旧标记误触发或掩盖登录警告。
- 回归覆盖编辑器停在非登录提供商、OpenDesign 与 MiMo 三种状态下的快捷重新登录，以及重复点击和迟到 idle 状态。

## 验收与维护

- 修改 Host/Client 设置字段时同步校验白名单、默认值、持久化、公开快照和修订冲突控制。
- 手动匹配回归覆盖多路由、重复绑定拒绝、保存重读、关闭恢复自动匹配、手动覆盖内置别名及下拉候选去重。
- 订阅检测与异步刷新必须保留原有请求排序和缓存隔离；新增字段应防止旧响应覆盖新设置。`manualMatching` / `providerMappings` 不参与查询设置一致性哈希，保存显示映射不得作废在途额度；完整设置 revision 仍包含它们。
- 用户文档区分路由匹配、凭据复用和只读额度联动，不把源码核对或桩测试表述为实机兼容验证。
- **弹层与工具报告有密度上限**：收起状态只保留「结论 + 窗口 + 关键金额」，说明类逐条内容折进 `details`。多账号按 Command Code 账户区的做法：**账号全部平铺**，一行一个账号（状态点 + 名字 + 余额或窗口余量），点行即切换查看对象（再点取消）；只有选中的账号才展开它的说明明细，未选中时不挂「其他说明」折叠。横幅不重复账号数；纯余额多账号按单位合计，部分失败/旧缓存/缺数字时明确标为已读小计与覆盖数量。新增 provider 或联动形态必须同时加进 [test-pill-density.mjs](tests/test-pill-density.mjs) 的形态表，守住「弹层 ≤ 14 行、单家报告一行 ≤ 220 字符」；单行 flex 账号按钮按实际排版计一行，只靠某一家截图验收不够。
- **新增药丸不得另起收起样式**：有窗口就画 Command Code 同款余量条，并在条旁直接给最紧窗的剩余百分比——收起态先回答「还剩多少」，告警/配置态保留原短文案，多账号使用代表账号自己的窗口，百分比不相加。纯数字条目（余额合计 / 账号计数 / 无限制）不挂 ℹ 占位符，让数值自己站住；只有 ⚠/✕/? 等告警语义才占图形位。纯余额多账号按用户选择显示同单位总积分/余额，不同单位分别合计；单账号直接显示自身余额。其它账号点开查看，多账号弹层默认展示总额，选中账号才显示该账号额度；查看只改变弹层，药丸保持总览，也不修改实际推理账号。失败/旧缓存/缺数字时给已读小计与覆盖数量，没有可读余额时不补造总计 0；余额告警按单位合计数值判定，单个账号为 0 不把正常合计标成耗尽。账号列表一行一个账号及独立余额，仅当前账号加「自动选择/固定」标签，同名账号补序号，单账号不重复列表，说明只由正文展示一次。OpenDesign 计费来源放悬浮说明与弹层，Antigravity 分池横幅沿用统一尺寸，不为新功能增加常驻标签或特殊横幅。
- 工具查询只在已确认相同来源、渠道与稳定 `accountId` 时折叠联动别名的重复行，优先保留原生入口标签；点名单个 OFM ID 保持原 ID。同名不同账号、不同来源/区域或缺少稳定身份的行保留，不能凭昵称和金额猜测去重。
- **输入区药丸有两套外观，由 `visibility.pillStyle` 切换**：`classic`（默认，全圆胶囊 + 1px 描边 + 600 粗体，全部 inline）与 `immersive`（与右侧 ModelSelect 的 `.trigger` 对齐：定高 `28px`、`var(--dsw-radius-sm, 8px)` 圆角、无边框、`font-weight: 400`、`var(--dsw-alias-label-secondary)` 文字色、悬停 `var(--dsw-alias-interactive-bg-hover)`）。沉浸式的几何 / 字重 / 常态配色**必须**放在 `PILL_CSS` 且限定在 `[data-style="immersive"]` 下——inline style 写不出 `:hover`；经典式仍由 inline 自管（描边色要按告警档位动态算，交给 CSS 反而更绕）。两套都保留**告警染色**（tinted 态自带 background + color，压过基础规则）。未知取值一律按经典处理。`--dsw-*` 是 DSH client-ui 的主题 token，不是本项目编的数字。回归：[test-client-render.mjs](tests/test-client-render.mjs)（两套各自的 inline 约束 + 设置页分段选择）、[test-client-ofm.mjs](tests/test-client-ofm.mjs)（CSS 规则限定在沉浸态）、[test-host-service.mjs](tests/test-host-service.mjs)（默认经典 / 可切 / 白名单拒绝未知值）。
- **积分包必须先归一化再展示**：[credit-packages.js](lib/credit-packages.js) 隐藏用尽与能确认已过期的包，按今天 / 3 天内 / 临时 / 周期套餐 / 永久分组；只在单账号、同单位内聚合，紧急组保留最早到期时间。已有窗口的包只补紧急提醒；无法确认语义的到期字段不猜。
- 变更说明先记入未发布条目；安装、版本发布与源码推送分别处理。

## 连坐（cascade）口径

上层窗口用尽 → 下层窗口也跟着不可用。这条规则横跨归一化、工具文本、药丸、Go 面板四处，任何一处口径不一致都会让用户看到自相矛盾的数字，所以单列一节。

- **实现只有一份**：`cascadeRateLimited()` 与 `windowExtrasResult()` 定义在 [shared.js](lib/providers/shared.js)，宿主与各 provider 模块共用。`lib/index.js` 曾复刻过一份，改一处忘另一处就会出现「Host 说连坐、药丸说正常」——**不要再复制**，需要新口径就改 shared.js。
- **连坐范围按池判定**：`groupLabel`（池身份：Antigravity 的模型分组、Magpie 的渠道池）优先于 `detail.scope`，都没有才回退 `"all"`。Antigravity 的 `detail.scope` 恒为 `"all"`（语义是「约束全部模型」而非池），拿它当池会把不同池串成一起：一个池的周额度用尽，别的池的 5 小时也被标红。
- **窗口顺序：短周期在上、长周期在下**（`5h` → 日 → 周 → 月 → `period` 兜底档）。顺序统一挂进 `cascadeRateLimited()`（所有窗口型 provider 的必经之路），不靠各家在归一化里自己排——上游下发顺序不固定，漏一家就会在两次刷新之间上下颠倒。带 `groupLabel` 的**真分池**只做组内排序（全局排会把同组窗口拆到别的组标题下）；`groupLabel` 不代表池身份时（OFM 把上游窗口类型名放这里当分组标题）用 `poolKey: null` 走全局排。`period` 表示「周期未知」，不猜，排最后。
- **连坐不改写读数**：`status === "rate-limited"` 分自身用尽与受连累，后者的 `percent` 是它自己的真实读数，渲染必须保留（Client 走 `windowLeft()`；go-panel 行尾写「连带限流 · 剩余 60%」；工具文本写「受连累（60% 剩余）」）。压成 0 会显示成「100% 已用」，抹掉「本来还剩多少」这条唯独它有的信息。自查点：Client 窗口卡片、go-panel 窗口行、`formatQuotaText`，三处口径必须一致。
- **只有连坐时也要说清不可用**：没有自身用尽、只被连坐时，go-panel 标题用「连带限流」而不是退回报剩余百分比——此刻额度实际不可用。
- **代表窗口取根因**：池耗尽（`accountPool.exhausted`）时挑给 `computeStatus` 的那条窗口必须**自身用尽**优先（`pickPoolLimitedWindow`），挑到连坐窗口会让横幅说「受连累」，掩盖真正用完的那条。
- 并列额度线**不连坐**：Copilot 的 Premium / Chat / Completions、LiteLLM 的 key / team / user 预算、Trae 的汇总窗，各自独立预算，一层用尽不代表另一层不可用。声明式自定义实例的窗口由用户映射，不做自动连坐。
- 回归：[test-cascade.mjs](tests/test-cascade.mjs)（Kimi / Z.ai 层级连坐）、[test-cascade-pools.mjs](tests/test-cascade-pools.mjs)（Antigravity 两通道 / Magpie 同池连坐与跨池隔离 / 无分池 provider 退回全量）、[test-cascade-display.mjs](tests/test-cascade-display.mjs)（工具文本、go-panel 行与标题、Client 窗口卡片、池代表窗口）。

## 被动接入（ingest）

其它插件把额度数据**推**给本插件，本插件只做形状校验、持久化与展示；数据与新鲜度由推送方负责，本插件不主动拉取、不重试、也不了解对方上游。实现集中在独立模块 [lib/ingest.js](lib/ingest.js)。

- **接口契约（仅 Cordis 服务，不做 HTTP 端点）**：同进程插件经 `ctx.get("subUsage")` 调用 `ingest(payload)`、`revokeIngest(source)`、`listIngest()`。`ingest` 返回 lossless JSON（`{ ok: true, source, providerId, receivedAt }` 或 `{ ok: false, error }`），坏数据不抛错、不污染已有数据。
- **`ingest:<source>` 命名与隔离**：`source` 限制为 `/^[a-z0-9][a-z0-9._-]{0,63}$/i`，拼成 `providerId = "ingest:<source>"`，与 33 个内置 provider 彻底隔离；**严禁**把被动源塞进静态表 `IDS` / `PROVIDER_ORDER` / `PROVIDER_META`，避免污染计数断言与内置管理页。`parseQuery`、`quota()`、`read()`、`snapshotEntry()` 与 Client 顶部 tab 均通过 `isIngestId()` 单独放行与安全取名。
- **独立持久化文件（不复用 `snapshot-store`）**：`IngestStore` 落盘到 `<config 目录>/dsh-subusage-ingest.json`（0600 + tmp/rename 原子写，`options.ingestPath === null` 关闭）。`dsh-subusage-cache.json` 是可丢弃的额度暂存，而被动接入文件是推送方交过来的**数据本体**，丢了无法由本插件重拉，必须独立保存。
- **秘密闸门与上限**：落盘前整条过 `SECRET_SHAPE`（命中 `Bearer` / `sk-` / `eyJ…` 等形态直接拒绝写入），单条 ≤64 KiB、总文件 ≤1 MiB、最多 50 个源（按 `receivedAt` 淘汰）、单源窗口 ≤16、附加行 ≤40、`ttlMs` 上限 7 天；坏窗口/附加行逐项跳过并记入 `diagnostics`。
- **开关只控制显示，不删数据**：`settings.ingest.hidden` 保存被用户隐藏的 `source` 名数组（补丁整体替换，双端 codec 校验同口径）；`publicSettings.ingest` 投影 `{ hidden, sources }` 供前后端解耦。关闭开关只让源从全量查询与顶部 tab 隐身、保留落盘数据，重新打开即恢复；撤回删除数据走 `revokeIngest(source)`。
- **`ttlMs` 过期只标 `stale`，不隐藏卡片**：推送方可选提供 `ttlMs`；超期后 `ingestEntry()` 将 `freshness` 设为 `"stale"`、设置页副文案补「N 分钟未更新」，仍保留卡片可见，不做「数据已失效」的裁决。
- **明确不做**：不做轮询与重试（本插件不知道对方上游）、不注册药丸或改动 `lib/go-panel.js`（被动源没有模型路由）、不在设置页提供删除按钮（生命周期归推送方 `revokeIngest`）。设置页入口位于「绑定与匹配」页的「外部接入」分组。
- 回归：[test-ingest.mjs](tests/test-ingest.mjs)（校验/成卡/持久化/隐藏开关/ttl stale/撤回/投影与 `cachedOnly`）、[test-client-render.mjs](tests/test-client-render.mjs)（外部接入区块有源/error/stale/空态/开关补丁/分组隔离/顶部 tab）、[test-client-behavior.mjs](tests/test-client-behavior.mjs)（冷启动与热启动 `readAll` 拉取）、[test-contract.mjs](tests/test-contract.mjs)（双端 `save` 与 `query` codec 一致性）。
