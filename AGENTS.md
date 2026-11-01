# dsh-subusage 维护约定

## 目的与边界

在 DSH 对话输入区显示当前模型提供商的订阅额度或余额，并提供设置页与只读 `subusage_quota` 工具。插件不注册模型路由；各订阅的凭据、额度单位和账号边界保持独立。功能与支持范围见 [README](README.md)，接口与验证说明见 [开发文档](docs/development.md)。

## 结构与设计

- `lib/index.js` 是 Host 实现，负责凭据解析、额度查询、缓存、设置持久化和远端接口；公开设置不得包含秘密。
- `lib/client.js` 是 Client 实现，负责设置页、药丸和客户端数据订阅；不引入 Node.js 模块。
- 代码直接维护在 `lib/`，修改后运行 `npm run check`，其中包括隔离回归与发布清单检查。隔离测试不替代真实账号或 GUI 验收。
- 凭据与登录适配遵循各提供商既有来源和生命周期；药丸路由别名不得顺带更改查询端点或账号选择。

## Antigravity / Trae 兄弟插件联动

- 联动项不进 `PROVIDERS` / `PROVIDER_META` / `PROVIDER_ORDER`（没有凭据、检测开关与设置卡片），登记在 Host 的 `LINKED_PROVIDERS` 与 Client 的 `PILL_LINKED_META`；改这几处表必须双端同步并更新 `tests/test-contract.mjs`。
- **Antigravity 一条、两个提供方插件通道**：`channels: ["agyQuota", "antigravityAuth"]`。`agyQuota` 是 dsh-antigravity-acp 的 `read({force})` → `QuotaSnapshot`（带 plan + credits，优先）；`antigravityAuth` 是本机实际安装的 dsh-tool-antigravity 经 `ctx.provide` 暴露的服务，`usage(signal?, force?)` → `QuotaStatusView`（gemini / non-gemini 两组、5h / weekly 两窗）。`linkedSnapshot()` 只在「服务取不到 / 没有方法」时回落，服务在场但回失败快照**不**回落；归一化分别走 `normalizeAntigravity` / `normalizeAntigravityAuthView`，字段形状照抄对方类型声明，不编绝对值。`rate-limited` 是查询限流，不是额度耗尽。
- 药丸（仅 Antigravity，Trae 仍只进工具报告）走独立 Typert 方法 `subUsage/readLinked`：Client 路由 `google-antigravity` → 联动 id `antigravity`（`ROUTE_PROVIDER_ALIAS`），Host `readLinked()` 复用 `linkedProvider` 但结果只回 `{ updatedAt, entries }`，**不回 settings**，避免轮询顶掉设置快照；两端 codec（`SubUsageLinkedQuery` / `SubUsageLinkedResult`）与方法白名单必须同步。联动 id 在 Client 跳过检测开关 / 凭据 / 路由存在性过滤，可见性由 Host 条目决定（未装插件也渲染缺席原因，不静默消失）。
- 缺席语义：不点名的全量查询静默；点名（含 `google-antigravity` / `dsh-tool-antigravity` 等别名）回一条列出两个插件名的安装指引；`unauthenticated` 点名时给「去 dsh-tool-antigravity 完成 Google 授权（`/antigravity-auth login`）」指引。

## 手动 provider 匹配

- `visibility.manualMatching` 默认关闭；`visibility.providerMappings` 保存订阅 ID 到多个模型 provider ID 的映射。
- 下拉列表来源是 Host 当前 `llm.listProviders()` 的 ID，不是硬编码候选列表；一个模型 provider 只能绑定一个订阅。
- 手动绑定默认只影响药丸选择订阅，优先于内置路由别名；未绑定路由继续自动匹配，关闭开关保留映射。
- **唯一例外是 `newapi`**：手动匹配开关打开且订阅绑定到自建路由时，New API 会沿用该路由 profile 的 `apiKeyEnv` 与 `baseURL`（`baseURL`/`baseUrl` 都认）作为默认连接；New API 卡片里显式填写的站点地址与手动 Key 仍优先。多条路由绑同一订阅时，按映射顺序取第一条有 `baseURL` 的，Key 引用按顺序逐个尝试——适合同一站点的多种协议路由，不适合把两个不同站点绑到同一个 New API 条目。
- 除 `newapi` 外，不改变检测开关、凭据、查询端点、额度缓存含义或工具报告的订阅 ID。实际选中模型的药丸 reader 以独立上下文跳过订阅原始路由 ID 的存在性过滤，刷新和轮询保持该上下文；设置页的原有过滤不变，药丸仍遵守检测开关、缺凭据隐藏和订阅状态判断。
- `newapi` 的映射/开关变化会单独失效该条目缓存（因为映射参与它的取数），其它订阅的映射仍只影响显示；`querySettingsHash` 仍不把 `manualMatching` / `providerMappings` 纳入。映射保存后 Client 立即重探测 `newapi`，避免卡片停在旧的「未检测到 API」。
- 火山 `volcengine-agent-plan` / `volcengine-coding-plan` 对应现有 Ark Agent / Coding 订阅；OpenDesign `opendesign-corouter-plan` / `opendesign-corouter-paid` 共用 OpenDesign 订阅。新增别名须核对提供方实际注册 ID。

## 中转聚合商的额度口径

- 中转聚合商登记两家：`apigoto`（2026-10-31 按用户决策移除 `unorouter` 与 `qnaigc`：它们只给 Key 级余额或时间范围内的花费，没有窗口与订阅语义，信息量不足以撑起一个入口）与 `newapi`（2026-11-01 按用户要求接入自建 New API / one-api 站点）。两家都只读官方额度接口、与推理共用同一把 Key；不注册路由、不写上游。`newapi` 不硬编码域名：站点根来自公开设置 `settings.newapi.baseUrl`，额度路径 `/api/usage/token/`（尾斜杠避免 301）与推理同一把 `sk-` Key 的 Bearer。
- 额度语义如实照搬，不套用别家的显示方式：`apigoto` 是订阅窗口 + 套餐内剩余金额 + 充值钱包（两个池，钱包为 0 不是告警）；`newapi` 单位固定 **500000 quota = 1 Credits**，不按国家货币/站点汇率换算。无限制令牌主余额取 `user_quota.total_available`（累计消费用 `spend`），没有 `user_quota` 时给 `allow_user_quota_query` 指引；有限令牌主余额取 `total_available`、`total_granted > 0` 时产 `period` 窗口（无重置时间），账户钱包只作说明、不并入主余额；显式非无限但全 0 显示 0；只有令牌名/到期等元数据时判为读取失败。
- 花费一律用 `spend`，不要放进 `balance`：余额行的告警阈值与「还剩多少」文案会把花费读成可用额度。
- 时间字段按语义区分：`apigoto` 的 `subscription.expires_at` 是套餐到期日、`newapi` 的 `expires_at` 是令牌到期，都不是窗口重置时间，不写进 `resetsAt`；以「… 到期 …（还有 N 天）」说明行显示，已过期改写为「已于 … 到期」，不显示「还有 0 天」。
- 徽标只放套餐名（`plan`），到期/策略/模式/积分/令牌名走 `note` 说明行：徽标是标题行里的一小块，塞进结论会被挤成一串。`policy_name` 与套餐名相同则不重复占行，`points` 为 0 不占行，`mode` 只翻译认得出的取值。
- 归一化走同一返回结构 `windowExtrasResult({ windows, extras, coverage })` 与窗口档位 `windowKindFromSeconds()`；固定额度端点登记在 `PROVIDERS[id].usageUrl`，不在 `fetchProvider` 里散写 URL。`newapi` 的 `usageUrl` 是相对站点根的路径，唯一动态地址来自 `settings.newapi.baseUrl`；该地址不是秘密但必须进入查询指纹，改地址后同 Key 也要重新取数。
- New API 的响应信封两代都认：`code: true`（New API）与 `success: true`（部分 one-api 系）；显式 false 是认证拒绝而不是数字。401/403 提示「额度查询与推理同一把 sk- Key」，404 提示站点缺少 `/api/usage/token/`，缺站点地址按「未配置凭据」处理且不发起请求。
- 自定义路由（如本机 `custom-relay`）不改代码：用「手动匹配 provider」把该路由绑定到 `newapi`，Host 会自动沿用该路由 profile 的 `baseURL` 与 `apiKeyEnv`（卡片显式值优先）；关闭手动匹配开关即停止继承、但保留映射。`newapi` 进 Client 的余额型可见性豁免（`BALANCE_ONLY_IDS`），没有同名模型路由也能查询。
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
- 登录前保留未保存草稿保护、组件级重复启动保护及最新设置 revision 校验。切换编辑器时，恢复状态请求不能覆盖新启动的任务；卸载只清理界面轮询，不取消 Host 登录任务。
- 回归覆盖编辑器停在非登录提供商、OpenDesign 与 MiMo 三种状态下的快捷重新登录，以及重复点击和迟到 idle 状态。

## 验收与维护

- 修改 Host/Client 设置字段时同步校验白名单、默认值、持久化、公开快照和修订冲突控制。
- 手动匹配回归覆盖多路由、重复绑定拒绝、保存重读、关闭恢复自动匹配、手动覆盖内置别名及下拉候选去重。
- 订阅检测与异步刷新必须保留原有请求排序和缓存隔离；新增字段应防止旧响应覆盖新设置。`manualMatching` / `providerMappings` 不参与查询设置一致性哈希，保存显示映射不得作废在途额度；完整设置 revision 仍包含它们。
- 用户文档区分路由匹配、凭据复用和只读额度联动，不把源码核对或桩测试表述为实机兼容验证。
- 变更说明先记入未发布条目；安装、版本发布与源码推送分别处理。
