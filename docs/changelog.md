# 更新记录

以下按发布版本保留当时的功能与验证记录。旧版本的导航、登录方案及兼容性描述不代表当前行为；当前使用方法见 [README](../README.md)。

## 未发布：鉴权数据加密存储、重构审查修复与设置页连接管理

### 设置页功能入口（本次新增）

- **管理区分组 tab（本次新增）**：额度区下方改为横向分组 tab——「订阅与凭据」（原有 provider 卡片 + 手动匹配/隐藏开关）、「聚合商」（`PROVIDER_META.aggregator` 标记的条目，目前只有 apigoto）、「联动」（全部联动项独立开关）、「自定义连接」（原 ConnectionsBlock）。
- **联动逐项开关（新增 `visibility.linked`）**：OFM 十个渠道（`ofm-*`）、独立 Trae / WorkBuddy / Raccoon / Loomy 与 Magpie 各有独立开关，缺省全开、补丁逐键合并；关闭后 `quota()` 与 `readLinked()` 同样静默缺席，Client store 同步清除旧条目并拦截迟到响应。Antigravity 仍走既有独立 `visibility.antigravity` 开关。回归见 [test-linked-switches.mjs](tests/test-linked-switches.mjs)。
- **Magpie 自定义分组绑定（新增 `settings.magpieRoutes`）**：`{模型前缀 → Magpie providerGroup}`，药丸 `modelOwnedBy` 归组先查该绑定再回落前缀直配与 `/v1/models` 的 `owned_by`；面向不用内置 magpie 三条路由、自行做 provider 分组的部署。设置页联动 tab 内提供绑定/解绑编辑器，候选分组名从已检测 `linkedAccounts[].providerGroup` 提示；参与保存 revision 但不参与查询一致性哈希（与 routeBindings 同口径，改绑定不作废额度缓存）。
- **连接实例管理 UI**：设置页「自定义连接」分组（`lib/client.js` 的 `ConnectionsBlock`/`InstanceEditor`），支持实例列表、启停开关、编辑、删除与新建（上限 24 条）；编辑器覆盖 adapterId、baseUrl、usagePath、authKind/scheme/customHeaderName、credentialMode、lifecycle、credentialRefs、routeIds、非秘密请求头与手动秘密（只写不回显）。
- **探测向导**：编辑器内「测试连接（不保存）」调 `detectInstance`，展示 `identified / needs-review / auth-required / unsupported` 四态、解释与五类冲突提示；可一键采用建议映射；探测期间设置被修改时显示 stale 告警并要求重测。
- **映射编辑器**：14 个 JSON Pointer 字段 + envelope/unit/scale/balanceSubjectKind/balanceAggregation/percentSemantics/windowPeriod/pool + 逐字段 `mappingLock` 锁定；内嵌 DisplayProfile（primaryMetric、hiddenElementIds）。
- **Recipe 导入导出**：实例卡片「导出」返回脱敏 JSON（秘密/凭据引用名/私有地址/路由绑定全部剥离）；「导入 Recipe」粘贴 JSON + 必填 baseUrl 直接落盘。
- **RouteBinding UI**：手动匹配区新增「路由绑定」子区，把单条模型路由直接绑到订阅或连接实例；与 providerMappings 同层，遵循统一解析顺序。
- **新增 4 条 RPC**：`subUsage/getCatalog`、`subUsage/detectInstance`（入参白名单校验）、`subUsage/exportRecipe`、`subUsage/importRecipe`（`{recipe, overrides}`）；`exportRecipe`/`importRecipe` 保留直连位置参数兼容。`publicSettings` 已同时下发 `instances`（公开视图）、`displayProfiles`、`routeBindings`、`magpieRoutes`、`catalog`。

## 未发布：鉴权数据加密存储与重构审查修复

- **秘密落盘加密（新增 `lib/secret-box.js`）**：`~/.dsh/dsh-subusage.json` 中的用户秘密值（`keys[id]`、`instanceSecrets`、小米 `xiaomi.cookie`/`xiaomi.renewal`、火山 `volc.accessKeyId`/`secretAccessKey`）以 AES-256-GCM 加密存储；32 字节随机密钥单独放在 `<config>.key`（0600），密文封套 `enc:v1:<iv>:<tag>:<ct>`（base64）。旧明文值加载时照旧可用并在下一次持久化自动加密；解密失败按空处理不阻断加载；密钥文件损坏抛出 `subusage/key-corrupt`。引用名（keyRefs、credentialRefs、env 名）与环境变量来源本身不存值，不加密；公开设置依旧不含任何秘密。回归见 [test-secret-storage.mjs](tests/test-secret-storage.mjs)。
- **实例凭据链移除 routeEnvs 注入**：`resolveInstanceIdentity` 不再把绑定路由的 `apiKeyEnv` 灌进自定义实例的凭据链（原顺序 routeEnvs → credentialRefs → builtinEnvs → 手动秘密会把别的路由的 Key 借给实例）；现在实例只吃 `credentialRefs` → `builtinEnvs` → `manualSecret`，路由绑定只决定药丸归属、不改变实例用什么 Key。内置 provider 的继承链不受影响。
- **routeBindings 归入手动匹配开关**：`visibility.manualMatching` 关闭时路由绑定保留但不生效（原先无条件生效，与 providerMappings 语义不一致）；Host `resolveRouteTarget`、Client 药丸与 `goPanelUsageId` 三处统一为「routeBindings（手动）→ 实例 routeIds → providerMappings（手动）→ 内置别名」同一顺序，实例 routeIds 属实例自身声明不受开关门控。`routeIds` 同时移出额度查询参数哈希：改绑定不再误作废在途请求与额度缓存（原先被计入 queryFields）。
- **HTTP 执行器加固**：响应体按字节上限流式读取（`ReadableStream.getReader` + `reader.cancel`），不再先 `text()` 全量进内存；JSON 解析加节点数预算（2 万）拒绝超宽/超深负载；超时计时保持到 body 读完。新增 `sanitizeUpstreamMessage`：上游错误消息进条目前先剥掉 hint 秘密（Key/Cookie 原文）、JWT、`sk-/ak-/rk-/ghp_/Bearer` 模式串并截 200 字；`secretHints` 由调用方按 identity 注入。
- **URL 与请求头收紧**：`isLoopbackHost` 补全 127.0.0.0/8 全部环回段（原先只认 127.0.0.1）与 `localhost`/`::1`/`0.0.0.0`；IPv6 私网只认 ULA/链路本地字面量（带 `:`），169.254 链路本地拦截；`normalizeUsagePath` 解码 `%2e` 后拒绝 `..`/`\`/`#`；自定义 headers 经 `validateNonSecretHeaders` 按 `authHeaderNames(authKind)` 拒掉与注入鉴权头同名的项（`exportInstanceRecipe` 同口径）。
- **DisplayProfile 改为投影层**：`applyDisplayProfile` 不再改 `quotas`/`windows`/`extras` 事实层，输出 `displayQuotas`/`displayWindows`/`displayExtras`/`displayPrimary.text`/`displayDegraded`；`-0` 归一为 `0`，隐藏元素不能再被推选为 primary；client `parseEntry` 与 Go 面板 `goPanelData` 渲染端优先消费 `displayX ?? X`。余额合计统一走 `sumAccountBalances(..., {dedupeBySubject:true})`——同 subject 的 Key 级余额不再重复相加（含 subject.kind=key 场景）。
- **声明式适配器修复**：LiteLLM 归一化兼容 `/user/info`（`user_info`）与 `/team/info`（`team_info`）响应壳；`baseUrl` 末尾 `/v1` 在 LiteLLM 管理端点合成时剥除（`/v1/key/info` 一律 404，recipe 新增 `dropsTrailingV1`）。sub2api 全部 `a ?? b ?? c` 取数链改 `pickNumber`：前置字段是不可解析的原始值（如 `"abc"`）不再吞掉后面的数字；`remaining` 为负（limit 0/缺席时上游 `-1` 哨兵）截断为 0 不再透成余额。custom-http 余额 `aggregation.balance` 缺省一律 `forbid`（原先 key 级默认 allow）：未知端点的钱包语义只有用户能确认，不默认可加。
- **探测与推断加固**：`toNumber` 千分位按 `\d{1,3}(,\d{3})+` 严格分组（`"1,5"` 拒绝）；`timestamp` 纯数字字符串不足 8 位一律当年份不当 epoch 秒；`windowPeriodFromHint` 先按「数字+单位」（7 days→week、15h→day、30 days→month）再按名称词推断。自动探测 `code:401/403`/`success:false` 信封判 auth-required；`readPointerSmart` 兼容 `{code,data}` 信封；预览脱敏补 JWT、`sk-/ak-` 内嵌 Key 与 URL userinfo 模式，`key` 驼峰命名（apiKey 等）入敏感名表。
- **实例修补与竞态**：`patch.instance` 的 Key 模式字段统一为 `credentialMode`（原先写错成 `keyMode`，清除秘密后实例停在 manual 不回继承）；`instanceProvider` 代次不一致重跑时按 id 从最新 settings 重取实例（原先复用旧对象，带着已删除的 routeIds/秘密引用复活）；`detectInstance` 加设置 revision 守卫，探测期间配置被改则结果作废（`stale:true`），不污染新配置下的草稿。
- **凭据生命周期字段**：`ConnectionInstance` 新增 `lifecycle`（`read-only | delegate | managed`，默认 `read-only`），`validateLifecycleMode` 统一校验并透出 `publicInstanceView`，为后续「可代理写操作」实例预留边界。

## 0.24.5：工具报告补实际额度数字、label 必填修复与重构说明

- **修复 `subusage_quota` 工具 schema 校验报 `missing required property label`**（0.24.4 发布后才修的漏网）：lossless 修复把 `label` 从「裸拷贝 undefined」改成「条件省略」，而工具 output schema 把它标为必填——Magpie 等联动的展开账号行本来就没有 label（账号名在 account 里），全量查询时所有账号行一起违约。现在依次回退：账号名 → 联动/常规表显示名 → providerId，必填字段不再留空。回归在 [test-wire-lossless.mjs](tests/test-wire-lossless.mjs) 增加 `assertToolShape`：lossless 之外再核一遍 schema 必填字段。
- **`subusage_quota` 报告报实际额度数字，不只报百分比**：窗口行在剩余百分比后补 `（余 N unit）`——`detail.left`（magpie 回推/直接下发）→ `detail.remaining` → `used/limit` 反推；非数值口径（`leftText` 的「Unlimited」）翻中文「不限量」；上游不报告数量的窗口保持纯百分比，不补造。数字量纲与客户端 `fmtTokens` 同口径（K/M/B 分级、两位小数收位）。
- **文档与发布说明补「项目正在进行重构」的提醒**：README 顶部高亮块与 awesome 条目同步注明：当前在 QuotaEntry / DSH Go 面板 / Magpie 网关方向持续重构，版本间可能出现异常，发现问题请回报。[awesome-dsh-plugin 收录条目](https://github.com/KouzakiUmi/awesome-dsh-plugin/blob/main/data/plugins/KouzakiUmi__dsh-subusage.yml) 同步更新到 31 条入口与重构提示（贡献指南为准：`description` 只说功能、不加营销词，提醒按事实写）。

## 0.24.3：宿主 Core 0.2.2-rc.1 兼容性与版本声明

- **兼容宿主 Core `0.2.2-rc.1`**：`peerDependencies` 补 `>=0.2.2-0 <0.3.0-0` 分支——原有两分支按 node-semver 的预发布规则会静默排除 `0.2.2-rc.1`，安装链路会判为 peer 不满足；按「逐 minor 分支」规则把 `>=0.2.1-0 <0.3.0-0` 拆成 `>=0.2.1-0 <0.2.2-0 || >=0.2.2-0 <0.3.0-0`，semver 实测 0.2.0 / 0.2.1 / 0.2.2 的预发布版均覆盖、0.3.0 仍排除。新增 `tests/test-peer-range.mjs` 守住每个 minor 的下界比较符、范围一致性与 `dshReleases` 状态。
- **兼容声明按证据更新**：`dsh.compatibility.dshReleases` 补 `0.2.2-rc.1: unknown`，README 兼容表加「未验证的 Core 版本」行并更新范围与分支说明，[开发与验证说明](development.md) 补静态核对记录。本机只完成核心包公开导出与版本的静态核对及全量回归，插件未在该 Core 上实机安装运行，故不标 `compatible`、「最后验证日期」保持 `2026-10-11`。
- 清理 `dsh.client.inject` 里在 0.2.2 安装树已不存在的 `@deepseek-ai/dsh-client-ui-slots`；该名单只是信息性包名边，Cordis 服务 inject 的 `slots` 不变。

## 0.24.4：DSH Go 原生面板、Magpie 聚合网关与 wire lossless 修复

- **修复 `subusage_quota` 全量报错「value is not lossless JSON」**：DSH typert 对工具/RPC 输出逐值校验——嵌套 `undefined` 属性、`NaN`/`Infinity`/`-0`、符号键、非普通对象、带洞数组任一处即拒整条结果。实发与潜伏共五处：火山四处 `resetsAt: fromEpoch(...)` 裸赋值（上游哨兵 `-1`/`0` → `undefined` 属性直达 `windows`）；magpie `/v1/models` 目录 `owned_by` 缺席时写成 `owned_by: undefined`；antigravity 去重 `picked.groupLabel = label || undefined`；`quota()` 白名单裸拷贝 `label`（magpie 展开的账号行没有 label）；`QUOTA_SOURCE` 符号键随 entry 到达 `readLinked`/`linkedStep`/`refresh` 客户端出口。源头逐处守卫之外，`quota()` 白名单对 `windows`/`extras`/`quotas` 统一过 `wireJson()` 兜底净化，三个客户端出口同套处理；新增 [test-wire-lossless.mjs](tests/test-wire-lossless.mjs) 用与 typert `visitJsonValue` 同口径的谓词全量扫描 `quota()`/`readLinked()` 输出。
- **切会话后不再把别的对话的渠道当成当前额度**（含账号行徽标同口径）：magpie 的 `concurrency` / `usage/requests` 是**整机全局**遥测（DSH 不发 `X-Magpie-Session`，网关不区分会话），而药丸是**按会话**回答「当前模型还剩多少」。原先把 `routeContext.live` 无条件排在命中顺序最前，于是切到另一个对话后，前一个对话正在跑的请求就成了本会话的「正在服务」——收窄到别的渠道，本会话模型归不出组时还会一起退回聚合总览。现在遥测**先归属再采信**：`req` 与本会话当前模型一致（去掉 `auto/` / `group/` 前缀后比较）才参与命中卡、池收窄与 `cardId` 回指；对不上时只作路由行展示，并标注「其他对话的请求」。`req` 缺席时无法证伪，维持原行为。同一修正同时落在 Go 原生面板（`goPanelServingCard`）。账号行「正在服务/上次命中」徽标也走同一归属过滤（原先直接读原始 `routeContext.cardId`，别的对话在跑请求时会给别人的卡挂徽标）。另外会话切换会换掉模型目录 store，此时不再沿用上一个会话的厂商（原先会把别的对话的订阅画到本会话药丸上，直到新会话目录就绪）。回归见 [test-pill-density.mjs](tests/test-pill-density.mjs)（另一对话的在途/上次路由、本会话在途仍优先、`req` 缺席、模型归不出组退回总览）与 [test-client-behavior.mjs](tests/test-client-behavior.mjs)（切会话不沿用旧厂商）、[test-go-panel.mjs](tests/test-go-panel.mjs)。
- **DSH Go 原生面板替代药丸**：`package.json` 新增 `dshGo` 清单（`panels.usage`，`session.tab` 放置），Host 经 `ctx.inject(["dshGo"], …)` 注册 `ctx.dshGo.panel`——额度显示在对话详情「插件」页签（Go 专属侧栏），聊天页输入区不再出现网页药丸：Client 检测到 `data-dsh-go-island` 标记就不注册 `conversation.input.right`（设置页与网页岛样式不受影响）。面板当前模型由 `model/selection` + `request/header` 会话事件按官方模型选择投影还原，provider id 经 `ROUTE_USAGE_ID` 归并（与 Client `ROUTE_PROVIDER_ALIAS` 同表，测试逐键比对），数据走 `service.quota()` 读共享缓存：60 秒轮询 + 模型切换事件即时重推 + 面板「刷新」动作穿透缓存。视图是声明式组件树（`lib/go-panel.js` 纯函数：模型/状态行、最紧窗高亮的窗口列表、余额/说明行、更新时间），全部数值走 `data` 绑定、数据模型 ≤32KiB、窗口/附加行各截断 8 条。回归见 `tests/test-go-panel.mjs`。
- **复查并修复路由/分池同类边界**：在途路由不再继承上次请求的 `cardId`、账号、模型、状态与时间，Client 拒绝跨渠道旧 `cardId`；`auto/*` 与 `group/*` 都能按模型目录归组。Antigravity 去重键补入窗口周期，未知池保留独立身份；`leftText` 同步进入权威 `quotas`。中文表补齐实读数据中的 Chat requests、1 day 与 Token Plan。
- **Magpie 按当前模型名前缀切渠道卡**：模型 id 的 `provider/` 前缀（`kimi/k3.1-pro`）直接匹配额度卡分组；`auto/*` 组模型回落 `/v1/models` 的 `owned_by`。切换模型立刻显示对应卡额度，不再卡在「上次路由」用尽的渠道上。
- **额度名中文化**：窗口标题与「不限量」等剩余文本按语言检测翻译（Credits→积分、Add-on credits→附赠积分、7 days→7 天…），英文环境保留原名。
- **Magpie 全卡补齐剩余数量**：`display` "a / b" 兜底解析——`amount===a` 或 `a/b` 偏离 `remaining%` 时 a 是已用、余 b−a（Copilot premium 729.6 requests / MiMo 7.70B credits / OpenDesign 450K credits）；`a/b≈remaining%` 时 a 是剩余（Loomy 今日积分）；K/M/B 量纲换算。Copilot Chat/Completions 的 `Unlimited` 走新 `detail.leftText` 契约字段原样显示，不再伪装成 100%。
- **Antigravity 卡去重 + 按当前模型收窄到额度池**：上游把每模型的同一额度按「模型×档位」复制下发（Opus/Sonnet/Argon 各 3 档完全相同），另附池级名行——去重后 4 窗 3 池：Claude & GPT 周（Opus/Sonnet 同池合并）、Gemini 4 Argon 周、Gemini 5h + 周；`groupLabel` 池词汇（`non-gemini`/`gemini`/`gemini-argon`）与 `poolScope:"independent"` 跟独立通道同口径，享受分池状态结论。当前路由模型按已知家族规则（claude/opus/sonnet/gpt→non-gemini 池，argon→gemini-argon 池，gemini→gemini 池）只显示对应池窗口，路由行加「（池 {名}）」，认不出的模型退回整卡口径。
- **纯剩余文本窗解析出数量**：Magpie `text:true` 窗口（Loomy「永久积分」）的 `display` 就是剩余量本身，解析进 `detail.left` 显示「余 19.7K 积分」，不再报占位百分比 100%。
- **窗口卡片显示额度原名**：Magpie 卡窗口标题用上游给出的额度名（Trae「Credits」、「Total credits」，SenseNova「通用积分池 · 5 hours」），不再一律显示「本周期/每月」周期词；原名已在标题位时说明行不重复。
- **弹层头部钉顶**：账号列表滚动时，厂商名与额度状态横幅固定在弹层顶部不再被卷走；点选下方账号横幅仍可见。
- **积分型窗口报实际数量，不只报百分比**：Magpie 卡片窗口带 `amount`/`limit`/`unit` 时（如 SenseNova Token Plan 的 `347.54 / 1200000 credits`），药丸、悬停与弹层窗口卡片显示「余 1.20M credits」；百分比余量条仍保留，没有数量口径的窗口照旧报剩余百分比。QuotaEntry `window` 元素新增 `left`（剩余量）字段与 `detail` 往返映射。
- **Magpie 纯余额卡补齐字段**：消费顶层 `balance` / `alias` / `until`——Raccoon 等无窗口卡现在显示掩码账号名、结构化余额（`amount` 元素 + 余额行）与到期日，不再只显示内部账号 ID 且标为不完整。
- **Magpie 药丸只显示当前调用的上游**：routeContext 有路由记录时（如 `devin/swe-2`），药丸的窗口、百分比与状态按命中卡（`cardId` 回指）判定，不再把全部卡片的最紧窗当成当前上游的额度；弹层只平铺焦点组，其余组收进「其他渠道」折叠。没有路由记录时退回聚合总览。同时修复 `normalizeMagpie` 向无 `user` 卡下发显式 `user: undefined` 导致 `subusage_quota` 输出被判为不可序列化的问题。
- **药丸收起态直接给数字，与核心药丸对齐**：健康窗口 / 分池 / 多账号条目在余量条旁直接显示最紧窗剩余百分比，不再空着只画条；纯数字条目（余额合计、账号计数、无限制）撤掉 ℹ 占位符让数值自己站住；⚠/✕/? 等告警语义图形与告警短文案原样保留。联动渠道与内置订阅现在共用同一套「数字优先」的收起形态。
- **QuotaEntry 元素补齐结构化字段**：元素新增 `id`（稳定身份）、`poolScope:"independent"`（仅 window，声明独立预算）、`amount.unitId`（聚合键，`unitIdOf()` 归一 credit/token/usd/cny/request 同义词，未知单位小写原文不猜）、`amount` 元素 `componentOf`（总额分项，合计时跳过）与 `diagnostics[]`（规范化丢弃/降级留记录）。**`quotas` 在场即权威**：是数组（含 `[]`）就按它派生 windows/extras，不从 legacy 反向导入；`windowFromQuota` 只在 `limit>0` 时推 `percent`（不出 NaN），`pool` 兜底 `groupLabel`，amount 保留 `label` 前缀；`RESERVED_KEYS` 阻断已知但坏形状的字段回透传。stale 保留条目复制 `quotas`；所有 emit 点（provider/refresh/linked/ofm-auto/desktop-route/含 keyAccounts/quota() 投影）统一过 `canonicalizeEntry`。
- **联动与聚合归一化全量产原生 quotas**：EAC（`normalizeEac`）、credit-packages（`quotaPackages` 结构化包组）、Trae CN 面板（窗口 + 余额 + Work/通用积分 componentOf 分项 + 包）、WorkBuddy（月度包 window + 总积分 + 包）、OFM（窗口 + 余额 + 包，多单位混合时余额不下发）、Antigravity（两通道窗口标 `poolScope:"independent"`——全仓唯一真独立池）、Magpie（窗口 pool=providerGroup、note/holdsWhy 透传）、ApiGoto（订阅窗 + plan 徽标 + 套餐剩余 role:plan + 充值钱包 role:wallet）。
- **Client 端口消费配额契约**：`readAmounts` 结构化金额选择器（quotas 优先、extras 文本兜底）；多账号纯余额按 `unitId` 分组求和（"credits" 与 "积分" 同一币种才合）；`independentPools` 由元素 `poolScope` 声明驱动、不再查 providerId（quotas 缺席的旧条目保留 antigravity 兜底）；账号行余额 quota 优先；`UNIT_ALIAS` 与 Host `unitIdOf` 同口径。
- **额度 wire 统一为 QuotaEntry 契约（模板化重构）**：新增 [quota-entry.js](../lib/quota-entry.js) 单一事实源——所有 provider / 联动 / 聚合器只喂数据，每个额度元素自声明 `order` / `label` / `amount.unit`；状态推断、覆盖率、阈值告警、布局、i18n 与弹层密度收归管线与渲染端口。元素类型 `window`（百分比窗口）/ `amount`（余额·附赠·钱包·套餐·花费）/ `package`（额度包）/ `plan` / `status` / `note` 可自由组合，维度是「账户 × 池 × 元素」。出边界统一 `canonicalizeEntry()`：`ofmAccounts` → `linkedAccounts` 别名折叠（wire 上不再有 `ofmAccounts`）、quotas ↔ windows/extras 双向补齐、`quotas` 恒为数组、`windows`/`extras` 保留「缺席 ≠ 空」语义。契约全文见 [docs/quota-entry.md](quota-entry.md)，回归见 `tests/test-quota-schema.mjs`。
- **Magpie 路由展示端口化**：`magpieRoute` 字段更名 `routeContext` 并成为模板端口——条目带该字段（含空对象）即渲染路由行，Client 不再查 `providerId`，其他通道复用同一渲染。`OfmAccountList` 更名 `LinkedAccountList`，i18n 键去掉 magpie 前缀（`routeLive` / `routeLast` / `routeAuto` / `routeNone` / `groupCards` / `otherGroups` / `servingHit`）。

## 0.24.2：多账号余额完整性与来源单位修正

- 修正 WorkBuddy 多账号用量：批量接口已给出逐账号余额、却缺少可选积分包明细时不再误标「数据不完整」；余额完整计入总积分，明细未提供在选中账号后说明。多账号弹层默认显示总额，点选账号才看该账号的数值；账号池模式只在当前账号行标注，不再每行重复。缺失余额与真实刷新失败仍保持降级。根据截图中的四个余额编写回归，未更改提供方实际账号选择。
- 核对 Loomy、Raccoon 等其它账号来源：EAC 回退的空包余额不再误报不完整或编成 `credits`，已知的 `credit(s)` / `token(s)` 同义单位先归一化再汇总，混合单位不借第一个包标记总额，错误形状的包字段仍降级；OFM 仅有总余额、未返回包字段时仍展示真实余额。Loomy 缺少每日分项且没有官方可用总量时不猜总积分；Trae 汇总与包都没读数时不再伪造 0，空包但有汇总、ZCode 合法空桶仍保留来源已知的单位。补齐多账号、缺失账号和单位回归。

## 0.24.1：MiMo 续期、联动药丸有效余额与工具去重

- **优化 OFM / 联动账号的药丸与展开 UI**：多账号收起态不再混合不同账号的窗口，而是画最紧窗口所在账号自己的余量条，并在横幅与悬浮说明标明归属；额度耗尽优先于缓存提示，任一账号部分失败或旧缓存不再被汇总成全绿。账号行复用统一状态判定，改为 Command Code 同款紧凑卡片与选中边线，长账号/状态标签在窄屏可收缩，再次点击选中项明确回到全部账号。
- **修正 OFM 额度展示边界**：`credit` / `credits` 与 `token` / `tokens` 按已知同义单位归一化，避免总余额和积分包被误拆；没有包明细时仍显示真实 `total`（含 0），无单位不编造。回归覆盖代表账号多窗、耗尽优先级、子账号部分失败、单位同义词与空包零余额。
- **Loomy / TRAE / Raccoon / Qoder 药丸显示总积分**：多账号纯余额入口按用户选择显示总额度，相同单位才合计，不同单位分别列出；点开后一行一个账号，金额收敛浮点尾数，同名账号补序号，单账号直接显示自身余额。失败/旧缓存/缺数字时给「已读合计」与覆盖数量，无数据不补造总计 0；按合计数值判定余额告警，单个账号为 0 不误报整个渠道耗尽。单账号不重复账号卡片，选中账号的说明只保留一份。多账号汇总本身的 partial 标记不再把完整账号数据误报成不完整。使用真实工具读数的脱敏数值进行 Client 回放，不把回放表述为安装后的 GUI 验收。
- **工具结果按真实来源与账号去重**：相同本机直取或 OFM 来源被多个入口引用时，同一渠道和稳定账号 ID 只报告一行，优先使用原生入口标签；点名单个 OFM 入口仍保持原 ID。不同来源、不同区域、同名不同 ID 和缺少稳定 ID 的账号不合并。
- 查看其它账号只改变弹层，药丸保持总览，也不修改实际推理选择。页面与工具继续使用完整直取池，修正本机直取的 Qoder 等标签不再误称 OFM，并按逐账号状态归并汇总完整性。
- 修复 MiMo 扫码续期材料收集：保留出码与扫码确认阶段下发的设备信息，同名 Cookie 采用最新值，保存与换票使用同一份续期材料。额度缓存命中时按当前会话 Cookie 与扫码续期材料重新计算登录状态，避免旧缓存误报 Cookie 到期。使用有效续期材料时仍静默换新 Cookie，网络异常自动重试，续期材料失效才要求重新扫码；历史登录缺失的材料需重新扫码取得。新增隔离回归，尚未做真实账号长期续期验证。

## 0.24.0：MiMo 扫码登录自动续期、本机直取与联动重构

- **MiMo 扫码登录支持自动续期**：此前扫码成功只保存 24 小时的控制台 Cookie，一个月有效的 `passToken` 换票后即丢弃（`mimo-qr.js` 头注释写的「保存 passToken、每次取数前重新换票」并未实现），所以每天都要重新扫码。现在扫码会把 `userId` + `passToken` + `deviceId` 作为续期材料写入 `xiaomi.renewal`；Cookie 距到期不足 10 分钟、已过期或被上游拒绝（401/403）时，Host 在取数前用它经 `serviceLogin?sid=api-platform&_json=true` + `clientSign` 静默换新并重新计时，用户无感。续期失败才提示：`passToken` 被撤销 / 到期 → 「自动续期失败，登录已失效，请重新扫码登录」且不再重复请求小米；网络 / 接口形状异常 → 按 1 / 10 分钟自动重试。有续期材料时不再显示 Cookie 倒计时，设置页显示「自动续期已开启，登录有效至 …」。浏览器登录、手动粘贴与清除凭据会丢弃续期材料（避免把别的账号续成旧账号）。该协议经隔离测试覆盖（`tests/test-mimo-renew.mjs`），未用真实账号长期验证。
- **修复 MiMo 设置页扫码登录与浏览器登录的按钮冲突**：两条登录共用同一份任务状态，扫码进行中会同时出现浏览器登录的进度条与「请在浏览器中完成登录」，失败提示也两套并存，且两个按钮都是主按钮。现在按任务通道归属渲染：二维码 / 浏览器进度 / 失败提示只出现在发起它的通道下，取消入口只有一个，任一进行中另一个登录按钮禁用；扫码是主按钮（标「推荐」），浏览器登录改为次按钮「浏览器登录并导入」。用量面板的快捷条同构（扫码主按钮 + 浏览器次按钮，手机引擎只有扫码），扫码入口会展开编辑器以显示二维码；Host 开始任一登录时会取消另一个进行中的任务（多窗口兜底）。

- **直取的两处边角**：Trae 账号池只有国际版账号时，直取不再就此收手，会继续读客户端 `storage.json` 里的 CN 登录；页面代取的多轮刷新里，直取在首轮读不到后 15 秒内不再对上游重复请求（新一轮刷新的首轮照常重试，重新登录后立即恢复）。回归见 `tests/test-local-link.mjs` 第 8、9 段。
- **修复两处联动缺陷**：① 本机直取在 60 秒缓存命中时同步返回普通对象，Host 对它调用 `.catch` 会抛 `TypeError`，导致缓存期内的非强制刷新把正常额度显示成错误；现在直取与 EAC 读取统一经 Promise 包装。② 页面代取遇到 404（独立插件未安装）时不再提前终止，而是把 404 回传给 Host，由 Host 走 OFM / EAC 回落或回一条带原因的缺席条目。新增缓存命中回归（`tests/test-local-link.mjs`），并改写原先固化提前终止行为的 404 客户端断言（`tests/test-client-ofm.mjs`）。

- **新增药丸统一沿用 Command Code 的展示逻辑**：多账号窗口在健康收起态只画余量条，不再常驻百分比；顶层没有窗口时也使用各账号窗口绘制。账号行改为与 Command Code 轮换池一致的单行样式，并显示各账号自己的余额或窗口余量。纯余额多账号优先显示提供方确认的当前账号，无法确认时显示账号数量，不再跨账号合计。OpenDesign 计费来源收进悬浮说明与弹层，不再与健康余量条并排占字；Antigravity 分池横幅恢复统一尺寸，仅保留不重复的结论。新增多账号窗口形态与收起药丸回归，弹层密度上限保持不变。
- **积分包改为分组摘要**：新增 [credit-packages.js](lib/credit-packages.js)，本机直取 / EAC、OFM、WorkBuddy 与 Trae 联动共用同一套规则。已用尽和能确认已过期的包不再显示；有效包按「今天到期 / 3 天内到期 / 临时额度合计 / 周期或套餐 / 永久额度」聚合，保留紧急组的最早到期时间。不同账号、不同单位不混合；已有额度窗口的包只补紧急提醒。EAC 未公开的数字时间单位仍不猜测。回归见 `tests/test-credit-packages.mjs` 及各渠道既有测试。
- **六个渠道改为「本机直取」**：Raccoon / Loomy / Qoder / Qoder 中国版 / ZCode / Trae 不再只靠 OFM 或兄弟插件的 HTTP 路由——新增 [local-usage.js](lib/local-usage.js)，直接从 DSH 凭据库按 `channel-pack/state.json` 的 `credentialRef` 取账号凭据，自己调各家只读额度接口（小浣熊 `points/v1/balance`、Loomy `points/records`、Qoder `sash/api/v2/me/usage`、ZCode `zcode-plan/billing/balance`），输出与 EAC 同形、复用 `normalizeEac` 归一化。实测本机拿到 Raccoon 两账号（6600 / 6900）、Loomy 两账号（25000 / 20000）、Qoder 100、Qoder 中国版 544。直取优先、失败静默回退原有来源链；**只读不刷新**（EAC 会轮换 refresh_token，抢刷新权会互踢），也不碰签到/领取类写接口。Trae 也纳入直取：从 `%APPDATA%/Trae CN/User/globalStorage/storage.json` 解出客户端凭据（AES-128-CBC 自封装，含自校验）后调 `web_user_ent_usage`，本机实测剩余 1754.28 credits（total 2600 − consumed 845.72），3 个积分包；CLI 那族 JWT 不再参与（它就是 401 / code 1001 的来源）。多账号读账号池 `$DSH_HOME/.trae-auth.<region>.json`（客户端 `storage.json` 只有当前登录），本机两个账号分别读到 621.85 与 1754.28 credits。Cline 与 LobsterAI 本机无任何凭据故未接；MiniMax 因短效 token 与自刷新抢权风险本轮不做。回归见 `tests/test-local-usage.mjs`。
- **兄弟插件联动改为「页面代取」**：DSH 的 `/plugins/*` 要求浏览器凭据（连接层 `admit()` 的 cookie 认证），宿主进程发的本机 HTTP 请求一律 403——上一版重装 DSH NEXT 后 Trae / WorkBuddy / 小浣熊 / Loomy 七条同时失败就是这个原因。现在由渲染进程带同源 cookie 取原始响应，宿主只跑归一化（新增 `subUsage/linkedStep` 两段式：宿主说缺哪个 URL → 页面 fetch → 回传 → 宿主算），业务逻辑仍只有一份。404 / 未登录 / 上游拒绝都回一条**带原因**的条目（不再让药丸静默消失），并继续走 OFM / EAC 回落；同一渠道 60 秒内复用上次成功读数（`force` 绕过，失败结果不缓存）。只有宿主根本不认识 `linkedStep` 时才退回旧路径，其余失败照实报出。回归见 `tests/test-linked-client-fetch.mjs`（缺席、回落、缓存、非法响应）与 `tests/test-client-ofm.mjs`（404 / 离线 / 5xx / 回退判定 / 轮数耗尽）。
- **EAC 三渠道作为 Loomy / Raccoon / Qoder 中国版的回退来源**：接上 [dsh-eac-router](https://github.com/KouzakiUmi/dsh-eac-router) 的 `/api/eac-router` 只读 JSON-RPC（`credits.balances`）。三处读的是同一批账号，因此不新增并列条目：独立 `dsh-raccoon-connect` / `dsh-loomy-connect` 与 Our Free Model 都缺席时，药丸才回退到 EAC（Qoder 中国版经 `ofm-qodercn` 回退）。全量报告与工具查询不回落，保持既有请求量。EAC 未安装（404）或后端未就绪（`eac-router/not-ready`）都按「这轮没有这条通道」处理，不顶红卡片；上游真实失败照实报出。归一化只读余额与积分包，EAC 未公开的时间单位不做换算。新增隔离回归 `tests/test-eac-link.mjs`。
- **修复 EAC 三渠道一律 401**：`/api/eac-router` 属宿主的鉴权面，原先用本机回环 HTTP 裸请求会缺会话凭据被网关回 401——Loomy / Raccoon / Qoder 中国版 三条同时失败正是同一个原因。改为与 Our Free Model 相同的 Connection 进程内 Fetch（自建 `owner` peer + `/api` 共享 handler），不再经过网络层鉴权。回归改为断言「走 `http://dsh.internal/api/eac-router` 且不得出现 `/api/eac-router` 的本机 HTTP 调用」，防止再退回裸请求。
- **弹层精简为「金额正文 + 折叠明细」**：余额 / 花费 / 套餐余额这类「一个数字就是结论」的行留在正文；积分包、到期时间等逐条说明收进 `details`，summary 只报条数，收起状态不显示到期时间。说明里的上游 ISO 时间（`2026-11-27T17:37:48.000Z`）渲染时换成本地时间。多账号渠道按 Command Code 账户区的做法：账号全部平铺，一行一个账号并显示余额或窗口余量，点行切换查看对象；只有选中的账号才展开自己的说明明细。凭据到期时间只在真的过期时占一行。药丸弹层、逐账号区块与设置页用量面板共用同一个 `ExtrasBlock`。工具报告（`subusage_quota`）的说明类额外项同样收敛为「说明 N 条」，不再把四十多条积分包逐段拼进一行。
- **精简 Antigravity 顶部状态提示**：分池横幅只保留一句结论，缩小图标、字号和留白，去掉与下方额度卡片重复的逐池余量、周期和重置摘要；悬浮说明仍保留完整详情，缓存和失败提示照常显示。

## 0.23.0：独立插件多账号额度与 Antigravity 分池展示

- **独立插件与 OFM 多账号额度**：补齐独立 Trae 国内/国际逐账号查询、WorkBuddy 国内/国际多账号余额，以及独立 Raccoon / Loomy 的当前登录状态；Raccoon / Loomy 药丸仅在独立接口缺席时回落 OFM。OFM 增加 `account.list` 索引合并与 Host 凭据存在性检查，保留稳定账号 ID、启停、登录元数据及独立失败；药丸支持全部账号/指定账号查看，实际推理选号由提供方管理。
- **鉴权与归属核查**：OFM 显示偏好不再被当作可用的账号模式；真实池行用 `accountId`，未知当前/固定状态不补造。WorkBuddy 总览与明确选中账号冲突时舍弃未知归属包，批量余额缺字段不补零；Trae 企业版不拿个人积分替代。Raccoon 操作秘密 `probeKey` 在缓存前剔除，Loomy 保留缓存时间与账号归属未知提示。移除 Trae 双层缓存，缺席后可立即恢复探测，强制刷新和卸载保持代次保护。接口与验证范围见[联动说明](ofm.md)。
- **Antigravity 按独立额度池判断状态**：Gemini、Claude/GPT 与 Gemini Argon 分别计算池内最紧窗口，部分池用尽时药丸显示如「1/3 池用尽」并作黄色提醒，只有全部已报告池耗尽才标红；顶部横幅与悬浮说明列出每个池自己的余量和重置依据。缓存、部分数据和读取失败保留对应提示。两个联动通道的已知组名统一为可读的中英文，`gemini-argon` 显示为「Gemini Argon 模型」；原始池标识与查询行为保持一致。

## 0.22.0：OFM 额度联动与手机药丸展开

- **OFM 额度联动**：新增小浣熊、Loomy、Qoder 国际/中国版、LobsterAI、TRAE、Cline、MiniMax Code、ZCode 和 Gemini 十个 `ofm-*` 入口，直接消费提供方的 `usage.badge`。按账号分别展示，保留原单位、额度包与 Cline 独立订阅窗口。小浣熊、Loomy、Qoder 已做上游真实账号只读核验；其余渠道与进程内 RPC 接线通过隔离回归，未做安装后的在线联调。范围见 [OFM 说明](ofm.md)。
- **DSH Go 药丸展开**：在底部 `panel` 网页岛中向下展开并参与内容高度，修复原先向上展开后被裁切的问题。独立 Chrome 以真实网页岛 CSS 覆盖深浅主题 × 320/360/430px、滚动及键盘视口，桌面弹层定位保留；Android 真机与其他插件药丸不在本次验收范围。
- **新增 Antigravity 独立开关**：设置 → 订阅用量 → 提供商管理顶部提供开启 / 关闭按钮，默认开启。关闭后 Host 不再调用 Antigravity 提供方插件，`quota()` / `subusage_quota` 不再返回该项，Client 隐藏药丸并阻止关闭前的迟到响应重新显示；重新开启立即恢复查询。同时覆盖在途成功、缺席和失败响应；其他窗口关闭后，旧药丸在下次查询时移除，重新开启可随轮询恢复。只改变用量读取与显示，不修改模型路由、登录状态或凭据，也不影响 Trae 联动。

## 0.21.3：精简 `subusage_quota` 的工具提示词

- 工具描述原先有 2683 字符，`providers` 参数描述另有 792 字符，是常驻提示词里最大的一项。精简后分别为 866 与 63 字符，合计从约 3475 降到 929（约 870 → 232 token）。
- 砍掉的是能在别处读到的内容：厂商清单（render 输出的报告里就有）、`state` 枚举、`omitted` 规则、`windows` / `extras` 字段含义（都在 output schema 里）、Command Code 多账户形态、Antigravity 与 Trae 各自的取数来源。保留的是模型必须知道的：无参即读全部、可传厂商名、认不出名字会回全量加说明、只读不写凭据、缓存 60 秒。
- 顺带确认了一个事实：`dsh-tools` 的 `schemaOf()` 只把 `name` / `description` / `parameters` 投影给模型，**output schema 不占提示词**。所以这 9.6K 的工具定义里只有描述部分真正进上下文。
- 4 处测试原先靠文案断言（`includes("unmatched name")`、`includes("multi-account")`、`includes("dsh-connect-trae")`）守住契约，改为校验实际调用行为；新增两条体量上限（描述 < 1000 字符、参数描述 < 200 字符），防止又长回去。
- 无功能变更：只改提示词与测试断言，工具行为、输出结构与查询逻辑不变。

## 0.21.2：文档收尾（扫码登录后的措辞对齐）

- 0.21.0 起 MiMo 已能扫码登录，但文档与界面文案还停在「打开官方登录页 + 手动粘贴 Cookie」的阶段，读起来像手机端只能靠导 Cookie。
- `mobileNoAuto` 改为指明 MiMo 可扫码、其他站点才需手动粘贴（中英文同步）；这是提示文案，不改任何行为。
- README 的 dsh-go 段落与 FAQ 同步：手机引擎没有 Chrome 属预期，MiMo 用小米账号扫码，OpenDesign 手动粘贴 Cookie（该站小众，手机上不另做登录通道）。
- 更新记录把 0.21.0 的两条「未发布」条目归入正式版本，并注明原生胶囊已移除的原因（只能打开网页，与已有手动导入重复）。
- 无功能变更；`npm run check` 全绿。

## 0.21.1：扫码登录补上药丸快捷入口

- Cookie 过期或缺失时，药丸上方的「建议操作」横幅原先在手机上只有「手动导入 Cookie」——扫码按钮只藏在提供商编辑器里，要先展开编辑器才找得到。现在手机引擎上 MiMo 的横幅直接给「小米扫码登录」，与「手动填写」并列；有浏览器的主机保留原「登录并自动导入」，两条通道不互相挤占。
- 无行为变更：只是把已有能力放到用户真正会看的位置。

## 0.21.0：小米账号扫码登录 MiMo 额度，并适配 dsh-go 手机引擎

**小米账号扫码登录（`lib/mimo-qr.js`）**

- **动机**：MiMo 的套餐额度接口 `/api/v1/tokenPlan/usage`、`tokenPlan/detail`、`balance` 只认控制台会话 Cookie（`api-platform_serviceToken` + `userId`）。推理用的 `tp-`（Token Plan）与 `sk-`（按量付费）Key 都读不到：实测两者请求控制台接口一律返回 `401 {"code":401,"loginUrl":…}`。官方 `@mimo-ai/cli` 的二进制里没有任何额度端点（46MB 归档内搜不到 `tokenPlan`/`usage`/`quota` 路径），第三方 CLI 的 `/v1/token_plan/remains` 在 `api.xiaomimimo.com` 与 `token-plan-cn.xiaomimimo.com` 上都是 404。而手机上浏览器普遍不再允许导出 Cookie，手动粘贴这条路在移动端等于不存在。
- **方案**：改用小米账号官方的「用小米手机扫一扫」授权（`sid=api-platform`，回调 `platform.xiaomimimo.com/sts`）。协议全程是普通 HTTP，不需要浏览器；手机「设置 > 小米账号」自带扫码器。新增 `lib/mimo-qr.js`，与 `CookieLogin` 并列（那套骨架是「开浏览器 → 抓 Cookie」，这里无浏览器且多一步换票），终态语义保持一致以便复用同一套登录卡片。
- **协议四步**（均实测）：① `serviceLogin?sid=api-platform&_json=true` 取 `_sign` 与初始 Cookie；② `longPolling/loginUrl` 取二维码 `qr` 与长轮询地址 `lp`；③ 长轮询等扫码，返回 `userId`/`passToken`/`nonce`/`ssecurity`/`location`；④ `location + clientSign` 换控制台 Cookie，其中 `clientSign = base64(sha1("nonce=<nonce>&<ssecurity>"))`。
- **两个实测陷阱**：(a) 第①步下发的 `deviceId` 等初始 Cookie 必须带到后续请求，缺了扫码后小米回 `70036 系统错误`；(b) `nonce` 是 19 位整数（超过 `Number.MAX_SAFE_INTEGER`），直接 `JSON.parse` 会把末几位改写（`…275584` → `…276000`），签名随之算错、换票恒回 401。`parsePollResponse()` 用正则取原始字面量绕开它，测试钉住该行为。
- **凭据**：只保存换到的控制台 Cookie（与手动粘贴同一落点）；`passToken` 声明有效期一个月，控制台 `serviceToken` 按服务端声明通常 24 小时。凭据不进入公开状态、RPC 响应与错误消息（`status()` 只带二维码与进度）。
- **入口**：Host 新增 `startMimoQrLogin` / `getMimoQrStatus` / `cancelMimoQrLogin`；`loginCodec` 增加 `starting` 状态与 `qr`/`qrTip`/`expiresInSec` 展示字段。设置页 MiMo 卡片新增「小米扫码登录」按钮，点开显示二维码；手机端原本「打开登录页 + 手动粘贴 Cookie」的引导改为扫码优先，手动导入保留为备选。
- **实测**：本机（dsh-go 手机引擎）完整跑通，读到真实套餐数据（Pro 套餐、周期结束日、已用/上限与百分比、CNY 余额）。
- 回归：新增 `tests/test-mimo-qr.mjs`（nonce 精度、签名稳定性、Cookie 解析、完整状态机、凭据不外泄、取消与重新开始）；`tests/test-contract.mjs` 与 `tests/smoke-host.mjs` 的方法白名单同步。`npm run check` 全绿。

**dsh-go 手机引擎适配**

- Host 新增运行环境探测：读 `/etc/dsh-app/runtime.json` 判定是否 dsh-go 本机引擎；结果经 `host.mobile` / `host.browserLogin` 交给 Client。路径与内容只用于判定，不含秘密，检测可注入（`options.hostRuntime`）以便隔离测试在手机上仍能验证桌面行为。
- 手机引擎里没有 Chrome/Chromium（实测 `playwright-core` 报 `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`，proot 内 `am` 也不可用），因此 `CookieLogin.start()` 在该环境下不再排队启动浏览器，而是立即返回 `subusage/no-browser` 与可读原因；桌面主机 `browserLogin` 恒为 true，流程与文案一字不变。
- Client 按该字段把「登录并自动导入」整组换成手机引导；MiMo 优先扫码，OpenDesign 走手动粘贴 Cookie（该站小众，手机上不另做登录通道）。OpenDesign 面板里「自动登录可用」那段说明在手机上不再出现。
- 曾加过 dsh-go 原生胶囊（「登录页」→「订阅登录页」面板），随后**已移除**：它只能打开官方登录网页，与设置页已有的手动 Cookie 导入重复，无法替用户完成登录，信息量不足以占一个原生座位。
- 回归：新增 `tests/test-dsh-go.mjs`（标记文件判定、坏文件降级、桌面自动登录行为不变、手机端 `no-browser` 且零次 `chromium.launch`、手动 Cookie 导入仍可用）。`npm run check` 全绿。**扫码登录路径已在本机 dsh-go 引擎实机验收**；桌面主机的自动登录仍以隔离测试守住。

## 0.20.0：Antigravity 用量接入本机 dsh-tool-antigravity，并进入输入区药丸

- **新增第二条 Antigravity 联动通道**：本机实际安装的 Antigravity 提供方插件是 [`dsh-tool-antigravity`](https://github.com/Jaylor-Wang/dsh-tool-antigravity)（0.5.x），它经 `ctx.provide("antigravityAuth", AntigravityAuthService)` 暴露服务，取数方法 `usage(signal?, force?)` 返回 `QuotaStatusView`（`state` 七态；`groups[]` 固定 `gemini` / `non-gemini` 两组，各带 `5h` / `weekly` 两窗的 0..1 剩余比例与 `resetTime`）。新增 `normalizeAntigravityAuthView()` 照其 `lib/types/quota.d.ts` 归一化：剩余比例换算成已用百分比，组名映射为「Gemini 模型」「Claude 与 GPT 模型」；`unauthenticated` 按未登录处理（全量静默、点名给登录指引），`forbidden` / `rate-limited` / `timeout` / `offline` / `protocol-drift` 各折成可读 error（查询限流不等于额度耗尽）。
- **与既有 `agyQuota`（dsh-antigravity-acp）通道二选一**：`LINKED_PROVIDERS.antigravity.channels = ["agyQuota", "antigravityAuth"]`，`linkedSnapshot()` 顺序探测，只在「服务取不到 / 没有该方法」时回落；服务在场但回失败快照不回落。同一份 Google Antigravity 配额始终只出一条 `antigravity`，agyQuota 信息更全（套餐名 + AI Credits）故优先。别名补充 `google-antigravity`（该插件的模型路由 id）、`dsh-tool-antigravity`。
- **Antigravity 联动首次进入输入区药丸**：选中 `google-antigravity` 模型路由时，Client 经 `ROUTE_PROVIDER_ALIAS` 归并到联动 id 并显示用量。联动项不进 `PROVIDER_META` / `PROVIDER_ORDER`（无设置卡片、无检测开关、不参与凭据 / 路由存在性过滤）。新增独立 Typert 方法 `subUsage/readLinked`（Host `readLinked()`，结果只含 `{ updatedAt, entries }` 不回 settings，避免药丸轮询顶掉设置快照），两端各加 `SubUsageLinkedQuery` / `SubUsageLinkedResult` codec。Trae 三块面板维持「仅工具报告」。
- 回归：新增 `tests/test-antigravity-tool-link.mjs` 与 `tests/test-client-antigravity-link.mjs`；更新 `tests/test-antigravity-link.mjs`（双通道缺席文案）、`tests/test-contract.mjs`（双端 codec + 方法白名单）、`tests/smoke-host.mjs`（invocations 清单）。`npm run check` 全绿。真实形状依据 dsh-tool-antigravity 0.5.2 的类型声明与其自带 pet-balance 消费代码双重核对；本机该插件账户池（`%LOCALAPPDATA%/dsh-tool-antigravity/accounts.json`）已有登录账号。**尚未安装到 desktop profile 重启做真机 GUI 验收**。

## 0.19.1：中转聚合商收窄到 APIGOTO，并优化其显示

**移除 `unorouter` 与 `qnaigc` 两条 provider（按用户决策）**：它们的信息量不足——UnoRouter 只给出 Key 级余额/累计消费，七牛云只有一个时间范围内的花费金额，都没有窗口或订阅语义，与药丸和额度面板要表达的东西对不上。移除后登记 **31 条** provider id，默认 11 开 / 20 关。注册表、归一化函数、`fetchProvider` 分支、Client 元数据与顺序表、`unorouter-sonnet` 路由别名、相关测试与文档一并清理；已经启用过这两家的旧配置在解析时被忽略，不再请求它们的端点。

- 窗口档位统一由 `windowKindFromSeconds()` 决定，APIGOTO 的 `window_sec` 与 OpenDesign 的 `durationSeconds` 共用同一套口径。
- 归一化统一返回 `windowExtrasResult({ windows, extras, coverage })`，字段名与默认值只有一处定义。
- 额度端点登记进 `PROVIDERS[id].usageUrl`，`fetchProvider` 不再散落硬编码 URL。

**APIGOTO 显示优化**（信息集合扩大，条目更有层次）：

- `plan` 徽标只放套餐名。到期日原先挤在徽标里（「套餐名 · 到期 2026-11-29」），现在另起说明行并带剩余天数：`套餐到期 2026-11-29（还有 31 天）`；已过期则写 `套餐已于 2026-11-29 到期`，不显示「还有 0 天」。**到期日仍然不写进 `resetsAt`**——它是套餐有效期，不是窗口重置。
- `policy_name` 与套餐名不同时补一行 `策略 …`；实测两者只差厂商前缀，相同时不重复占行。
- `mode` 翻译成中文显示（`subscription` → 订阅制，`paygo` → 按量计费），认不出的模式原样带出，不猜。
- `points` 非 0 时显示；0 是没有信息量的默认值，不占行。
- 充值钱包文案由「另有余额钱包」改为「充值钱包另有 N USD」，与主余额的「套餐内剩余」区分开。
- 窗口明细行在 `unit` 缺失时不再留一个悬空空格（新增 `detailUsedNoUnit` 文案键）。
- 回归重写为 `tests/test-relay-aggregators.mjs` 单家覆盖，钉住到期倒计时、策略去重、模式翻译、积分为 0 不占行、钱包为 0 不告警、`expires_at` 不进 `resetsAt`，以及已移除两家在注册表 / 顺序表 / 路由别名三处无残留。

## 0.19.0：三家中转聚合商（APIGOTO / UnoRouter / 七牛云）

- 新增 3 条 provider id，均默认关闭、不进新安装的默认开启序列；至此登记 33 条，默认 11 开 / 22 关。
- `apigoto`：`GET /v1/usage`（与推理同一把 Key 的 Bearer）。窗口档位由响应的 `window_sec` 换算，不从套餐名反推；百分比由 `used`/`limit` 算出（接口不给百分比）。**`subscription.expires_at` 是套餐到期时间，不是窗口重置时间**，只作为套餐信息文字带出，不产 `resetsAt`。余额取套餐内 `remaining`（单位随 `unit`），充值钱包 `balance_usd` 为 0 时不产生任何余额告警行，有余额时另起一行说明。
- `unorouter`：`GET /api/usage/token/`，必须用 **API Key 自身**认证（账户余额接口要另一种访问令牌，本插件不保存也不索取）。累计量按官方口径 500000 单位 = 1 USD 换算。`unlimited_quota: true` 时只报累计消费并说明无限额度，**不把负的 `total_available` 显示成欠费**。new-api 的失败仍是 HTTP 200 + `success: false`，此时映射为认证错误而不是数字。`unorouter-sonnet` 路由共用同一把 Key 与同一份额度，Client 用 `ROUTE_PROVIDER_ALIAS` 归并到 `unorouter`。
- `qnaigc`（七牛云）：官方只有**费用**接口 `GET /v3/stat/usage/apikey/cost?type=month`，单位人民币元，余额与资源包剩余只在控制台。因此产出 `spend` 而不是 `balance`，并在 `note` 里写明口径（本月消耗、原始标准价不含资源包优惠）——把花费当余额显示会直接误导。
- 三家都按「凭据服务 → 启动环境」的既有继承链取 Key，支持手动 Key 与额外引用名；响应不回显 Key。
- 回归：新增 `tests/test-relay-aggregators.mjs`（含三家归一化、Host 端到端端点与鉴权、`success=false` 映射、Client 注册与归并、花费文案）；既有测试的 provider 计数与默认关闭清单同步更新。
- **本轮仅用真实 Key 直连验证了接口契约与响应形状，未作 GUI 实机验收**；也未对七牛云之外的站点做套餐耗尽路径的真实观测。
- 已于 2026-10-30 经 `v0.19.0` 标签发布：Release 与主分支 CI 均 success，registry `latest` 为 0.19.0，Release 资产与 npm tarball SHA256 一致（184681 字节）。未安装到 `desktop` Profile、未重启 DSH。

## 0.18.2：客户端自定义 Key 同步与多 Key 监控

- 凭据解析优先使用 DSH 路由实际声明的 `apiKeyEnv`（客户端 Models 页保存自定义 Key 写入的引用名），修复客户端覆盖环境变量后插件仍读旧环境值、药丸与额度不跟随的问题。
- 每个提供商可在设置页添加最多 8 个额外监控的凭据引用名；各自独立查询额度并展示，只保存引用名、不保存 Key 值。药丸与用量面板始终显示当前路由实际使用的那个 Key，额外 Key 不参与药丸选择。
- 手动 Key 被清除（或 Ark AK/SK 被清除）后自动回到继承来源；`manual` 模式下手动 Key 缺失也不再短路整条继承链，修复删除手动 Key 后环境变量读不到的问题。
- 回归覆盖引用名持久化与校验、路由 Key 优先、额外 Key 额度、清除后回落、多 Key 缓存隔离与客户端保存补丁；未进行真实账号 GUI 联调。

## 0.18.1：MiMo 快捷重新登录修复

- 修复 Cookie 过期、即将到期及未登录提示中的快捷登录按钮误用下方凭据编辑器提供商的问题；现在明确登录当前用量面板的 MiMo，并展开对应进度。
- 避免切换编辑器后恢复登录状态的迟到响应将新任务覆盖为 idle；保留未保存编辑保护与重复启动保护，下方配置区登录继续可用。

## 0.18.0：OpenDesign 药丸计费来源

- OpenDesign 套餐与付费路由分别标注「使用套餐额度」和「使用余额」；套餐任一额度窗口确认用尽后，标注改为「使用余额」，展开可见余额续用说明。
- 套餐读数缺失、过期、部分覆盖、查询失败或已过重置点时，显示「计费来源待确认」；无订阅与额度用尽分别说明，未知路由不猜分类。
- 只增加药丸及弹层标注，账号额度缓存、查询与计费行为不变；原有套餐告警加上套餐前缀，避免被误解为余额耗尽。

## 0.17.0：手动匹配 provider 与插件路由适配

- 新增默认关闭的「手动匹配 provider」开关，可将一个订阅绑定到多个本机已注册的 provider；支持逐项添加、移除和持久化，关闭开关保留绑定。
- 映射只影响药丸对应的订阅显示，不改变凭据、查询端点或检测规则；手动绑定优先，未绑定路由保留自动匹配。同一路由不能重复分配给不同订阅。
- 根据插件源码补充自动匹配：`dsh-volcengine-provider` 的 `volcengine-agent-plan` / `volcengine-coding-plan` 分别映射到现有 Ark Agent / Coding 入口；`dsh-opendesign-corouter` 的 `opendesign-corouter-plan` / `opendesign-corouter-paid` 均映射到 OpenDesign。
- README 增加手动绑定用法及兼容插件清单，区分路由匹配、凭据复用和仅工具报告的额度联动。
- 药丸使用实际选中路由的独立查询上下文，避免自定义名称因订阅原始路由不存在而被过滤；首次查询与后续轮询均适用，设置页路由过滤与检测开关不变。
- 完整隔离测试与清单检查通过，覆盖多端点绑定、优先级、关闭恢复、持久化、重复绑定校验，以及自定义路由冷启动、请求合并、轮询和卸载。离线浏览器检查通过深浅主题各四种宽度；未安装或进行真实 GUI 联调。

## 0.16.3：提供商管理与 Ark 分组检测

- 提供商管理改为稳定的单列列表，配置按钮在对应行下展开凭据编辑器，不切换上方用量。
- Ark 个人版与 Team 分别由 `visibility.ark` / `visibility.arkTeam` 控制；Team 默认关闭，旧配置未显式设置 `arkTeam` 时也按关闭迁移。共享 AK/SK 不变。
- 修复仅开启 Team 时管理卡片把 Team 状态用于个人版开关的问题；个人版状态与操作始终绑定个人版组。
- 完整隔离回归与清单检查通过；新增用例覆盖仅开启 Team 后重新开启个人版。未进行真实账号请求或宿主安装验收。

## 0.16.2：OpenCode Go 的 GO 专属凭据引用

- **问题**：`opencode-go` 的凭据引用此前硬编码为 `OPENCODE_API_KEY`。pi-ai 内置路由确实默认用这个名字，但它同时是 OpenCode Zen（按量付费）的变量名；把 Go 套餐单列一把 Key 时，DSH 里该路由的 `apiKeyEnv` 会写成 `OPENCODE_GO_API_KEY`（本机 desktop profile 即如此）。结果是**模型能正常调用、额度却报「无凭据」**——路由与额度插件读的是两个不同的引用名。
- **修法**：`PROVIDERS["opencode-go"]` 增加 `envAliases`，凭据解析改为逐引用名进行（`credentialRefNames()`）：先 `OPENCODE_GO_API_KEY`、再回退 `OPENCODE_API_KEY`；**名字优先、来源其次**——同一个名字内部仍是「凭据服务 → 启动环境」，前一个名字两种来源都没有才看下一个名字。这样通用名里那把 Zen 余额 Key 不会被当成 Go 订阅 Key 拿去查额度。其它 provider 没有 `envAliases`，解析路径与顺序完全不变。
- Client 同步：`PROVIDER_META["opencode-go"].envName` 改为 `OPENCODE_GO_API_KEY`（与 Host 同源，`tests/test-contract.mjs` 增加两端 `envAliases` 一致性断言），设置页「技术信息与帮助」里的「继承变量」显示为 `OPENCODE_GO_API_KEY / OPENCODE_API_KEY`（取第一个有值的）。
- 测试：`tests/test-opencode.mjs` 新增 7 组凭据引用断言（专属名优先 / 通用名回退 / 专属名认启动环境 / 名字优先级高于来源优先级 / 两者皆无 → `none` / 端到端 Authorization 用的是专属名那把 Key / 条目对外主引用名）；`node tests/run-all.mjs` 全部通过。
- 文档：README 的「凭据与环境」表与 provider id 映射、`docs/credentials.md`（新增「OpenCode Go 的两个引用名」小节）、README 排错表补一条「模型能调用但额度报无凭据」。
- **真机只读验证（2026-10-25，经用户授权）**：用本机凭据库里真实的 `OPENCODE_GO_API_KEY` 走 0.16.2 的解析链请求 `GET https://opencode.ai/zen/go/v1/usage`，HTTP 200，`state=ok` / `keySource=credentials` / `envName=OPENCODE_GO_API_KEY` / `coverage=complete`，三窗 rolling 3% · week 97% · month 56%（重置 2026-10-25T07:51:57Z / 2026-10-26T00:00:00Z / 2026-11-13T17:40:48Z），用时约 0.9 秒；密钥未输出、未落盘。修复前同一份凭据因引用名不匹配只会得到「无凭据」。
- **桌面 Profile 安装（2026-10-25，经用户授权）**：`dsh-subusage@0.16.2` 已装进 `desktop` Profile——依赖 spec、`pnpm-lock.yaml` 与 `node_modules/dsh-subusage/package.json` 均核对为 `0.16.2`，已安装产物里能查到 `envAliases` 与 `OPENCODE_GO_API_KEY`；`dsh.profile.bundles` 不变。发布未满 24 小时，按 pnpm 供应链策略用 Profile 的 `minimumReleaseAgeExclude`（`dsh-subusage@0.16.1 || 0.16.2`）放行该版本，未下调全局门槛。随包 Desktop CLI 的 `add` 在该机两次都在 pnpm `added 0` 处因 Electron crashpad 崩溃（退出码 `4294930435`），改用随包独立 node 驱动同一个 pnpm 完成（既有故障的等价通道）。**未重启 DSH**：界面验收需重启后由用户执行，运行中的 Host 仍是 0.16.1。

## 0.16.1：客户端小修与文档新鲜度巡检

- OpenDesign 设置页的自动登录说明纠正：0.14.2 时记录的「Playwright 自动登录会被 Cloudflare 挑战挡住、手动导入是唯一路径」已不成立——实测按钮可用（2026-10-24 确认：临时浏览器不自报自动化身份后，人机验证由用户在弹出窗口里亲自完成）。按钮与登录流程保留原样，原「会被挡住、请用手动方式」的段落改为引导在弹出窗口完成验证，手动导入与控制台入口保留为备选。
- 设置页拨动火山方舟**组开关**后立即刷新那 4 条路由：组级字段 `visibility.ark` 不在 `providers` 里，旧逻辑收集不到要刷新的条目，开启后界面停留在旧的「检测已关闭」直到点进标签页或 60 秒定时刷新。现在 `ark: true` 的保存会把全部 Ark 路由加入刷新列表（关闭不需要刷新）。
- Client 的 query codec 允许空 `providerIds`：`readSettings` 的「只读设置」请求本来就发 `providerIds: []`（Host 端同口径接受），但 Client 端 `parseQuery` 此前要求非空——当前网关出站不校验所以没炸，属于潜伏契约地雷；现在两端对齐。
- 测试：`tests/test-client-render.mjs` 增加 OpenDesign 标签页「自动登录按钮在场 / 人机验证说明与控制台入口保留」断言；`tests/test-client-behavior.mjs` 增加组开关「关闭不追加刷新、重新开启立即刷新全部 4 条路由」与 `parseQuery` 空数组/未知 id/非法 force 断言；`node tests/run-all.mjs` 通过。
- **文档新鲜度巡检（2026-10-24）**：OpenDesign 一事暴露「现行文档沿用旧实测结论」的风险，据此全量核对 README 与 docs/。修正：README 顶部版本横幅停在 0.14.5（0.15.0–0.16.0 三个版本未更新）→ 0.16.0；README 实测覆盖表补上 0.16.0 已真机验证的 GitHub Copilot 行；README 与 `docs/providers.md` 的网络端点清单补 `api.github.com`（0.16.0 新增 Copilot 时漏记）；`docs/design-ux.md` 的设置页卡片数 25 → 27（30 条 provider − Ark 4 条 + 1）、默认开启序列补 DeepSeek 账号并把 OpenDesign 登录入册；`docs/development.md` 的 managedByPlugin 名单补 github-copilot、RPC 契约补 OpenDesign 三个登录方法与 `visibility.ark` 字段、「设置页首次 readAll 是全量 RPC」改为 0.13.0 起的 `readSettings()` 只读元数据、三处互相矛盾的开关/标签计数统一为当前值；README / development.md / publish.md 的语法检查命令块补齐 CI 实际检查的 7 个文件；文件职责表补 `cookie-login.js` / `opendesign-login.js` / `grok-credits.js`。
- **`scripts/check-browser-runtime.mjs` 计数断言过时会必挂**：断言停在 13 可见 / 25 开关 / 14 关闭（注释还写着不存在的「7 条 Ark 路由」「默认关闭 20 条」），与当前代码的真实值 11 / 28 / 16 不符。已按重新生成的预览实测修正断言与注释，并真跑八组（深浅 × 4 宽度）全部通过——此前该脚本自 0.13.x 后就没人跑过，属「文档/脚本随版本漂移」的同一类问题。

## 0.16.0：GitHub Copilot 额度（第 30 条 provider `github-copilot`，默认关闭）

- 新增 GitHub Copilot 订阅额度。**复用**已安装的 Copilot 提供方插件 `@inventec/dsh-copilot-auth`（1.2.21 实测）经 DSH 凭据库保存的 OAuth 记录 `llm-pi-ai/github-copilot`：取 `payload.refresh`（长期 GitHub OAuth token），以 `Authorization: token …` 调 `GET https://api.github.com/copilot_internal/user`（企业版按 `enterpriseUrl` 换 `api.<域名>`，主机名只取 hostname 并做格式校验）。严格只读：不铸造 Copilot 会话令牌、不写回、不续期；没有记录 / 没有 `refresh` 按未登录，坏记录报凭据错误且不回显 token。
- 归一化 `normalizeCopilotUsage`：`premium_interactions` 画成月度主池窗口（接口给剩余百分比，对外输出已用；缺百分比时由 entitlement / remaining 推算；夹在 0–100）；`unlimited` / `-1` 哨兵与零额度占位桶不画 0%；主池用尽且 `overage_permitted` 时标「可按量续用」并显示超额次数；免费档新形态（chat / completions 真实计数）与旧形态（`limited_user_quotas` 为剩余 / `monthly_quotas` 为总量）都支持，旧形态只在没有其他窗口时读取；组织席位（`token_based_billing`）返回合法空状态说明。
- Client：`PROVIDER_META` / `PROVIDER_ORDER`（追加末尾）、无凭据提示、设置页说明与凭据来源标签、分组标签中英文；「已检测到凭据即可查询、不依赖路由表」的豁免从 Codex 扩展为 OAuth 类（Codex + Copilot）。名字别名：`copilot` / `ghc` / `ghcp` / `dsh-copilot-auth`。
- 测试：新增 `tests/test-copilot.mjs`（凭据读取与企业域名、付费 / 免费 / 组织三种形态、端到端请求形状与缓存隔离、401 映射、未登录不发请求、拒绝本地 Key、别名）；`tests/test-client-behavior.mjs` 增加「无路由表仍可查询」断言；各处 provider 计数 29→30 同步。
- **真机验证（2026-10-23，经用户授权）**：用本机 `~/.dsh/.credentials.yaml` 中该记录的真实 `refresh`，走本插件 Host 的完整解析链对 `GET https://api.github.com/copilot_internal/user` 发一次只读请求，**HTTP 200**，`Authorization: token` 被接受；个人档（`copilot_plan: individual`）读到 `premium_interactions` 月池 entitlement 1500、`percent_remaining` 50.3、`credits_used` 744（已用 49.7%，重置 2026-11-01），`chat` / `completions` 为 `unlimited` 不画窗口，entry 为 `ok` / `complete` / `copilot-oauth`。实测还暴露两点并已据此修正：① 顶层与各桶的 `token_based_billing` 在个人档也是 `true`，只能在「没有任何窗口」时才用它判断组织席位；② `remaining` 是取整（755）而 `quota_remaining` 是浮点（755.6），明细已用 `credits_used`（744）与账面一致。过程只读、不输出 token。
- 推送前交叉核验（独立只读代理，DeepSeek V4.1 Flash / high）无阻断项，采纳并修复：① 「主池不设限」改发 Client 认得的 `quota-status`（此前发 `credit-status`，药丸会落到「暂无额度数据」）；② 组织席位不再仅凭 `token_based_billing` 判断（个人档也为 true），改看套餐名 / 零额度占位桶；③ 窗口明细补 `unit: "requests"`；④ 缓存指纹纳入 API 主机（企业域名变化即时失效）。未采纳：上游 403/404 专属错误映射（语义未核验，保持 401/403 统一为登录失效）。
- **未做**：企业版（`enterpriseUrl`）、免费档、组织席位三种形态无真实账号可验，仅有隔离测试；未安装到桌面 Profile，界面验收需重启 DSH 后由用户执行。

## 0.15.1：报告文本按额度池合并「一池一段」

- 用户实测反馈：Antigravity 那一行读起来「额度冗余」。核对后确认数据本身没有重复——`agy /usage` 返回的是 **3 个真实额度池**（Gemini Models / Claude and GPT models / Gemini 4 Argon，其中 Argon 在 Pro 计划下按官方说明**是独立池**），冗余来自展示：我们按「池名 · 窗口」逐窗平铺，同一池名重复两三遍，5 段窗口 + 1 段余额挤成一行。
- 文本层改为**同池相邻窗口并成一段**：`Gemini Models · week 95.8% 剩余（重置 …） / 5h 96.6% 剩余（重置 …）`。池名只写一次，窗口顺序保持上游下发次序，跨池仍分开；只合并**相邻**同池窗口（交错下发时不为省字重排）。该规则对所有带额度池标注的 provider 同样生效（ARK 与 Volc AFP 的「文本/向量 · 5h / week」——文本路径里 `detail.scope` 优先于 `groupLabel`），数据结构与 `windows[]` 不变。
- 有意**没有**把 Gemini 4 Argon 并进 Gemini Models：官方说明 Pro 计划下两者的额度是分开的，合并会把独立池说成同一份额度。
- 顺带修掉联动项实测暴露的一处措辞错误：当一次查询里**只有联动项**且都没读到时（例如只问 `trae-global` 而该区域没登录），末尾汇总原本把它们算进「其余为读取失败」并把用户指向 dsh-subusage 的凭据文档；现在联动项单独计数并注明「兄弟插件未运行或对应区域未登录」，下一步指向 设置 → Trae / Antigravity ACP 卡片。混合场景仍分别计数；顺带把「其余为读取失败」改成带条数的「其余 N 条为读取失败」，且 `rest === 0` 时整段不再出现——旧文案在「没有任何失败条目」时也会写「其余为读取失败」，本身是错的。
- 测试：`tests/test-quota-api.mjs` 增加「同池并段 / 池名只写一次 / 跨池分开 / 单窗池不带多余 `/` / 交错不重排」断言；`node tests/run-all.mjs` 与 `scripts/check-manifest.mjs` 通过。

## 0.15.0：Antigravity / Trae 额度联动与 OpenDesign 额度标签消歧

- 新增**兄弟插件联动**：本机运行 `dsh-antigravity-acp`（包名 `dsh-bundle-antigravity-host`）时，`quota()` 视图与 `subusage_quota` 工具报告里会多一条 `antigravity`。数据取自该插件已经算好的 Cordis 服务 `agyQuota`（`read({ force })`），本插件**不读凭据、不请求上游、不写任何设置**。联动项没有自己的检测开关与设置卡片；插件不在场时顺带查询里不出现该条目，被点名却没检测到服务时回一条可执行说明，而不是空结果。
- 快照按本插件语义换算：它报的是**剩余**（`remainingPct` 或 0..1 的 `remainingFraction`），对外 `percent` 是**已用** = 100 − 剩余；`window` / `name` 归到 `5h` / `week` / `month` / `day` / `period`；组名（`Gemini Models` 等）进 `groupLabel`——它说明这条百分比约束哪批模型；`disabled` 窗口**不**冒充「已达限额」，只在 extras 里说明；接口只给比例、不给绝对值，因此不写 `detail.used/limit`。AI Credits 余额进 `balance`，套餐名进 `plan`。
- 联动取数有独立预算（默认 15 秒）并折叠成一条 error 条目：官方 CLI 首次取数慢不会拖垮整份报告；超时后提供方插件自己的缓存仍会补上，下次查询即可命中。
- OpenDesign 的两个美元数字按池子改名：`monthly-balance`（套餐订阅额度）显示「套餐余额」（en `Plan balance`），`balance`（钱包合计 = 订阅 + 充值）显示「总额度」（en `Total balance`）。通用 provider 的「月额度剩余 / 余额」不变——Command Code 那条确实是月池。
- 新增第二路联动：`dsh-connect-trae`（v4.3.0，**不是本仓库写的插件**）把用量挂在本机 web 服务器的只读路由 `/plugins/dsh-connect-trae/usage?region=<cn|enterprise|ai>` 上，它自己的卡片读的就是这条；本插件从 `webServer` 服务取回环 origin、带上自己的 `Origin` 头请求它，再把 `TraeWebUsage` 换算成条目：`trae`（国内版积分 → `period` 窗口，percent 是「已用积分 / 积分包合计」，余量、Work/通用两个桶与积分包到期提醒进 extras）、`trae-global`（国际版订阅档位、试用期、是否买了套餐）、`trae-enterprise`（只在真有企业账号时出现；企业租户额度它自己也读不到，照实说明，不把个人积分挪过去）。通道 404 = 插件没装（静默缺席），其它非 2xx / 非 JSON / 超时才折叠成一条 error；结果缓存 60 秒，`refresh: true` 绕过。
- 点名语义细化：只有**单目标名字**（`antigravity`、`trae-global`）算点名，缺席时回可执行说明；厂商名 `trae` 命中三块面板（与 `zai` / `ark` 同口径）时缺席静默，但「问了一家、一个条目都没有」时仍补一条说明，避免空列表被读成「本机没配任何额度」。
- 推送前交叉核验（独立只读代理，对照本机已安装的真实 `dsh-bundle-antigravity-host` 0.1.25 与 `dsh-connect-trae` 4.3.0 逐项核对契约）提出并已修复：① Trae 取数请求补取消信号（此前是全文件唯一不接 `AbortSignal` 的请求，超时只是「不再等待」、连接与 `dispose()` 都收不回来）；② 默认全量查询的超时改为静默（对方 CLI 单命令预算 45s，冷启动会把一次超时顶成 error），点名查询仍如实报；③ 上游错误文本截断到 200 字符、多账号的账号名（实测邮箱形态）掩码后才进工具输出；④ Work / 通用积分桶缺席时不再补 0；⑤ `read`/`refresh` 收到联动 id 时指回 `quota()`，不再误报「Host 版本较旧」；⑥ 删掉 README 里重复的联动项条目。
- 测试：新增 `tests/test-antigravity-link.mjs`（快照换算、别名、缺席/失败/超时降级、工具报告与文本）与 `tests/test-trae-link.mjs`（三种面板语义、回环路由 + Origin 头、60 秒缓存与 force、404 语义、非 JSON / 超时降级、工具报告），`tests/test-client-render.mjs` 增加 OpenDesign 标签断言（中英文案 + 通用 provider 不变）；`node tests/run-all.mjs` 与 `scripts/check-manifest.mjs` 全部通过。**发布与安装（2026-10-23）**：`0.15.0` 已经 `release.yml` 的 Trusted Publishing 发布——registry 的 `latest` 与 `versions["0.15.0"]` 均核对为已发布（`published 2026-10-22T17:10:51Z`），`v0.15.0` Release 资产 `dsh-subusage.tgz` 与 npm tarball 的 SHA256 一致（`sha256:43d41bd9…72f5`，164599 字节）；发布工作流首轮在 60 秒可见性窗口内核对失败（既有已知形态），按流程先在 registry 确认版本可读、再 `workflow_dispatch`（`version_tag=v0.15.0`）重跑转绿。已用随包 Desktop CLI 装进 `desktop` profile（`dsh-subusage@0.15.0`），并用**已安装产物**走真实取数路径复跑一次：`quota(["trae"])` 首次 648ms 只回 `trae`，第二次 0ms（缓存），工具文本与不点名时的 `omitted: 29` 均符合预期。
- **仍未做**：重启 DSH 之后在界面上做最终验收（重启由用户在场执行）；`antigravity` 仍需 `dsh-antigravity-acp` 处于加载状态才有条目（进程内 Cordis 服务，没有可外部探测的 HTTP 口，目前只在隔离测试与契约对照里验证）。
- **Trae 链接已用真实运行中的 DSH 实测**（2026-10-23，经用户授权）：对 `dsh-connect-trae` 注册的只读路由实际请求三块面板——`region=cn` 返回 `signed-in`（真实 CN 账号、11 个积分包、Work / 通用两个桶与到期分组齐全），`region=enterprise` 与 `region=ai` 返回 `signed-out`（该机没有对应登录，响应里带 `searched` 诊断）。真实 `SubUsageService` 走生产取数路径的结果：`quota({ providerIds: ["trae"] })` 首次 527ms 只回 `trae` 一条（`period` 窗口 percent = 已用/积分包合计、余量与 Work/通用备注齐全），第二次 0ms（60 秒缓存命中、条目逐字相同），`force: true` 552ms 重新取数且结果一致；不点名时报告只多这一行（其余 29 家按「有数据才留」收起，`omitted: 29`）。`.trae-auth.cn.json` 是 0 个凭据也不影响结论——该插件从 Trae 客户端存储读登录态（响应里的 `searched` 路径就是它自己的诊断）。

## 0.14.5：OpenDesign Cookie 失效不再显示为部分数据

- OpenDesign 额度或钱包接口返回已识别的认证错误时，整条结果明确报告登录/凭据失效，不再被另一端成功结果吞成「数据不完整」，也不沿用旧额度与余额缓存。
- 网络错误、429/5xx 与普通响应解析失败仍按原规则独立降级；认证错误优先于另一端的普通故障。自动登录不再因另一端成功就保存未通过认证的 Cookie。
- 增加认证错误、成功缓存后失效、新 Cookie 恢复、公共额度视图与 Client 状态回归；本次认证失效修复只做隔离测试，未用真实账号验证当前界面。
- 修正文档：新安装有效默认值为 13 开 / 16 关（Ark 四路共用组开关），覆盖清单补齐 OpenDesign 为 29 条；手动 Cookie 先保存后独立验证，自动登录才是验证后提交。历史接口实测与当前版本界面验收分别说明。

## 0.14.4：Grok 零用量与缺省百分比核验

- REST 成功但未报告百分比时，用同一 OAuth 最多补查一次 grok.com consumer gRPC-web（6 秒预算）。只有周期类型、起止时间与 REST 一致才采纳百分比；失败或不匹配保留原有套餐、余额与部分数据，不误报登录失效。
- 按官方公开计费 descriptor 解析 `current_period`（field 8）。仅完整帧、成功 trailer、当前有效的周/月周期且整包无 float 百分比时，将省略的 proto3 标量解释为已用 0%；缺周期、历史/未来周期、损坏帧与错误 trailer 均不推断零值。显式百分比维持 0–100 单位，不乘 100。
- 隔离回归覆盖零值、非零百分比、畸形消息、错误 trailer、周期不匹配、补查失败降级及缓存。2026-10-21 修复前已实测 REST 与 consumer gRPC 均成功且省略零值字段，Grok 官方 App 显示 0%；修复后的线上账号与界面验收另行报告，不自动安装或重启 DSH。

## 0.14.3：OpenDesign 个人钱包与双额度独立降级

- 个人工作区新增读取 `/api/v1/billing/summary`，显示钱包余额与月订阅额度剩余；复用现有余额展示，不把模型等效金额或扣除倍率当作钱包上限。
- 钱包与 Design Plan 窗口分别取数，任一失败保留另一端并标记部分数据；两个端点都不可读才报错。团队与未知工作区不使用未经核实的账号级钱包数据。
- 实测零值场景纳入回归：钱包及订阅/充值余额均为零，Design Plan 周池仍剩约 99.9%；零不当缺失、两池互不级联。不新增推算月度百分比窗口。

## 0.14.2：OpenDesign 改用实测契约（真实 workspaceId 与扁平响应）

- 0.14.0 的契约是从前端 bundle 的 Zod schema 反推的，实测**两处都错了**：额度接口路径必须带真实 workspaceId（`/v1/workspaces/<id>/billing/coding-plan-usage`；把 `current` 当路径参数会回 403 `workspace_member_required`），响应也是**扁平**的（`tier`、`eligible`、`windows` 在顶层，没有嵌套 `codingPlan`，也没有 `balanceUsd` / `funding`）。
- 现在先 `GET /v1/workspaces/current` 取 `workspaceId`，再拼额度 URL；id 只放行裸标识符，避免拼出别的路径。解析器改读扁平字段，并相应去掉「钱包余额」与「出资方式」的表达——接口不提供这两项，之前那两个字段是推断出来的，实际不存在。
- 未订阅仍按「没有窗口也没有档位」判断；认不出的响应一律报 `subusage/response`，不会再说成「确定没有订阅」。
- 手动导入是本轮唯一验证通过的凭据路径：从自己浏览器的 Network 复制 `cookie:` 整行即可（会话是 better-auth 的 `__Secure-better-auth.session_token`）。Playwright 自动登录在 Cloudflare 挑战处仍会失败——0.14.1 只把 `navigator.webdriver` 压成 false，不足以通过。本轮不安装或重启 DSH。

## 0.14.1：OpenDesign 自动登录去掉自动化自报

- 自动登录弹出的 Chrome 由 Playwright 启动时 `navigator.webdriver` 为 true，OpenDesign 的 Cloudflare 挑战在点「验证」那一刻据此判为自动化并失败。启动参数改为带 `--disable-blink-features=AutomationControlled`，本机实测把该标志从 true 压到 false；`ignoreDefaultArgs: ["--enable-automation"]` 在 playwright-core 1.63 上其实已是空操作（该版本默认参数里没有这条开关），保留只为将来版本加回时兜住。
- 这是 Playwright 自己 browser 工具在同类场景的做法，不是绕过人机验证：用户仍要在弹出的窗口里亲自完成 Cloudflare 挑战。登录页本身在两种参数下都能正常加载，差别只在那一个标志位。
- MiMo 与 OpenDesign 共用同一个登录骨架，因此同样带上这两项；其流程只依赖会话 Cookie 与额度接口，不受影响。
- 未在真实 OpenDesign 账号上验证 Cloudflare 是否放行。自动登录仍失败时可改用「手动导入」粘贴会话 Cookie，那条路径不经过 Playwright。本轮不安装或重启 DSH。

## 0.14.0：OpenDesign 额度与通用 Cookie 登录

- 新增 OpenDesign（open-design.ai）订阅额度，第 29 家 provider，默认关闭。额度取控制台 `GET /api/v1/workspaces/current/billing/coding-plan-usage`，套餐档位、钱包余额与 `coding_plan` / `wallet` 出资方式分开表达。
- 该接口只返回 `usedCredits` / `limitCredits` 字符串、不返回百分比，因此先按窗口的 `durationSeconds` 归入 5 小时 / 7 天 / 月度再算已用比例。Go 同时有 5 小时与 7 天两窗，Plus / Pro / Max 只有 7 天窗；窗口缺失按部分数据展示，不当作零额度。
- 凭据是控制台会话 Cookie，不是模型调用的 `sk-` API Key——后者只对 `amr-link.open-design.ai` 的 `/v1/models` 与 `/v1/chat/completions` 生效，控制面的 `/v1/credits`、`/v1/usage`、`/v1/balance` 等路径一律 404，填 Key 会直接给出提示。
- 登录方式对齐 MiMo，新增「登录并自动导入」：Playwright 拉起本机 Chrome、隔离上下文轮询 Cookie，先真正调一次额度接口确认生效再落盘。两家共用的流程骨架抽为 `lib/cookie-login.js`，MiMo 的导出与行为不变。
- OpenDesign 的会话写在 HttpOnly Cookie 上、名字无法枚举，因此按额度接口 URL 取全部未过期 Cookie；登录完成前只拿到 `__cf_bm`、`od_attr` 这类非认证 Cookie 时接口回 401，判为「登录尚未生效」继续等待，绝不落盘。
- 登录状态按 provider 标记，修掉两家共用同一份状态导致的标签页串台；失效重拉也按各自 provider 走。
- 未在真实 OpenDesign 账号上验证：本机没有该站登录态，接口契约取自生产前端 bundle 的 Zod schema，属未公开私有接口，字段变化风险已记入 README 未验证清单。本轮不安装或重启 DSH。

## 0.13.4：Grok credits 500 时回退 grok.com gRPC-web

- `GET /v1/billing?format=credits` 在部分 X 订阅迁移账号上会返回 HTTP 500（`Failed to serialize billing response`）。同一 OAuth Bearer 下改为回退 `POST grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`（gRPC-web），恢复周池已用百分比与重置时间。
- REST 仍是首选；401/403 不回退。gRPC 路径拿不到 prepaidBalance 时不冒充 0 余额。无 format 的旧月度形态（`monthlyLimit: 0`）仍不当作额度。
- 隔离测试覆盖 gRPC 帧解析、500 回退成功、401 不回退、回退失败仍报告原 HTTP 错误。本轮不安装或重启 DSH。

## 0.13.3：The X Subscription 与 Cursor Pro 接入边界

- Grok 入口改为 `Grok (X / SuperGrok)`，额度查询增加 `X Subscription` 别名；沿用官方 CLI 计费代理与共享 OAuth 登录链，不新增重复的 Cursor 用量池。
- 新订阅按席位共享第一方周额度，充值余额独立；套餐显示名取上游，不根据套餐价格/倍数推算绝对额度。团队全量汇总与工作区切换不在本入口范围内。
- 代理缺少百分比但返回有效周期时保留套餐/余额，标记部分数据，不报整包无效、不伪造 0%；官方 proto3 `Cent` 空对象解析为零余额，缺失消息仍未知。
- 明确 Cursor Pro 没有官方独立模型推理 / chat-completions API，不能直接作为 DSH 模型订阅；CLI、SDK 与 Cloud Agents API 运行的是 Cursor 自身 Agent，不新增 Cursor 模型路由或个人用量入口。
- 四个新套餐名称、共享单窗、充值余额、缺百分比降级、别名与缓存均有隔离回归；本机旧 SuperGrok OAuth 两个端点返回 HTTP 200，已复现缺百分比响应。新套餐迁移账号与团队工作区尚未实测；发布不自动安装或重启 DSH。

## 0.13.2：用量界面文案、方舟标签与弹层溢出

- 连坐说明把内部 `week` 等 kind 翻成「每周」等窗口名，不再泄漏 `[week]`。Cookie 临近到期改口「续期」，不再说「需要登录」；药丸用短词，倒计时小时/天向下取整。
- Command Code 自动轮换用黄底说明「下方是默认账户额度，不是正在处理请求的账户」，并给窗口列表加标题；账户数不再把「自动轮换」算进容量。
- 中文面板标题本地化（小米 MiMo、方舟 Agent Plan 等）；AFP 分组与成员预算走 locale；Cookie / Key 校验错误中英并列。
- 方舟订阅结论未返回前，标签栏只留一张代表卡，避免四个「待检测」灰标签；已订阅即使没推理路由仍显示。关掉默认隐藏仍看全部。
- 弹层限高滚动；设置页成功计数标明可点「查看问题」；刷新中区分当前/全部；默认隐藏开关改成人话；卡片网格最后一张不再拉满。额度充足的多窗口不再说「最紧张」。
- 回归覆盖连坐文案、Cookie 短词与续期判定、方舟订阅未知可见性、AFP 分组键、账户数量与刷新按钮文案。全量测试、清单与语法检查通过。发布版本为 0.13.2；本轮不安装或重启用户运行环境。

## 0.13.1：Codex 冷启动过滤与传输失败后的药丸隐藏

- 另一个直接复现的源头是设置初始化：Codex 默认关闭，Client 状态冷启动 / 重建时没有读取用户保存的“已开启”设置就提前过滤查询；同 provider 会话切换不会重建药丸，切去默认开启的其他模型才顺带载入设置。默认关闭的入口首次查询现在先共享一次空 providerIds 的本机元数据读取，再按保存的开关按需查询，不发起全量额度请求；明确关闭仍不查询。

- 复现 0.13.0 中的另一条隐藏链路：Codex 凭据已经检测到、路由暂时缺席时，刷新传输失败构造的新 error 条目丢失 `apiDetected` / `keySource`，随后被可见性规则隐藏，下一轮刷新又被路由过滤。
- 传输失败现在仅保留已有凭据检测元数据，不沿用旧额度：仍显示读取失败，窗口清空、freshness 为 unknown；下一次自动轮询可在同一组件内恢复。Host 明确返回 no-key / apiDetected:false 时仍按设置隐藏，不强制常驻。
- 针对性测试覆盖真实 UsagePill + store、直接刷新失败、60 秒轮询失败、无需切换提供商的原地恢复及显式退出登录。发布版本为 0.13.1；本轮不安装或重启用户运行环境。desktop 已安装包只读取证为 0.13.0，确认仍含旧传输失败分支；未捕获消失瞬间的现场 RPC，离线复现不冒充真实环境验收。

- 35 个测试文件全量、Client 语法、清单及差异检查通过；新增断言验证错误药丸可见且不展示成功旧额度，后续自动轮询可继续发 RPC。

## 0.13.0：余额展示、按需刷新、Codex OAuth 兼容与 README

发布与本机部署分开；以下为本次版本内容，不自动安装或重启 DSH。

### README 产品主页重设计

- 保留原标题图的深蓝背景、左标题与右侧双主题弹层构图，只优化价值文案、层级与留白；小药丸改为当前真实组件渲染，不手绘另一套 UI。
- 首页改为“快速开始 → 额度 / 余额 / 账户管理 → 支持场景 → 技术参考”，增加深浅主题功能特写，版本流水账后置，保留完整技术说明与旧版本截图。
- 新图明确标注虚构数据、工作区离线预览；0.13.0 与历史版本截图明确区分。新增可复现生成与本机 GFM / 链接 / 图片检查脚本，不改运行环境。
- 深浅主题功能图的组件边界检查通过；主页深浅 × 1080 / 390px 四种布局、图片加载、主题切换与 184 次内部链接检查通过。清单、相关脚本语法与差异检查通过；本机近似渲染不等于 GitHub / npm 页面已部署，外链未联网逐一验收。

### 金额精度、按需刷新与独立 Codex OAuth 兼容

- 余额在药丸、横幅与明细统一限制为最多两位小数，原始金额仍用于阈值判断。正常 CNY / USD 余额用绿色 ✓，低余额黄 / 红与 !；无统一面值的 credits 保留中性 ℹ，非正余额红色。
- 设置页初始化通过既有 read 的空 providerIds 读取本机元数据，不发起全量厂商请求；仅当前用量页按需刷新，缓存设置可直接回显。显式“刷新全部”仍可使用。
- 已检测到登录的 Codex 不因路由暂时缺席被隐藏；尚需实机确认用户报告的闲置消失路径。
- 增加 dsh-codex-subscription 独立 OAuth 的只读活动账号 grant / 双旧引用兼容，再回退到 Codex CLI；活动账号与 token 变化使缓存失效，损坏记录不跨账号兜底，不写回或自行刷新另一插件的 OAuth。
- 35 个测试文件全量通过；清单、Host / Client 语法与差异检查通过；深浅主题各 11 个真实组件离线场景通过金额精度、图标、预警与窗口优先检查，使用虚构数据。尚未安装到真实 DSH 验收；发布版本为 0.13.0，不安装或重启用户运行环境。

## 0.12.0：双 DeepSeek 余额入口、分单位药丸与详情折叠

发布内容与验证范围如下；发布不自动安装到实际 DSH，新增账号余额与无订阅形态仍需真实账号验收。

### 轮换池限额层级与详情折叠

- 受限账户明确显示具体额度周期；多周期同时受限一并列出，连坐窗口优先解释根限额，不再只写“已用尽”。未知周期不猜全部耗尽，已购余额续用仍独立展示。
- 轮换池容量摘要保持可见，逐账户列表默认折叠为“点击查看详情”；展开后内部最高 240px 滚动，保留点击固定账户及原生键盘操作。弹层和设置页复用同一个组件。
- 新增中英文、周/月/多周期、连坐、PAYG、40账户折叠和滚动回归；纳入本次发布，不自动安装或重启用户的 DSH。

### 余额药丸分级与 DeepSeek 账号入口

版本为 **0.12.0**；本轮不部署到用户运行环境，不将桩测试当作真实账号在线验收。

- **余额药丸分级**：`deepseek`、`deepseek-account`、`siliconflow`、`novita`、`hyperbolic`、`deepinfra`、`vercel-ai-gateway` 与其它带余额的条目，药丸直接显示金额与单位并按自身单位染色——人民币 < 1 元红、1–5 元黄、≥ 5 元灰；美元 < 0.2 红、0.2–1 黄、≥ 1 灰。`credits` 及其它没有跨厂商统一面值的单位只在**已解析的非正余额**时标红，正余额保持灰色。这些是**产品预警阈值，不是汇率换算**，也不承诺「还能跑多少次」；累计花费（`spend` / `*-spend`）是已花金额，不套用余额阈值。
- **窗口优先、余额不越权**：有有效套餐窗口时窗口始终优先，负余额不抹掉有效套餐，套餐耗尽也不会被钱包盖过；官方明确给出 PAYG / included 续用建议时该建议独立保留。纯余额药丸只在读取成功且数据完整时出现，缓存与部分数据仍是降级态。
- **新增 `deepseek-account`（DeepSeek 账号，默认开启）**：复用本机 `deepseekAccount` 服务的登录态读取充值余额；不读取、导出或保存 OAuth token，也不使用 `DEEPSEEK_API_KEY`。与 `deepseek`（改名为 DeepSeek API）的开关、缓存与余额完全独立，别名 `deepseek-official` 指向账号入口。该入口**不自行发起 HTTP 请求，而是复用宿主账号请求链（宿主可能联网）**，余额不落盘，也不复用本插件的旧 TTL 结果，也不要求本机装有对应模型路由；两个 DeepSeek 入口连同 SiliconFlow、Novita、Hyperbolic、DeepInfra、Vercel AI Gateway 均按余额型口径处理，手动模式或已存 Key 照样能查。provider 总数 27 → 28，默认开启 10 → 11。
- **MiMo 不再把「没有订阅」画成 0%**：只有「用量组为空 / 零容量」配合**可读的套餐详情**（套餐名与套餐码确实缺失、`code` 正常）才判 `subscribed:false`；**零容量不生成 0% 用量窗口**。套餐端点读取失败仍标部分数据、**不宣称未订阅**；余额端点读取失败仍保留已成功的套餐用量并给出说明。余额与套餐彻底解耦，任一端点失败不再拖垮另一端。
- **ZenMux 订阅端点失败**保留余额但标部分数据，并写明「余额已读取；套餐状态暂不可确认」，不据此宣称未订阅。
- **Codex 明确零余额仍展示**：`has_credits=true` 且非 unlimited 的有限数值余额不再因为等于零而被丢弃；是否可由 credits 续用仍要求正余额或明确 unlimited，零余额不会掩盖耗尽。
- 回归：**35 个测试文件全部通过**；清单、相关 JS 语法与 `git diff --check` 通过。新增双入口、超时、端点降级、金额阈值及零余额回归；深浅主题各 11 个真实组件离线场景通过。预览使用虚构数据，**仍未部署到真实 DSH / 账号验收**。本节不改变既有 RPC 与 `state`；发布与本机安装分开，未安装或重启用户环境。

## 0.11.2：现行套餐语义修正与必要实现优化

- Codex：合法单周窗不误判 partial，Pro 系列缺时长不误标 5h；保留无 rate_limit 的企业 Credits、支出/成员预算；查询工作区头和缓存指纹计入 accountId；未映射的额外特性池仍明确部分覆盖。
- ZenMux：解析真实周窗口，账户 suspended/banned 不被短窗健康掩盖；月 cap 未报告已用不编造百分比。Novita：接受官方十进制金额字符串。LiteLLM：保留 Key/User/Team 多层预算，解析嵌套响应并行查询，不用上级覆盖下级。
- `coverage` 从窗口数量改为适用事实的完整性；单窗/无上限/余额型正常成功不误警告，真实可选端点失败仍按部分数据展示。
- 新增可选 `availability/availabilityReason`，保留既有 RPC 与 state。Command Code 已购余额可按量续用，赠金未确证不假定绕过；NanoGPT 路由建议与基础百分比分开，未知余额/策略不冒充可用；工具 schema、文本与 UI 同步。
- 轮换池有备用可用时，不被默认账户异常染红；读取失败保留未知，不推断全池耗尽。AFP 级联增加约束范围，文本周窗不连坐日能力，共享月约束保留；总览明确只部分能力耗尽。
- 共享 UI 状态继续由 computeStatus 派生，排序同步；LiteLLM 多预算行有作用域标签和唯一 key，已花费不再误标余额。不引入新打包流程、不扩大到未经核验的新接口。
- 独立复核补缺：续用未知不被健康百分比盖成绿色；无窗口的企业限制保留在无参工具查询；只有套餐名或部分配额的轮换账户不冒充健康；工具文本保留多预算身份与能力范围。无上限状态单独解释，不误标成余额。
- 回归：新增 `test-quota-semantics.mjs`，补企业/工作区缓存、工具契约与续用文案、池反向组合和状态矩阵；同步修正旧单窗 partial、上级覆盖等错误断言。LiteLLM 包含 Key/Team/User 同取与单范围 403 降级。
- 文档与主页：修正支持数量、窗口/预算、单位换算及工具字段说明；新增按量续用、自动池和能力范围三张离线截图；版本发布不代表真实企业席位/新套餐私有接口已验收，也不自动安装或重启。

## 0.11.1：SuperGrok 自动续约、Command Code 轮换池健康度与审查修复

### SuperGrok token 过期时借 dsh-grok-kit 官方链自动续约（2026-10-12）

- **问题**：grok-kit 面板显示「已登录」，本插件却显示 token 已于某时刻过期。根因是两边刷新时机不对称：grok-kit 的 OAuth 刷新是**懒触发**（仅聊天/搜索遇 401、启动拉模型列表时才刷，无后台定时器），用户一段时间没用 Grok 聊天，`~/.grok/auth.json` 就停在旧 token；而本插件每分钟读用量、是最常发现过期的一方，旧设计却「只读不刷」。本机实测：token 6 小时即过期（04:49 登录、10:49 过期），grok-kit 最后一次活动停在 07:48。
- **修复**：过期时动态加载兄弟插件 `dsh-grok-kit`（弱依赖，`import()` 失败即降级），调用其 0.2.0 导出的 `XaiOAuthSession.models.getAuth("xai")`——与 grok-kit 聊天/搜索是**同一条官方刷新链**：共享文件 store、写锁内二次检查、compare-and-write 写回同一个 `~/.grok/auth.json`，多个消费者并发只刷一次。这不是自己裸 POST token 端点（那才会绕过写锁顶掉 refresh-token 轮换）；grok-kit 与 Grok CLI 反而共享续约结果。**本节取代 0.10.6 起各版本「只读、不刷新 token」的旧行为描述**（Codex 仍保持纯只读不变）。
- **不信任返回值、只信文件**：`getAuth` 成功/失败后一律重读登录文件确认新 token 与新过期时间；因此「getAuth 拿不到写锁失败、但并发进程已把文件刷新」的场景也照样续约成功（pi-ai 在锁内发现「别人已刷」时会静默返回 undefined，重读文件正好把这种静默失败转成成功续约）。外层 20s 总预算（pi-ai 内部另含 15s 刷新超时），用完即 `dispose()` 会话。模块解析**只缓存成功结果**：未安装/旧版时每次过期都会重试加载，中途装好 grok-kit 无需重启 DSH。
- **三级降级文案**：续约成功→照常拉用量；兄弟插件缺失/旧版（无 `XaiOAuthSession` 导出）/模块解析失败→提示「未能加载 dsh-grok-kit（≥0.2.0）」+ 手动登录步骤；刷新链报错（如 `invalid_grant`）→明示「自动刷新失败」+ 上游原因（截 200 字）+ 重新登录指引。未过期不加载 grok-kit，零额外开销。
- **测试**：`tests/test-supergrok.mjs` 过期场景由「直接报错不发请求」改为五个用例——续约成功（新 token 计费、旧 token 零请求、会话 dispose）、刷新链抛错（失败原因进文案、不发计费请求）、兄弟插件三种缺失形态 + loader 抛错均安全降级、getAuth 失败但文件被并发刷新仍成功、未过期不加载刷新链。另在桌面 profile 实测原生 ESM 可加载 dsh-grok-kit 且真实 store/provider 解析正确（未代用户执行真实凭据刷新）。

### Command Code 自动轮换池健康度（业务层优化，2026-10-12）

- **问题**：自动轮换模式下药丸/面板只显示顶层 Key（默认账户）单账户额度，但真实请求会落到池中任意账户——默认账户健康不代表池健康（其余账户可能已全部 5h 限额），乐观数字会误导用户。
- **业务口径修正**：不能简单取「池中最紧张账户」染红——账户间是**独立配额**，轮换器会避开已限额的账户，单账户限额不是立即失败信号。只有**所有配置了凭据的账户都限额**（池耗尽）才是要 429 的时刻；部分限额只是容量降级。
- **Host**：新增 `commandCodePool()`，仅在**自动轮换**模式（固定账户不挂）把 `accountPool` 摘要挂到默认账户 entry：逐账户 `usable / blocked / unusable` 分类、`available/blockedCount/unusableCount/exhausted` 汇总。复用各账户自己的 TTL/inflight 缓存（默认账户复用主链路 entry），每分钟自动刷新不会真打 N 次计费接口；点名单个额外账户时不挂。
- **Client**：弹层与设置页新增 `CommandCodePoolSummary`（直接函数调用、与视觉原语同约定）——池标题 + 可用/限额计数、逐账户圆点与最差窗口、点账户行可固定到它；**池耗尽时**用池中一条 rate-limited 窗口喂给 `computeStatus`，药丸与横幅如实染红，部分限额不染红只在摘要提示。双语文案齐备。
- **测试**：新增 `tests/test-commandcode-pool.mjs`（部分受限/全耗尽/全未配置/固定模式/点名账户/缓存零新增请求）与 `test-client-render` 的摘要三态 + 池耗尽染红断言。
- **另**：产出 [MiMo 登录摩擦优化设计](mimo-login-redesign.md)（私有 persistent context + 超时弹性 + 临期提醒），待评审，未实施。

### 审查修复（2026-10-12）

- **Ark 未装路由时单家刷新空转（功能 bug）**：Client 单家刷新过滤器此前对所有 provider 套用 `providerRoutable`，但火山方舟额度是账号级管控面订阅、显隐本就豁免路由检查；导致「AK/SK 名下有套餐、本机未装对应 arkcli 路由」的条目在定时刷新、重置补拉或点击「刷新当前」时都不发请求，只有「刷新全部」能更新。现刷新过滤器对 volc 同样豁免，与 `providerVisible` 同口径；`test-client-behavior` 补充对拍断言。
- **Client save 校验器漏 `visibility.ark`（双端 schema 漂移）**：Host 的 `parseSettings` 接受火山组开关补丁，而 Client 白名单此前仅放行 `providers` 与 `hideWithoutApi`；网关出站当前不校验虽未致障，但属埋雷。Client 补充 `ark` 字段及布尔校验；`test-contract` 增加双端 parser 对同一合法补丁都接受、非法类型都拒绝的语义对齐用例（此前契约测试只比对 `typeSymbol` 字符串，覆盖不到解析语义）。
- **错误消息中英混杂（i18n）**：Host 的失败 message 是中文兜底，英文界面直接渲染。Client 新增 errorCode→中英双语文案的 `localError()` 层（覆盖 13 个 `subusage/*` code），`computeStatus` 横幅、弹层失败行、设置页横幅、工具栏错误及保存通知全部走它；中文界面文案不变；中文原文保留在节点 `title` 供排障；未知 code 与传输层错误回退原文不丢信息。
- **文档事实订正**：provider 总数 30→**27**、默认关 20→**17**、火山路由 7/5→**4** 条（个人版 2 + 团队版 2）、卡片 25→**24**；README 与 `docs/provider-coverage.md` 移除已下线的 BytePlus（`ark-coding-plan-byteplus`）「当前支持」条目与环境变量；Codex 默认状态由错误的「开」订正为「关」；代码注释 8 处「7 条」同步订正。
- **删除死代码 `severity()`**：旧的药丸阈值函数（阈值 80% 与现行 71/91 口径不符），`computeStatus` 体系建立后已无任何引用。
- **Codex 注释自相矛盾订正**：`PROVIDER_META.openai-codex` 注释同时写「默认开启」与「默认关闭」，删除前者，与 `defaultEnabled: false` 一致。
- **设置页首次加载不再闪现**：首次 `readAll` 飞行期间 `providerVisible` 对缺失 `settings` / `configured` 一律「未知放行」，标签栏会先闪现默认开启项、顶部出现「0/N 家成功」。现未初始化时不渲染标签栏、空状态与成功计数（刷新按钮保留，初始化失败仍可靠「刷新全部」恢复）；`test-client-render` 增加「初始隐藏 / 加载后出现」双侧断言。
- **Host 域健壮性清理**：① User-Agent 由硬编码、滞后两版的 `dsh-subusage/0.10.10` 改为读 `lib/index.js` 的 `VERSION` 常量，`check-manifest` 新增「VERSION 必须与 package.json 一致」校验（缺失/不一致直接失败，已用改错自证）；② `fetchJson` 把 3xx（`redirect:"manual"` 下的跳转）与 401/403 分开映射——前者归 `subusage/response`（意外重定向），不再被误诊成「凭据失效」诱导用户重登录，条件加显式括号；③ SuperGrok 的 token 过期时刻不再硬编码 `Asia/Shanghai`，改跟随系统时区；④ CI 语法检查补上漏网的 `lib/volcengine.js`。
- **双端 provider 表一致性纳入契约测试**：Host 正式导出 `IDS` / `PROVIDERS`，`test-contract` 新增断言 Client 的 `PROVIDER_META` 键集与 `PROVIDER_ORDER` 必须与 Host `IDS` 集合完全相同，并逐家核对 `envName`、`managedByPlugin`、`defaultEnabled`；新增厂商只改一端以后会直接让 CI 变红。

## 0.11.0：Command Code 多账户额度与设置页账户区

- **设置页也能切换 Command Code 账户**：Command Code 的用量面板里挂上**与药丸弹层同一个组件、同一个控制器**（`CommandCodeAccountSwitch`）——自动轮换 / 默认账户 / 各额外账户、当前项高亮、失败回读与降级文案两处完全一致，不必再跳到提供方插件的设置页。折叠标题直接回答「现在是哪一个账户」：固定账户写「账户名 · 使用中」，自动轮换写「自动轮换」（附选项数量）。切换后设置页把当前账户同步给共享 store，上方面板与药丸一起改看所选账户的额度。
- **额度查询一次给全部账户**：`subusage_quota` 工具与 Host 的 `subUsage.quota()` 在涉及 Command Code 时**按账户各返回一条**，带 `account`、`accountActive`、`accountMode`（`fixed` 固定账户 / `auto` 自动轮换），当前激活的排最前——「还剩多少」与「现在实际用哪个账户」一次问清。账户清单读自提供方插件的 `llm-commandcode` 设置（与其 `slots()` 同规则：默认账户 + 有凭据引用的额外账户，登记未完成的不列），**不额外请求接口**；settings 服务不可用时退回原来的单账户形态。
- **按账户分缓存**：缓存键从 `commandcode` 拆成 `commandcode` 与 `commandcode@<凭据引用名>`。此前一次读多个账户会互相把对方的缓存顶掉（指纹不同即删缓存），60 秒 TTL 形同虚设；失效改走 `invalidateProvider(id)`，按 `id@` 前缀把全部账户一起丢掉——改凭据或开关不能只失效默认账户那一条。
- **工具输出不再塞空条目**：**点名的家原样返回**（即使没配凭据——用户问的正是「它为什么没数据」）；**不点名时**（含名字一个都没认出来、走全量兜底时）省略检测已关闭、未配置凭据、以及接口没报告任何额度的条目，省略条数按**家**去重后写进 `omitted`（同一家的多个 Command Code 账户只算一家），并在文本末尾说明。**读取失败（`error`）的条目保留**——那是「这次没读到」，不是「没配置」，省略掉会把排障方向带偏；认不出的名字自己那行也保留。`plan` 只算套餐名、`account` 只算账户标注，都不当作「有额度数据」（但火山方舟的席位标注同样用 kind `account`，它算身份信息，见下）。
- 账户清单与提供方插件 `slots()` 的唯一差异写进注释与文档：**不支持「字面 Key」账户**（`accounts[].apiKey` 直接写在提供方配置里的那种，其 slots() 会列、本插件按引用名解析不到），设置页与工具两处一并跳过；同一凭据引用名重复出现时只列一次（否则同账户出两行、还会多打一份计费请求）。`setCommandCodeAccount` 把 `"default"` 归一为空串——Host 端本就是同一缓存键，归一后不会为「固定到默认账户」多打一次强制刷新。
- **不再误吞火山方舟的席位标注**：为去掉重复账户名，工具文本最初跳过所有 `extras.kind === "account"`，而席位版的标注用的正是同一个 kind（`席位 seat-xxx（共 N 个席位）`）——文本里席位 ID 会整行消失。现在只在该条带顶层 `account` 字段（多账户行）时才跳过，省略判定同理：无窗口但带席位身份的成功条目不再被当作「没有数据」。
- **对外额度视图不泄露凭据引用名**：额外账户没配凭据时，`provider()` 的 no-key 文案里嵌着它的 `apiKeyEnv` 引用名（如 `COMMANDCODE_ACCOUNT_WORK`），而视图契约承诺不含继承变量名/凭据引用。`quota()` 现在把错误文案里的引用名换成账户标签（`Account 2`）；本机界面那条通道（`read`/`refresh`）仍保留引用名——用户要靠它定位该往哪个 ref 里写凭据。
- **共用控制器的竞态修掉**：设置页与药丸弹层现在共用同一个账户控制器，两处同时挂载会并发 `load()`。`load()` 现在把同一代的并发请求合并成一次 describe，并让「切换账户（mutate）之后才返回的旧 describe」作废——否则它会把 `activeId` / `revision` 覆盖回切换前的快照，两处界面一起回到旧账户；切换进行中 / 只读 / 未 ready 时账户按钮一并禁用（`switchTo` 本来就会拒绝，可点的按钮只会变成「点了没反应」）。
- 文案与契约：`commandcodeHelp` 与账户区提示说明「设置页与弹层同一开关」；工具 `description` 交代省略规则与多账户形态，`output.schema` 增加 `account` / `accountActive` / `accountMode` / `omitted`；README 的额度查询 API 一节补上视图新字段与「`quota()` 本身不过滤」的区别。
- 首页视觉：**标题图换成真实渲染截图拼贴**（`assets/title.png`，由 `debug/build-title.mjs` 生成、不入库）——左侧文字与三个同款药丸（一列迷你横条、满格 = 100% 剩余、档位色、正常态不写字），右侧是**当前实现真实渲染**的两张用量弹层并排（-5° 轻倾斜、不重叠）：浅色演示 **Codex**「额度充足」（`5 小时` / `每周` 两条限制 + `plus` 套餐标签），深色演示 **OpenCode Go**「额度已用尽并连坐」（受连累 / 已用尽标签、空槽余量条、每月仍剩 31% 与连坐明细）。字体用本机已装的开源 **Noto Sans SC**（SIL OFL），不使用商业字体。手绘的 `assets/title.svg` 删除；README 首屏去掉弹层大图（只留标题图），标题图整行宽度。
- 测试：新增 `tests/test-commandcode-multiquota.mjs`（账户清单、按账户展开与排序、按账户分缓存与失效、工具省略与点名、文本层账户后缀）；`tests/test-commandcode-accounts.mjs` 增加设置页账户区与「未注入 cc 时隐藏」两段。`node tests/run-all.mjs`（32 个文件）与 `node scripts/check-manifest.mjs` 全部通过。

## 0.10.12：首页重设计、审查修复与兼容声明更新

- **README 重写为产品首页**：Hero + 痛点对照表 + 15 种状态画廊（新增 `pill-states-light/dark.png` 两张带水印离线预览，`screenshots.json` 扩为 4 项）+ 快速开始；30 行提供商表格等长列表移到「技术文档」分界线之后；`dsh-codex-connect` 引用补上维护中的上游链接（franksong2702，npm 同名包指向处）。
- **审查修复**（Grok 4.6 / GLM-5.3 双子代理独立审查，无 P1）：设置页余额态不再同时出现「余额 xx / 暂无额度数据 / 余额行」三处打架；提供商标签改用与面板、药丸同一个 `computeStatus()`（缺凭据蓝 ⚙、无窗口成功中性 ℹ，不再误标红/绿）；Cookie 到期药丸保留迷你余量条，行动项只占一个词；删除死代码 `numColor` / `tagColor` / `providerIcon` 与 locale `retry`。
- **测试**：新增 `tests/test-compute-status.mjs` 分支矩阵（含优先级交错用例）；「不得展示旧额度」断言改用 `remainWord`，罩住 0.10.11 的新渲染。
- **兼容声明**：`dshReleases` 的 `0.2.1-alpha.2` 与 `0.2.0-rc.2` 按实机证据升为 `compatible`（Desktop Core alpha.2 上 0.10.8~0.10.11 日常运行；v0.1.0~v0.3.0 精确锁定 rc.2）；`0.2.0-rc.1` 无运行记录维持 `unknown`。README 兼容表与最后验证日期（2026-10-11）同步。
- **规范文档**：development.md 新增「依赖面与 Core 兼容规范」（公开 API 面清单、peer 双分支规则与 0.8.x~0.10.7 教训、dshReleases 证据语义、Core 升级核对清单）；design-ux.md 新增「状态判定规范（computeStatus）」并刷新线框图与档位词。
- 文档过时修正：DSH badge 改为 `0.2.x`、files 白名单描述（无 locale、含 LICENSE）、development.md 的 locale 文件入口、publish.md 截图声明（两张 0.7.0 → 四张 0.10.11）。

## 0.10.11：药丸与弹层视觉重设计（仅 Client UI）

- **修正「偏高」**：旧档位词「偏高」没写清主语（用量高？余量高？）。档位词现在只说还剩多少：充足 / 偏少 / 即将用尽 / 已用尽 / 受连累；阈值（已用 71 / 91 / 100%）与内部 `percent` 不变。
- **药丸只画图形**：正常时只显示彩色迷你余量条（每个窗口一根，满 = 100% 剩余，顺序与弹层一致）；不再写厂商名、「余 87%」。需要留意时才追加**一个词**（`5时 偏少`、`周 已用尽`、`需配置`、`拉取失败`、`缓存数据`、Cookie 到期提醒），并整体染成状态色。百分比与完整说明收进 `title` / `aria-label`。
- **弹层先给结论**：顶部状态横幅（实心状态圆 + 「额度充足 / 余量偏低 / 即将用尽 / 额度已用尽 / 需配置 / 拉取失败…」+ 一行依据，如「最紧张：每周 · 剩 60% · 3 天后重置」）；套餐名移到标题行右侧小标签；窗口行改为扁平卡片（大号剩余 %、8px 圆角进度条，档位词只在需要留意时出现）；余额等补充项两列对齐；页脚「更新于 + 刷新」。
- 药丸、弹层、设置页用量面板共用同一个 `computeStatus()` 判定，三处结论与颜色一致；设置页标签改为状态圆标 + 厂商名的胶囊。
- 文案：`pillLimited` 改为「已用尽」，`statusPartial` 缩短为「数据不完整」。测试同步更新（正常态药丸不再含「余 X%」文字）。

## 0.10.10：进度条按剩余扣减

- 进度条改为剩余口径：满格 = 100% 绿色余量，随已用扣减；已达限额 / 受连坐显示空槽。详单主数字与药丸统一为「余」；绝对量明细仍写已用 / 总计。内部 `percent` 仍是已用百分数。标题图同步。窗口行不再用系统 `<progress>`，改成与标题图同类的圆角轨道 + 档位色填充条。

## 0.10.9：设置页刷新不再冻其它提供商开关

- 设置页「刷新当前 / 刷新全部」不再占用全局 `busy`：刷新期间其它提供商开关、凭据入口仍可点；刷新按钮自身显示「刷新中…」并禁用。Client `createUsageStore.refresh` 按提供商拆 inflight 与 RPC，单家刷新不再等待整批最慢一家。刷新全部时单家传输失败只写该条目错误，不再抬成整页 `loadError`、也不提前结束其余家。
- Host `provider()` 的凭据解析（凭据服务/登录文件读取）加 10 秒超时（与 HTTP 的 `AbortSignal.timeout` 同量级，可经 `identityTimeoutMs` 注入）：凭据服务挂起时该提供商返回可读的超时错误条目（`subusage/identity-timeout`），不再让「刷新中」永久卡住；单家超时不拖累同批其它提供商，且不按凭据失效处理、不清 Cookie。
- 刷新全部进行中拨可见性开关不再静默丢掉在途用量：visibility 保存只更新 settings（不再推进 epoch、不重置在途请求序号），在途 refresh 完成后照常合并 entries。过期请求的 settings 仍丢弃；**当前代** refresh 若带上另一窗口的新 revision 则采用它，但不再 `invalidate` 全员（非活跃条目不会永久 loading）。凭据保存仍推进 epoch；火山 AK/SK 变更会在 Client 失效整组 Ark 路由并在保存后整组重拉。
- `setCommandCodeAccount` 刷新失败不再变成未处理拒绝。点「刷新全部」即使过滤后只剩一家，也不把传输失败抬成整页 `loadError`。`subusage_quota` 整次查询加 30 秒上限。identity `withTimeout` 吞掉超时后迟到的 reject，避免 unhandledRejection。

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
- **刻意不返回 settings 与内部状态**：`keySource` / `apiDetected` / 继承变量名一概不出现——第三方消费者只需要额度，不该知道本机配了哪些凭据。未知 `providerIds` 被忽略；单家失败只影响自己的条目（有测试断言视图里搜不到 `settings` / `keySource` / `apiDetected` 与 Key 本身）。（**更正**：「未知 `providerIds` 被忽略」在 `0.10.5` 已推翻——静默过滤会让调用方以为本机没有额度，现在改为宽松命名匹配 + 认不出时附上全量数据。）
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

## 0.10.8：移除 BytePlus 与 locale 死文件，补齐上架所需的声明

- **火山方舟只剩官方 CLI 的 4 条路由。** `ark-coding-plan-byteplus` 也移除了：它走的 `ark.ap-southeast-1.byteplusapi.com` 与 `GetCodingPlanUsage` **确实存在**——返回的是业务信封错误 `NotFound.BillingType`（`coding plan config is not exist`），不是路由不存在——但本机没有 BytePlus 账号可验证，实现正确性无从确认，所以不再保留。取舍与证据记在 [provider-coverage.md](provider-coverage.md)。国内那两条 legacy 路由的药丸别名（`ROUTE_PROVIDER_ALIAS`）保留，装旧插件的用户不受影响。
- **修正 peer 范围会静默排除预发布版本。** 原来的 `>=0.2.0-rc.1 <0.3.0-0` 看起来覆盖 0.2.x，但 node-semver 只在范围里**某个比较符与该版本的 `major.minor.patch` 元组完全一致、且自身带预发布标签**时才放行预发布——`0.2.1-alpha.1`（**当前活跃版本**）因此被静默排除。改为逐元组的显式分支：`>=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-0 <0.3.0-0`。这是 awesome-dsh-plugin 贡献指南专门警告过的一条，我们正好踩中。
- **新增 `LICENSE`（MIT）。** 仓库根此前没有这个文件，GitHub 因此把 `licenseInfo` 判为 `null`；DSH STORE 也要求 manifest、仓库与分发产物三方一致地声明许可证。现在 `files` 白名单包含它，`check-manifest.mjs` 会校验它存在、是 MIT 且已打进包。
- **新增 `engines.node` 与 `dsh.compatibility`。** `engines.node >=22.19.0`；`dsh.compatibility.node` 同值；`dsh.compatibility.dshReleases` 逐版本声明——**只有本机实机验证过的 `0.2.1-alpha.1` 标 `compatible`，其余三个标 `unknown`**（没有证据不猜）。
- **移除 `locale/`**：DSH 不读这个目录（核实过 manifest 与插件管理相关包），客户端文案走 `lib/client.js` 里 `ctx.locale.register` 的内联字典，所以它是死文件。同时去掉 `exports` 里的 `./locale/*` glob 与 `files` 里的 `locale`。
- **README 补齐上架所需的声明**：新增「实测覆盖」一节（**已实测验证**的 7 项与**仅桩测试**的其余提供商分列，并邀请用户开 issue 补充）；「权限与数据」补上命令/进程/生命周期脚本/运行依赖/浏览器边界；「兼容性」补上 Node 与已验证 Core 版本，并解释那个 `||` 分支为什么不能省；「安装」补上 GitHub 固定 Commit 方式，并说明为什么不能用浮动分支；新增「主要风险」。
- 测试：`check-manifest.mjs` 的 locale 断言换成 LICENSE 断言（存在 / MIT / 已打进包）；`prepare-release.mjs` 与 `test-release-pack.mjs` 的清单同步；各文件计数 28 → 27。

## 0.10.7：删掉旧插件的国内重复路由，同一个 plan 只留一个面板

- **症状（用户报的）**：同一个 Agent Plan 显示成两个面板——`Ark Agent Plan (CN, legacy plugin)` 与 `ARK Agent Plan (arkcli)`，数字还不一样（4.2% vs 5.3%）；Coding Plan 同样成对出现。用户的原话是「legacy 的数据比新的延迟」。
- **实测结论：那不是延迟，是同一份订阅被查了两遍。** 用本机 AK/SK 把 5 条 Ark 路由各打一遍：legacy 与 arkcli 的请求 URL **逐字相同**（`GetAFPUsage` / `GetCodingPlanUsage` @ `open.volcengineapi.com/cn-beijing`），间隔 4 秒的两轮数据**完全一致**；`subusage_quota` 带 `refresh: true` 也给出两两相同的数字。差异只来自各自缓存（TTL 60 秒）的刷新时刻不同。
- **改法**：**移除** `ark-coding-plan-cn` 与 `ark-agent-plan-cn` 两条路由及其在设置页的独立卡片。同一个 plan 无论由哪个插件提供，都只对应**一个**面板。
- **旧插件用户的药丸不丢**：装了 `@volcengine/ark-plan-api` 的用户，模型路由仍然是那两个 id，所以 Client 新增 `ROUTE_PROVIDER_ALIAS`，在**入口**把它们归并到 arkcli 路由——药丸照常显示，数据来自同一份订阅。
- **BytePlus 保留**：它是唯一的「同 Action 不同 host」（`ark.ap-southeast-1.byteplusapi.com` / `ap-southeast-1`），独立站点、独立订阅，删了就没有实现覆盖它。
- **「没有这个套餐」不再是错误**：实测没有 BytePlus Coding Plan 的账号返回 HTTP 404 `NotFound.BillingType`（`coding plan config is not exist`）。此前它被当成 404 错误画成一张红色卡片；现在 `NotFound.BillingType` 与 `OperationDenied.NotSubscribed` 一律回报 `subscribed: false`，前端据此收起——**两个套餐都检测，谁有数据显示谁**，不需要预先判断用户「是哪个套餐」。
- 新增结构化字段 `subscribed`（Host 的 entry 与 `quota()` 视图都有）：HTTP 200 但没有订阅 ≠ 0% 用量，这个区别以前只写在 `extras` 文案里，前端拿不到。
- 测试：`test-volcengine.mjs` 的 Client 段改为断言 arkcli 两条默认开启、BytePlus 默认关闭，并新增「legacy id 已移除但必须仍能归并」；错误映射段拆出 `OperationDenied.NotSubscribed` / `NotFound.BillingType` → `subscribed: false` 的用例；各文件里的 provider 计数从 30 改到 28。

## 0.10.6：修好 Coding Plan 查不到用量，Grok token 过期说清楚

- **症状（用户报的）**：有 Coding Plan 订阅、AK/SK 也配了，卡片却永远写着「订阅检测已关闭 / 暂无额度数据」；同一台机器用 `arkcli usage plan --product coding-plan` 能查到额度。
- **根因一：两端判定分叉。** 设置页的 Ark 是一张合并卡片（7 条路由共用一个**组开关** `visibility.ark`），Client 按组开关判显隐，而 Host 的 `provider()` 只看**逐条开关** `visibility.providers[id]`。老配置里逐条各存一份（`arkcli-coding-plan: false`），迁移时又只把「任一条开着」合并成组开关 `true`——于是界面显示这条路由、Host 却回 `disabled`。现在 `parseStored` 读回时把逐条值归一化到组开关，Host 也用同一个 `providerEnabled()` 判定，两端口径只剩一个真源。
- **根因二：Ark 不该按路由收起。** Client 原本对所有提供商都用「本机装没装这条**推理**路由」当可见性判据。可火山方舟的额度走**账号级管控面**：一组 IAM AK/SK 就能查到名下所有套餐——本轮用本机 AK/SK 实测，`GetCodingPlanUsage` 与 `GetAFPUsage` **两条都返回 HTTP 200 与完整窗口**，且两者在 arkcli 里同为控制面 `ark_action`（不存在「Coding Plan 专用查询 key」）。路由只是模型推理入口，「订了 Coding Plan、却没在 DSH 里配 coding-plan 路由」完全正常，按路由收起会让这类用户凭空少一条真正有数据的额度。现在 Ark 只按「有没有可用 AK/SK」判定，其余按路由取数的提供商不变。
- **顺带修正默认值**：`defaultSettings()` 里 Ark 的逐条默认值改为直接跟随组开关。否则「首次读到（还没有配置文件）→ 保存 → 再读回」会因为归一化把成员值改成组开关的值而算出不同的 revision，第二次保存直接撞 `revision-conflict`——这个是我加归一化时被测试当场抓住的。
- **Coding Plan 的响应形态更正**：实测响应里除 `Level` / `Percent` / `ResetTimestamp` 外还有 `Cap: 100`、`RewardTotalPercent`、`HasReward`——**字段确实存在**（此前文档写的是「未在任何来源证实存在」，已更正为「存在但语义无官方说明」）。仍然不展示：不编造单位，也不把 100 读成「还有 100 次」。`session` 窗口的 `ResetTimestamp` 是 `-1` 哨兵，不输出重置时间（既有的 `ms > 0` 判定已覆盖）。
- **SuperGrok 的 token 过期说清楚**：`~/.grok/auth.json` 里带着 `expires_at`，而凭据解析从来没读它——过期后插件照发请求，拿到上游 401，界面显示「登录或凭据已失效」，可用户那边的 Grok Kit 明明写着「已登录」。现在解析出 `expiresAt`，已过期就**不发请求**并直接说明：token 何时过期、用一次 Grok CLI 或在 设置 → xAI Grok 里重新登录即可刷新同一个文件、以及**为什么本插件不代刷**（refresh-token 轮换由 Grok CLI / grok-kit 各自的锁协议管理，第三端刷新会把它们的轮换顶掉）。
- 测试：`test-volcengine.mjs` 新增「组开关是唯一真源」（迁移残留的逐条 false 不得让 Host 跳过查询；反向关掉组开关后整组都跳过）；`test-provider-controls.mjs` / `test-client-render.mjs` / `test-client-behavior.mjs` 同步 Ark 整组可见的新语义；`test-supergrok.mjs` 新增过期 / 未过期 / 无 `expires_at` 三个用例。

## 0.10.5：额度查询改用宽松命名匹配，并把「空结果」这条路堵死

- **症状**：模型调用 `subusage_quota(providers: ["zai"])` 拿到的是**空列表**，看起来像「本机什么都没配」。真正的原因是两套命名：模型手里的是 DSH 的路由名（`zai`、`grok`、`codex`），而本插件的 provider id 是路由 id（`zai-coding-cn`、`xai-oauth`、`openai-codex`）——旧实现只做精确 id 匹配，认不出的一律 `filter` 掉，于是「传了名字」反而比「不传」结果更少。
- **改法**：名称解析改成**归一化宽松匹配**（大小写与 `-` `.` `_` 空格均无关），并为路由登记别名（厂商名、品牌中文名、GLM/Zhipu 这类同义写法）。一个名字命中多条路由时**全部返回**：`zai` → 中国版 + 国际版，`ark` → 7 条，每条各自带真实 `state`（没启用的如实标 `disabled`）——不替调用方猜一条，也不返回空。
- **兜底**：一个名字都认不出时，返回里**先**给一条说明（写明可用写法与「省略参数即查全部」），**再附上全部 30 条数据**。原则是「数据先给出去，判断交给调用方」：旧行为的静默过滤会让调用方以为本机没有额度，而真正的原因只是名字没对上。`render` 出的文本同样不再可能是空的——读不到数据时也给下一步。
- **工具说明补全**：DSH 只把 `name` / `description` / `parameters` 投影给模型，`output.schema` **不会**发给模型（`dsh-tools` 的投影刻意丢掉 `output` / `execute` 等本地字段），所以「怎么用」只能写在描述里。描述现在交代了「不传参数即查全部」「可传厂商名」「认不出时会拿到全量数据」，`providers` 参数也说明了大写与分隔符无关。
- **`output.schema` 补元素级 schema，并修掉两处会真炸的问题**：`windows` / `extras` 原先只声明 `type: "array"`、没有 `items`，等于对元素不做任何约束。补上 `items` 后用**真实的 `dsh-tools` 校验器**（`valueSchemaSpecToJsonSchema` + `validateJsonSchemaValue`）压了一遍真实输出，抓到两个会直接让工具失败的缺陷：①未知名字条目多带了一个 `errorCode` 字段，而该层是 `additionalProperties: false`；②`lastSuccessAt` / `coverage` / `freshness` 为 `undefined` 时键仍存在，被判成「不是 string」。现在 `quota()` 只输出**真正有值**的字段——与项目既有的「absent field ≠ 0」一致：字段缺席表示「这家没有报告」，不是「报告了空」。窗口与 `detail` 两层用 `additionalProperties: true`：形态随厂商变化，收紧成白名单只会让新增字段在运行时被判违规。
- 测试：`tests/test-quota-api.mjs` 覆盖别名（`zai` / `Z.AI` / `zai_coding_cn` / `ark` / `Kimi` / `grok`）、混入未知名字时的顺序（说明在前）、全认不出时的「说明 + 30 条」、视图不含 `undefined` 键、`render` 在空结果与「一条都没读到」时的兜底文案，以及 schema 的元素级形状与描述措辞。

## 0.10.4：修好 AFP 两条额度线的分组（0.10.2 声称过，但一直没有生效）

- **症状**：Agent Plan 卡片里 5 小时 / 周 / 月 / 日四个窗口连排，**没有分组标题**——于是「日 50.0K 比周 35.0K 还高」看起来像插件算错。`0.10.2` 的更新记录里已经写过「按额度线分成两组展示」，但界面上从来没出现过。
- **根因**：分组标注（`groupLabel`）由 `lib/volcengine.js` 的解析器产出，而 `lib/index.js` 的 Ark 分支会先用 `windowRow` **重新构造**一遍窗口对象再交给前端；`windowRow` 只认 `kind / percent / resetsAt / status / detail` 五个字段，`groupLabel` 在这里被**静默丢掉**。丢字段不报错、不抛异常，前端只是没有标题可插——所以解析器层的测试全绿，界面一直是错的。
- **修法**：`toWindows` 重建窗口时把 `groupLabel` 一并带上。`tests/test-volcengine.mjs` 新增一段「分组标注经过 Host 装配后仍在」，逐条比对四个窗口而不是只看解析器输出——这是第一处**跨过 Host 装配**这层的断言，此前所有相关测试都停在解析器上，正是漏掉这个 bug 的原因。
- **明细行拆成两行**：用量（`已用 x / 总计 y`）与重置时间原先用 ` · ` 挤在同一行，窄弹层会从「重置于 2026/10/10 01:34:25（还有 2 小时）」**中间折断**，读起来像属性与数值分了家。现在用量一行、重置一行，两行各自可换行（`overflowWrap: anywhere`）。
- 弹层与设置页的窗口列表合并成同一个 `UsageWindowList`，分组标题不再只存在于其中一处；`tests/test-client-render.mjs` 新增一段同时钉住这两处，并断言「同一条额度线的标题只插一次」「日限额排在最后」。
- 顺带：`render-ui-preview.mjs` 的 `pill` 模式支持 `arkcli-agent-plan`，用 AFP 的真实形态（两条额度线 × 四个窗口）出图，离线预览从此能直接看到分组与拆行效果。

## 0.10.3：火山方舟合并成一张卡片、Codex 默认关闭

- **设置页把火山方舟的 7 条路由合并成一张卡片**：它们共用同一组 IAM AK/SK，而一般用户只持有一个套餐，原来 7 张卡片各自问一遍同样的凭据纯属冗余。现在只有一个**组开关**（落在 `visibility.ark` 上）和一组凭据，卡片里说明本机实际装了哪几条路由。**这些 provider id 并没有合并**——药丸仍按 id 匹配路由。旧配置里逐条保存的开关会按「任一条开着」自动迁移。
- **Codex 改为默认关闭**：它的提供方插件自带用量药丸，两个并排只是重复信息（仍可在提供商管理里手动开启）。README 新增「前置：这几家需要提供方插件」一节，列出 Command Code / SuperGrok / Codex 各自的前置插件与登录方式。

## 0.10.2：MiMo 登录入口修复、输入净化与凭据指引

- **修好 MiMo 的登录入口**：点「登录并自动导入」原来打开的是站点**首页**，而首页不会触发登录，用户还得自己点进控制台找登录按钮。现在直接落在**控制台套餐页**（`platform.xiaomimimo.com/console/plan-manage`）——那也正是读取 `tokenPlan/detail` 与 `tokenPlan/usage` 的页面；控制台历史上出现过 502（仅首页可用），因此保留回退到首页。设置页里那个「仅打开官网」的手动入口也一并改到控制台页。
- **输入净化覆盖到全部输入框**：AK/SK 之外，**普通 API Key** 与 **LiteLLM 代理地址**此前也把「含控制字符」当成错误**直接拒绝保存**——从网页或控制台复制时常带尾随换行，于是填了也存不上；**Z.ai 的组织/项目**则会把内部换行原样存进去。现在统一走 `stripInvisible`（剔除空白与零宽字符），只有**全空白**才拒绝（否则会把「清空」误当成「替换成空值」）。新增 `tests/test-input-sanitize.mjs` 覆盖这六个输入框。
- **保存后如实反馈**：火山 AK/SK 保存时若「你填了值、但实际没写进去」，界面直接给红色提示并指出改用环境变量，而不是笼统回一句「已保存」。
- **新增[凭据获取指引](credentials.md)**，并接到 README（Quick start / Configuration / Troubleshooting）与设置页里需要用户先去别处操作的凭据区（火山 AK/SK、MiMo、普通 Key、LiteLLM、Z.ai 团队档）。内容含：每类凭据的**官网入口、环境变量名、界面填入位置**；火山子用户的**创建与授权完整清单**（`ArkReadOnlyAccess` + 「限制到项目资源」选否，以及 `AccessKeySelfManageAccess` / `AccessKeyFullAccess` 的取舍）；一张**报错对照表**。设置页的火山凭据区还加了直达控制台「API 访问密钥」的链接。
- **Agent Plan 的额度按额度线分成两组展示**。官方口径（[套餐概览 · 额度刷新规则](https://ark.volcengine.com/region:cn-beijing/docs/agent-plan-personal-plan-overview#%E9%A2%9D%E5%BA%A6%E5%88%B7%E6%96%B0%E8%A7%84%E5%88%99)）里，**日限额只覆盖视觉模型、语音模型与 Harness**，而 5 小时 / 周 / 月属于文本 / 向量模型——两条不是同一条额度线，混排会让人把「日 50K > 周 35K」读成插件算错。现在按额度线分组显示（个人版与席位版共用同一组窗口定义），日限额排在最后并标注适用范围。**Coding Plan 不受影响**：官方只给 5 小时 / 周 / 月三条，本就是同一条线。（**更正**：这条分组在 `0.10.2` / `0.10.3` **实际没有生效**——`groupLabel` 被 Host 装配窗口时丢掉了，界面一直没标题；`0.10.4` 修好并补了跨 Host → wire → Client 的断言。）
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
