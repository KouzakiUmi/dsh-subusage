# dsh-subusage 维护约定

## 目的与边界

在 DSH 对话输入区显示当前模型提供商的订阅额度或余额，并提供设置页与只读 `subusage_quota` 工具。插件不注册模型路由；各订阅的凭据、额度单位和账号边界保持独立。功能与支持范围见 [README](README.md)，接口与验证说明见 [开发文档](docs/development.md)。

## 结构与设计

- `lib/index.js` 是 Host 实现，负责凭据解析、额度查询、缓存、设置持久化和远端接口；公开设置不得包含秘密。
- `lib/client.js` 是 Client 实现，负责设置页、药丸和客户端数据订阅；不引入 Node.js 模块。
- 代码直接维护在 `lib/`，修改后运行 `npm run check`，其中包括隔离回归与发布清单检查。隔离测试不替代真实账号或 GUI 验收。
- 凭据与登录适配遵循各提供商既有来源和生命周期；药丸路由别名不得顺带更改查询端点或账号选择。

## Antigravity 与独立插件联动

- 联动项不进 `PROVIDERS` / `PROVIDER_META` / `PROVIDER_ORDER`（没有凭据槽与普通设置卡片），登记在 Host 的 `LINKED_PROVIDERS` 与 Client 的 `PILL_LINKED_META`；改这几处表必须双端同步并更新 `tests/test-contract.mjs`。Antigravity 例外地有独立 `visibility.antigravity` 开关（默认开启），只占管理区顶部一个按钮，不进入普通 provider 列表。
- **Antigravity 一条、两个提供方插件通道**：`channels: ["agyQuota", "antigravityAuth"]`。`agyQuota` 是 dsh-antigravity-acp 的 `read({force})` → `QuotaSnapshot`（带 plan + credits，优先）；`antigravityAuth` 是本机实际安装的 dsh-tool-antigravity 经 `ctx.provide` 暴露的服务，`usage(signal?, force?)` → `QuotaStatusView`（gemini / non-gemini 两组、5h / weekly 两窗）。`linkedSnapshot()` 只在「服务取不到 / 没有方法」时回落，服务在场但回失败快照**不**回落；归一化分别走 `normalizeAntigravity` / `normalizeAntigravityAuthView`，字段形状照抄对方类型声明，不编绝对值。`rate-limited` 是查询限流，不是额度耗尽。
- **兄弟插件的 HTTP 路由只能由页面代取**：`/plugins/*` 走连接层 `admit()`，要求浏览器 cookie；宿主进程请求一律 403（实测 Trae/WorkBuddy/小浣熊/Loomy 七条同时失败）。所以 `CLIENT_FETCH_VIA`（trae-route / workbuddy-route / desktop-route）改由渲染进程同源 fetch 原始响应，宿主用 `subUsage/linkedStep` 以「注入数据源」的方式复用 `linkedProvider` 的原有归一化、缺席指引与 OFM/EAC 回落（不要另写一条归一化分支，否则缺席与回落会静默丢失）。禁止把归一化复制到前端，也禁止退回「宿主自己发本机 HTTP」；客户端只在宿主不认识 `linkedStep` 时回退。成功读数按渠道 60 秒复用，失败/缺席不缓存。OFM 与 EAC 走进程内 Fetch、Antigravity 走 Cordis 服务，不受影响。
- 联动药丸走独立 Typert 方法 `subUsage/readLinked`：Client 路由 `google-antigravity` → 联动 id `antigravity`（`ROUTE_PROVIDER_ALIAS`），独立 Trae / WorkBuddy / Raccoon / Loomy 与 OFM 也登记在联动表。Host 结果只回 `{ updatedAt, entries }`，**不回 settings**，避免轮询顶掉设置快照；两端 codec 与方法白名单必须同步。联动 id 跳过普通 provider 的凭据 / 路由存在性过滤；只有 Antigravity 遵守 `visibility.antigravity`，关闭时移除旧条目并阻止迟到响应复活药丸。开启且未装插件时显示缺席原因。
- 点名联动查询的空 `entries` 表示移除该请求目标的旧额度；Client 仅接受当前请求代的移除信号，不覆盖设置快照，后续轮询可恢复其他窗口重新开启的联动。回归覆盖跨窗口关闭/恢复及关闭前在途成功、缺席和失败响应。
- Antigravity 的模型分组是独立额度池：同池内取最紧窗口，跨池按实际报告的组数计数；部分池耗尽只作黄色提醒，全部已报告池耗尽才标红。药丸、横幅与悬浮说明共用分池结论；分池横幅只展示一句紧凑结论，逐池余量和重置时间留在窗口卡片与悬浮说明中，避免展开后重复列举。缓存/部分/失败状态优先保留数据质量提示。显示名将 Gemini / Claude-GPT / `gemini-argon` 的已知组名转为可读的中英文，原始 `groupLabel` 保留池身份，未知组名原样显示；不猜当前模型所属池、不补造缺席池。
- 缺席语义：不点名的全量查询静默；点名（含 `google-antigravity` / `dsh-tool-antigravity` 等别名）回一条列出两个插件名的安装指引；`unauthenticated` 点名时给「去 dsh-tool-antigravity 完成 Google 授权（`/antigravity-auth login`）」指引。

## OFM 联动与手机药丸

- 十个渠道以 `ofm-*` 登记，由 [ofm.js](lib/ofm.js) 经 Connection 的进程内 Fetch 调用 `usage.badge` 与 `account.list`；完整范围、鉴权来源及限制见 [联动说明](docs/ofm.md)。Host 可按索引引用检查凭据非空存在性，只回状态，引用名和秘密不出 Host；不自行登录、签到或写提供方设置。OFM `preference` 是显示偏好，不是账号模式，不能生成无依据的当前账号。
- 工具按账号展开，药丸用 `ofmAccounts` / `linkedAccounts` 保留稳定 `accountId` 与独立额度；查看账号仅切换展示，不修改实际推理账号。凭据存在/记录有效期不能当上游鉴权成功。索引删除、停用或缺凭据不能复活旧额度；余额不跨账号累加，包到期不作窗口重置，Cline 窗口按账号 ID 匹配。
- 独立 Trae / WorkBuddy 由 [connect-usage.js](lib/connect-usage.js) 经各自公开 GET 接口读取，按插件、区域和账号 ID 隔离。池行真实字段是 `accountId`，`current` 不与旧绑定的 `selected` 混用；Trae 池关闭不推固定，WorkBuddy 固定还需 `selectionExplicit`。企业 Trae 不读个人积分替代；WorkBuddy 批量只有总余额，明确选中状态矛盾时丢弃未知归属的完整包。
- 独立 Raccoon / Loomy 由 [desktop-usage.js](lib/desktop-usage.js) 消费单当前账号 `/status`。Raccoon `probeKey` 丢弃后才缓存，Loomy 缓存不伪造账号归属/容量/请求采样时间。两种模型药丸仅在独立接口缺席时回落 OFM；工具分别报告真实来源，避免自动回落重复。`ofm-trae` / `ofm-minimax` 仍为独立查询 ID。
- 独立读取缓存由 reader 统一维护，缺席不缓存，强制刷新有代次保护、卸载不回填。不要在 Host 再包一层无排序缓存。提供方 GET 可能自行镜像登录、续期或更新运行时账号池，文档须按实际生命周期说明。
- DSH Go `panel` 网页岛中，药丸详情进入文档流向下展开，外层负责滚动；样式按岛标记自动生效并随 Client 卸载清理。桌面仍为绝对定位弹层。离线浏览器检查见 [脚本](scripts/check-ofm-mobile.mjs)，Android 真机验收单独记录。

## EAC 三渠道回退（dsh-eac-router）

- Loomy / Raccoon / Qoder 中国版 的第三个来源是 [dsh-eac-router](../dsh-eac-router) 的 `/api/eac-router`（JSON-RPC：`{ type:'client-request', rpcId, method:'eac-router', payload:{ method, payload } }` → `{ type:'server-response', rpcId, result:{ ok, value | error } }`），额度只读 `credits.balances`。
- **必须走 Connection 的进程内 Fetch**（与 [ofm.js](lib/ofm.js) 同口径：自建 `owner` peer + `connection.createSharedFetchHandler("/api")`）。`/api/*` 是宿主的鉴权面，裸 HTTP 打本机回环会缺会话凭据、被网关回 401——三个渠道一起 401 就是这个原因，不得改回 `webServerOrigin()` + `fetch`。
- **不新增并列条目**：三处读的是同一批账号，`LINKED_PROVIDERS` 里只加 `eac` 回退字段——`raccoon` / `loomy` 走「独立 connect 插件 → Our Free Model → EAC」，`ofm-qodercn` 走「OFM → EAC」。顺序由 `linkedSnapshot` 决定，现有来源在场时不得请求 EAC。
- 回落只在 `readLinked`（药丸，`allowSourceFallback = true`）发生；`quota()` 与工具的全量/点名查询保持既有请求量，不额外放大。
- 缺席语义：404（未安装）= 通道不存在；`eac-router/not-ready`（后端未启动）= 本期没有这条通道；两者都返回 `undefined`，不顶红卡片，点名时给「先装哪个独立插件」的说明。其它 `ok:false` 算真实失败并透出上游原因。
- 归一化在 [eac-usage.js](lib/eac-usage.js)：只读 `balance.total` 与 `packages`，单位照抄包上报的 `unit`，不猜 `total` 单位、不换算 EAC 未公开的 `expiresAt` 数字时间单位；明确可解析的日期字符串才进入 [credit-packages.js](lib/credit-packages.js) 的到期分组。缓存 60 秒、有代次保护、卸载不回填。
- 回归见 [test-eac-link.mjs](tests/test-eac-link.mjs)：归一化、回退顺序、请求体（`credits.balances` / `provider`）、缺席与未就绪、真实失败、缓存。

## 本机直取（不经兄弟插件）

- 目标：Raccoon / Loomy / Qoder / Qoder 中国版 / ZCode / Trae 六个渠道，优先由本插件**自己**读本机凭据、自己调上游只读额度接口，而不是转发 OFM 或兄弟插件的 HTTP 路由。实现见 [local-usage.js](lib/local-usage.js)。
- 凭据来源三条：① 账号池渠道走 `ctx.get("credentials").resolve(ref)`，ref 取自 `$DSH_HOME/channel-pack/state.json` 的 `accounts[].credentialRef`；② **不要自己解析 `.credentials.yaml`**（那是同一份数据的脆弱副本）；③ Trae 的凭据由 [trae-auth.js](lib/trae-auth.js) 解密，读取必须走注入的 `io.readFileSync` 而不是 `node:fs`，否则隔离测试会真读本机凭据并向上游发请求。**全部账号在账号池 `$DSH_HOME/.trae-auth.<region>.json`（v2 `{version, credentials:[...]}`）里；客户端 `storage.json` 只有「当前登录」那一个**——只读 `storage.json` 会漏掉其他账号。两处字段名不同（池是 `accessToken`/`accountName`/`expiresAtMs`，客户端是 `token`/`account.username`/`expiredAt`）。
- 顺序：`linkedSnapshot()` 里直取优先。**全部账号都读不到就返回 `undefined`**（没凭据 / 已过期 / 上游拒绝），静默让位给原有来源链；只要有一个账号读到就照实返回，失败的行各自带原因。上游应答成功但没下发数字（企业版账号）算「可达」，要显示原因而不是装作缺席——两者不能混为一谈。读失败不落缓存，用户重新登录后下一轮立即恢复。
- **只读两条铁律**：① 不替用户刷新 token——EAC 会周期性轮换 `refresh_token`，两边同时持刷新权会把对方顶下线；② 不碰任何写接口（Loomy 每日签到、ZCode 领取），打开面板不该变成意外签到。
- 各家契约差异必须逐家核对，不可套用：Raccoon 用 `Bearer` + `X-Org-Code`（组织码缺失只能读个人池）；Loomy 只认 `token` 头且成功码是字符串 `"000000"`；Qoder 用 `security_oauth_token` 优先 + `Cosy-ClientType: 10`，企业版 `displayMode === "enterprise"` 不下发数字；ZCode 用 `zcode_jwt` + 必需 `X-Device-Mid`，单位是 token 不是积分；Trae 用 `Cloud-IDE-JWT` + POST `web_user_ent_usage`，剩余按 `credits_limit - credits_amount` 算。两处易错：ZCode 的 `balances: []` 是「0 个桶」的合法形态（如实显示 0），只有字段整体缺失才算形状变化；Trae 的逐包额度要 `product_extra.package_extra` 优先、包名只认 `display_desc`（`package_name` 是产品名，会让几个包同名）。Trae 还只支持中国版账号（凭据自带 `region`），非 CN 不发请求。
- Trae 那一层是**复刻客户端私有格式**：密文布局、四张 64 字节盐常量与 `aes` / `aes-private` 两种头都照抄已装的 `dsh-connect-trae`。客户端大版本换格式时解密会失败，此时必须返回 `undefined` 让直取回退，**不要试图猜新格式**。`~/.trae-cn/trae-jwt-token` 是 CLI 的另一族 JWT（401 / code 1001），不要拿它兜底。
- 已知取舍（有意保留，不要当成遗漏去「修」）：① `linkedSteps` 的 60 秒页面代取缓存在直取之上仍会各算一份，最坏陈旧度接近 120 秒；② `ofm-trae` 的直取实际读的是 Trae **中国版**桌面客户端，标签仍显示「TRAE · OFM」，`trae-global` / `trae-enterprise` 不走直取；③ 上游 `code` 与注入依赖的 `error.message` 会进公开文案，新模块本身不往结果、缓存或日志里放 token。
- 未做的渠道要写明原因：Cline / LobsterAI 本机没有任何凭据；MiniMax 的 token 只有约 4.5 小时且自刷新可能与 MiniMax Code 的 `auth.lock` / `generation` 抢权（按用户决定本轮不做，要做就得先定「不刷新、过期即提示重登」这条线）。

## 手动 provider 匹配

- `visibility.manualMatching` 默认关闭；`visibility.providerMappings` 保存订阅 ID 到多个模型 provider ID 的映射。
- 下拉列表来源是 Host 当前 `llm.listProviders()` 的 ID，不是硬编码候选列表；一个模型 provider 只能绑定一个订阅。
- 手动绑定只影响药丸选择订阅，优先于内置路由别名；未绑定路由继续自动匹配，关闭开关保留映射。
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
- 回归覆盖编辑器停在非登录提供商、OpenDesign 与 MiMo 三种状态下的快捷重新登录，以及重复点击和迟到 idle 状态。

## 验收与维护

- 修改 Host/Client 设置字段时同步校验白名单、默认值、持久化、公开快照和修订冲突控制。
- 手动匹配回归覆盖多路由、重复绑定拒绝、保存重读、关闭恢复自动匹配、手动覆盖内置别名及下拉候选去重。
- 订阅检测与异步刷新必须保留原有请求排序和缓存隔离；新增字段应防止旧响应覆盖新设置。`manualMatching` / `providerMappings` 不参与查询设置一致性哈希，保存显示映射不得作废在途额度；完整设置 revision 仍包含它们。
- 用户文档区分路由匹配、凭据复用和只读额度联动，不把源码核对或桩测试表述为实机兼容验证。
- **弹层与工具报告有密度上限**：收起状态只保留「结论 + 窗口 + 关键金额」，说明类逐条内容折进 `details`。多账号按 Command Code 账户区的做法：**账号全部平铺**，一行一个账号（状态点 + 名字 + 余额或窗口余量），点行即切换查看对象（再点取消）；只有选中的账号才展开它的说明明细，未选中时不挂「其他说明」折叠。横幅不重复账号数；余额归属明确时给当前账号，否则提示按账号查看，不跨账号合计。新增 provider 或联动形态必须同时加进 [test-pill-density.mjs](tests/test-pill-density.mjs) 的形态表，守住「弹层 ≤ 14 行、单家报告一行 ≤ 220 字符」；只靠某一家截图验收不够。
- **新增药丸不得另起收起样式**：有窗口就画 Command Code 同款余量条，健康不多写文字；多账号顶层无窗口时使用账号窗口绘制。OpenDesign 计费来源放悬浮说明与弹层，Antigravity 分池横幅沿用统一尺寸，不为新功能增加常驻标签或特殊横幅。
- **积分包必须先归一化再展示**：[credit-packages.js](lib/credit-packages.js) 隐藏用尽与能确认已过期的包，按今天 / 3 天内 / 临时 / 周期套餐 / 永久分组；只在单账号、同单位内聚合，紧急组保留最早到期时间。已有窗口的包只补紧急提醒；无法确认语义的到期字段不猜。
- 变更说明先记入未发布条目；安装、版本发布与源码推送分别处理。
