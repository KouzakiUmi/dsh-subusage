# 开发与验证说明

## 1. 目标与授权边界

目标 API 为 DeepSeek Harness `0.2.0-rc.2`，peer 范围为 `>=0.2.0-rc.1 <0.3.0-0`，允许范围内的预发布版本。范围声明与真实运行验证分别记录。本项目是树外 Host/Client bundle，`cordis.patch.yml` 插入 `subusage`，不修改核心、安装树或 ASAR。

工作区开发、安装启用、依赖安装/构建授权与重启是不同操作。修改并通过测试不代表运行环境已经生效。

### 文件入口

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 提供商适配、凭据解析、持久化、缓存与 Host RPC |
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

- `read()` 保留无参初始化入口。
- `refresh(request)`：`request = { providerIds: string[], force: boolean }`，只读取指定厂商；返回的 entries 由 Client 合并。
- `save(settings)`：provider patch，包含 `providerId`、`expectedRevision`、来源模式、凭据保持/替换/清除动作与可选 Z.ai 参数。凭据由提供方插件管理的厂商（`managedByPlugin`，现即 commandcode）拒绝一切凭据补丁，只接受裸 patch。
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
- Kimi 新格式仅兼容有明确窗口含义和数值依据的字段；未知结构报错，不猜测额度。
- Command Code 并行直连 `/alpha/billing/credits` 与 `/alpha/billing/subscriptions`（请求头对齐提供方插件的 accountHeaders：Bearer、accept-encoding: identity、x-command-code-version、x-cli-environment）。absent 窗口是未报告上限（不画额度行）；`cap: 0` 是报告过的无上限，按 0% 不受限展示；`exceeded` 或原始比例达 100% 即限流；已出现的窗口块缺 `used`/`cap` 或非数值一律报错，不当作零用量。月余额 `credits.monthlyCredits` 是剩余金额，使用已知套餐表快照计算 `max(0, total - remaining)`，不是接口直接报告的月cap；未知套餐或缺月余额时 coverage=partial，不猜测百分比。planId优先 subscriptions.data.planId、回退 credits.planId，重置取 subscriptions.data.currentPeriodEnd（ISO或毫秒），非法日期不输出。月池耗尽不参与短窗级联（额外购买/赠送池可能仍可用）；周/5小时保持现有级联。余额只显示真正报告过的月剩余/已购/赠送字段。多账户轮换或固定 activeAccount 时显示默认（顶层 Key）账户额度，自定义 apiBase 不跟随。
- 单厂商凭据、网络、解析异常不影响其它厂商条目。
- 按厂商共享 TTL 缓存与 in-flight 请求；配置/凭据变化使旧账号缓存失效。
- TTL 为 60 秒。Client 仅订阅活跃、开启的提供商，隐藏页面暂停定时读取，回到可见状态再检查；不要把所有厂商做成独立全局轮询。
- 新增厂商须同步 Host 的 PROVIDERS、Client 的 PROVIDER_META / PROVIDER_ORDER、帮助文案、README 和默认值测试。未获明确需求的新订阅商保持 `defaultEnabled: false`；原有偏好通过存储合并保留。
- 允许保留的临时错误返回 stale 标记、上次成功时间与结构化错误；认证失效不保留旧额度。
- 429/临时错误使用退避，倒计时本地更新，重置后有界刷新而不制造请求循环。
- Retry-After / retryAt 优先于强制刷新和重置到期。已知本地配置修改只失效受影响厂商；未知外部 revision 修改保守失效所有条目。
- MiMo 会话 Cookie 自签发起 24 小时有效。Host 在凭据写入的同一刻记录 `xiaomi.loginAt` / `xiaomi.expiresAt`（毫秒，清除凭据时归零），并把 `cookieExpiresAt` 挂到该厂商的每条 entry 上；自动登录经 `MimoLogin` 回调传入浏览器观测到的 Cookie 过期时刻，取 `min(24h 上限, 观测值)`——该回调必须透传第 4 个实参，少声明形参会静默退化成 24 小时上限。计时只在真正写入凭据（`cookieUpdate` 为 `replace`）时重置，`keep` 不得续满倒计时。解析存储只接受安全整数正数，损坏字段按未记录处理。Client 侧到期档位由 `cookieExpiry()` 单点判定：>2h 正常、≤2h 提醒、≤30min 紧急、已过期。**倒计时只用于展示**：归零不改凭据可用性，真实失效仍由官方接口返回决定；接口已判定凭据失效（`state: "error"`）时倒计时不得抢占主文案，但「已过期」本身仍优先，因为它就是重新登录的行动项。Client 合并/失效条目时保留 `cookieExpiresAt`，否则保存或登录后倒计时会短暂消失；但凭据被 `clear` / `replace` 时必须丢弃旧值，否则已删除的 Cookie 仍显示过期倒计时。

## 5. 凭据与 MiMo

当前仍兼容旧本机 JSON 存储，并非加密凭据库；不输出真实 Key/Cookie到日志、测试、截图或读取结果。新建目录 mode 为 0700、临时文件为 0600，重命名前再收紧临时文件权限；不 chmod 已有共享配置目录。Windows chmod 不等同于 ACL 管理，部署者仍需保证目录 ACL 仅授权合适用户。

Command Code 不提供本地凭据编辑：沿用提供方插件（@mars-sea/dsh-commandcode-provider）的凭据来源链——凭据服务 `COMMANDCODE_API_KEY` → 启动环境 → `~/.commandcode/auth.json` 兜底（解析对齐其 resolveAuthFileApiKey：`apiKey` / `commandcode` 字符串、`commandcode`/`command-code` 凭据记录的 key/access）。

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

浏览器检查需要工作区可解析 `playwright-core` 且已安装 Google Chrome；不会下载浏览器。它检查 Cookie 域/路径隔离、十个提供商开关加一个默认隐藏开关、三项默认关闭、七个可见标签、无下拉列表和横向溢出，并将 PNG 写到 `debug/ui-preview/`。

单独生成浅色药丸弹层 HTML：

```console
node scripts/render-ui-preview.mjs 530 nanogpt light pill
```

可用以下独立 Chrome 命令将该 HTML 截成 PNG（先生成 HTML；所有 HTTP 请求会被阻止）：

```console
node --input-type=module -e "import {chromium} from 'playwright-core'; import {resolve} from 'node:path'; import {pathToFileURL} from 'node:url'; const b=await chromium.launch({channel:'chrome',headless:true}); try { const p=await b.newPage({viewport:{width:554,height:560},colorScheme:'light'}); await p.route(/^https?:/,r=>r.abort()); await p.goto(pathToFileURL(resolve('debug/ui-preview/settings-530-nanogpt-light-pill.html')).href); await p.screenshot({path:'debug/ui-preview/settings-530-nanogpt-light-pill.png',fullPage:true}); } finally { await b.close(); }"
```

预览页面包括布局示意，不完全复刻 DSH 外壳。市场所用设置截图来自 `settings-530-xiaomi-token-plan-cn-dark-credentials.png`，弹层来自 `settings-530-nanogpt-light-pill.png`。人工检查后将 PNG 复制到 `assets/screenshots/` 的相应文件，保留离线标记并同步 [截图声明](../screenshots.json) 与 README。市场只需 GitHub 仓库图片，当前 npm 白名单不包含这些 PNG。

### Command Code 药丸账户切换验证记录（未发布）

- `node tests/run-all.mjs` 全部通过（新增 `test-commandcode-accounts.mjs`），`node scripts/check-manifest.mjs` 与 `node --check lib/client.js` 通过。
- 新增覆盖：账户列表解析（默认账户、额外账户 id 取 `apiKeyEnv`、label 空白回退 `Account N`、无引用与登记中账户过滤、`naming` 阶段保留）、activeAccount 判定（空串/`auto`/悬空引用按自动轮换）、控制器 describe→ready、固定账户 set 与回自动 unset/写空串（按组合层 base 分支）、mutate 失败保留原因并回读 Host 状态、非 ready 拒绝切换、switching 并发拒绝、弹层三选项渲染与不可用降级。
- 实现约束：账户列表只读 settings describe（`llm-commandcode` ns），不发起任何计费请求；`remote.settings` 未挂载或提供方插件未运行时降级为不可用；不修改 Host、凭据与 manifest。写入与 Command Code 提供方插件设置页同一 wire 通道（`settings.mutate("llm-commandcode", ops, revision)`），op 形式与其 client 的 active intent 一致。
- **未做**：真实 DSH 中与 `@mars-sea/dsh-commandcode-provider` 一同加载的实机验收、真实多账户切换的在线验证、浏览器截图。

### MiMo Cookie 有效期监控验证记录（未发布）

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
