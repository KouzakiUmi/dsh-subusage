# 凭据获取指引

这份文档只解决一类问题：**界面显示「无凭据 / 未检测到 Key」，或者填了却不生效。**

每种凭据都给出三条路：**去官网哪里拿**、**放哪个环境变量**、**在界面哪里填**。三者任选其一即可（优先级见下），不需要同时做。

---

## 先分清两类凭据（最常见的误解）

| | 推理 Key | 额度凭据 |
|---|---|---|
| 干什么用 | 调用模型，由**提供方插件/CLI**使用 | 查询订阅额度，由**本插件**使用 |
| 谁管理 | 提供方插件、`arkcli`、`codex login` 等 | 本插件（设置页 / 凭据服务 / 环境变量） |
| 长什么样 | `sk-…`、`tp-…`、`ark-…` | API Key；**火山是 IAM AK/SK 一对**；MiMo 是平台 Cookie |

**这两类不能互相替代。** 最典型的坑是拿火山方舟的推理 Key 去填额度查询——它一定失败，上游会明确回一句 `GetAFPUsage requires Volcengine Ark SSO STS`。原因见下面的火山小节。

---

## 配置优先级

同一份凭据可以有多个来源，插件按这个顺序取**第一个命中的**：

1. **凭据服务**（DSH 的凭据存储）
2. **启动环境变量**（DSH 进程启动时的环境快照，**改了要重启 DSH**）
3. **界面手动填写**（设置 → 订阅用量 → 对应卡片 → 连接与凭据）

所以只要 1 或 2 里有一份能用的，界面里就不用再填。

---

## 一、火山方舟（最容易卡住的一家）

火山方舟的 **7 条路由共用同一组 IAM AK/SK**，填一次即可。

### 为什么不能用推理 Key

套餐额度只在**管控面 OpenAPI** 上暴露，鉴权是 IAM Access Key 的 HMAC-SHA256 签名。而路由上那个 `ARKCLI_*_API_KEY` 是**数据面**凭证，只授权调用模型——拿它去查额度会被上游拒绝。

### 去哪拿

1. 登录火山引擎控制台 <https://console.volcengine.com/>
2. 点**右上角头像** → 下拉菜单里的「**API访问密钥**」（直达 <https://console.volcengine.com/iam/keymanage>）
3. 点「**新建密钥**」

⚠️ **同一个页面上有「Access Key」和「API Key」两类凭证**，要的是 **Access Key**（也就是 AK/SK 这一对）。API Key 那类是数据面用的，正是你已有的推理 Key。

⚠️ **Secret Access Key 只在创建时显示一次**，关掉页面就再也看不到，当场复制或下载 CSV。

### 用子用户跑：创建与授权的完整清单（推荐）

官方推荐的做法是用子用户而不是主账号密钥。如果你还没有可用的子用户，按下面顺序建一遍即可。

**第 0 步的前提**：创建身份本身就需要权限——用**主账号**，或一个挂了 IAM 管理权限的子账号（官方口径：关联了 `AdministratorAccess` 之类的 IAM 管理员权限）。另外，账号需完成实名认证。

| 步骤 | 在哪做 | 关键勾选 |
|---|---|---|
| 1. 创建子用户 | 访问控制 → **用户** → 新建用户 → 通过用户名创建 | 登录设置里勾 **编程访问**（这是 AK/SK 的前提，不勾就没有密钥） |
| 2. 创建 AK/SK | 用户详情 → **密钥** → 新建密钥 | SK 只显示一次，当场保存 |
| 3. **授予额度读取权限（本插件唯一必需的）** | 用户 → **添加权限** | 策略选 **`ArkReadOnlyAccess`**，「限制到项目资源」选 **否** |
| 4. 让子用户自己管密钥（可选） | 同上的权限页 | `AccessKeySelfManageAccess` —— 仅能管理**自己**的密钥 |
| 5. 让管理员代管全部密钥（可选） | 同上的权限页 | `AccessKeyFullAccess` —— 可管理**该账号下全部** IAM 用户的密钥 |

**只有第 3 步是这个功能需要的**；4 / 5 是给密钥轮换与日常运维准备的。**不要**为了让额度显示出来去挂 `ArkFullAccess`——那是方舟的完整读写权限，远超所需。

三个官方点名的坑：

- **「限制到项目资源」必须选「否」**。选了「是」并限定项目后，若套餐资源不在那个项目里，就会一直 `AccessDenied`；
- **只给了 `ArkExperienceAccess`（体验权限）读不了额度**，必须是 `ArkReadOnlyAccess` 或更高；
- **主账号买了套餐，子用户默认仍然没有权限**——套餐不会自动分配给子用户，必须按上面第 3 步单独授权。

如果已经挂了 `ArkReadOnlyAccess` 却仍报 `AccessDenied`，按方舟官方 FAQ 的次序查：**大概率是这条策略被做了项目隔离**——改成不限项目，或把套餐所在项目一并授权。

> 依据：[使用 IAM 管理权限](https://ark.volcengine.com/region:cn-beijing/docs/use-iam-to-manage-permissions#preset-policies)（预设策略说明）、[为子用户授予 API 访问密钥管理权限](https://docs.volcengine.com/docs/IAM/GrantuserAPIkeymanagementpermissions?lang=zh)（三种 `AccessKey*` 策略的区别）、[方舟常见问题](https://ark.volcengine.com/region:cn-beijing/docs/modelark-faq#c610a875)（`ArkReadOnlyAccess` 与项目隔离的处置）。

### 放环境变量

```powershell
[Environment]::SetEnvironmentVariable("VOLC_ACCESSKEY", "<你的 AccessKey ID>", "User")
[Environment]::SetEnvironmentVariable("VOLC_SECRETKEY", "<你的 Secret AccessKey>", "User")
```

设完**重启 DSH**（启动环境是进程启动时的快照，刷新页面不算）。

### 在界面填

设置 → 订阅用量 → 提供商管理 → **ARK Plan** 卡片 → 展开「连接与凭据」→ 点「**手动 AK/SK**」→ 填两个框 → **点「保存设置」**。

⚠️ 注意这个页面里两种保存方式不一样：**提供商开关是立即保存**（点一下就生效），而**凭据必须点「保存设置」**才提交。填完不点保存，值只在输入框里。

---

## 二、小米 MiMo（订阅制，用 Cookie）

MiMo 的 Token Plan 用量挂在**平台会话**上，所以用的是 Cookie 而不是 API Key。

### 自动登录（推荐）

设置 → 订阅用量 → 提供商管理 → **MiMo** 卡片 → 「**登录并自动导入**」。

插件会打开一个浏览器窗口，直接落在**控制台的套餐管理页**（`platform.xiaomimimo.com/console/plan-manage`）——该页会自动触发小米账号登录。用小米账号登录后，浏览器会自动关闭并保存 Cookie。

> 登录窗口里请**自行完成登录**：插件不接管你的账号密码，只在你登录成功后读取会话 Cookie。

### 手动导入

如果自动登录不可用，也可以自己复制：

1. 浏览器打开 <https://platform.xiaomimimo.com/console/plan-manage> 并登录
2. 打开开发者工具 → Network → 任意请求 → 复制完整 `Cookie` 请求头
3. 粘进 MiMo 卡片的 Cookie 输入框 → 保存

Cookie 必须**同时包含** `api-platform_serviceToken` 与 `userId`，否则会被拒绝（这是脚本自身要求的两个字段）。

### 有效期

会话 Cookie 自签发起按 **24 小时**计。临近到期时药丸和设置页都会提醒，重新登录即可。**Cookie 不走环境变量**。

---

## 三、其余提供商一览

大部分提供商只需要一把 API Key，形态是「凭据服务里的引用名」或同名环境变量。

| 提供商 | 环境变量 | 去哪拿 |
|---|---|---|
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek 开放平台 → API Keys（与推理同一把） |
| Z.ai（中国） | `ZAI_CODING_CN_API_KEY` | 智谱开放平台 → API Keys；团队档另需组织 / 项目 ID |
| Z.ai（国际） | `ZAI_CODING_API_KEY` | Z.ai 平台 → API Keys |
| Kimi | `KIMI_CODING_API_KEY` | Kimi 开放平台 → API Keys |
| OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go 控制台 |
| MiniMax（中国 / 国际） | `MINIMAX_CN_API_KEY` / `MINIMAX_API_KEY` | MiniMax 开放平台 |
| Codex（ChatGPT 订阅） | 无环境变量 | 运行 `codex login`；本插件只读 `~/.codex/auth.json`，不保存凭据 |
| SuperGrok | 无环境变量 | 运行 `grok login`；本插件只读 `~/.grok/auth.json` |
| Command Code | `COMMANDCODE_API_KEY` | 由 Command Code 提供方插件管理，本插件只读 |
| SiliconFlow | `SILICONFLOW_API_KEY` | SiliconFlow 控制台 → API 密钥 |
| OpenRouter | `OPENROUTER_API_KEY` | OpenRouter → Keys（查余额还需 management / provisioning key） |
| Novita AI | `NOVITA_API_KEY` | Novita 控制台 |
| Hyperbolic | `HYPERBOLIC_API_KEY` | Hyperbolic 控制台 |
| DeepInfra | `DEEPINFRA_API_KEY` | DeepInfra → API Keys |
| Chutes | `CHUTES_API_KEY` | Chutes 控制台 |
| Ollama Cloud | `OLLAMA_API_KEY` | ollama.com → Settings → Keys |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | Vercel 控制台 |
| ZenMux | `ZENMUX_MANAGEMENT_API_KEY` | ZenMux → **Management API Key**（不是推理 Key） |
| NanoGPT | `NANOGPT_API_KEY` | NanoGPT 控制台 |
| Synthetic | `SYNTHETIC_API_KEY` | Synthetic 控制台 |
| LiteLLM | `LITELLM_API_KEY` | **你自建的网关**：虚拟 Key + 在设置页填 proxy 地址 |

---

## 四、环境变量怎么设（Windows）

用户级环境变量（推荐，只影响你自己的账号）：

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "<key>", "User")
```

设完**必须重启 DSH**：插件读的是 DSH 进程启动时的环境快照，刷新页面不会重新读取。

查看当前是否已生效：

```powershell
[Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY")   # 空 = 没设
```

---

## 五、常见报错对照

| 界面提示 / 现象 | 原因与处理 |
|---|---|
| 未配置火山方舟 AK/SK | 三处都没有 AK/SK。按上面第一节配；注意要 **Access Key** 而不是 API Key。 |
| 提示已保存，但仍是「无凭据」 | 凭据编辑需要点「**保存设置**」；开关才是立即保存。 |
| `AccessDenied` / `OperationDenied` | 权限不足：子用户挂 `ArkReadOnlyAccess`，且不限制到项目（见第一节）。 |
| `SignatureDoesNotMatch` / `InvalidAccessKey` | AK/SK 本身有问题：填错、AK 与 SK 不是同一个用户，或复制时被截断。 |
| `GetAFPUsage requires Volcengine Ark SSO STS` | 用了推理 Key 去查额度。换 IAM AK/SK。 |
| 「订阅检测已关闭」 | 该提供商的**开关**是关的，去提供商管理里打开。 |
| 「本机没装这条路由」 | 本机没有任何提供方插件/CLI 注册这个 provider id，开了也读不到——多半是另一个安装方式的同名路由（例如旧插件的 `ark-agent-plan-cn`）。 |
| MiMo 显示「需要登录」/ 临近到期 | 重新走「登录并自动导入」；Cookie 24 小时有效。 |
| 填了值却提示包含非法字符 | 已改为自动剔除换行 / 制表 / 零宽字符；若仍出现，请附上报错原文。 |

---

## 六、还想知道为什么

- 各家的**额度语义、窗口含义与单位换算**：[providers.md](providers.md)
- 哪些厂商评估过但**不接入**、理由是什么：[provider-coverage.md](provider-coverage.md)
- 插件的**开发与验证约定**：[development.md](development.md)
