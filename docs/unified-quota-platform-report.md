# 一体化额度查询与药丸显示平台研究报告

- **文档状态**：研究方案，待实施
- **研究日期**：2026-11-08（Asia/Hong_Kong）
- **适用项目**：dsh-subusage
- **研究范围**：登录与凭据模块化、额度来源实例化、接口自动探测、响应归一化、人工纠正、显示规范、模型 provider 绑定，以及 sub2api 和私人部署接入
- **实施状态**：本文仅形成设计，不代表相关模块已经实现或经过真实部署验收

> 本文中的 `ConnectionInstance`、`AdapterRecipe`、`CredentialProfile`、`DisplayProfile` 等均为**建议的新概念与命名**，不是对当前代码已有能力的描述。涉及新增字段、RPC、目录结构和阶段验收的内容均为提案；现有行为以源码和现行开发文档为准。

---

## 1. 执行摘要

dsh-subusage 已具备两个适合平台化的基础：

1. [QuotaEntry](../lib/quota-entry.js) 已建立「账户 × 池 × 额度元素」的统一 wire 契约，能够承载窗口、余额、额度包、套餐、状态、说明和多账号数据。
2. OFM、EAC、Magpie、LocalUsage 等读取器已经证明，不同取数通道可以共享归一化、缓存、降级、药丸和工具输出。

当前主要瓶颈不是额度显示模型，而是普通 provider 的接入方式：静态 provider 表、身份解析分支、请求大分支和 Client 静态元数据仍彼此耦合。新增一个陌生服务通常仍需要修改 Host、Client、路由映射和测试多处代码。

本报告建议将项目演进为：

> **以 ConnectionInstance 为中心的通用额度查询与药丸显示平台。每种服务由适配器描述，每个用户来源由实例表达；凭据、账户、路由绑定和显示配置在能力约束下自由组合。已知服务自动识别，陌生服务生成可审阅的映射草稿，经用户确认后成为声明式适配器。**

核心结论如下：

- **保留 QuotaEntry，不再重写一套显示协议。**
- **不要强迫所有 provider 声明式化。** OAuth、签名、protobuf、复杂分池和兄弟插件继续使用 Native Adapter；普通 HTTP JSON 服务使用 Declarative HTTP Adapter；OFM、Magpie 等使用 Linked Adapter。
- **自动探测采用“已知配方识别 → 通用结构推断 → 用户确认 → 保存复测”四段式。** 通用 heuristic 不得直接、静默地把陌生字段认定为余额或窗口。
- **“自由组合”必须是受约束组合。** 适配器声明可接受的凭据类型、鉴权方式和查询能力，UI 不提供无意义或危险的任意组合。
- **显示配置与额度语义分离。** 标签、顺序、精度和药丸主指标属于显示；已用/剩余、单位缩放、池独立性、重置与到期属于归一化，不能通过“调整显示”改变告警事实。
- **sub2api 适合作为第一个端到端样板。** 其分组 Key 可通过只读 `GET /v1/usage` 查询配额、订阅窗口、限流窗口和钱包，但必须区分 Key、分组与用户作用域，尤其不能跨 Key 重复汇总同一钱包。
- **采用增量迁移。** 先建立统一运行时和动态实例目录，再落地 sub2api 与声明式运行时，随后实现自动探测和人工纠正，最后迁移既有 provider。

---

## 2. 背景与问题定义

### 2.1 用户目标

目标平台应支持：

1. 主流订阅继续由内置结构直接接入。
2. 反代订阅通过 OAuth、Cookie、共享登录态或兄弟插件读取。
3. Magpie 通过 HTTP 与自定义路由关联展示上游卡片。
4. sub2api、LiteLLM 和其他私人部署可通过地址与凭据接入。
5. 用户输入 API 地址后，系统尽可能自动发现额度接口并归一化。
6. 自动识别不准确时，用户可以手动选择端点、字段、语义和账号范围。
7. 用户可以调整药丸与详单的显示规范，而不改变原始额度事实。
8. 一个额度实例可以绑定一个或多个 DSH 模型 provider，也可以独立存在。
9. 设置页、药丸、DSH Go 面板和 `subusage_quota` 工具读取同一份规范数据。

### 2.2 当前重构已经解决的问题

当前实现已经具备以下模块化成果：

- `QuotaEntry.quotas[]` 是规范额度元素表，`linkedAccounts[]` 提供账号维度，`pool` / `poolLabel` / `poolScope` 提供池语义。
- `canonicalizeEntry()` 在出边界统一收编 legacy 与规范形状。
- Cookie 登录流程已抽成通用骨架，站点差异由参数描述。
- OFM、EAC、Connect、Desktop、Local、Magpie 等通道有独立读取器和归一化模块。
- 药丸、设置页和 Go 面板共享额度状态与展示语义。
- 手动 provider 匹配允许多个模型路由绑定到一个现有订阅入口。
- 多 Key 监控、额外凭据引用和按账户缓存已经建立。

因此，下一步不应推翻这些成果，而应把它们纳入统一的实例与适配器运行时。

### 2.3 仍未解决的结构问题

#### A. 普通 provider 仍是静态注册

[lib/index.js:30](../lib/index.js#L30) 的 `PROVIDERS` 同时承载标签、内置环境变量、默认开关和部分端点信息。用户无法在不改代码的情况下新增一个独立额度来源。

#### B. 身份解析仍有大量 provider 特判

[lib/index.js:2148](../lib/index.js#L2148) 的 `identity()` 同时处理 Cookie、AK/SK、OAuth、登录文件、账号服务、额外引用和普通 Key。虽然解析顺序已经统一了一部分，但凭据类型、来源、所有权和生命周期仍集中在服务大类中。

#### C. 请求和归一化仍由大型分支组织

[lib/index.js:2240](../lib/index.js#L2240) 的 `fetchProvider()` 同时负责端点拼接、请求头、多步请求、降级策略和归一化调用。简单的单端点 JSON 服务与复杂 OAuth/protobuf 服务共享同一个分支体，新增声明式来源没有自然入口。

#### D. Client 与 Go 面板依赖静态目录

[lib/client.js:499](../lib/client.js#L499)、[lib/client.js:560](../lib/client.js#L560) 和 [lib/go-panel.js:13](../lib/go-panel.js#L13) 等表需要知道所有合法 ID。自定义实例若继续沿用这套静态白名单，会同时卡在设置、药丸、Go 面板和工具多处。

#### E. 额度作用域还不足以支撑通用聚合

当前「账户 × 池 × 元素」能表达数据归属，但通用中转平台还需要区分：

- Key 自己的请求数与花费；
- 分组共享的订阅计数；
- 用户共享的钱包；
- 企业席位预算；
- 独立账号余额。

缺少这一层时，多 Key 场景最容易出现重复合计或错误去重。

---

## 3. 目标与非目标

### 3.1 目标

- 用户可以不修改源码，新增一个 sub2api 或兼容的私人额度接口。
- 已知配方可以自动识别端点、鉴权和响应结构。
- 陌生 JSON 响应可以生成带依据的字段映射候选。
- 用户确认后的映射可持久化、复测、修改、克隆和脱敏导出。
- 凭据解析、请求鉴权和续期所有权相互独立。
- 多 Key、多用户、多分组、多席位不被错误合计。
- 自定义实例与内置实例使用同一药丸、面板和工具管线。
- 修改显示偏好不作废额度缓存，不覆盖映射语义。
- 既有用户配置和 provider ID 可以渐进迁移。

### 3.2 非目标

- 不注册或改写模型路由。
- 不通过发送聊天、补全或其他计费请求探测额度。
- 不绕过目标站点的鉴权、人机验证或权限边界。
- 不保证私人接口的数字是正式计费依据。
- 不允许用户在映射配置中执行任意 JavaScript。
- 不把所有复杂 provider 强行转换为 JSON 配置。
- 不在第一版实现通用历史账单、趋势图或全协议 OpenAPI 爬虫。
- 不自动合并仅因昵称、邮箱或金额相同而“看起来像”的账号。

---

## 4. 总体架构

### 4.1 六个核心对象

| 对象 | 职责 | 是否含秘密 |
|---|---|---|
| `AdapterRecipe` | 描述一种服务如何查询、解析和归一化 | 不应含秘密 |
| `ConnectionInstance` | 用户实际添加的一条额度来源，保存地址、配方、配置和开关 | 默认不含秘密 |
| `CredentialProfile` | 描述凭据来源链、存储引用、鉴权应用和生命周期 | 只保存引用；秘密由凭据服务或受控存储持有 |
| `AccountProfile` | 描述一个连接下的 Key、用户、分组或席位 | 只保存账户元数据与凭据引用 |
| `RouteBinding` | 将 DSH 模型 provider 绑定到实例，必要时再绑定到账户 | 不含秘密 |
| `DisplayProfile` | 控制药丸主指标、标签、排序、精度、阈值和账号视图 | 不含秘密 |

建议的数据流：

```text
DSH 模型 provider
        │
        ▼
RouteBinding ───────────────┐
                            ▼
                   ConnectionInstance
                    ├─ AdapterRecipe
                    ├─ CredentialProfile
                    ├─ AccountProfile[]
                    └─ DisplayProfile
                            │
                            ▼
              Adapter Runtime / Query Pipeline
                            │
                            ▼
                       QuotaEntry
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
            药丸          Go 面板      subusage_quota
```

### 4.2 为什么需要 ConnectionInstance

“sub2api”是一种适配器，不是用户唯一的一条数据。用户可能有：

- 两个不同的 sub2api 部署；
- 同一部署下的多把分组 Key；
- 同一服务地址上的生产与测试配置；
- 同一适配器但不同显示规范的多个入口。

因此运行、缓存、路由绑定和显示选择必须面向实例，而不是只面向配方 ID。

建议实例使用稳定、不可复用的 `instanceId`。`recipeId` 表示适配器类型，`providerId` 在过渡期继续用于 wire 兼容，新增 `instanceId` 作为真实查询与缓存身份。

### 4.3 统一运行时与三类适配器

三类适配器共享注册、配置校验、超时、缓存、退避、代次保护、取消、秘密净化和输出边界，但保留不同实现方式。

| 类型 | 适用场景 | 当前可迁移例子 |
|---|---|---|
| Native Adapter | OAuth、签名、多步发现、protobuf、复杂池语义 | Codex、Grok、火山、MiMo |
| Declarative HTTP Adapter | 普通 HTTP JSON、单步或有限多步只读查询 | sub2api、LiteLLM、简单余额接口 |
| Linked Adapter | Cordis 服务、兄弟插件、页面代取、聚合网关 | OFM、EAC、Antigravity、Magpie |

建议接口能力包括：

```text
validateConfig
resolveRequirements
read(context)
normalize(raw, context)
capabilities
```

Native 与 Declarative 是同一适配器体系的不同实现，不应演化成两套互不相干的查询平台。

---

## 5. 适配器模型

### 5.1 AdapterRecipe 内容

一个配方应描述：

- 配方 ID、版本和显示名；
- 支持的实例参数；
- 接受的凭据类型与鉴权方式；
- 固定端点或用户端点策略；
- 查询步骤；
- 响应信封规则；
- 归一化方式；
- 支持的账户与作用域；
- 是否支持自动探测；
- 是否支持多 Key、多账号和指定账户绑定；
- 可用的药丸主指标类型；
- 配置迁移函数或版本兼容策略。

### 5.2 Declarative HTTP Adapter 能力

声明式运行时建议支持：

- HTTP(S) base URL；
- GET 与明确声明为只读的 POST 查询；
- 非秘密静态请求头；
- 查询参数和 JSON body 的受限占位符；
- 多步查询中的非秘密 ID 提取，例如 workspaceId；
- 裸对象和 `{code, message, data}` 信封；
- RFC 6901 JSON Pointer；
- 数组根与对象根选择；
- 白名单转换；
- 输出到 QuotaEntry 的映射。

建议的白名单转换：

- `coalesce`
- `toNumber`
- `scale`
- `used / limit`
- `remaining / limit`
- `limit - used`
- 秒、毫秒、ISO 时间转换
- 单位与角色映射
- 数组元素映射
- 常量标签和周期

明确不支持：

- `eval`、Function 构造器或用户脚本；
- 任意 JavaScript 表达式；
- 任意文件、子进程或数据库访问；
- 未声明的网络目标；
- PUT、PATCH、DELETE 等写操作；
- 把登录、签到、刷新或领取动作混入普通额度刷新。

### 5.3 Native Adapter 的保留价值

以下能力不应为了“配置化”而重写：

- OAuth 设备码、授权码与续期；
- 共享登录文件的锁与所有权；
- 火山 AK/SK 签名；
- Grok gRPC-web / protobuf；
- Antigravity 独立池去重与池归属；
- Magpie 路由遥测归属；
- 多源回退与缺席语义；
- 需要精确业务证据的未订阅、企业无数字和限流判断。

Native Adapter 只需实现统一接口，并复用公共运行时，不必牺牲语义精度。

---

## 6. 凭据、鉴权与登录生命周期

### 6.1 三层拆分

#### 第一层：Credential Resolver——凭据从哪里来

内置解析器建议包括：

- DSH 路由实际 `apiKeyEnv`；
- DSH 凭据库引用名；
- 启动环境变量；
- 本插件手动秘密；
- OAuth 登录记录；
- Cookie 登录器；
- 共享登录文件；
- 兄弟插件服务；
- DSH 账号服务。

实例可以配置有序解析链，例如：

```text
当前模型路由 apiKeyEnv
→ 用户指定 SUB2API_API_KEY
→ 启动环境
→ 手动 Key
```

继续沿用现有“名字优先、来源其次”规则，不跨引用名拼接不同来源的凭据。

#### 第二层：Auth Applier——凭据如何进入请求

独立支持：

- `Authorization: Bearer <secret>`；
- 裸 `Authorization`；
- 有界自定义 Authorization scheme；
- `x-api-key`；
- 自定义秘密请求头；
- Cookie；
- AK/SK 等签名器；
- 无 HTTP 秘密的宿主服务调用。

Adapter 必须声明兼容项，UI 只提供合法组合。自定义静态请求头默认视为非秘密；秘密请求头必须通过凭据引用注入。

#### 第三层：Credential Lifecycle——谁负责续期

建议明确三种所有权：

| 所有权 | 行为 |
|---|---|
| `read-only` | 只读取，过期后提示重新登录，不自行续期 |
| `delegate` | 由凭据所属插件或宿主服务续期 |
| `managed` | 本插件登录器拥有续期职责，例如 MiMo |

这一层用于防止多个组件同时刷新同一 refresh token，避免互相顶下线。

### 6.2 存储与公开投影

- 优先把秘密写入 DSH 凭据库，实例只保存引用名。
- 手动秘密保留现有受控回退，但公开设置只暴露存在性、来源与到期元数据。
- 配方导出默认不包含秘密、凭据引用名和用户地址。
- 探测草稿中的秘密使用 Host 侧短期句柄，不在每次向导请求中反复回传。
- 原始响应不得进入 `subusage_quota` 工具结果。
- 错误、诊断和缓存键不得包含秘密原文。

---

## 7. 自动探测总体方案

### 7.1 能力边界

对任意私人部署，平台可以：

- 验证有限的常见只读端点；
- 识别已登记服务的响应签名；
- 从 JSON 结构生成额度映射候选；
- 帮助用户确认并保存映射。

平台不能凭空发现一个完全未知、无文档、无候选路径的接口。对这类情况，应允许用户手填路径，或后续通过 OpenAPI 文档辅助生成候选。

### 7.2 四种探测结果

| 状态 | 含义 | 下一步 |
|---|---|---|
| `identified` | 已知配方与结构校验均通过 | 可直接预览并保存 |
| `needs-review` | 找到可读 JSON，但部分语义不唯一 | 进入映射确认页 |
| `auth-required` | 端点可能存在，但凭据或鉴权不通过 | 修改凭据或鉴权方式 |
| `unsupported` | 没有可用候选或结构无法表达 | 手填端点，或保留为不支持 |

“HTTP 200”不等于识别成功；“返回 JSON”也不等于其中一定有可用额度。

### 7.3 探测状态机

#### 第一步：建立连接草稿

用户可：

- 从已配置的 DSH provider 继承 base URL 和 `apiKeyEnv`；
- 或手填地址并选择 CredentialProfile。

此阶段只规范化输入，不发送模型请求。

#### 第二步：生成有限的 RequestPlan

先尝试已知配方，再尝试少量通用候选。例如：

- sub2api：`GET /v1/usage`；
- LiteLLM：`GET /key/info`；
- 通用候选：`/v1/usage`、`/usage`、`/api/v1/auth/me`、`/api/v1/user/profile`。

候选列表必须是配方登记或通用白名单，不能爬站或暴力枚举。

#### 第三步：执行与分类

分别记录：

- 网络失败；
- TLS 失败；
- 超时；
- 401 / 403；
- 404；
- 429；
- 5xx；
- 非 JSON；
- 业务信封失败；
- JSON 成功但没有额度候选；
- 识别成功或待确认。

认证失败不能被后续普通 404 掩盖；429 应尊重 Retry-After，不继续放大探测流量。

#### 第四步：结构识别

优先匹配完整配方签名。例如 sub2api 的：

- `quota`；
- `subscription`；
- `rate_limits`；
- `usage.today / usage.total`；
- `balance`。

已知配方校验失败后，可进入通用推断，但不能仍声称“已识别为 sub2api”。

#### 第五步：生成映射草稿

草稿应包含：

- 端点与鉴权候选；
- 数据根；
- 账号根；
- 元素候选；
- 字段路径与值类型；
- 推断语义；
- 推断依据；
- 置信度；
- 冲突和缺失项；
- 脱敏预览。

#### 第六步：用户确认与复测

已知配方可直接进入预览；通用推断首次必须人工确认。保存后再查询一次，验证端点、字段和数值关系仍成立。

用户确认项形成 `mappingLock`。后续自动探测、配方升级和重新识别不得覆盖人工纠正。

---

## 8. 通用响应推断规则

### 8.1 字段候选只是证据之一

可识别的字段语义包括：

- balance / wallet / remaining；
- used / usage / consumed；
- limit / quota / cap / max；
- remaining / left / available；
- reset_at / resets_at / window_end；
- expires_at / current_period_end；
- day / daily、week / weekly、month / monthly；
- requests / tokens / actual_cost。

但最终判定还要结合所在节点、兄弟字段、单位和值关系。

### 8.2 结构关系校验

窗口候选至少尽量验证：

```text
used + limit + remaining 同时存在时：
used ≈ limit - remaining

0 ≤ used ≤ limit
limit > 0 才计算百分比
remaining 与 used 的方向一致
resetsAt 能解析为合法时间
单位在 used / limit / remaining 间一致
```

不能通过校验时，保留字段和诊断，不生成确定窗口。

### 8.3 不得自动猜测的情况

以下情况必须标记冲突或要求用户确认：

- 根节点同时存在 `balance` 与 `remaining`，无法区分钱包和套餐余量；
- 只有 `percent: 0.39`，无法确认是 0.39% 还是 39%；
- 只有 `usage`，无法确认是已用金额、token 数还是请求数；
- 数字时间无法确认单位；
- `expires_at` 无法区分套餐到期与窗口重置；
- 数组无法确认是账号、窗口、额度包还是历史记录；
- 多把 Key 返回相同钱包，但没有稳定用户身份；
- 额度池名称相同，但没有证据说明共享或独立。

尤其不能使用“数值小于等于 1 就当 0–1 比例”的通用规则。比例缩放必须来自配方、字段语义、结构交叉验证或用户确认。

### 8.4 单位证据优先级

建议按以下顺序：

1. 已核验配方的明确约定；
2. 响应显式 `unit` / `currency`；
3. 可靠字段后缀，例如 `_usd`；
4. 兄弟字段与结构交叉验证；
5. 用户选择。

都没有时单位保持未知。陌生接口不能默认 USD、credits 或 token。

### 8.5 置信度应可解释

不建议只显示一个不透明百分比。每个候选应给出：

- 命中了哪个已知配方或字段规则；
- 哪些结构关系成立；
- 哪些字段冲突；
- 哪些语义仍需用户选择。

已知配方完整校验可自动通过；即使通用推断得分很高，首次仍建议人工确认。

---

## 9. 人工纠正与映射编辑器

### 9.1 请求配置

用户可调整：

- 配方；
- base URL；
- 查询路径；
- 鉴权方式；
- 信封根；
- 多步请求中的非秘密参数。

提供“测试连接但不保存”，将配置保存与在线验证分开反馈。

### 9.2 数据根与账号配置

用户可选择：

- 单账号或多账号；
- 账号数组路径；
- 账号稳定 ID；
- 显示名；
- 当前账号标记；
- Key、用户、分组、席位等作用域。

不能把任意数组自动视为账号列表。缺少稳定身份时，可以保留行级独立数据，但不能参与跨刷新去重或跨 Key 合计。

### 9.3 元素映射

每个元素可配置：

- 类型：window / amount / package / plan / status / note；
- 数据路径；
- 已用、上限、剩余；
- 数值缩放；
- 单位；
- 周期；
- 重置或到期时间；
- 池 ID 与池名；
- 独立或共享预算；
- 是否允许聚合。

映射页应同时展示：

1. 脱敏字段树；
2. 当前映射；
3. 归一化诊断；
4. QuotaEntry 预览；
5. 药丸预览。

### 9.4 原始响应处理

- 原始响应只用于 Host 侧探测和本机确认页。
- 发送给 Client 前必须脱敏、限制深度和大小。
- 对 token、cookie、authorization、key、secret 等字段及其值进行遮蔽。
- 对 JWT 形态、用户输入秘密和 URL 用户信息进行额外处理。
- 默认不把原始响应持久化到配置。
- 工具查询不返回原始响应。

---

## 10. 显示规范与额度语义的边界

### 10.1 DisplayProfile 可控制

- 药丸主指标；
- 最紧窗口或指定金额；
- 元素顺序与隐藏；
- 标签覆盖；
- 小数位与紧凑格式；
- 单位显示别名；
- 每单位预警阈值；
- 多账号显示总额、代表账号或指定账号；
- 弹层默认展开程度。

### 10.2 DisplayProfile 不可控制

以下属于语义映射，不属于显示偏好：

- 一个数字是已用还是剩余；
- 0–1 与 0–100 的比例缩放；
- amount 是余额、钱包、套餐还是花费；
- 两个池是否独立；
- 一个时间是窗口重置还是套餐到期；
- 多账号是否属于同一用户；
- 不同单位是否可合计。

这一边界用于保证“调整显示”不会改变告警、覆盖率和工具报告的事实。

### 10.3 主指标回退

建议允许实例配置：

- `tightest-window`：最紧窗口；
- `element:<stable-id>`：指定额度元素；
- `account-total:<unitId>`：符合条件的账号合计；
- `account:<accountId>`：指定账号；
- `auto`：按内置保守规则回退。

当指定元素消失、单位变化或数据不完整时，显示明确降级状态，不自动换到语义不同的数字。

---

## 11. QuotaEntry 的作用域扩展建议

现有组合模型继续作为核心，建议补充主体和聚合约束：

```text
subject:
  kind: key | user | group | seat | account
  id: 稳定身份

aggregation:
  balance: allow | forbid
  reason: shared-owner | key-scoped | unknown | ...
```

### 11.1 为什么需要 subject

同一种 `amount` 在不同主体上有不同含义：

- Key 的请求数、token 和实际成本；
- 分组共享的订阅日/周/月计数；
- 用户共享的钱包；
- 企业席位预算；
- 普通账号余额。

只依靠 `linkedAccounts` 和 `pool` 无法在所有中转场景中防止重复汇总。

### 11.2 聚合原则

- 不同单位不合计。
- 不同主体不合计，除非适配器明确声明共享。
- 同一用户钱包被多把 Key 返回时，默认禁止相加。
- 缺少稳定主体身份时不跨刷新去重、不跨账号求和。
- `componentOf` 继续表示总额分项。
- `poolScope:"independent"` 继续只用于真独立预算。

### 11.3 用量指标与可用额度分离

请求数、token 数和历史消耗不是可用额度。后续可增加独立 `metric` 或 `series` 元素，不应为了复用现有类型而把它们塞入 balance 或 spend。

第一版可先不展示历史指标，但不能因此误用现有字段。

---

## 12. sub2api 首个完整适配样板

### 12.1 外部证据

本研究核对了：

- [CodexBar sub2api 接入文档](https://github.com/steipete/CodexBar/blob/main/docs/sub2api.md)：分组 API Key 通过只读 `GET /v1/usage` 查询，不需要 dashboard JWT，也不发送模型请求。
- [CodexBar sub2api 归一化实现](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/sub2api.js)：包含 `quota`、`subscription`、`rate_limits`、`balance` 和 Key 用量总数的处理。
- [dsh-sub2api-usage](https://github.com/aming1029/dsh-sub2api-usage)：提供 Key、管理员、账号和自定义请求模式，以及 JSON Pointer 字段映射与手工纠正思路。

这些资料用于设计参考，不等同于本项目已在真实 sub2api 部署验收。

### 12.2 第一版输入

- base URL；
- 分组 API Key；
- 可选显示名；
- 可选多把分组 Key；
- 可选 RouteBinding。

管理员 API、邮箱密码登录、小时趋势和完整账单不属于第一版必需范围。

### 12.3 请求规则

- 只读 `GET /v1/usage`；
- Bearer 鉴权；
- 地址末尾已有 `/v1` 时避免拼成 `/v1/v1/usage`；
- 保留用户自建子路径；
- 兼容裸对象和成功 `{code,data}` 信封；
- 查询日期和时区参数按配方需要添加，不用于伪造窗口边界。

### 12.4 归一化映射

| sub2api 响应 | 建议的 QuotaEntry 表达 |
|---|---|
| `quota.used / limit / remaining / unit` | 通用周期 window，保留实际数量，不虚构周期 |
| `subscription.daily_*` | day window |
| `subscription.weekly_*` | week window |
| `subscription.monthly_*` | month window |
| `rate_limits[]` | 5h/day/week 等窗口及 `reset_at` |
| `balance` | wallet amount，标记 user 作用域，默认禁止跨 Key 求和 |
| `planName` | plan 元素 |
| `expires_at` | 套餐到期 note，不写 `resetsAt` |
| `usage.today / total` | Key 作用域用量指标，不作为剩余额度 |

同时兼容扁平和嵌套 subscription 形态。订阅计数是否分组共享，应保留配方给出的作用域，不用 Key 级日历序列反推窗口边界。

### 12.5 多 Key 与路由绑定

- 每把 Key 独立查询、独立缓存、独立错误与额度。
- 分组订阅计数可按分组作用域共享。
- 钱包按拥有者用户作用域处理，不能因出现在多张卡上而重复合计。
- RouteBinding 可指向实例，也可进一步指向具体分组 Key。
- 未指定账户时按保守代表规则展示，不把全部 Key 的最紧窗误认为当前路由额度。

---

## 13. Magpie、反代订阅与既有联动的位置

### 13.1 Magpie

Magpie 保持 Linked/Native 复合适配：

- HTTP 读取仍由 `MagpieUsageReader` 负责；
- 卡片归一化仍使用现有专用逻辑；
- 路由遥测、当前模型归组和卡命中继续由原生代码处理；
- ConnectionInstance 只承载用户可见的启用、显示和绑定配置。

Magpie 的“HTTP + 自定义关联”不需要被通用 JSON Pointer 取代。

### 13.2 OAuth 与反代订阅

OAuth 的反代订阅主要复用 CredentialProfile 和 Native Adapter：

- 登录流程由 OAuth 登录器或所属插件负责；
- 查询适配器只消费当前有效身份；
- 续期所有权显式声明；
- 路由绑定与凭据来源保持独立。

### 13.3 OFM、EAC 与兄弟插件

这些通道继续保留：

- 多源回退顺序；
- 缺席与未登录的区别；
- 页面代取与进程内 Fetch 的边界；
- 账号 ID 和区域隔离；
- 提供方自己的登录与缓存生命周期。

平台化的目标是统一实例目录和输出，不是抹平各通道的真实差异。

---

## 14. 动态目录、路由绑定与工具查询

### 14.1 Host 动态目录

Host 应向 Client 和 Go 面板提供公开目录：

- 内置实例与自定义实例；
- 实例 ID、配方 ID、显示名；
- 启用状态；
- 可用账户；
- 凭据公开状态；
- 显示能力；
- 路由绑定；
- 配方和映射版本。

Client 不再用静态 `PROVIDER_ORDER.includes(id)` 拒绝自定义实例。

由于当前 Client 只注入 React，不能简单 import Host ESM 模块，动态目录应通过 RPC 下发，而不是跨端共享 Node 模块。

### 14.2 RouteBinding

绑定规则建议保持：

- 手动绑定优先于内置别名；
- 一个模型 provider 同时只绑定一个额度实例；
- 一个实例可绑定多个模型 provider；
- 必要时绑定到实例下的具体账户；
- 绑定不改变模型路由、查询端点或凭据来源；
- 未绑定路由继续按内置规则匹配；
- 地址相同只可作为绑定建议，不能自动证明是同一账号。

### 14.3 工具与面板

`subusage_quota`、药丸和 Go 面板应接受或解析实例 ID，同时保留现有 provider ID 和别名兼容。

工具输出只返回规范额度与公开诊断，不返回：

- 原始响应；
- 秘密；
- 凭据引用名；
- 探测草稿；
- 原始映射样例；
- 未脱敏账号信息。

---

## 15. 缓存、并发与配置版本

### 15.1 缓存身份

建议缓存键包含：

- instanceId；
- accountId / subject；
- 凭据指纹；
- base URL 与必要查询参数；
- 配方版本；
- 映射版本；
- 影响查询语义的配置。

### 15.2 不失效数据缓存的修改

以下修改只影响展示，不应作废在途额度：

- DisplayProfile；
- 路由绑定；
- 标签和排序；
- 纯显示阈值。

完整设置 revision 仍用于多窗口编辑冲突控制。

### 15.3 必须失效的修改

- base URL；
- 鉴权方式；
- 凭据；
- 账号选择；
- 请求路径或参数；
- 数据根；
- 元素映射；
- 单位、缩放、角色和池语义。

### 15.4 探测与正式查询分离

- 探测请求不写入正式额度缓存。
- 原始探测响应只短期保存于 Host 侧草稿。
- 迟到响应必须校验草稿代次与设置 revision。
- 删除实例或修改凭据后，旧响应不得复活条目。
- 强制刷新仍遵守 Retry-After、在途合并和只读约束。

---

## 16. 网络与配置安全边界

### 16.1 URL 与重定向

建议默认策略：

- 只允许 HTTP(S)；
- URL 不包含用户名、密码或 fragment；
- 默认 HTTPS；
- loopback HTTP 可用于本机部署；
- 非 loopback 内网 HTTP 需要实例级明确允许；
- 鉴权秘密只发送到用户确认的 origin；
- 重定向默认仅接受同源，不把秘密转发到跨域目标；
- 不通过配置关闭 TLS 验证。

### 16.2 请求限制

- 候选端点数量有限；
- 总探测时间和单请求超时有限；
- 响应体大小有限；
- JSON 深度、数组长度和字段数量有限；
- 429 尊重 Retry-After；
- 自定义查询只允许 GET 和配方登记的只读 POST；
- 非秘密静态头不能覆盖 Host、Content-Length 或适配器拥有的鉴权头。

### 16.3 配方导入导出

- 默认只包含配方与映射，不含秘密、引用名和用户地址。
- 导入时校验 schemaVersion、字段白名单和大小。
- 导入的声明式配方仍只能使用白名单能力。
- 第三方 Native Adapter 不能只通过 JSON 导入获得执行权限，需要独立的代码安装与信任流程。

---

## 17. 建议的内部模块划分

以下为建议目录，不是当前结构：

```text
lib/
  platform/
    registry.js             适配器注册与能力目录
    instances.js            实例解析、迁移和公开投影
    runtime.js              查询、缓存、退避、代次和取消
    catalog.js              Host → Client/Go 动态目录
    bindings.js             RouteBinding
    display-profile.js      显示配置校验与迁移

  credentials/
    resolver-chain.js       引用名和来源链
    auth-appliers.js        Bearer、x-api-key、Cookie 等
    lifecycle.js            read-only / delegate / managed

  http/
    request-plan.js         只读步骤与参数
    executor.js             超时、响应限制、同源重定向
    json-pointer.js         RFC 6901 与 UI 路径转换
    transforms.js           白名单转换

  detection/
    detector.js             探测状态机
    recipes.js              已知端点与结构签名
    inference.js            通用字段候选和冲突
    sanitize-preview.js     原始响应脱敏

  adapters/
    declarative/
      sub2api.js
      litellm.js
    native/
      ...
    linked/
      ...

  quota-entry.js            继续作为统一 wire 契约
  client.js                 动态实例设置、药丸和映射向导
```

现有 `lib/index.js` 最终应主要负责组合服务、RPC 和生命周期，不再承载所有 provider 的请求细节。

---

## 18. 现有实现的迁移映射

| 当前结构 | 目标位置 | 迁移原则 |
|---|---|---|
| `PROVIDERS` | 内置 AdapterRecipe 与默认实例描述 | 保留现有 ID 和默认开关 |
| `identity()` | CredentialProfile 与 Resolver Chain | 先抽公共链，再迁移特殊来源 |
| `fetchProvider()` | Native / Declarative Adapter | 简单服务优先迁出，复杂服务保留原生 |
| `LINKED_PROVIDERS` | Linked Adapter 描述 | 保留通道、回退和缺席语义 |
| `PROVIDER_META / PROVIDER_ORDER` | Host 动态目录与 Client locale | 不再要求自定义 ID 进入静态表 |
| `ROUTE_PROVIDER_ALIAS` | 内置 RouteBinding | 与手动绑定使用同一解析入口 |
| CookieLogin / OAuth / 登录文件 | Credential Lifecycle 与 Resolver | 续期所有权不变 |
| MagpieUsageReader | Linked/Native Adapter | 保留专用归一化和路由归属 |
| QuotaEntry | 统一输出，按需增加 subject / aggregation | 不推翻现有元素模型 |
| 手动 providerMappings | RouteBinding | 支持实例及可选账户目标 |

---

## 19. 分阶段实施计划

### 阶段 0：建立平台边界，保持行为不变

工作内容：

- 建立 AdapterRegistry、ConnectionInstance 和 CredentialProfile 基础模型。
- 将现有静态 provider 包装为内置实例描述。
- 增加 Host 动态目录 RPC。
- 抽取公共 RequestExecutor、缓存身份和秘密净化。
- 保持现有 QuotaEntry、药丸、RPC 和工具兼容。

验收：

- 现有全量回归通过。
- 用户可见行为不变。
- 内置实例与原有 ID 的映射稳定。

### 阶段 1：声明式运行时与 sub2api

工作内容：

- 实现 JSON Pointer、白名单转换、RequestPlan 和归一化管线。
- 完成 sub2api 地址、Key、响应和多分组 Key 支持。
- 增加 subject 与禁止聚合语义。
- 将 LiteLLM 作为第二个迁移样板，验证私人部署兼容。

验收：

- 新增 sub2api 不需要修改 Client 或 Host 分支。
- 多 Key 钱包不重复合计。
- `/v1` 拼接、信封、嵌套响应和部分失败有回归覆盖。

### 阶段 2：自动探测与人工纠正

工作内容：

- 已知配方识别；
- 通用结构推断；
- 映射确认页；
- DisplayProfile；
- 映射锁定、复测、编辑和克隆；
- 脱敏原始响应预览。

验收：

- 一个未内置的 JSON 额度接口可完全通过界面接入。
- 通用推断不会在首次未经确认时直接生成正式余额或窗口。
- 用户纠正在重新探测后仍保留。

### 阶段 3：统一登录与迁移既有 provider

工作内容：

- CookieLogin、OAuth、共享文件和宿主服务纳入 CredentialProfile。
- 普通 provider 分批迁出 `fetchProvider()`。
- 复杂 provider 包装为 Native Adapter。
- 支持脱敏配方导入导出。

验收：

- 各既有登录和续期所有权不变。
- 既有凭据解析优先级和路由行为不回归。
- 自定义实例与内置实例共享相同目录和查询管线。

### 阶段 4：扩展生态

可选工作：

- OpenAPI 辅助发现候选 GET 端点；
- new-api / one-api 等更多配方；
- 历史趋势、请求数、token 指标；
- 社区配方包；
- 经独立信任流程的第三方 Native Adapter。

这些不是第一版自动探测的前置条件。

---

## 20. 测试与验收矩阵

### 20.1 适配器契约

- 配方配置校验与版本迁移；
- Declarative 与 Native 输出一致进入 canonicalizeEntry；
- 未知字段、非法枚举、NaN、Infinity、-0 和嵌套 undefined 不破坏 wire；
- 公共目录和工具输出不含秘密。

### 20.2 自动探测

- 401、403、404、429、5xx、超时、TLS、非 JSON；
- 业务信封非零；
- `/v1/v1/usage` 防重；
- 保留自建子路径；
- 跨域重定向不泄漏秘密；
- 响应大小和候选数量限制；
- 迟到响应不覆盖新草稿；
- 原始预览脱敏。

### 20.3 通用推断

正例：

- used / limit / remaining 一致；
- 显式 USD、token、credits；
- 日/周/月窗口；
- 账号数组有稳定 ID；
- 额度包和窗口可区分。

反例：

- balance 与 remaining 歧义；
- 0.39 比例歧义；
- expires_at 与 reset_at 混淆；
- 历史数组被误认为账号；
- 同名池被误认为独立或共享；
- 同钱包多 Key 被重复合计。

### 20.4 sub2api

- 裸响应与信封；
- 扁平和嵌套 subscription；
- quota、rate_limits、wallet、plan、expiry；
- 多分组 Key 独立缓存；
- Key 用量与用户钱包作用域；
- 指定路由到指定分组 Key；
- 部分端点失败与旧数据保留。

### 20.5 显示与路由

- DisplayProfile 修改不作废额度缓存；
- 指定元素消失时明确降级；
- 单位变化不沿用旧标签或阈值；
- 多路由绑定、重复绑定拒绝和关闭恢复；
- 药丸、设置页、Go 面板与工具选择同一实例和账户；
- 新增形态纳入弹层密度回归。

### 20.6 真实验收与隔离验收分开

至少需要分别记录：

- 桩响应与纯函数测试；
- 离线浏览器组件检查；
- 一个真实 sub2api 部署；
- 一个真实 LiteLLM 或私人部署；
- DSH 设置页、药丸、Go 面板和工具端到端检查。

桩测试不得表述为真实部署兼容证明。

---

## 21. 风险与缓解措施

| 风险 | 后果 | 缓解 |
|---|---|---|
| 通用字段猜测错误 | 错报余额、比例或额度耗尽 | 首次人工确认、结构校验、映射锁定 |
| 自定义请求能力过宽 | SSRF、秘密泄漏或意外写操作 | 同源限制、只读方法、白名单转换、秘密隔离 |
| 多 Key 重复汇总 | 钱包或订阅额度虚高 | subject 与 aggregation 约束 |
| 所有 provider 强行声明式化 | 丢失复杂语义、回归面扩大 | Native / Declarative / Linked 并存 |
| 动态目录迁移不彻底 | 设置可见但药丸或 Go 面板不可见 | Host 单一目录、双端契约测试 |
| 探测覆盖用户配置 | 人工纠正失效 | mappingLock、配置版本和迁移测试 |
| 原始响应进入工具 | 账号或秘密泄漏 | Host 脱敏预览、工具白名单输出 |
| 一次性大重写 | 既有 31 条入口和联动回归 | 增量迁移、每阶段保持现有行为 |
| 显示配置改变语义 | 告警和工具结论不一致 | 显示与归一化严格分层 |

---

## 22. 推荐默认决策

后续进入实施时，建议采用以下默认值：

1. **通用推断首次必须确认；已知配方可以自动通过。**
2. **不执行用户 JavaScript，只提供声明式白名单能力。**
3. **普通自定义额度刷新只允许 GET；只读 POST 由配方明确声明。**
4. **默认 HTTPS，loopback HTTP 直接支持，其他明文内网地址逐实例确认。**
5. **多 Key 钱包默认不合计，只有稳定主体和明确规则允许合计。**
6. **用户映射优先于自动识别，配方升级不得静默覆盖。**
7. **复杂 provider 永久允许保留 Native Adapter，不以“全部 JSON 化”为验收目标。**
8. **先完成 sub2api 闭环，再扩展 new-api / one-api 等更多协议。**
9. **DisplayProfile 永远不改变额度事实。**
10. **每阶段都可独立交付，不进行一次性全仓重写。**

---

## 23. 最终建议

最合适的演进方向不是“再抽几个 helper”，也不是“写一个万能字段识别器”，而是建立三层平台能力：

1. **实例层**：每个用户额度来源都是独立、可绑定、可配置的 ConnectionInstance。
2. **适配层**：Native、Declarative、Linked 三类适配器共享统一运行时，复杂与简单服务各取所需。
3. **认知层**：已知配方自动识别，陌生结构生成可解释候选，用户确认后成为稳定映射。

QuotaEntry 继续负责统一输出，药丸、Go 面板和工具继续共享渲染语义。自动探测只负责降低首次接入成本，人工映射负责最终语义确认，DisplayProfile 负责个性化展示。

按这一方向实施：

- 主流订阅不会被破坏；
- OAuth、Magpie 和兄弟插件不必重写；
- sub2api 可以快速形成首个完整样板；
- 陌生私人部署能从“必须改源码”降为“界面配置与确认”；
- 项目才真正从一组 provider 适配代码，演进为通用额度查询与药丸显示平台。

---

## 24. 参考资料

### 项目内资料

- [QuotaEntry 统一契约](quota-entry.md)
- [开发与验证说明](development.md)
- [提供商清单与额度语义](providers.md)
- [UX 设计](design-ux.md)
- [Host 当前实现](../lib/index.js)
- [QuotaEntry 当前实现](../lib/quota-entry.js)
- [Magpie 当前实现](../lib/magpie-usage.js)
- [本机直取当前实现](../lib/local-usage.js)

### 外部资料

- [CodexBar：sub2api 接入文档](https://github.com/steipete/CodexBar/blob/main/docs/sub2api.md)
- [CodexBar：sub2api JavaScript 归一化实现](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/sub2api.js)
- [CodexBar：JavaScript provider-plugin 设计原型](https://github.com/steipete/CodexBar/blob/main/docs/plugin-prototype.md)
- [dsh-sub2api-usage：自定义请求与 JSON Pointer 方案](https://github.com/aming1029/dsh-sub2api-usage)

### 研究限制

本报告基于当前工作区源码、项目文档和上述外部公开实现。研究过程中未修改运行环境，未安装依赖，未调用真实 sub2api 或私人部署，也未进行真实账号、GUI 或端到端验收。外部接口形状用于方案设计，实施时仍需以目标部署版本和隔离回归为准。
