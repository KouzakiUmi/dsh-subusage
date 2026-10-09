# 开发与验证说明

## 1. 目标与授权边界

目标 API 为 DeepSeek Harness `0.2.0-rc.2`，peer 范围为 `>=0.2.0-rc.1 <0.3.0-0`，允许范围内的预发布版本。范围声明与真实运行验证分别记录。本项目是树外 Host/Client bundle，`cordis.patch.yml` 插入 `subusage`，不修改核心、安装树或 ASAR。

工作区开发、安装启用、依赖安装/构建授权与重启是不同操作。修改并通过测试不代表运行环境已经生效。

### 文件入口

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 提供商适配、凭据解析、持久化、缓存与 Host RPC |
| `lib/volcengine.js` | 火山方舟 AK/SK 签名与 Coding / Agent Plan 窗口解析（纯函数、零依赖，可单独测试） |
| `docs/provider-coverage.md` | 提供商覆盖与**不接入**的决策记录：已支持清单、评估后不做的厂商与理由、用户决策跳过的厂商 |
| `lib/client.js` | Client 模块、共享 store、设置页与模型药丸；内含界面中英文文案 |
| `lib/mimo-login.js` | 隔离 Chrome 登录、Cookie 提取与任务生命周期 |
| `locale/zh.json`、`locale/en.json` | 插件元数据与配置文案 |
| `cordis.patch.yml`、`package.json` | bundle 注册、入口、依赖与打包白名单 |
| `tests/` | 桩网络/隔离文件系统回归 |
| `scripts/` | 清单、打包、离线预览与浏览器检查 |
| `screenshots.json`、`assets/screenshots/` | 市场截图声明与受版本控制的图片 |

当前没有源码转译步骤，直接维护 `lib/*.js`；修改 Host/Client 后按部署方式重新加载相应入口。

## 2. 依赖与生命周期

- Host 使用的核心包声明在 `peerDependencies`。外置链接、profile 包解析与兼容性检查应依据目标部署实现，不用「静默失败」概括所有错误。
- 必需服务声明 Cordis `inject`，可选服务使用 `ctx.get` 判空；它通常只返回 ACTIVE 提供者，不可将轮询当作一般服务生命周期方案。
- Client 入口是 `window.__ModuleLoader__.load({ id, factory })` 惰性 CJS factory，目前仅 require 平台 React。
- `dsh.client.inject` 是信息性包名边，不是 Cordis 服务依赖，也不保证 apply 顺序。
- `slots.inject` 等待实际 slot 声明；注册、事件、计时器和共享缓存应随所属 fiber 卸载清理。
- 不新增未知 settingsScope API、主进程 guest 通道或假定 Client 能创建 BrowserWindow。

## 3. RPC v0.2 契约

Host 与 Client 均声明 `read / refresh / save` 及三个 MiMo 登录方法，测试机械比较 service、namespace、method、wire、codec typeSymbol。

- `startMimoLogin(request)`：必需 `{ expectedRevision: string }`，codec 为 `dsh-subusage#MimoLoginStart`。
- `getMimoLoginStatus()`：无参数。
- `cancelMimoLogin(request)`：必需 `{ jobId: string }`，codec 为 `dsh-subusage#MimoLoginCancel`。
- 登录返回 `dsh-subusage#SubUsageLoginState`，只公开任务状态、固定错误说明与可选公共结果，不包含 Cookie。

- `read(request?)`：request 在 wire 层可选（两端描述符声明 `acceptsUndefined`，网关对缺参放行、service 直调无参同样兜底），缺参/undefined 等价于全量 `refresh({ providerIds: 全部, force: false })`（默认账户）；也可传入与 refresh 相同的查询（Client 初始读取会携带 `commandCodeAccount`）。
- `refresh(request)`：`request = { providerIds: string[], force: boolean, commandCodeAccount?: string }`，只读取指定厂商；`commandCodeAccount` 仅对 commandcode 生效（空串/缺省 = 默认账户，额外账户 id 即其凭据引用名）；返回的 entries 由 Client 合并。
- `save(settings)`：provider patch，包含 `providerId`、`expectedRevision`、来源模式、凭据保持/替换/清除动作与可选 Z.ai 参数。凭据由提供方插件管理的厂商（`managedByPlugin`，现即 commandcode、xai-oauth 与 openai-codex）拒绝一切凭据补丁，只接受裸 patch。
- 检测开关使用独立补丁 `{ expectedRevision, visibility: { providers?, hideWithoutApi? } }`，不得混入凭据字段；provider 开关增量合并，不重置未提交条目。
- 公共 settings 只含 revision、非秘密参数、hasKeys、keyModes 与 xiaomi 的 `hasCookie`、`loginAt`、`expiresAt`。后两项是本地计时元数据（ISO 串或 null），不是秘密，也不参与凭据有效性判断。
- 保存与验证分离。保存失败和保存后在线验证失败必须有不同反馈。
- revision 是配置版本令牌；刷新不得丢弃未保存编辑，过期表单不得覆盖新配置。

两端必须同时更新。Client 支持的新方法不能用于仍运行旧契约的 Host；遇到此情况应提示更新/重启目标 Host，而非无限等待。

## 4. 数据与缓存约定

- 是否耗尽按原始百分比/明确接口状态判断，不能按用于展示的四舍五入值判断。
- 非法/缺失百分比不是 0%；部分数据不能默认绿色可用。
- 重置日期解析成功后统一输出 ISO，不保留原串；`Date.parse` 可接受带括号注释的 RFC 日期，原样回传会携带不可信文本或秘密。
- Z.ai 百分比为 0–100；MiMo `percent` 为 0–1；OpenCode Go 三窗通常包裹于 `usage`。
- Kimi `/coding/v1/usages` 的窗口集合按账户下发：`usages` 比例池可能只有 `limit_5h` + `limit_month_total`（`limit_7d` 仅在部分套餐出现，不能当必需字段），旧账户则只有顶层 `usage` + `limits[]` 绝对计数，同一 Key 连续请求形态稳定。归一化按实际下发的窗口名产出窗口；`limit_month_code` 是月池的 Code 份额而非独立预算，不单独成窗；无任何比例池时，用 `limits[]` 中 `duration=300 / TIME_UNIT_MINUTE` 项的 `limit`/`remaining` 反推 5 小时窗口，再用顶层 `usage` 的 `limit`/`remaining` 反推周额度。未知结构仍报错，不猜测额度。
- Command Code 并行直连 `/alpha/billing/credits` 与 `/alpha/billing/subscriptions`（请求头对齐提供方插件的 accountHeaders：Bearer、accept-encoding: identity、x-command-code-version、x-cli-environment）。absent 窗口是未报告上限（不画额度行）；`cap: 0` 是报告过的无上限，按 0% 不受限展示；`exceeded` 或原始比例达 100% 即限流；已出现的窗口块缺 `used`/`cap` 或非数值一律报错，不当作零用量。月余额 `credits.monthlyCredits` 是剩余金额，使用已知套餐表快照计算 `max(0, total - remaining)`，不是接口直接报告的月cap；未知套餐或缺月余额时 coverage=partial，不猜测百分比。planId优先 subscriptions.data.planId、回退 credits.planId，重置取 subscriptions.data.currentPeriodEnd（ISO或毫秒），非法日期不输出。月池耗尽不参与短窗级联（额外购买/赠送池可能仍可用）；周/5小时保持现有级联。余额只显示真正报告过的月剩余/已购/赠送字段。用量显示跟随药丸弹层选择的账户：默认账户（含自动轮换）走 `COMMANDCODE_API_KEY` 凭据链，额外账户按其凭据引用名（`apiKeyEnv`）从凭据服务 → 启动环境解析（对齐提供方插件 `slots()`/`resolveRef`），缓存指纹计入账户选择，entry 带 `account` 字段；自动轮换不跟随实际服务账户，自定义 apiBase 不跟随。
- SuperGrok 并行直连官方 Grok CLI 计费代理 `/v1/billing?format=credits` 与 `/v1/settings`（请求头对齐官方 CLI：Bearer、`X-XAI-Token-Auth: xai-grok-cli`、`x-userid`、`x-grok-client-version`）。`creditUsagePercent` 是统一用量池的**已用**百分比（0–100，剩余 = 100 − 已用），周期取 `currentPeriod`（周/月枚举名，未知或缺失类型归通用订阅池 `sub`），重置取 `currentPeriod.end`，非法日期不输出；旧形态按 `monthlyLimit`/`used`（美分）折算比例并归月账期窗口，`{}`（proto3 零值）解码为 0，无上限（limit≤0）不折算。套餐名取 `/v1/settings` 的 `subscription_tier_display`（失败回退 billing 响应的 `subscription_tier`），已购加量余额 `prepaidBalance` 美分转美元显示；未报告的字段不冒充 0，无任何比例来源时报错不猜额度。
- 单厂商凭据、网络、解析异常不影响其它厂商条目。- 按厂商共享 TTL 缓存与 in-flight 请求；配置/凭据变化使旧账号缓存失效。
- 窗口对象上的**展示字段**（如 AFP 的 `groupLabel`）在 Host 重新构造窗口时必须一并带上：Host 的 `windowRow` 是白名单工厂，只保留 `kind / percent / resetsAt / status / detail`，解析器另外产出的标注会在这里被静默丢弃——不报错、不抛异常，界面只是少一块信息，单元测试照样全绿。凡「解析器产出 → Host 装配 → wire → Client 渲染」的字段都按这条处理，并在 Host 侧补一条跨装配层的断言（`0.10.4` 的 AFP 分组就是这么丢过一次的）。
- TTL 为 60 秒。Client 仅订阅活跃、开启的提供商，隐藏页面暂停定时读取，回到可见状态再检查；不要把所有厂商做成独立全局轮询。
- 新增厂商须同步 Host 的 PROVIDERS、Client 的 PROVIDER_META / PROVIDER_ORDER、帮助文案、README 和默认值测试。未获明确需求的新订阅商保持 `defaultEnabled: false`；原有偏好通过存储合并保留。
- 允许保留的临时错误返回 stale 标记、上次成功时间与结构化错误；认证失效不保留旧额度。
- 429/临时错误使用退避，倒计时本地更新，重置后有界刷新而不制造请求循环。
- Retry-After / retryAt 优先于强制刷新和重置到期。已知本地配置修改只失效受影响厂商；未知外部 revision 修改保守失效所有条目。
- 火山方舟（**7 条路由**：arkcli 的 `arkcli-agent-plan` / `arkcli-coding-plan` / `arkcli-agent-plan-team` / `arkcli-coding-plan-team`，旧插件的 `ark-coding-plan-cn` / `ark-agent-plan-cn` / `ark-coding-plan-byteplus`）：provider id 必须与写入方（官方 CLI `arkcli helper` 或旧插件 `@volcengine/ark-plan-api`）注册的路由**逐字一致**，否则选中方舟模型时药丸不会出现（路由未安装时 `configured` 为 false，条目仍可配置）。额度走管控面 OpenAPI：`POST https://open.volcengineapi.com/?Action=X&Version=2024-01-01`（BytePlus 走 `ark.ap-southeast-1.byteplusapi.com`），Action 与 Version 放在 query 串并参与签名。签名是火山通用 HMAC-SHA256 V4：CanonicalHeaders 块尾换行后与 SignedHeaders 行之间**有一个空行**；Credential 首段是 **8 位日期**（不是完整 X-Date）；`host` 必须与实际请求域名一致（两个接入域名混用必然 401）；query 用 RFC3986 严格转义（`! ' ( ) *` 必须转义）。凭据是 IAM 的 AK/SK 配对，与这些路由的推理 API Key（`ARK_*_API_KEY`）是两套；7 条共用 `settings.volc`，继承变量为 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`。**企业版/团队版走两步**：`ListSeatInfos`（带 `volcScene`）取 SeatID，再 `GetSeatAFPUsage` 或 `GetSeatInfoUsage`；多个席位只读第一个但如实标注总数。AK 与 SK 必须**同源配对**，`source` 只取 `credentials` / `env` / `manual` / `none` 之一，禁止跨来源拼接（否则 401 且看不出根因）。补丁形如 `volc: { accessKeyId | secretAccessKey: { action, value } }`，两个字段各自 keep/replace/clear：`replace` 不接受空串（SK 不回显，空串不是清空指令），`clear` 写空字符串而**不是 delete**（`publicSettings` 依赖字段存在）。共享凭据变化要让全部 `credentialKind === "volc"` 的条目一起失效，不能只失效当前标签页。
- 火山方舟窗口语义：Coding Plan 的 `Result.QuotaUsage[].Level ∈ {session, weekly, monthly}`、`Percent` 是**已用百分数 0–100**（不套用「≤1 视为小数」规则，否则 0.39% 会被放大成 39%）、`ResetTimestamp` 是**秒**；Agent Plan 的 `AFPFiveHour/AFPDaily/AFPWeekly/AFPMonthly` 里 `Quota`/`Used` 是字符串绝对值、`ResetTime` 是**毫秒**、`Quota=0` 表示该窗口不适用（不产出行、不当 0%）；接口不返回 Coding Plan 的绝对量，`Cap` 字段未在任何来源证实存在，因此不产出 detail。**AFP 的四个窗口属于两条额度线**：5 小时 / 周 / 月走文本 / 向量模型，`AFPDaily` **只覆盖视觉 / 语音模型与 Harness**（官方「套餐概览 → 额度刷新规则」），所以日配额高于周配额是正常口径而不是算错；解析器给每条窗口产出 `groupLabel`，界面按它插分组标题并把日限额排在最后，前端拿不到该字段时**不会**退化成任何提示（见第 4 节关于 Host 装配丢字段的约定）。**HTTP 200 且窗口为空是「未订阅」而不是 0% 用量**，界面显式说明。错误按业务信封 `ResponseMetadata.Error.Code` 分三类：401 类（`SignatureDoesNotMatch` / `InvalidAccessKey` 等）提示需要 AK/SK 而非推理 Key，403 类（`AccessDenied` / `OperationDenied` / 欠费）提示权限与订阅，`InvalidActionOrVersion` 提示接口可能已变更。
- MiMo 会话 Cookie 自签发起 24 小时有效。Host 在凭据写入的同一刻记录 `xiaomi.loginAt` / `xiaomi.expiresAt`（毫秒，清除凭据时归零），并把 `cookieExpiresAt` 挂到该厂商的每条 entry 上；自动登录经 `MimoLogin` 回调传入浏览器观测到的 Cookie 过期时刻，取 `min(24h 上限, 观测值)`——该回调必须透传第 4 个实参，少声明形参会静默退化成 24 小时上限。计时只在真正写入凭据（`cookieUpdate` 为 `replace`）时重置，`keep` 不得续满倒计时。解析存储只接受安全整数正数，损坏字段按未记录处理。Client 侧到期档位由 `cookieExpiry()` 单点判定：>2h 正常、≤2h 提醒、≤30min 紧急、已过期。**倒计时只用于展示**：归零不改凭据可用性，真实失效仍由官方接口返回决定；接口已判定凭据失效（`state: "error"`）时倒计时不得抢占主文案，但「已过期」本身仍优先，因为它就是重新登录的行动项。Client 合并/失效条目时保留 `cookieExpiresAt`，否则保存或登录后倒计时会短暂消失；但凭据被 `clear` / `replace` 时必须丢弃旧值，否则已删除的 Cookie 仍显示过期倒计时。

## 5. 凭据与 MiMo

当前仍兼容旧本机 JSON 存储，并非加密凭据库；不输出真实 Key/Cookie到日志、测试、截图或读取结果。新建目录 mode 为 0700、临时文件为 0600，重命名前再收紧临时文件权限；不 chmod 已有共享配置目录。Windows chmod 不等同于 ACL 管理，部署者仍需保证目录 ACL 仅授权合适用户。

Command Code 不提供本地凭据编辑：沿用提供方插件（@mars-sea/dsh-commandcode-provider）的凭据来源链——凭据服务 `COMMANDCODE_API_KEY` → 启动环境 → `~/.commandcode/auth.json` 兜底（解析对齐其 resolveAuthFileApiKey：`apiKey` / `commandcode` 字符串、`commandcode`/`command-code` 凭据记录的 key/access）。

SuperGrok（`xai-oauth`）同样不提供本地凭据编辑，但只认 dsh-grok-kit / Grok CLI 共享的 OAuth 登录文件：优先 `~/.grok/auth.json`（槽位 map，槽位名含 `auth.x.ai` 优先、旧签发方 `accounts.x.ai` 次之、最后任意槽位；取 `key`/`access` 与 `user_id`，缺 `user_id` 时回退 JWT `sub`），回退 dsh-grok-kit 旧版 `~/.dsh/.xai-oauth-auth.json` 信封（`credential.access` / `credential.accountId`）。**只读不写、不自行刷新 token**：access token 短命轮换且 refresh-token 轮换由两端（Grok CLI / dsh-grok-kit）各自的锁协议管理，第三端刷新会互相顶掉轮换导致登录失效；因此也不走凭据服务/启动环境链（环境副本必然过期顶掉新 token）。API Key（`XAI_API_KEY`）路线取不到订阅周池，不支持。

Client 不填回已保存秘密。Cookie 解析支持多行 KV、成对文本、JSON 与 TAB Name/Value；JSON 域规则按目标站点匹配。Netscape 格式先识别七列数据再跳过普通注释，`#HttpOnly_` 只作为域前缀处理；普通 TAB 中合法的 `#` 开头 Cookie 名不能误删。TAB 解析使用原始分行，不能用整串/整行 trim 丢失末列空值。输入错误必须保留原文，Host 再做 header 安全及必需条目验证。

MiMo 接口字段是不可信输入：余额只接受有限十进制字符串，货币代码限三位大写字母；额度明细只输出有限非负数，不把对象及其键传入 RPC。未约束的套餐名在普通刷新与自动登录验证缓存/返回前进行字段级 Cookie 脱敏；不递归替换自建枚举、日期和数值余额，避免短 userId/可选 Cookie 破坏可信结构。提取 Cookie 值时先 trim 再计算等号位置，并移除外层引号，防止分号后空格使秘密被截断。回归覆盖普通刷新、缓存回放、登录提交、带引号单值回显及非法对象明细。

原 webview 取数桥已移除；普通官网链接仍不自动同步外部浏览器 Cookie。自动登录由 Host 的隔离 Chrome 会话实现，延迟加载 `playwright-core`，不使用 persistent context，不读取日常浏览器配置，不下载浏览器。

登录任务单实例、五分钟期限，start 立即返回，Client 每两秒串行查询活跃任务，卸载只停止 UI 轮询；Host 处理取消、关闭窗口、迟到启动、超时和 dispose。只提取官方 API 域/路径匹配的两个必需 Cookie，验证成功后同步检查 MiMo 材料冲突并保存。其他厂商修改可合并；认证/网络失败不提前持久化。有效登录但只有余额时保留 partial/额度未知语义。

成功登录状态不是永久可复用快照：MiMo 材料改变时返回 idle，其他厂商改变时刷新公开 revision；Client 同时使用请求 epoch 防止保存之后收到旧 success 再合并。浏览器异常使用固定安全说明，不回显原始 URL、Cookie 或令牌。真实官方登录仍需用户验收。

## 6. 测试与生效

0.7.0 新增 `zai-coding` / `synthetic` / `nanogpt`，两端默认关闭；旧配置升级不自动启用。NanoGPT 接口的比例为 0–1、重置为毫秒，日/周仅统计输入 Token；`sk-nano-mgmt-` 前缀选择管理用量接口，其他 Key 使用推理凭据的用量接口。相关来源、修复与测试结果见 [审查记录](code-review.md)。

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
node --check lib/mimo-login.js
```

测试用虚构凭据、桩网络和隔离文件系统。新增 service 测试不能访问 `~/.dsh` 的真实配置。

自动测试覆盖模块/slot装配、RPC 描述符、额度边界、凭据 patch、异常隔离、缓存、Cookie、React 状态路径。桩 React/ctx 不证明真实 Loader realm/fiber 或浏览器行为。

### 离线浏览器与截图

`render-ui-preview.mjs` 执行当前 Client 组件，使用虚构用量、Hook 桩和固定测试时间；不执行 effect，不连接 DSH，也不读取真实凭据。它生成 HTML，不直接生成 PNG。参数依次为内容区宽度、provider ID、主题与模式（`credentials` 或 `pill`）。

在仓库根目录运行。以下 PowerShell 示例生成浏览器验收需要的八个设置页面：

```powershell
foreach ($theme in @('dark', 'light')) {
  foreach ($width in @(530, 500, 499, 360)) {
    node scripts/render-ui-preview.mjs $width xiaomi-token-plan-cn $theme credentials
  }
}
node scripts/check-browser-runtime.mjs
```

浏览器检查需要工作区可解析 `playwright-core` 且已安装 Google Chrome；不会下载浏览器。它检查 Cookie 域/路径隔离、31 个开关（30 家 provider + 1 个「没有检测到 API 的默认隐藏」）、预览桩下 12 个可见标签与 18 家关闭、无下拉列表和横向溢出，并将 PNG 写到 `debug/ui-preview/`。

单独生成浅色药丸弹层 HTML：

```console
node scripts/render-ui-preview.mjs 530 nanogpt light pill
```

`pill` 模式也支持 `arkcli-agent-plan`，用 Agent Plan 的真实形态（两条额度线 × 四个 AFP 窗口）出图，可用来目视确认分组标题与明细拆行：

```console
node scripts/render-ui-preview.mjs 530 arkcli-agent-plan dark pill
```

可用以下独立 Chrome 命令将该 HTML 截成 PNG（先生成 HTML；所有 HTTP 请求会被阻止）：

```console
node --input-type=module -e "import {chromium} from 'playwright-core'; import {resolve} from 'node:path'; import {pathToFileURL} from 'node:url'; const b=await chromium.launch({channel:'chrome',headless:true}); try { const p=await b.newPage({viewport:{width:554,height:560},colorScheme:'light'}); await p.route(/^https?:/,r=>r.abort()); await p.goto(pathToFileURL(resolve('debug/ui-preview/settings-530-nanogpt-light-pill.html')).href); await p.screenshot({path:'debug/ui-preview/settings-530-nanogpt-light-pill.png',fullPage:true}); } finally { await b.close(); }"
```

预览页面包括布局示意，不完全复刻 DSH 外壳。市场所用设置截图来自 `settings-530-xiaomi-token-plan-cn-dark-credentials.png`，弹层来自 `settings-530-nanogpt-light-pill.png`。人工检查后将 PNG 复制到 `assets/screenshots/` 的相应文件，保留离线标记并同步 [截图声明](../screenshots.json) 与 README。市场只需 GitHub 仓库图片，当前 npm 白名单不包含这些 PNG。

### 0.10.8 运行时验证记录：web profile 的安装—启动—回滚闭环

**环境**：Desktop 内置 Core `0.2.1-alpha.1`（与 `dsh.compatibility.dshReleases` 里标 `compatible` 的版本一致），真实 `$DSH_HOME` 下的 `web` profile，固定 Commit `c47521df4dab8559b4d6d04f502a9477a5a5f5da`（= `v0.10.8`）。**未触碰 `desktop` profile**（验证后复核其依赖清单不变）。

| 操作 | 结果 | 要点 |
|---|---|---|
| install | pass | `dsh plugin --profile web add 'git+…dsh-subusage.git#c47521df…'`；pnpm 2.9s，`package.json` 锁到该 Commit；profile 由 CLI 自动初始化 |
| dump-config | pass | 组合树含 `- id: subusage` / `name: dsh-subusage`；无加载错误 |
| start | pass | `dsh --profile web --no-open --port 3081` 起服务并打印带 token 的 URL |
| api-smoke | pass | 无 token 根路径 **HTTP 401**；带 token **HTTP 200**（35,975 B HTML，`<title>DeepSeek Harness</title>`） |
| ui-readback | pass | 真实浏览器（本机 Chrome，headless）里 **设置 → 订阅用量** 面板完整渲染；火山方舟卡片显示「该组共 **4** 条路由定义」，与 0.10.8 移除 legacy 后的数量一致 |
| uninstall | pass | 依赖移除；`bundles` 回到 `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app]` |
| rollback | pass | 卸载后 `dump-config` 中再无 `subusage`；端口释放；隔离 `DSH_HOME` 已删除 |

**两条与插件无关的环境限制**（记录下来，避免下次误判）：

- **npm 全局 CLI（`0.1.2-rc.1`）跑 web profile 会失败**：本机 `~/.dsh/cordis.patch.yml` 里 `arkcli helper` 写的 MCP 条目带 `arkcli_managed` 字段，而 `0.1.2-rc.1` 的 `@deepseek-ai/dsh-mcp-client` schema **严格拒绝**该字段（`dsh: plugin tree failed to load … 1 entry did not activate`）。Desktop Core `0.2.1-alpha.1` 的该 schema 允许它，所以 Desktop 一直正常。验证因此改用 Desktop 自带的 Core。
- **隔离 `DSH_HOME` 下启动会停在** `user patch-layer watching requires the Cordis HMR service`：profile 初始化时写入的 `patchReload: live` 需要 HMR 服务，而隔离 home 里没有。同样与本插件无关，所以最终用真实 `DSH_HOME` + 专用 `web` profile 做隔离。

**未做**：没有在 `0.2.0-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2` 上重复这六步，`dsh.compatibility.dshReleases` 对这三个保持 `unknown`；真实 Desktop profile 的插件更新与界面回读仍由用户自行验收。

### 0.10.0 → 0.10.1 验证记录：火山方舟全面覆盖、额度查询 API、RPC 版本窗口期与设置页排序

- **默认可见性按「本机实际装了什么路由」判定（`providerRoutable`）**：provider id 就是路由 id，而路由由提供方插件/CLI 按账号**实际持有的东西**写入——`arkcli helper` 只为真正订阅的套餐写路由。因此只用常量 `defaultEnabled` 会出现「只买了 Agent Plan，却默认把 Coding Plan 也点亮」的假象。现在的判定链是：显式设置 > `defaultEnabled` > `configured[id] !== false`。三点必须守住：①**逐个判定，两种套餐可以共存**（本机两条路由都在就两条都显示，不做二选一）；②`configured` 缺失时按「未知」放行——`detectConfigured` 拿不到路由表时返回 `undefined` 而**不是** `false`，否则会谎报「全都没装」把每条标签都清空；③用户关掉「没有检测到 API 的默认隐藏」时不再按路由收起（那是「我要看全部」的明确表达）。
- 设置页的提供商管理列表把**已启用的排到最前面**（`sort` 稳定，组内保持 `PROVIDER_ORDER` 顺序），避免每次往下翻找自己开了哪几家。
- **输入净化约定（六个输入框统一）**：设置页的凭据类输入框（AK、SK、普通 Key、MiMo Cookie、LiteLLM 代理地址、Z.ai 组织/项目）都会收到**从网页或控制台复制来的值**，这类值常带尾随换行、制表或零宽字符，而它们本身都不含空白。所以正确做法是 `stripInvisible`（剔除 `\s` 与 `\u200b-\u200d\ufeff`）后保存，**不是**用 `/[\x00-\x1f\x7f]/` 去拒绝——拒绝会让用户看到「填了没用」，根因却藏在一条没读懂的报错里。只有**全空白**才拒绝（否则会把「清空」误当成「替换成空值」）；Host 侧的同名校验保留作最后防线，但正常路径不应触发它。MiMo Cookie 另有 `normalizeCookieText` 做更严格的规范化与必需字段校验。`tests/test-input-sanitize.mjs` 钉住这六条。
- **凭据指引是用户文档的一部分**：[`docs/credentials.md`](credentials.md) 承载「去哪拿、放哪个环境变量、在界面哪里填」以及报错对照；README 的 Quick start / Configuration / Troubleshooting 都链到它，设置页里需要用户先去别处操作的凭据区（火山 AK/SK、MiMo、普通 Key、LiteLLM、Z.ai 团队档）也各带一个链接。**改凭据流程或新增提供商时要同步它**——用户在这类问题上最容易卡住，而界面本身说不清「去哪儿拿」。文中引用的火山权限策略名与处置顺序以官方文档为准，改动前先核对。
- **Ark 是分组，不是合并 provider**：火山方舟的 7 条路由共用同一组 IAM AK/SK，而一般用户只持有一个套餐，所以设置页把它们**合并成一张卡片 + 一个组开关**（`visibility.ark`），卡片里说明本机实际装了哪几条。四条要点：①**provider id 绝不合并**——药丸靠 id 精确匹配路由，合并了就不显示；②组开关存两条路径：`persist` 写组标志的同时**写入组内每一条**，新旧字段始终一致，回退版本也不会读到矛盾状态；③旧配置里逐条保存的开关由 `parseStored` 按「任一条开着」迁移，不留痕迹；④`affected` 必须带上整组，否则改开关后各条目的缓存不失效。客户端渲染时只保留「本机装了的那条」作代表（都没装就用第一条）。
- 药丸的窗口短标签存 locale key（`KIND_SHORT`），中文给「周 / 月 / 日 / 5时」、英文给 `1w` / `1m` / `1d`——不要用 `W` / `M` / `D` 让用户猜。

- **wire 契约的兼容性约定（这条踩过一次真实故障）**：Client bundle 刷新页面即生效，而 Host 要**重启 DSH** 才换代码，因此「客户端已更新、Host 还没重启」是一个**必然出现**的窗口期。凡是**随版本演进的枚举**（首当其冲是 provider id）都不能在 RPC 的 `parse` 层做整体拒绝——否则新版 Client 带着新 id 过来时，用户只会看到网关的 `typert gateway: ... wire field "request" failed boundary validation`，既不知道原因也不知道该做什么。现在的做法是：`refresh` **过滤**未知 id 并单独列出，由 `refresh` 回一条 `subusage/unknown-provider` 的可读条目，其它提供商照常刷新；`save` 的未知 provider 放宽到 `persist` 里拒绝（同样给可读原因）；只有**形状**错误（非数组、缺 `force`、空 `providerId`）才在 `parse` 层拒绝。新增 provider 时不需要同步改动校验逻辑。

- 火山方舟企业版/团队版席位（arkcli 路线的 `arkcli-agent-plan-team` / `arkcli-coding-plan-team`）：`tests/test-volcengine.mjs` 增加席位解析与 Host 流程两段——SeatID 列表（trim、忽略无 ID 行、非数组或缺失返回空）、AFP 四窗口与 `Quota=0` 跳过、`ResetTime` 毫秒、Coding 三字段与缺字段跳过、超 100 收敛到 100；Host 端断言**两步调用**（`ListSeatInfos` → `GetSeatAFPUsage`）、档位与席位标注、无席位时的说明、不回显 SK。**未做**真实企业版账号的在线验证（本机没有团队版席位）。
- 席位接口已按**官方 API 契约**核实（`https://api.volcengine.com/api/common/explorer/api-swagger?ServiceCode=ark&Version=2024-01-01&APIVersion=2024-01-01&ActionName=<Action>` 无需凭据即返回完整 JSON-Schema）：`Filter` 是契约层面的**必填**字段（空对象 `{}` 合法）、`Scene` 枚举为 `coding_plan_enterprise`（默认）/`agent_plan_enterprise`、`PageSize` 上限 100（默认 20）、SeatID 路径为 `Result.Data[].SeatID`、四个 AFP 窗口名与 `SeatAFPUsages[]` 路径均与实现一致。**据此修正了两处**：`GetSeatInfoUsage` 带 `Scene`（Coding Plan 企业版传空串，传错会静默返空 SeatID）、其响应按站点双路径容错（国际站 `Result.SeatInfoUsage.*`、中国站 `Result.*` 直挂）。
- 仍未证实（需真实企业版账号）：①`GetSeatInfoUsage.ShortTermUsage` 的语义——中国站契约写「席位 5 小时用量百分比」、国际站写 "Seat 5-hour usage percentage"，而中国站 `list-seat-info-usages-api` 正文写「近 5 分钟用量」；2 条来源倾向 5 小时（同族 `ShortTermResetMilestone` 也写"5 小时 session 配额刷新"），实现按 5 小时窗口处理，但**不要基于该字段做业务判断**；②**`ListSeatInfos` 只取第一页**（`PageSize: 100`，不发翻页游标）——超过 100 个席位时会漏席位、"共 N 个席位"的标注也会失真；契约给 `PageNum/PageSize`，官方 CLI 源码却说用 `NextToken` 游标，两者可能并存，当前实现按契约发单页；③无权访问席位时预期 `AccessDenied`（需 admin/root 身份），"HTTP 200 空数组"只有 CLI 层旁证；④`Filter: {}` 在 wire 层能否真实通过。

- `node tests/run-all.mjs` 全部通过（新增 `tests/test-volcengine.mjs` 与 `tests/test-siliconflow.mjs`），`node scripts/check-manifest.mjs` 与四个 `node --check` 通过。
- 签名：把官方 demo `volc-openapi-demos/signature/nodejs/sign.js` 的函数**逐字复制**进来与 `lib/volcengine.js` 对同一输入对拍，确认本实现与官方文档 cURL 示例所用的签名集合（`content-type;host;x-content-sha256;x-date`）逐字节一致。注意官方 demo 的默认路径会按 `needSignHeaderKeys=[]` 过滤成 `host;x-date`，**不能照抄它的 header 黑名单**。
- **没有权威固定向量可用**：官方 demo 的 AK/SK 是占位符，官方文档示例里的凭据被打码，因此 `test-volcengine.mjs` 里的签名期望值是本仓库自算并钉住的回归基线（已在测试文件头部注明来源与核对方式），不是官方公布的向量。一次调研中由子代理"自行计算"的向量（`39fee0d0…`）经复算与其自身给出的 CanonicalRequest 自相矛盾，已弃用，不作为基线。
- 回归覆盖：签名中间串与 Authorization 模板（8 位日期、SignedHeaders 顺序、64 位 hex）、host/SK/Action 参与签名、RFC3986 转义、Coding Plan 三窗口与百分比不放大、`ResetTimestamp` 秒级、Agent Plan 四窗口与字符串绝对值、`Quota=0` 不产出行、未订阅（200 + 空窗口）不画 0%、401/403/404 三类错误映射、AK/SK 独立 keep/replace/clear、半份凭据按未配置、共享凭据变化使全部 Ark 条目失效且 TTL 内仍命中缓存、Client 侧注册与补丁语义。
- 过程中由测试抓到的两个真实缺陷：①`commitMimoLogin` 的缓存指纹在 `provider()` 增加 secret 段后未同步，导致 MiMo 登录后首次刷新重复拉取（与 0.8.0 记录过的同类缺陷同源）；②清除火山凭据时用 `delete` 删掉 `stored.volc` 字段，使随后的 `publicSettings` 抛 `TypeError`——现改为置空字符串。
- **未做**：真实 AK/SK 的在线调用验证（本机没有可用的火山 IAM 凭据，测试全部使用虚构凭据与桩网络）；`ark-coding-plan-byteplus` 的 BytePlus 管控面域名与 `ap-southeast-1` 区域未实测（按官方地域域名表实现，该 provider 默认关闭）；`GetCodingPlanUsage` 无官方文档，接口变更风险无法通过文档消除；真实 DSH 中与 `@volcengine/ark-plan-api` 一同加载后的药丸显示未验收。
- SiliconFlow：`tests/test-siliconflow.mjs` 覆盖余额归一化（`totalBalance` 优先、`balance` 兜底、0 余额合法、两位小数、非法值报错）、Host 端到端（默认关闭不请求、开启后 Bearer 直连 `/v1/user/info`、不产出窗口、密钥不回显）与 Client 注册。**这是首个纯余额型 provider**：余额没有上限也就没有百分比，因此不产出窗口，靠新增的余额兜底文案显示——无窗口有余额时药丸显示「余额 X CNY」，无窗口无余额（或只有套餐名）时仍回落到「暂无额度数据」；`tests/test-client-render.mjs` 的对应断言已按新语义更新并补了反向用例（此前那条断言要求空额度一律显示占位）。同样**未做**真实 Key 的在线验证。
- LiteLLM：`tests/test-litellm.mjs` 覆盖地址规范化（去尾斜杠与 `/v1`、保留自建子路径、`file://`/`ftp://`/非法输入一律按未配置）、归一化两条分支（有预算 → 窗口 + `budget_reset_at`；无上限或 `max_budget: 0` → 只给 `spend` 金额，不编造百分比）、user/team 视图优先与 scoped 403 降级、缺代理地址归到 `subusage/credentials` 并给出指引、端点落在 proxy 根、Client 的地址回填与补丁提交。**这是第一个引入「用户可配置端点」的 provider**：`settings.litellm.baseUrl` 是非秘密字段（原样回显），合法性在请求前用 `URL` 解析把关。**未做**真实自建网关的在线验证（本机没有 LiteLLM proxy）。
- ZenMux 与 NanoGPT 余额：`tests/test-aggregators.mjs` 覆盖 ZenMux 的 0–1 小数换算、flows 明细、ISO `resets_at`、仅余额时 `partial`、两端点全空才报错，以及 Host 端「两端点各一次 + Management Key + 余额 403 降级后仍 `ok`」；NanoGPT 覆盖余额作为增量条目、缺失/非法不影响配额、零余额照实显示。`tests/test-new-providers.mjs` 的请求次数从 3 改到 4 并断言余额端点用 `POST` + `x-api-key`（不是 Bearer）。**注意**：`windowRow` 统一把百分比收敛到**一位小数**，所以 0.3938 → 39.4；这会让极小百分比（如 0.05%）显示成 0，是既有设计而非本次引入，若要改需连同所有 provider 一起评估。**未做**真实 Management Key 的在线验证。
- UX 三改：`tests/test-commandcode-accounts.mjs` 钉住账户区折叠（details + summary 显示当前账户与数量 + 列表限高 240 滚动 + 降级同样折叠）；`tests/test-client-render.mjs` 钉住待处理排序（出错项排第一、其余保持登记顺序、全正常时顺序不变）与顶部计数按钮（可点/禁用/无障碍名提到目标 provider）。排序权重里**「未配置凭据」刻意不计入**，否则关闭默认隐藏后每个未配置的厂商都会排到前面。测试注意：`PROVIDER_ORDER` 来自 vm realm，跨 realm 数组不能直接 `deepStrictEqual`，涉及它的比较统一用 JSON。
- 额度查询 API：`tests/test-quota-api.mjs` 覆盖 `quota()` 视图形状、**宽松命名匹配与空结果兜底**、**「不泄露内部状态」**（视图里搜不到 `settings` / `keySource` / `apiDetected` / `envName` 与 Key 本身）、单家失败只影响自己的条目，以及工具契约（`defineTool` 的 object 根 schema、`windows`/`extras` 的**元素级** schema、`providers`/`refresh` 映射、`render` 文案含未配置/已关闭/限流+重置/缓存/失败原因与空结果兜底）。`tests/smoke-host.mjs` 增加「`subusage_quota` 已注册且参数为 providers/refresh」断言。DSH 侧 API 已核实：`defineTool` 由 `@deepseek-ai/dsh-tools` 导出（`textRender` **未**导出，`render` 自己返回 `[{type:"text",text}]`）；`defineTool` 的 `execute(args, exec)`、`output.schema` 用 DSH 的「属性内 `required: true`」写法；`items` 支持嵌套 object，但**元素本身**不能写 `required`（只有对象内部的属性可以）。**未做**：真实 host 上工具被模型调用的端到端验证（需要重启 DSH）。
- **Ark 组开关是唯一真源**（0.10.6 定稿）：7 条路由共用一个开关，因此**逐条开关不再有独立语义**——`parseStored` 读回时把逐条值归一化到 `visibility.ark`，`defaultSettings()` 的逐条默认值也直接跟随它，Host 与 Client 都用同一个 `providerEnabled()` 判定（Host 侧同名函数在 `lib/index.js`）。任何一处漏掉就会出现「界面按组开关显示、Host 按逐条值回 `disabled`」的分叉——用户看到的正是一张写着「订阅检测已关闭」的空卡片。**改可见性判定时两端必须一起改**。
- **Ark 不按路由收起**：`providerRoutable` 只适用于**按路由取数**的提供商。火山方舟的额度走账号级管控面，一组 AK/SK 覆盖名下所有套餐（`GetCodingPlanUsage` 与 `GetAFPUsage` 同为控制面 `ark_action`，2026-10-10 用本机 AK/SK 实测两条都 HTTP 200），推理路由装没装与额度无关，所以 `providerVisible` 对 `PROVIDER_META[id].volc` 跳过路由判据，只按「有没有可用 AK/SK」（`apiDetected`）决定。
- **同一个 plan 只对应一个面板**（0.10.7 定稿）：旧插件 `@volcengine/ark-plan-api` 的两个国内路由（`ark-coding-plan-cn` / `ark-agent-plan-cn`）已从 `PROVIDERS` **移除**——实测它们与 arkcli 路由的请求 URL 逐字相同（同 Action、同 host、同 AK/SK、同一份订阅），并列显示只会让人以为买了两个套餐，数字还会因为各自缓存而差出几十秒。装了旧插件的用户靠 Client 的 `ROUTE_PROVIDER_ALIAS` 在**入口**归并到 arkcli 路由，药丸不丢。BytePlus 是唯一「同 Action 不同 host」，作为独立站点保留。
- **「没有这个套餐」不是故障**：`NotFound.BillingType` / `OperationDenied.NotSubscribed` 一律回报 `subscribed: false`（Host 的 entry 与 `quota()` 视图都带这个结构化字段），前端据此收起。**两个套餐都检测、谁有数据显示谁**，不要去做「判断用户是哪个套餐」的逻辑；这条同时是 0.10.6 那个「Coding Plan 查不到」的结构性修复。
- **共享登录文件的凭据要把 `expires_at` 读出来**：`~/.grok/auth.json` 带这个字段，不读的话过期后只能拿到上游 401，界面显示「登录或凭据已失效」，而用户那边的 Grok Kit 写着「已登录」——两边对不上。现在过期就**不发请求**、直接说明过期时间与「去刷一次」的下一步，并说明为什么不代刷（refresh-token 轮换有各自的锁协议，第三端刷新会顶掉别人的轮换）。Codex 的登录文件同理值得核对。
- **额度查询的两条硬约定**（0.10.5 定稿，改动前先读）：①**名字匹配必须宽松**——调用方（尤其模型）手里的是 DSH 的路由名而不是本插件的 provider id，精确匹配会让 `["zai"]` 变成空结果；匹配统一走 `PROVIDER_LOOKUP`（`normalizeProviderKey` 去掉大小写与 `-` `.` `_` 空格），命中多条时**全部返回**，不猜也不吞。②**任何路径都不返回空**——认不出的名字原样回报并附上全量数据，`render` 文本在无数据时也给下一步。视图里**不输出 `undefined` 值的键**：DSH 会用 `output.schema` 校验返回值，`{lastSuccessAt: undefined}` 会被判成「不是 string」而让工具直接失败（`ToolOutputError`），这也是 `quota()` 改成条件展开的原因。
- **`output.schema` 不发给模型**（`dsh-tools` 的投影只保留 `name` / `description` / `parameters`；`output` / `execute` / `finalizeContent` / `timeoutMs` / 呈现回调「绝不会泄漏到协议上」）。因此：**「怎么用」只能写在 `description` 与参数说明里**，而 `output.schema` 的职责是**校验返回值**（`createSuccessResult` → `ToolOutputError`）与 UI 展示。两者不可互相替代。改动 `output.schema` 后必须用真实校验器验证一遍，方法见 `debug/verify-tool-schema.mjs`（debug/ 不入库）：从 `@deepseek-ai/dsh-tools/lib/index.js` 导入 `defineTool` / `validateJsonSchemaValue`，用真实 `quota()` 输出跑校验——0.10.5 就是这样抓到 `errorCode` 越界与 `undefined` 字段这两个会直接炸的问题的。
- 用量面板内联行动条（UX）：`tests/test-usage-action.mjs` 钉住判定（缺凭据/凭据被拒/已过期 → 重新登录/2 小时与 30 分钟档/正常倒计时不打扰/计时不可解析不编造），`tests/test-client-render.mjs` 钉住渲染（MiMo 失效时面板出现行动条与按钮，正常状态没有）。行动条只负责「把入口送到眼前」，凭据编辑复用同一份编辑器，避免两套字段与校验漂移（沿用本仓库既有的「两入口共用同一渲染」约定）。
- 余额型聚合商六家：`tests/test-aggregators.mjs` 逐个钉住单位换算（Novita 1/10000、Hyperbolic 美分、DeepInfra 取负、Chutes 绝对量、Ollama 0–1 小数、Vercel 十进制字符串）与边界（`{quota:0}` 不猜比例、Ollama 缺层跳过、DeepInfra 欠款分支），并在 Host 端逐一断言端点与鉴权头（**Ollama Cloud 是裸 `Authorization`**）。**未做**任何真实 Key 的在线验证。
- MiniMax 国际版改为默认关闭（用户要求：实际使用少）。`tests/test-minimax.mjs` 补上默认值断言并在用例前显式开启两家，`tests/test-client-behavior.mjs` 的可见 tab 列表改用 MiniMax CN。（当时的 15/9 计数已被后续批次改写，**当前值以 `lib/index.js` 的 `PROVIDERS` 为准**——现为默认关闭 20 条、默认开启 10 条；设置页合并 Ark 后是 25 张卡片。）
- OpenRouter：`tests/test-openrouter.mjs` 覆盖限额窗口与 `limit_reset` 映射、免费档日窗口、**余额端点 403 的静默降级**（只少余额，条目仍 `ok`）、`limit_remaining` 越界不产生负用量、无可用信息才报错、Host 端到端两请求与 Client 注册。**未做**真实 Key 的在线验证（无凭据）。
- DeepSeek 官方余额：`tests/test-deepseek.mjs` 覆盖归一化（不产窗口、字符串金额、多币种取第一条可解析项、货币码不合规时只显示金额、`is_available=false` 提示充值、非法值报错）、Host 端到端（默认开启、Bearer 与推理同 Key、密钥不回显）与 Client 注册。**未做**真实 Key 的在线验证。
- 顺序约定：新 provider 一律**追加在 `PROVIDER_ORDER` 末尾**。本轮把 Codex 插在中间时，测试里三处按位置写的 `ids[N]` 断言全部错位（改用 id 字面量断言后恢复）；追加在末尾则不影响既有索引。
- **真机验证（2026-10-09，Codex）**：用本机 `~/.codex/auth.json` 的真实 ChatGPT 登录向 `GET https://chatgpt.com/backend-api/wham/usage` 发一次只读请求，**HTTP 200**，实测 `primary_window.window_seconds=18000`、`secondary_window.window_seconds=604800`、`plan_type="plus"`、`credits={has_credits:false,balance:"0"}`。由此发现并修正两处只有真机才暴露的问题：**① `resets_at` 是 Unix 秒数而实现只接受字符串，导致重置时间被静默丢弃**（桩测试喂的是 ISO 串，所以一直是绿的）；② `plan_type` 未显示。教训：**桩测试里的字段类型必须来自真实响应**，否则"解析正确"只是自洽。验证脚本在 `debug/verify-codex-live.mjs`（debug/ 不入库）。
- Codex 订阅用量：`tests/test-codex.mjs` 覆盖登录文件解析（`auth_mode` 门禁、`account_id` 可选、缺失/损坏不抛错、`CODEX_HOME` 覆盖路径）、窗口归一化（主/次窗口回退命名、`window_seconds` 判 30 天档、100% 判限流、单窗口 partial、`credits` 四类不显示、`plan_type` 档位、秒级与 ISO 两种重置时间、哨兵 0、非法百分比报错）、Host 端到端（默认开启即读取、Bearer 是 OAuth token 而非 API Key、响应不回显 token、拒绝本地凭据补丁、无登录文件时 no-key 文案点名 `codex login` 与 API Key 模式限制）与 Client 注册。**这是首个"凭据完全由外部 CLI 登录文件提供且默认开启"的 provider**；`tests/test-client-render.mjs` 里原先把 `openai-codex` 当"不支持的路由"的断言改用 `vrtx-gemini`，保留了那条覆盖。
- 离线预览与浏览器像素验收（**2026-10-09 补做，此前因沙箱受限未做**）：`scripts/check-browser-runtime.mjs` 现可实际运行——本机 Chrome 154 启动正常，深浅主题 × 530/500/499/360px **八组全部通过**（无横向溢出、无下拉列表、开关与标签计数正确）。此前记录的 `chromium.launch: spawn EPERM` 不是 Chrome 的问题：**受限沙箱禁止命名管道**，而 Playwright 正是用 `--remote-debugging-pipe` 与浏览器通信；文件策略放开到完整访问后限制消失。该脚本的计数随后续批次更新（**当前** 31 个开关 / 12 个可见标签 / 预览桩下 18 家关闭）。

### 0.8.3 验证记录：Kimi 月度窗口与响应形态兼容

- `node tests/run-all.mjs` 全部通过，`node scripts/check-manifest.mjs` 与三个 `node --check` 通过。
- 触发场景（实测）：`/coding/v1/usages` 按套餐体系下发不同窗口集合——老套餐（节奏命名，如 Allegro）返回 `limit_5h` + `limit_7d`；新套餐（Go / Plus 命名）只返回 `usages.limit_5h` + `limit_month_total` + `limit_month_code`，没有 `limit_7d`。同一把新套餐 Key 连续三次请求形态稳定，`/v1/me` 报 `user_level_name: "Plus"`、`goods_version: 2`。旧代码把 `limit_7d` 当必需字段，对新套餐 Key 一律抛 `Invalid Kimi usage response`，与 HTTP 层和 Key 有效性无关。
- 回归覆盖：现行响应（`limit_5h` + 月池 + `booster_wallet`）产出 `["5h","month"]`，`month_code` 不单独成窗；月池耗尽连坐 5 小时并标注 `blockedBy: ["month"]`，反向不连坐；旧绝对形态（顶层 `usage` + `limits[]`）按 `limit`/`remaining` 反推 5 小时与周额度；`used_ratio` 非数值与完全未知结构仍然报错。
- **未做**：老套餐 Key（节奏命名）的在线响应采样（依据“老套餐正常、新套餐报错”的现场反馈与该分支原有断言）；真实 DSH 中安装 0.8.3 后的实机验收。

### 0.8.2 验证记录：Command Code 账户切换同步控制用量显示

- `node tests/run-all.mjs` 全部通过，`node scripts/check-manifest.mjs` 与相关 `node --check` 通过。
- 新增覆盖：Host 按账户引用名解析 Key（凭据服务命中、环境回落、缺失 no-key 且文案指明账户、非法引用名不抛错）、`default`/缺省同走默认链、账户切换不复用旧账户缓存而同账户 TTL 内命中、query 校验拒绝非 string 账户；Client store 显示账户状态（readAll/refresh 携带 `commandCodeAccount`、相同账户去重、切换强制重拉）、UsagePill 挂载即读账户配置并在账户区 ready 后同步 activeId、弹层「上方用量」标注（固定账户显示 label、自动轮换显示默认账户并附不跟随说明）。
- 契约同步：Host/Client 两端 `read` descriptor 均接受与 `refresh` 相同的可选查询；`commitMimoLogin` 的缓存指纹补齐第五段与 `provider` 一致（否则 MiMo 登录后首次刷新会重复拉取）。
- 审查修复（MiMo 两路拆分审查，无 blocker/major，各带回归断言）：provider 内 config-changed 回退补传账户（错误条目不再错标 `default`）；切账户在 invalidate 后补 emit，消除强制刷新返回前「标注已切换、数字仍旧账户」的瞬态错标（新增在途竞态回归断言）。兼容性加固：read 的 `request` 参数在两端描述符声明 `acceptsUndefined` 且 query 解析容忍缺参/undefined——旧 client bundle（无参 read）与新 Host 共存的窗口期内初始读取降级为默认账户全量查询，而不是整体失败。另补 readAll 携带显示账户、账户 id trim、账户区不可用不显示标注等回归。
- **未做**：真实 DSH 中与 `@mars-sea/dsh-commandcode-provider` 一同加载的实机验收、真实多账户切换的在线验证、浏览器截图。

### Command Code 药丸账户切换验证记录（0.8.0）

- `node tests/run-all.mjs` 全部通过（新增 `test-commandcode-accounts.mjs`），`node scripts/check-manifest.mjs` 与 `node --check lib/client.js` 通过。
- 新增覆盖：账户列表解析（默认账户、额外账户 id 取 `apiKeyEnv`、label 空白回退 `Account N`、无引用与登记中账户过滤、`naming` 阶段保留）、activeAccount 判定（空串/`auto`/悬空引用按自动轮换）、控制器 describe→ready、固定账户 set 与回自动 unset/写空串（按组合层 base 分支）、mutate 失败保留原因并回读 Host 状态、非 ready 拒绝切换、switching 并发拒绝、弹层三选项渲染与不可用降级。
- 实现约束：账户列表只读 settings describe（`llm-commandcode` ns），不发起任何计费请求；`remote.settings` 未挂载或提供方插件未运行时降级为不可用；不修改 Host、凭据与 manifest。写入与 Command Code 提供方插件设置页同一 wire 通道（`settings.mutate("llm-commandcode", ops, revision)`），op 形式与其 client 的 active intent 一致。
- **未做**：真实 DSH 中与 `@mars-sea/dsh-commandcode-provider` 一同加载的实机验收、真实多账户切换的在线验证、浏览器截图。

### MiMo Cookie 有效期监控验证记录（0.8.0）

- `node tests/run-all.mjs` 全部通过（新增 `test-mimo-cookie-expiry.mjs`），`node scripts/check-manifest.mjs` 与三个 `node --check` 通过。
- 回归覆盖：旧配置无计时字段仍可读取、登录/导入从写入时刻计 24 小时并落盘、重新登录重新计时、平台观测到的更早过期时间优先且不放大上限、非法观测时间退回 24 小时、清除凭据同时清除计时、被手改坏的计时字段按未记录处理且不影响凭据读取、entry 与 settings 均下发且不回显 Cookie。
- 审查修复四项，各带回归断言并逐项单独还原验证过断言确实会失败：①`persist` 的 `keep` 曾续满倒计时；②`MimoLogin` 以 4 实参调用而 Host 回调只声明 3 个形参，`observedExpiresAt` 被静默丢弃，「取更早者」规则在线上从未生效（原测试直调 `commitMimoLogin` 绕过装配，故给出假阳性）；③倒计时文案抢占认证失败的主文案；④`invalidate` 在凭据被 `clear`/`replace` 后仍沿用旧 `cookieExpiresAt`。
- `extractMimoSession` 此前零覆盖，已补：会话 Cookie 返回 0、两个必需 Cookie 取更早的过期时刻、混合会话 Cookie 采用另一个、已过期的必需 Cookie 不进入会话。
- 客户端回归覆盖四档判定、药丸图标/文案/底色、额度用尽优先于到期提醒、认证失败优先于倒计时（已过期除外）、弹层常驻有效期、设置页登录时间与剩余时间、无记录时不编造倒计时，以及 store 的 `save` → `invalidate` 在 `clear`/`replace` 丢弃旧计时、`keep` 保留计时。
- 离线布局预览已按「临近到期」档位重新渲染并逐项核对 HTML（设置页 `color:#eab308">登录于 … · Cookie 2 小时后到期`、24 小时说明、药丸 aria-label 含到期提示）。
- **未做**：真实 DSH 中 Host/Client 一同加载后的实机验收、真实 MiMo 账号登录与倒计时到期后的接口行为、浏览器截图（本次沙箱禁止 Chrome 命名管道，`playwright-core` 无法启动）。药丸与设置页的视觉回归需在可启动浏览器的环境重跑。

### 0.7.0 验证记录

16 个回归文件通过，清单、Host/Client 语法与 npm 打包预检通过。八组设置页检查包含十个提供商开关和三个默认关闭项；另有深浅主题 × 280/360/530px 的六组药丸边界与颜色检查。具体修复和在线验收限制见 [审查记录](code-review.md)。

### 2026-10-04 提供商管理检查

- 0.6.0：十五个回归文件、清单、Host/Client 语法与 diff 格式检查通过。
- 新增覆盖开关增量保存、旧配置默认值、跨实例持久化、缺凭据/路由区分、关闭后的请求隔离、过期 revision、写入失败与迟到回包；Client 覆盖默认隐藏、配置入口、全部关闭、脏草稿保护和药丸订阅。
- 独立 Chrome 离线验收：深浅主题 × 530/500/499/360px 共八组通过，七个导航按钮、八个开关、零下拉列表且无横向溢出。页面与 Cookie 为虚构数据，不连接真实 DSH/账号。
- 本地链接安装指向工作区，但未重启或确认运行时代际；真实 Loader、在线额度与真实设置交互仍需验收。

### 2026-10-03 历史检查

- 12 个回归测试文件、清单校验、Host/Client 语法检查及 `npm pack --dry-run --ignore-scripts` 通过。
- 独立 Chrome 离线验收通过：全虚构 HttpOnly Cookie 的域/路径隔离，以及深浅主题下 530/500/499/360px 内部内容区的五等宽导航/窄选择框、原生选项对比度和无横向溢出。
- 新增回归涵盖普通刷新/缓存/登录提交的 Cookie 回显、短 Cookie 语义保留、非法对象明细、日期注释、完整 Netscape 导入及跨厂商登录按钮隔离。
- 未安装或重载运行中的插件；真实 Loader composition、在线账号接口和实际登录仍未验收。

部署后另行检查：Host/Client 版本一致、真实 Remote 往返、scope 卸载、约 530px 和窄内容区导航、125% 缩放、中文/英文、深浅主题，以及实际启用的各提供商 API。新增三家先确认默认关闭不请求，再主动开启并验证实际账号。Host 变更需要目标部署提供的重载或重启；Client 热生效依赖对应 watcher 及加载链路，不能一概认为 Ctrl+R 一定读到新产物。
