# 独立插件与 Our Free Model 额度联动

本插件复用提供方已有的账号与额度接口。独立插件与 Our Free Model（OFM）是不同的数据来源；工具按来源、区域和账号分别报告。纯余额多账号药丸按单位显示总积分/余额，点开可逐账号查看，实际推理账号仍由提供方管理。

## 独立插件

| 插件 | 查询 ID / 模型路由 | 读取接口 | 已落实范围 |
|---|---|---|---|
| dsh-connect-trae 4.6.12 | `trae`、`trae-global`、`trae-enterprise` | `usage`；国内/国际多账号用 `account-status?accountId=…` | 国内积分、国际订阅按账号读取；企业版说明额度不可读，不查询个人积分替代 |
| dsh-connect-workbuddy 5.17.0 | `workbuddy`、`workbuddy-global` | `usage`、`account-credits` | 当前账号完整积分包；其他账号仅总剩余积分，积分包明细未提供时另作说明 |
| dsh-raccoon-connect 0.2.4 | `raccoon` | `/plugins/dsh-raccoon-connect/status` | 单当前登录的积分与记录到期时间；没有公开账号池/稳定账号 ID |
| dsh-loomy-connect 0.2.0 | `loomy` | `/plugins/dsh-loomy-connect/status` | 单当前登录，分别显示永久积分、每日赠送积分与缓存时间 |

Trae 与 WorkBuddy 路径前缀为 `/plugins/dsh-connect-trae/`、`/plugins/dsh-connect-workbuddy/`。按各自公开区域参数查询，Trae 为 `cn` / `ai` / `enterprise`，WorkBuddy 为 `cn` / `global`。账号 ID 相同也不跨插件或区域复用读数。

Raccoon / Loomy 药丸先探测独立接口；只有接口缺席时才回落到 OFM 同渠道，并显示实际来源标签。独立入口已经在场但未登录、失败或没有积分时，保留该来源的状态。工具的全量查询和厂商名查询分别报告实际来源，不把药丸回落结果重复登记成独立插件。可用 `dsh-raccoon-connect`、`dsh-loomy-connect` 精确点名独立来源，`ofm-raccoon` / `ofm-loomy` 精确点名 OFM。

独立 Raccoon / Loomy 的公开接口只消费一个当前登录，无法像账号池一样枚举历史账号；OFM 对应渠道提供多账号数据。Loomy 的积分缓存没有账号 ID，显示时保留归属未知提示与原 `updatedAt`。Raccoon 没有积分采样时间，不能把请求时刻记作积分成功时间。

## OFM 渠道

| 渠道 | 查询 ID | 读数 | 药丸路由 |
|---|---|---|---|
| 小浣熊 | `ofm-raccoon` | 可用积分、奖励/每日/会员/充值分项 | `raccoon` 独立接口缺席时回落 |
| Loomy | `ofm-loomy` | 可用积分、永久积分与每日赠送 | `loomy` 独立接口缺席时回落 |
| Qoder 国际版 | `ofm-qoder` | 套餐额度、资源包余量与容量 | `qoder` |
| Qoder 中国版 | `ofm-qodercn` | 套餐额度、资源包余量与容量 | `qodercn` |
| LobsterAI | `ofm-lobsterai` | 提供方返回的积分/余额包 | `lobsterai` |
| TRAE | `ofm-trae` | 提供方返回的积分/余额包 | 独立查询 ID；模型 `trae*` 使用独立 Trae 接口 |
| Cline | `ofm-cline` | Credits 与独立订阅窗口 | `cline` |
| MiniMax Code | `ofm-minimax` | 提供方返回的 Token/额度包 | 独立查询 ID；保留原有 MiniMax 订阅匹配 |
| ZCode | `ofm-zcode` | 按模型分桶的 Token 额度 | `zcode` |
| Gemini | `ofm-gemini` | 按模型分组的剩余配额比例 | `gemini` |

OFM 2.7.1 的十渠道不含 WorkBuddy。查询全部 OFM 渠道可传 `providers: ["ofm"]`，也支持 `our free model` / `our free models`。小浣熊别名兼容 `raccoon` / `racoon`，模型路由仍为 `raccoon`。

这些联动没有本插件的凭据槽或普通提供商卡片。工具一账号一条；药丸保留稳定 `accountId`，同名账号也分别展示。切换查看账号不写提供方的固定账号、轮换顺序或登录设置。

## 鉴权数据与生命周期

- OFM 通过进程内 RPC `account.list({provider})` 读取账号索引，再以稳定 ID 合并 `usage.badge({provider,force})`。Host 可经现有凭据服务解析索引中的引用，仅将非空存在性转换为 `authStatus: present | missing | unknown`；引用名、凭据内容及 ZCode 索引中的手机号等字段不进入额度结果。
- `authStatus` 是凭据存在性或提供方记录的登录有效期，不能证明上游接受了本次鉴权。`authExpiresAt` 是提供方记录，可能滞后或由提供方估算。账号枚举或凭据检查失败时记未知，成功额度可独立保留；索引 HTTP 失败、RPC 错误或响应漂移另标部分数据并提示索引读取失败，404 缺席保持旧版兼容。额度采样时效与账号索引覆盖分别表述；已知缺少凭据的缓存读数标为旧数据。
- OFM `usage.badge.preference` 的 `auto | subscription | credits` 是显示口径，不能映射为账号模式。其公开 API 没有当前固定账号状态；实际选号按账号顺序检查启用状态、模型限流与凭据可解析性，不是 round robin。
- Trae / WorkBuddy 的 `pool.enabled === true` 表示自动账号池，真实公开池行使用 `accountId`，`current` 标记可用于提供方当前选择。Trae 池关闭不能直接推断固定模式；WorkBuddy 还需 `selectionExplicit === true` 才确认固定。总览字段与明确选中账号冲突时，舍弃归属不明的完整积分包，保留独立按 ID 查询的余额。
- Trae / WorkBuddy 使用提供方自己的登录解析与续期流程，不通过其 `transfer` 接口导出 access / refresh token。Raccoon 响应中的 `probeKey` 是操作授权秘密，归一化后才缓存，始终丢弃该字段。Loomy 普通轮询及手动额度重读均不携带会刷新模型目录的 `refresh=1`。
- 接口请求限于额度 GET 与 OFM 的 `account.list` / `usage.badge`，不调用签到、账号增删、排序、切号或秘密导出。提供方内部仍可能镜像账号、续期并保存其既有登录态，或更新运行时账号池选择；额度只读不等于这些提供方接口完全没有内部副作用。

## 数据语义与缓存

- 只报告剩余积分的快照显示绝对量。小浣熊和 Loomy 的 OFM 包结构会把当前余额同时写入 `total`，不能据此推算历史已用比例。
- Qoder、ZCode、Gemini 只有明确容量时才生成比例；容量零不造耗尽窗口，极小正余额也不因四舍五入变成耗尽。多模型池分别显示，百分比不相加为余额。
- 展示单位只归一化已知同义词（`credit` / `credits`、`token` / `tokens`），积分包分组与总余额使用同一口径；不同单位仍不合计。没有包明细或单位时保留真实 `total` 数字，不把 0 余额显示成「暂无数据」，也不编造单位。
- EAC 回退与本机直取共用余额归一化：包为空而总额有效时，仍显示已知余额并说明缺少包明细；已知的 `credit(s)` / `token(s)` 同义单位先归一化再汇总，无法从一致的包单位判断时显示无单位原数，不默认成 `credits`。混合单位包不把第一个单位套在总额上；本机 Trae 的 `credits` 与 ZCode 空包的 `token` 由各自来源明确提供。OFM 的 Loomy / Raccoon 等纯余额账号只有 `balance.total` 而未返回 `packages` 时，也展示总额并说明缺少包明细，错误的包字段仍标部分数据；Gemini / ZCode 总量可能跨模型池，缺少分桶时仍不把它当完整额度。
- 多账号药丸选取最紧窗口所在的账号作为代表，只画该账号自己的窗口并标明归属；额度耗尽优先于缓存/部分数据提示。逐账号行与药丸共用状态判定，任一账号的部分失败或旧缓存不会让汇总继续显示全绿。
- 纯余额多账号药丸按用户选择显示总额度，只在相同单位内求和，不同单位分别列出；点开后查看每个账号。单账号直接显示其余额。有失败、旧缓存或缺数字时显示「已读合计」与已读取账号数，不把子集称为完整总额；没有可读账号时不补造总计 0。查看其它账号只改变弹层，药丸保持总览，提供方确认的当前账号仍在列表标注。TRAE 页面与工具均维持直取优先，不拼接不同 ID 域的 Connect 账号。
- 同一来源与渠道的稳定账号 ID 在工具查询中只报告一份；原生入口与 OFM 别名引用相同本机直取结果时优先原生标签，单独点名 OFM 仍保留其 ID。不同来源/区域及没有稳定 ID 的账号不猜测去重。
- Cline 余额和订阅窗口按账号 ID 关联；独立成功数据可保留，失败或漂移的部分标为未知。
- 包到期日是说明；只有明确窗口重置才写 `resetsAt`。积分包由 [credit-packages.js](../lib/credit-packages.js) 隐藏用尽/已过期项，并按今天、3 天内、临时、周期套餐与永久额度聚合；同账号同单位才合计，已有窗口的包只补紧急提醒。WorkBuddy 公开 HTTP 包字段 `cycleRefreshMs` 来自内部 `refreshAtMs` 的投影；只有缺少逐包日期时才保留上游 `expiringSoon` 聚合提醒。批量账号余额没有积分包/重置明细，不套用当前账号数据；余额数值已读时视为完整，缺少积分包另作说明。账号余额缺失或刷新失败仍报部分或旧数据。
- OFM 沿用提供方缓存（2.7.1 成功 120 秒、全部失败 15 秒），独立插件桥接按插件与区域缓存 60 秒、合并在途读取。强制刷新绕过缓存并有响应排序保护；缺席不缓存，后续轮询可恢复；卸载后迟到结果不回填。
- OFM 的 `usage.badge` 只接受渠道，不能真正缩小到单账号请求，且实现先查询全部账号余额再过滤停用账号。本插件可显示索引中的停用账号，但不能承诺提供方没有查询其上游。

## 宿主与实现

OFM 走宿主 Connection 的 `createPeer()` / `createSharedFetchHandler("/api")` 进程内分发，固定调用 `/api/channel-pack`。独立插件通过宿主 `webServer.getOrigin()` 的已注册状态路由访问，并遵循各接口的本机 Host / Origin 校验。各来源缺席与读取失败分别处理。

实现分别在 [OFM 读取](../lib/ofm.js)、[Trae / WorkBuddy 读取](../lib/connect-usage.js)、[独立 Raccoon / Loomy 读取](../lib/desktop-usage.js)，由 [Host](../lib/index.js) 接入 `quota()` / `readLinked()`；积分分组共用 [credit-packages.js](../lib/credit-packages.js)。[Client](../lib/client.js) 只接收白名单额度和账号元数据，不接收秘密。

## DSH Go 药丸

`panel` 网页岛中详情向下展开并进入文档流，由外层滚动；键盘缩小视口后仍能到达底部刷新按钮。样式跟随岛标记生效，桌面端保持向上弹层。

## 验证范围

2026-11-02 核对 OFM 2.7.1、已安装独立 Trae 4.6.12 / WorkBuddy 5.17.0，以及独立 [Loomy 0.2.0 状态源码](https://github.com/gdrpzym/dsh-loomy-connect/blob/main/src/web-status.ts)和 [Raccoon 0.2.4 路由源码](https://github.com/zhlcba/dsh-raccoon-connect/blob/main/src/routes.ts)。独立 Raccoon / Loomy 的实际安装与在线兼容性尚未验证，不能由 OFM 内嵌实现推定。此前 OFM 小浣熊、Loomy、Qoder 国际/中国版曾完成上游真实账号只读核验；本次新增接线与鉴权字段采用隔离测试，并对本机既有登录记录作脱敏存在性核查，未执行真实登录/刷新/切号或上游鉴权验证。

- [OFM 回归](../tests/test-ofm-link.mjs)：账号索引、稳定 ID、凭据检查、元数据失败保留成功额度、字段脱敏。
- [独立读取回归](../tests/test-connect-usage.mjs)：Trae / WorkBuddy 多账号、真实池字段、区域隔离、当前账号矛盾、缓存与生命周期。
- [独立状态回归](../tests/test-desktop-usage.mjs)：当前账号、Loomy 缓存、Raccoon 秘密剔除。
- [Host 接线回归](../tests/test-connect-link.mjs)：工具/药丸共源、缺席恢复、OFM 回落与来源去重。
- [Client 回归](../tests/test-client-ofm.mjs)：账号切换查看、鉴权元数据、账号删除、部分失败与来源匹配。
- [离线浏览器检查](../scripts/check-ofm-mobile.mjs)：虚构数据检查深浅主题、320/360/430px、滚动和桌面定位；不替代运行中 DSH 或 Android 真机验收。
- [实读余额回放](../tests/test-linked-info.mjs) 与 [浏览器检查](../scripts/check-linked-info.mjs)：2026-11-04 工具强制刷新读到 Loomy 两账号 24473 / 20000 积分、TRAE 572.84 / 1320.1 credits、Raccoon 6354 / 6900 积分、Qoder 100 credits、Qoder 中国版 2644 credits；使用脱敏账号名在真实 Client 组件回放，并检查 320 / 1200px 深浅主题。余额在线读取、隔离接线、离线浏览器布局分别成立，未替代安装后的 DSH GUI 验收。

源码完成、安装重载、真实账号在线调用分别记录。
