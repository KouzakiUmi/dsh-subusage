# dsh-subusage 维护约定

## 目的与边界

在 DSH 对话输入区显示当前模型提供商的订阅额度或余额，并提供设置页与只读 `subusage_quota` 工具。插件不注册模型路由；各订阅的凭据、额度单位和账号边界保持独立。功能与支持范围见 [README](README.md)，接口与验证说明见 [开发文档](docs/development.md)。

## 结构与设计

- `lib/index.js` 是 Host 实现，负责凭据解析、额度查询、缓存、设置持久化和远端接口；公开设置不得包含秘密。**秘密落盘加密**：`lib/secret-box.js` 用 AES-256-GCM 加密 `~/.dsh/dsh-subusage.json` 中的秘密值（`keys[id]`、`instanceSecrets`、小米 `xiaomi.cookie`/`xiaomi.renewal`、火山 AK/SK），封套 `enc:v1:<iv>:<tag>:<ct>`，32 字节随机密钥存 `<config>.key`（0600）；旧明文值读取兼容并在下次保存自动加密，解密失败按空、密钥文件损坏抛 `subusage/key-corrupt`。只有用户输入与登录得到的秘密加密；凭据引用名（keyRefs/credentialRefs/env 名）与环境变量来源不存值不加密。回归见 [test-secret-storage.mjs](tests/test-secret-storage.mjs)。
- `lib/client.js` 是 Client 实现，负责设置页、药丸和客户端数据订阅；不引入 Node.js 模块。设置页「自定义连接」区块（`ConnectionsBlock`/`InstanceEditor`/`RouteBindingsBlock`）提供连接实例 CRUD、四态探测向导（测试连接不保存）、映射编辑器（14 个 JSON Pointer + mappingLock 逐字段锁）、DisplayProfile（primaryMetric/hiddenElementIds）与 Recipe 导入导出；配套 RPC `subUsage/getCatalog|detectInstance|exportRecipe|importRecipe`（export/import 保留直连位置参数兼容），两端 method/codec 清单由 `test-contract.mjs` 比对。
- **`lib/go-panel.js` 是 DSH Go 原生面板**（纯函数、无 IO）：`package.json` 的 `dshGo` 清单声明 `panels.usage`（`session.tab`，对话详情「插件」页签），Host 经 `ctx.inject(["dshGo"], …)` 调 `ctx.dshGo.panel` 注册视图/数据/刷新动作。药丸在 Go 岛内不注册（Client 检测 `data-dsh-go-island` 后跳过 `conversation.input.right`，桌面行为不变）。当前模型按官方投影从 `model/selection` + `request/header` 还原，`ROUTE_USAGE_ID` 与 Client `ROUTE_PROVIDER_ALIAS` 同表（test-go-panel.mjs 逐键比对，改一处必须改两处）。数据走 `service.quota()` 缓存：60 秒轮询、会话事件即时重推、刷新动作 `force`。命中卡与池收窄与药丸同口径（含「遥测先归属再采信」，见 Magpie 一节）。视图只用声明式组件与 `data.*` 绑定，窗口/附加行各截断 8 条。
- **`lib/quota-entry.js` 是统一 wire 契约（QuotaEntry）的唯一事实源**：所有 provider/联动/聚合器只喂数据——每个额度元素自己声明 `order`/`label`/`amount.unit`；状态推断、覆盖率、阈值告警、布局、i18n、弹层密度由管线与渲染端口统一负责。元素类型 `window`（百分比窗口）/ `amount`（余额·附赠·钱包·套餐·花费）/ `package`（额度包）/ `plan` / `status` / `note`，组合维度是「账户 × 池 × 元素」。出边界统一 `canonicalizeEntry()`：`ofmAccounts`→`linkedAccounts` 折叠、quotas↔windows/extras 双向补齐、恒为数组。**`quotas` 在场即权威**（含 `[]`）：数组存在就按它派生 legacy，整体缺席才从 windows/extras 转。元素 `id` 稳定身份；`poolScope:"independent"` 只标真独立预算（Antigravity，groupLabel 不自动升级）；`amount.unitId` 是聚合键（按 `unitIdOf` 同义归一，未知单位不猜）；`componentOf` 元素是总额分项、合计跳过；`diagnostics[]` 留规范化丢弃/降级记录。完整契约见 [docs/quota-entry.md](docs/quota-entry.md)。
- **一体化额度查询与药丸显示平台**（架构见 [研究报告](docs/unified-quota-platform-report.md)）：`lib/quota-entry.js` 扩展 `subject`（`key | user | group | seat | account`）与 `aggregation`（`balance: allow | forbid`），`canSumBalanceElement`/`sumAccountBalances` 阻断同用户多把分组 Key 的共享钱包重复累加；`lib/http/` 提供 RFC 6901 JSON Pointer、白名单转换器、安全 URL 归一（禁止公网明文 HTTP、拦截跨源重定向、保留反代子路径与 `/v1` 去重）及只读执行器；`lib/credentials/` 封装统一凭据解析链（内置 provider：`routeEnvs` → `keyRefs` → `builtinEnvs` → `manualSecret`；**自定义实例不含 routeEnvs**，只有 `credentialRefs` → `builtinEnvs` → `manualSecret`——路由绑定只决定药丸归属，不把别的路由的 Key 借给实例）与只读鉴权头注入；`lib/adapters/declarative/` 提供 `sub2api`、`litellm` 与 `custom-http` 声明式适配器；`lib/detection/` 实现 4 态自动探测（`identified` / `needs-review` / `auth-required` / `unsupported`）、数值守恒与五大歧义检测、`mappingLock` 锁定保护及 `sanitizePreview` 预览脱敏；`lib/platform/` 管理 `ConnectionInstance`、`DisplayProfile`（含语义护栏与缺失目标优雅降级）、`RouteBinding`、动态目录及 Recipe 脱敏导入导出。修改展示配置或路由绑定不失效正式额度缓存。回归见 [test-sub2api.mjs](tests/test-sub2api.mjs)、[test-detection-inference.mjs](tests/test-detection-inference.mjs)、[test-display-profile.mjs](tests/test-display-profile.mjs) 与 [test-platform-runtime.mjs](tests/test-platform-runtime.mjs)。
- **wire 输出必须 lossless JSON**：DSH typert 对 RPC/工具返回值逐值校验，嵌套 `undefined` 属性、`NaN`/`Infinity`/`-0`、符号键（如 `QUOTA_SOURCE`）、非普通对象、带洞数组任一处违规整条作废（火山 `resetsAt: undefined` 曾让 `subusage_quota` 全量报错）。规则：**字段缺席就不要写属性**，不得写 `x: undefined`；`resetsAt`/`owned_by`/`groupLabel` 等可选字段一律条件展开。`quota()` 白名单与 `readLinked`/`linkedStep`/`result()` 出口统一过 `wireJson()` 深度净化兜底，回归见 [test-wire-lossless.mjs](tests/test-wire-lossless.mjs)（与 typert `visitJsonValue` 同口径的扫描谓词）。
- 代码直接维护在 `lib/`，修改后运行 `npm run check`，其中包括隔离回归与发布清单检查。隔离测试不替代真实账号或 GUI 验收。
- 凭据与登录适配遵循各提供商既有来源和生命周期；药丸路由别名不得顺带更改查询端点或账号选择。

## Antigravity 与独立插件联动

- 联动项不进 `PROVIDERS` / `PROVIDER_META` / `PROVIDER_ORDER`（没有凭据槽与普通设置卡片），登记在 Host 的 `LINKED_PROVIDERS` 与 Client 的 `PILL_LINKED_META`；改这几处表必须双端同步并更新 `tests/test-contract.mjs`。每个联动项有独立开关：Antigravity 走既有 `visibility.antigravity`（默认开启），其余全部走 `visibility.linked[id]` 逐项表（缺省全开、补丁逐键合并）；关闭时 quota() 与 readLinked() 同样静默缺席，Client 清除旧条目并拦截迟到响应。开关集中在设置页「联动」分组 tab（Antigravity / 独立插件 / OFM 十渠道 / Magpie 四组）。
- **Antigravity 一条、两个提供方插件通道**：`channels: ["agyQuota", "antigravityAuth"]`。`agyQuota` 是 dsh-antigravity-acp 的 `read({force})` → `QuotaSnapshot`（带 plan + credits，优先）；`antigravityAuth` 是本机实际安装的 dsh-tool-antigravity 经 `ctx.provide` 暴露的服务，`usage(signal?, force?)` → `QuotaStatusView`（gemini / non-gemini 两组、5h / weekly 两窗）。`linkedSnapshot()` 只在「服务取不到 / 没有方法」时回落，服务在场但回失败快照**不**回落；归一化分别走 `normalizeAntigravity` / `normalizeAntigravityAuthView`，字段形状照抄对方类型声明，不编绝对值。`rate-limited` 是查询限流，不是额度耗尽。
- **兄弟插件的 HTTP 路由只能由页面代取**：`/plugins/*` 走连接层 `admit()`，要求浏览器 cookie；宿主进程请求一律 403（实测 Trae/WorkBuddy/小浣熊/Loomy 七条同时失败）。所以 `CLIENT_FETCH_VIA`（trae-route / workbuddy-route / desktop-route）改由渲染进程同源 fetch 原始响应，宿主用 `subUsage/linkedStep` 以「注入数据源」的方式复用 `linkedProvider` 的原有归一化、缺席指引与 OFM/EAC 回落（不要另写一条归一化分支，否则缺席与回落会静默丢失）。禁止把归一化复制到前端，也禁止退回「宿主自己发本机 HTTP」；客户端只在宿主不认识 `linkedStep` 时回退。成功读数按渠道 60 秒复用，失败/缺席不缓存。OFM 与 EAC 走进程内 Fetch、Antigravity 走 Cordis 服务，不受影响。
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

- `LINKED_PROVIDERS.magpie` 的 `via: "magpie"`，由 [magpie-usage.js](lib/magpie-usage.js) 的 `MagpieUsageReader` 在 Host 进程内直取回环 `GET`（默认 `http://127.0.0.1:3425`）。**不进 `CLIENT_FETCH_VIA`**：loopback 免鉴权且页面拿不到宿主进程内连接，与 `/plugins/*` 的 cookie 通道不是一类。`magpie` / `magpie-responses` / `magpie-anthropic` 三条模型路由经 `ROUTE_PROVIDER_ALIAS` 归到 `magpie`。
- **只读**：只发 `GET /v1/magpie/quotas?kept=1`、`/v1/magpie/usage/requests`、`/v1/magpie/concurrency`、`GET /v1/models`；`?kept=0` 会触发全部卡片重查、POST `/refresh` 写提供方侧——都不在主动刷新里使用。读取失败 / 5xx / 非 JSON = 通道缺席（`undefined` → `null`），点名才给安装指引；`data:[]` 是「网关在场但没卡」，不是缺席。缓存 60 秒、有代次保护与 pending 合并，`dispose()` 清理。
- **卡视图**：一张卡 = `linkedAccounts` 一行，`providerGroup`/`providerName` 给分组的键与显示名，`account` =「`name · (alias | user)`」——卡片有 `alias`（掩码账号）用它做显示名，`user` 保留给路由回指；`accountId` 带 `#<idx>` 区隔同 provider 同用户的多套餐；`last:true` → `accountActive`。`used`/`remaining` 是已用百分比写进 `windows[].percent`；窗口名先按已知名归一、再按「读数到重置点的时长」兜底到 5h/day/week/month/period，认不出的不猜；窗口原名写进 `detail.note`，弹层窗口卡片标题**优先显示原名**（「Credits」「Total credits」「通用积分池 · 5 hours」直接写是什么额度），周期档位词只在没有原名时用，说明行不重复原名。**`text:true` 是纯剩余文本窗**（Loomy 永久积分）：`display` 只有一个数、无 limit/已用，`remaining` 是占位值——解析 display 得 `detail.left`，不报占位的 100%。**积分型窗口**（`amount`/`limit`/`unit` 在场，如 SenseNova）同步下 `detail.used`/`limit`/`unit` 与 `detail.left`（剩余量按 `limit×remaining` 回推，上游不给直接数字时不猜）：药丸大数字、`pillText` 与窗口卡片优先报「余 N credits」实际数量，百分比条仍画剩余比例但不再独占显示。**纯余额卡**（无 windows）走顶层 `balance` → `amount` 元素 + `extras` 余额行，`until`（可解析日期）→ note 行，不补造百分比窗口。**`display` "a / b" 兜底**：上游只给文本不给结构化字段时按 a 的角色算剩余量——`amount===a`（amount 恒为已用）或 `a/b` 更偏离 `remaining%` 时 a 是已用、余 b−a（Copilot premium / MiMo / OpenDesign / SenseNova）；`a/b≈remaining%` 时 a 是剩余本身（Loomy）；K/M/B 量纲换算；display 给非数值文本（Copilot「Unlimited」）原样下发 `detail.leftText`（契约字段，客户端当剩余文本显示）。**Antigravity 去重与分池**：上游把每模型的同一额度按「模型×档位」复制下发（Opus/Sonnet/Argon 各 3 档完全相同），另附「池 · 周期」池级名行——同一额度最多出现 4 份。只对 provider=antigravity 按「池+周期+已用%+重置时间」分组去重（未知池保留原名作池身份，不合并两个陌生池）：池级名行退为池名来源不占行（Opus/Sonnet 同池合并成一行「Claude & GPT · 7 days」），模型级行去 (tier) 后缀同名合并（Argon 三档合一），组内无模型行时池级名行自己留下（Gemini · 7 days / 5 hours）。产出 4 窗 3 池：Claude & GPT 周、Gemini 4 Argon 周、Gemini 周 + 5h——池词汇照抄独立通道 `non-gemini`/`gemini`/`gemini-argon` 写进 `groupLabel`，quotas 同步 `poolScope:"independent"`。`readAt` 缺席时窗口档位用 `now` 兜底倒推（`magpieWindowKind` 的时长兜底需要基准）。**模型→池收窄**：`poolForModel` 按 `groupLabel` 池词汇匹配（claude/opus/sonnet/gpt→non-gemini，argon→gemini-argon，gemini→gemini），认不出的模型退回整卡口径不硬配；弹层正文与药丸状态条按收窄后窗口算，路由行加「（池 {名}）」。**模型→渠道卡**：选中模型 id 的 `provider/` 前缀（`kimi/k3.1-pro`→`kimi`）直接匹配 `providerGroup`；`auto/*`、`group/*` 组模型没有 provider 前缀时查快照里 `/v1/models` 的 `owned_by`（先完整 id、后组名后缀）。命中顺序：**本会话的**在途 live > 当前模型归组 > **本会话的**上次路由 provider——切换模型立刻切卡，不卡在「上次路由」的用尽横幅；**遥测要先归属再采信**：magpie 的 concurrency / usage 行不区分会话（DSH 不发 `X-Magpie-Session`），只有 `req` 与本会话当前模型一致（去 `auto/`/`group/` 前缀后比较）时才认它——否则切到另一个对话后，别人正在跑的请求会被当成「正在服务」，收窄到别的渠道，本会话模型归不出组时还会一起退回聚合总览。认不出的遥测仍作路由行展示，但标注「其他对话的请求」。账号行「正在服务/上次命中」徽标同样按归属后的 cardId 过滤，不读原始 `routeContext.cardId`。
读数 >24h → `stale`；`error` 卡保留成行不丢。
- **路由口径**：`concurrency.active` 里 `agent==="dsh"` 的在途行（live，正在走的实际上游）压过 `usage/requests` 的最近一次命中（recent），折成 `entry.routeContext`（**模板端口**：字段在场即有路由口径，Client 不查 providerId）。**live 不继承 recent 的 `cardId/account/model/status/at`**：这些字段属于旧请求，concurrency 未报告就缺席；Client 还校验 `cardId` 的 `providerGroup`，拒绝旧 Host/迟到快照的跨渠道回指。**不猜 auto 组上游**：`owned_by` 只是出厂提示，`/v1/magpie/route?session=` 要求 `X-Magpie-Session` 而 DSH 不发；没有日志就说「暂无路由记录」。**药丸只显示当前模型命中的上游卡**：命中顺序为在途 live > 当前模型 `provider/` 前缀（或 `auto/*` 的 `owned_by`）> 上次路由 provider；**遥测先归属再采信**（同上：`req` 与本会话模型对不上就不参与命中卡、不参与池收窄，也不接受它的 `cardId` 回指）；按命中卡判定百分比与状态，不把全部卡的最紧窗当成当前额度。`LinkedAccountList` 按 `providerGroup` 分组平铺、焦点组置顶；有命中卡时只平铺该组（`servingOnly`），其余组收进 `details`（「其他渠道 · G 组 N 张」）；无命中或账号数 >12 也走同一折叠守住 ≤14 行。快照另带 `/v1/models` 的 `{id,owned_by}` 列表供 `auto/*`、`group/*` 归组；它只是当前选择的显示映射，不等于已发生的真实路由。
- 回归见 [test-magpie-link.mjs](tests/test-magpie-link.mjs)；分组与折叠两形态在 [test-pill-density.mjs](tests/test-pill-density.mjs) 的密度表里。

## EAC 三渠道回退（dsh-eac-router）

- Loomy / Raccoon / Qoder 中国版 的第三个来源是 [dsh-eac-router](../dsh-eac-router) 的 `/api/eac-router`（JSON-RPC：`{ type:'client-request', rpcId, method:'eac-router', payload:{ method, payload } }` → `{ type:'server-response', rpcId, result:{ ok, value | error } }`），额度只读 `credits.balances`。
- **必须走 Connection 的进程内 Fetch**（与 [ofm.js](lib/ofm.js) 同口径：自建 `owner` peer + `connection.createSharedFetchHandler("/api")`）。`/api/*` 是宿主的鉴权面，裸 HTTP 打本机回环会缺会话凭据、被网关回 401——三个渠道一起 401 就是这个原因，不得改回 `webServerOrigin()` + `fetch`。
- **不新增并列条目**：三处读的是同一批账号，`LINKED_PROVIDERS` 里只加 `eac` 回退字段——`raccoon` / `loomy` 走「独立 connect 插件 → Our Free Model → EAC」，`ofm-qodercn` 走「OFM → EAC」。顺序由 `linkedSnapshot` 决定，现有来源在场时不得请求 EAC。
- 回落只在 `readLinked`（药丸，`allowSourceFallback = true`）发生；`quota()` 与工具的全量/点名查询保持既有请求量，不额外放大。
- 缺席语义：404（未安装）= 通道不存在；`eac-router/not-ready`（后端未启动）= 本期没有这条通道；两者都返回 `undefined`，不顶红卡片，点名时给「先装哪个独立插件」的说明。其它 `ok:false` 算真实失败并透出上游原因。
- 归一化在 [eac-usage.js](lib/eac-usage.js)：只读 `balance.total` 与 `packages`，`credit(s)` / `token(s)` 只按已知同义词归一化；仅当各包单位明确一致、或本机直取已明确携带余额单位时给总额标单位。包为空仍保留真实余额和覆盖状态，不编造 `credits`，混合单位也不套用第一个包的单位。真实账号失败/刷新失败保留降级，不换算 EAC 未公开的 `expiresAt` 数字时间单位；明确可解析的日期字符串才进入 [credit-packages.js](lib/credit-packages.js) 的到期分组。缓存 60 秒、有代次保护、卸载不回填。
- 回归见 [test-eac-link.mjs](tests/test-eac-link.mjs)：归一化、回退顺序、请求体（`credits.balances` / `provider`）、缺席与未就绪、真实失败、缓存。

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
- 手动绑定只影响药丸选择订阅，优先于内置路由别名；未绑定路由继续自动匹配，关闭开关保留映射。`routeBindings`（路由→实例绑定）同属手动层：`manualMatching` 关闭时保留不生效；统一解析顺序为 `routeBindings` → 实例 `routeIds`（实例自身声明，不受开关门控）→ `providerMappings` → 内置别名，Host `resolveRouteTarget`、Client 药丸与 `goPanelUsageId` 三处同口径。
- 不改变检测开关、凭据、查询端点、额度缓存含义或工具报告的订阅 ID。实际选中模型的药丸 reader 以独立上下文跳过订阅原始路由 ID 的存在性过滤，刷新和轮询保持该上下文；设置页的原有过滤不变，药丸仍遵守检测开关、缺凭据隐藏和订阅状态判断。
- 火山 `volcengine-agent-plan` / `volcengine-coding-plan` 对应现有 Ark Agent / Coding 订阅；OpenDesign `opendesign-corouter-plan` / `opendesign-corouter-paid` 共用 OpenDesign 订阅。新增别名须核对提供方实际注册 ID。

## 中转聚合商的额度口径

- `apigoto` 是**目前唯一**的中转聚合商（2026-10-31 按用户决策移除 `unorouter` 与 `qnaigc`：它们只给 Key 级余额或时间范围内的花费，没有窗口与订阅语义，信息量不足以撑起一个入口）。它只读官方额度接口，与推理共用同一把 Key；不注册路由、不写上游。
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
- **积分包必须先归一化再展示**：[credit-packages.js](lib/credit-packages.js) 隐藏用尽与能确认已过期的包，按今天 / 3 天内 / 临时 / 周期套餐 / 永久分组；只在单账号、同单位内聚合，紧急组保留最早到期时间。已有窗口的包只补紧急提醒；无法确认语义的到期字段不猜。
- 变更说明先记入未发布条目；安装、版本发布与源码推送分别处理。
