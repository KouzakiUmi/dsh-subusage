# MiMo 登录摩擦优化设计（待评审，未实施）

> 状态：**设计稿，等待用户决策，未写任何代码。** 2026-10-12 由代码审查的业务层评审提出。
> 关联：现状实现 [lib/mimo-login.js](../lib/mimo-login.js)、[lib/index.js](../lib/index.js) 的 `MimoLogin` 接线；历史约束 [docs/plan.md](plan.md) 第 4 节环境侦察。

## 1. 问题：为什么这是全产品最高频的摩擦

MiMo（`xiaomi-token-plan-cn`）是唯一**没有「长期 API Key」路线**的提供商：控制台对 `tp-`/`sk-` 推理 Key 查余额一律 404，只能用平台会话 Cookie，而 Cookie 有效期 **24 小时**。

当前自动登录的实际体验（[mimo-login.js](../lib/mimo-login.js)）：

1. 每次登录都 `chromium.launch()` 起一个**全新的、无持久化的隔离 Chrome**（`chromium.launch`，无 persistent context，不读日常浏览器 profile）；
2. 用户必须在这个**陌生窗口里完整走一遍**：输账号、输密码、过滑块/短信验证码、可能还有「记住此设备」；
3. 任务有 **5 分钟硬超时**（`setTimeout(300000)`），遇到找密码、短信延迟、验证码反复就被强制结束，重来；
4. 24 小时后 Cookie 过期，再来一遍。

对每天高频使用 MiMo 的用户，这是一个**每天一次、每次都要人工介入完整登录**的固定成本。

## 2. 不能做什么（既有硬约束，仍然成立）

这些约束在 [plan.md](plan.md) 第 4 节用真机验证过，新方案**不能违反**：

- **不能读用户日常 Chrome 的 Cookie**：Chrome 127+ 是 v20 app-bound 加密（Local State 有 `app_bound_encrypted_key`），DPAPI 解不了；且运行中的 `Default\Network\Cookies` 被独占锁。这条路已证伪，不要再尝试。
- **不能用主窗口 webview / `window.open`**：壳的 `setWindowOpenHandler` 对 http/https 一律 `shell.openExternal` + deny。
- **Host 是 RUN_AS_NODE**（`DeepSeek Harness.exe --expose-internals …host\index.js`），没有 Electron BrowserWindow API，登录浏览器只能由 **playwright-core 拉起的独立 Chrome** 承担（现状即是如此）。
- 只能提取 `api-platform_serviceToken` 与 `userId` 两个**官方 API 域/路径匹配**的 Cookie，且要过 Cookie 名值的 header 安全校验；不下载浏览器（复用系统 Chrome channel）。

## 3. 候选方案

### 方案 A：私有 persistent context（推荐主方案）

把 `chromium.launch()` 换成 **`chromium.launchPersistentContext(userDataDir, {...})`**，`userDataDir` 放在插件私有目录（如 `~/.dsh/subusage/mimo-profile/`），**不是**用户日常 Chrome 目录。

- **安全边界不变**：仍然是隔离会话，不读取、不污染日常浏览器；私有目录沿用 0700。
- **收益来自站点自己的「记住登录态」**：MiMo 站点在自己的存储里放了长效登录凭据 / refresh 态后，第二次起打开往往**已是登录态或一键确认**，不必再输密码、过短信；Cookie 过期时很多情况下能被站点自动续期，甚至接近半自动。
- 这与"读日常 Chrome Cookie"有本质区别：我们持久化的是**插件自己发起的那次登录**的站点存储，不是去解密别人的浏览器数据库。

**需要真机验证的不确定点（桩测试覆盖不到）：**
1. MiMo 站点是否真的在 persistent context 里保留长效登录态、保留多久（可能它强制 24h 服务端会话，persistent 也只省"输密码"那一步）；
2. 滑块/风控对"同一 userDataDir 反复出现的自动化浏览器"是否更友好或更敏感；
3. `extractMimoSession` 在 persistent context 下（context 级 cookies API 与 browser context 一致）的提取与域/路径过滤是否行为一致——预期一致，需实测。

**回退**：保留一个设置/常量开关，异常时退回当前的无持久化 `launch()`（路线 C 始终在）。

### 方案 B：超时弹性（低成本，可与 A 叠加）

- 5 分钟硬超时偏紧。改为：**只要检测到用户仍在与登录页交互**（navigation、input、Cookie 变化事件）就**顺延**超时（如每次活动 +2 分钟，封顶 15~20 分钟）；完全无活动才按原 5 分钟收尾。
- 或者更简单：超时延长到 10 分钟并做成常量。
- 风险低，纯 [mimo-login.js](../lib/mimo-login.js) 内部改动；但单独做只解决"被打断"，不解决"每天重登"。

### 方案 C：临期主动提醒（与业务评审 #1 同方向）

- 已有的 Cookie 2h 黄 / 30min 橙 / 过期红是**被动显示**；可在 MiMo 为当前模型、Cookie 当天到期时给一次性提醒，让用户在**方便的时候**主动重登，而不是任务撞鉴权失败后。
- 依赖 DSH 的通知能力（需先核实有无稳定 toast/notification API），与方案 A/B 正交。

## 4. 推荐落地范围（若批准）

第一阶段只做**低风险、可回退**的部分：

1. **方案 B 超时弹性**（先落，独立有价值）；
2. **方案 A persistent context**，但：
   - userDataDir 固定在插件私有目录、0700；
   - 加一个开关（默认开启，可退回无持久化）；
   - 仍只提取两个官方域 Cookie，校验链不变；
3. 不自动刷新、不代用户操作页面，只受益于站点自身的持久登录。

方案 C 待核实 DSH 通知 API 后另议。

## 5. 测试与验收计划

- **桩/单测可覆盖**：超时顺延的计时逻辑（注入时钟）、persistent vs 临时 context 的**选择逻辑**（注入 launch / launchPersistentContext 两个桩，断言按开关调用了正确的一个、userDataDir 路径与 0700 意图）、Cookie 提取与校验在两种 context 下走同一套过滤、回退开关。
- **必须真机人工验收（明确标注，不假装桩测能覆盖）**：
  - 第一次完整登录成功并保存 Cookie；
  - 关闭后第二次打开是否免输密码 / 一键确认；
  - Cookie 过期（或改系统时间 / 等 24h）后能否被站点自动续期或快速重登；
  - 滑块/短信在持久 context 下的实际表现；
  - 私有目录被删除后能干净回退到完整登录。
- 回归：现有 [test-mimo.mjs](../tests/test-mimo.mjs)、[test-mimo-cookie-expiry.mjs](../tests/test-mimo-cookie-expiry.mjs) 必须保持全绿；Cookie 脱敏（`redactMimo`）、24h 计时元数据、登录任务单实例等既有行为不变。

## 6. 明确不做

- 不读取/解密日常浏览器；不用主窗口 webview；不自动点击/自动过验证码；不把 Cookie 迁出发过的边界（与"暂不迁移凭据库"决策一致）；不为 MiMo 增加任何推理 Key 路线（接口本身不支持）。
