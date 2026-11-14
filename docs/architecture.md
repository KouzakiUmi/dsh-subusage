# 架构总览 / Architecture

> 本文是插件的**当前架构与亮点速览**，面向贡献者与二次开发；使用与配置见 [README](../README.md)，逐文件职责见 [开发文档](development.md)，wire 契约细节见 [QuotaEntry](quota-entry.md)，一体化平台设计决策见[研究报告](unified-quota-platform-report.md)。

## 定位一句话

**只读的额度层**：不注册模型路由、不提供推理服务；读取订阅/余额/联动额度，统一成一种条目模型，显示在药丸、弹层、Go 原生面板与设置页，并只读绑定主机的 provider 路由做归属。新上游出现时有两条接入路径：设置页零代码（自定义连接），或一个归一化模块文件（内置 provider）。

## 数据流（一条额度读数的完整旅程）

```
上游来源
  ├─ 32 条内置 provider id（订阅窗口 / 余额 / 额度池 / 席位）
  ├─ 自定义连接（ConnectionInstance：任意 HTTP 上游，零代码）
  └─ 19 条联动项（Antigravity / Trae / WorkBuddy / Raccoon / Loomy / OFM×10 / Magpie）
        │
        ▼
凭据解析链 lib/credentials/resolver-chain.js
  routeEnvs → keyRefs（最多 8 个引用名）→ builtinEnvs → manualSecret
  自定义实例不含 routeEnvs（路由绑定只决定归属，不借 Key）
  秘密经 lib/secret-box.js AES-256-GCM 落盘加密（0600 密钥文件，旧明文读取兼容、保存自动升级）
        │
        ▼
取数层（两条并列路径）
  ├─ 内置 provider：lib/providers/* 归一化模块（经 windowApi 与宿主通信）
  └─ 自定义上游：lib/adapters/declarative/*（custom-http / sub2api / litellm 声明式映射）
      lib/http/*（RFC 6901 JSON Pointer、白名单转换器、安全 URL 归一、只读执行器）
      lib/detection/*（4 态探测 identified / needs-review / auth-required / unsupported）
        │
        ▼
QuotaEntry 统一 wire 契约 lib/quota-entry.js
  元素模型：window / amount / package / plan / status / note
  维度：账户 × 池 × 元素（order / label / amount.unit / unitId / componentOf / poolScope）
  出边界 canonicalizeEntry()：quotas 在场即权威、双字段补齐、恒为数组
        │
        ▼
wireJson 深度净化（lossless JSON，typert 逐值校验兜底）
        │
        ├─ Client 药丸 + 弹层 + 设置页（lib/client.js，DSH Go 岛自动适配）
        ├─ DSH Go 原生面板（lib/go-panel.js 声明式组件 + dshGo.panel）
        └─ subusage_quota 工具（Agent 只读查询）
```

## 亮点（按可演示度排列）

1. **32 条内置额度入口 + 19 条联动项**：DeepSeek、Kimi、Z.ai、MiMo、OpenCode Go、Command Code、SuperGrok、Codex、Copilot、火山方舟（个人/团队）、SiliconFlow、OpenRouter、ZenMux、Vercel、Ollama Cloud、New API / one-api 自建站……一家一条凭据链、一套单位口径，互不混淆。
2. **零代码接入任意新上游**：设置页填 Base URL → 「测试连接（不保存）」→ 4 态探测自动推导 JSON Pointer 映射 → 一键套用建议映射 → 保存即得药丸。映射错误可逐字段 🔒 锁定，重新探测不覆盖。接入配方（Recipe）可脱敏导出 / 导入分享。
3. **统一条目模型**：不管上游给的是百分比窗口、美元余额、积分包还是席位池，出边界都是同一套 QuotaEntry 元素——药丸、弹层、面板、工具四端同口径渲染，阈值告警与合计规则只在管线里写一次。
4. **秘密落盘加密**：API Key、OAuth 记录、会话 Cookie 用 AES-256-GCM 加密后落盘，密钥文件 0600；公开设置永远只有引用名，没有秘密值。
5. **多 Key 监控**：每个 provider 最多 8 个凭据引用名，逐 Key 独立查询与缓存（`id@ref`），主条目参与药丸选择，额外 Key 用于排障 / 多账号对账。
6. **路由归属三处同口径**：内置别名 → 手动映射 → 路由绑定 → Magpie 分组绑定，Host `resolveRouteTarget`、Client 药丸、Go 面板 `goPanelUsageId` 三处同一张表、同一套解析顺序（回归逐键比对）。
7. **Magpie 遥测先归属再采信**：本地网关的并发/请求行不区分会话，只有与本会话当前模型一致才参与「正在服务」判定——切到别的对话不会被别人的在途请求误导。
8. **密度契约**：弹层 ≤14 行、单行报告 ≤220 字符，多账号平铺一行一个，形态表回归锁定——新形态接入不会撑爆界面。
9. **隔离回归 235 项**：桩网络 / 隔离文件系统 / 双端契约比对（`npm run check`），Host 归一化函数可在不触碰 DSH 核心包的情况下独立测试。
10. **Provider 模块化**：30 个归一化函数全部迁出宿主核心（`lib/providers/subscriptions|balances|session|newapi.js`），模块只经参数 `windowApi`（failure / 窗口工具 / 联动元数据）与宿主通信；`lib/index.js` 保留同名薄包装器，内部调用与测试零改动。

## 模块地图（按层）

| 层 | 文件 | 职责 |
|---|---|---|
| 契约 | `lib/quota-entry.js` | QuotaEntry 唯一事实源、canonicalizeEntry、元素/池/聚合词汇 |
| 契约 | `lib/secret-box.js` | AES-256-GCM 封套加解密 |
| Provider 模块 | `lib/providers/shared.js` | `createWindowApi`：模块与宿主的唯一通信面 |
| Provider 模块 | `lib/providers/subscriptions.js` | 订阅窗口型归一化 ×9（Kimi / Z.ai / MiMo / OpenCode Go / Synthetic / NanoGPT / MiniMax / Command Code / SuperGrok） |
| Provider 模块 | `lib/providers/balances.js` | 余额/限额型归一化 ×12（SiliconFlow / DeepSeek×2 / OpenRouter / Novita / Hyperbolic / DeepInfra / Chutes / Ollama Cloud / Vercel / Zenmux / Apigoto） |
| Provider 模块 | `lib/providers/session.js` | 会话/登录态型归一化 ×8（Copilot / OpenDesign+账单 / Antigravity×2 / Trae / LiteLLM / Codex） |
| Provider 模块 | `lib/providers/newapi.js` | New API / one-api 自建站（站点根归一 + 取数 + 归一化） |
| 声明式平台 | `lib/adapters/declarative/*.js` | custom-http / sub2api / litellm 适配器（JSON Pointer → QuotaEntry） |
| 声明式平台 | `lib/http/*.js` | 安全 URL 归一、只读执行器、信封解包、白名单转换器 |
| 声明式平台 | `lib/detection/*.js` | 4 态探测、数值守恒推断、歧义检测、预览脱敏、Recipe |
| 声明式平台 | `lib/credentials/*.js` | 解析链、鉴权头注入、生命周期 |
| 声明式平台 | `lib/platform/*.js` | 实例、目录、DisplayProfile、路由绑定、运行时 |
| 联动 | `lib/ofm.js` / `lib/connect-usage.js` / `lib/desktop-usage.js` / `lib/local-usage.js` | OFM 十渠道 / Trae·WorkBuddy / Raccoon·Loomy / 本机直取六渠道 |
| 联动 | `lib/magpie-usage.js` / `lib/eac-usage.js` | Magpie 本机网关 / EAC 三渠道回退 |
| 登录 | `lib/cookie-login.js` + `lib/mimo-login.js` / `lib/opendesign-login.js` / `lib/mimo-qr.js` / `lib/trae-auth.js` | Cookie 登录骨架与两家站点参数、扫码、Trae 凭据解密 |
| 纯计算 | `lib/credit-packages.js` / `lib/volcengine.js` / `lib/grok-credits.js` | 积分包分组 / AK-SK 签名 / gRPC-web 帧解析（零依赖可单测） |
| 宿主 | `lib/index.js` | Host 服务：RPC、缓存、设置持久化、调度；provider 归一化薄包装器 |
| 客户端 | `lib/client.js` | 药丸、弹层、设置页、数据订阅（不引入 Node 模块） |
| 客户端 | `lib/go-panel.js` | DSH Go 原生面板（纯函数、无 IO） |

## 设计不变量（改代码前先读）

- **只读边界**：不写上游任何状态（不签到、不刷新 token、不碰写接口）；本机直取与兄弟插件不抢刷新权。
- **wire lossless**：出边界禁止嵌套 `undefined` / `NaN` / 符号键；字段缺席就不写属性，`wireJson` 兜底。
- **秘密不出 Host**：公开设置、RPC 返回、日志、错误文案都不携带秘密值；凭据只报存在性与引用名。
- **显示不编造**：缺数字不补 0、未知单位不猜、缺席不画耗尽；百分比一律「已用」口径。
- **双端同步表**：`PROVIDER_META` / `ROUTE_PROVIDER_ALIAS`（Client）与 Host 别名表、Go 面板 `ROUTE_USAGE_ID` 改一处必须同步其余并跑 `test-contract`。

## 三条扩展路径

| 路径 | 何时用 | 成本 |
|---|---|---|
| A. 自定义连接（零代码） | 上游是可配置的 HTTP 额度接口；设置页探测 → 映射 → 保存 | 0 行代码 |
| B. 内置 provider | 需要 enroll 进默认开关 / 凭据槽 / 内置别名的一等入口 | 1 个归一化模块 + 注册面（`PROVIDERS`、Client META、计数断言、文档） |
| C. 插件联动 | 额度在第三方 DSH 插件手里（Trae / WorkBuddy / OFM / EAC / Antigravity / Magpie） | `LINKED_PROVIDERS` 登记 + 双端 codec 同步；`/plugins/*` 路由自动走页面代取（`linkedStep`） |

新增聚合语义（比如多端点 join）目前是引擎缺口：实例只有单 `usagePath`，多请求组合需要扩展 `requests[]` + join 引擎后才可在自定义连接里表达。
