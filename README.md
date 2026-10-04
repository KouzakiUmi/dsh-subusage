# dsh-subusage —— DeepSeek Harness 订阅用量显示

在模型选择器旁显示当前模型商的订阅余量；点开药丸看用量、重置时间和套餐详情。支持 **Z.ai Coding CN / Kimi Coding / Xiaomi MiMo / OpenCode Go / Command Code / MiniMax（国际与中国）**。

## 0.6.0：提供商管理与默认隐藏

- 设置 → 订阅用量底部新增默认折叠的「提供商管理」：七个提供商/区域独立开启或关闭，立即持久化；关闭后隐藏用量标签与药丸，停止订阅用量请求，不删除凭据、不修改模型路由。
- 新增「没有检测到API的默认隐藏」开关，默认开启。按实际 Key / MiMo Cookie 是否存在判断，不以模型路由是否注册或接口是否成功判断；认证失败、网络错误仍展示异常。
- 管理区始终列出全部提供商：每家开关与「连接与凭据」在同一卡片，就地展开编辑；MiMo 为「登录与凭据」，Command Code 为只读凭据来源。移除跨区域「配置」跳转，隐藏/关闭条目仍可就地编辑。
- 上方只显示用量，查看用量与正在编辑的提供商独立，切换用量不丢失草稿；保存结果和错误在管理区就地反馈。关闭自动隐藏后，无凭据条目恢复指引，手工关闭的提供商不会被自动重新开启。
- 开关保存与凭据保存互相隔离，脏草稿期间锁定开关，多窗口使用 revision 防止覆盖；仅改变默认隐藏不清除 Host 用量缓存。
- 所有导航与套餐选择改为按钮，窄屏自然换行，整个设置页不使用下拉列表。
- **Host 与 Client 必须一起加载新版**。本地 link 安装直接指向工作区；磁盘更新不代表正在运行的 Host/Client 已重载，必要时重启 DSH。在线账号与真实应用界面仍需验收。

## 0.5.0：MiniMax 订阅检测

- 新增 `minimax` / `minimax-cn`，分别继承 `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`，也可在设置中保存独立的订阅 Key。区域之间不自动尝试或转发 Key。
- 直连对应区域的 `/v1/token_plan/remains`，只显示 `general` 或旧版 `MiniMax-M*` 编程池，忽略视频/图像池，不累加共享额度。
- 显示短周期和周已用百分比及重置时间；优先采用 `remaining_percent`，计数明细按[官方 CLI 消歧规则](https://github.com/MiniMax-AI/cli/blob/main/src/utils/quota.ts)校准，无法匹配时只显示百分比。旧版无百分比响应按剩余计数解释。
- 无上限、未报告或零总计且无百分比的窗口不绘制，标记部分数据；没有可绘制窗口时额度未知。不推断套餐名称，周加量不折算额外百分比。
- 设置导航扩展为七个区域条目，内部宽度 ≤699px 时切换选择框。
- **Host 与 Client 必须一起更新**；未执行在线账号验收或安装。接口参考：[官方 Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq)、[官方 CLI 端点](https://github.com/MiniMax-AI/cli/blob/main/src/client/endpoints.ts)。

## 0.4.1：补齐 Command Code 月额度

- 显示月额度剩余，并按已知套餐总额计算月已用百分比和已用/上限；例如 GOAT 总额 70、剩余 55.86，显示已用 14.14 / 70（20.2%）。
- 套餐及账期来自 `/alpha/billing/subscriptions`，失败时可回退 credits 内的 planId；没有账期时不编造重置日期。
- 月总额是[提供方插件套餐表](https://github.com/Mars-Sea/dsh-commandcode-provider/blob/main/src/capabilities.ts)的快照，不是计费接口直接报告的硬上限；未知套餐只显示剩余金额并标记部分数据。套餐变更后需核对更新。
- 月余额不包含已购/赠送余额；月池耗尽不据此连坐周/5小时窗口。
- 修复非法重置日期导致整包失败，以及旧配置中的 Command Code 手动 Key 绕过托管凭据来源的问题。
- 修复 MiMo 普通刷新/缓存中的接口 Cookie 回显；脱敏正确处理分号后空格和带引号的值。
- 修复 Netscape Cookie 导入：兼容注释、`#HttpOnly_` 域前缀及 TAB 末列空值，仍严格过滤外域。
- MiMo 登录只锁定本厂商的手动导入/清除，不再阻止其他厂商更换 Key，也不产生实际未执行的待清除提示。

## 0.4.0：Command Code 用量显示

- **支持 Command Code**：该路由由另一个插件 [`@mars-sea/dsh-commandcode-provider`](https://github.com/Mars-Sea/dsh-commandcode-provider) 注册；本插件显示其 5 小时 / 每周 / 月额度池、重置时间、套餐（planId）、月剩余与已购 + 赠送余额，周窗用尽会连坐 5 小时窗口。
- **快速直连刷新**：不消费提供方插件的用量服务（它按账户逐个串行多端点、超时预算长，作为药丸来源太慢），改为自读同一凭据后并行直连 `/alpha/billing/credits` 和 `/alpha/billing/subscriptions`（各 10 秒超时）；不读取请求统计、不串行遍历账户。
- **同一凭据来源**：凭据服务 `COMMANDCODE_API_KEY` → 启动环境 → `~/.commandcode/auth.json`（`cmd login` 写入，解析方式与提供方插件一致）。本插件**不保存** Command Code 凭据；Key、登录与多账户在 设置 → Command Code 管理。
- **已知限制**：多账户轮换或固定 `activeAccount` 时显示默认（顶层 Key）账户的额度，可能与实际服务账户不同；提供方插件里自定义 `apiBase` 不会被跟随。
- **五等宽导航**：设置页厂商导航改为五等宽单行，窄内容区（≤499px）切换为选择框。

**两端必须同时更新**：旧 Host 会拒绝含 `commandcode` 的刷新请求。

## 0.3.0：按钮式凭据与 MiMo 自动登录

- **凭据按钮**：默认只展示当前来源；通过「更换 / 清除」进入编辑，再保存或取消，不再使用「保持 / 替换 / 清除」下拉菜单。
- **自动登录导入**：点击「登录并自动导入」，使用隔离的临时 Chrome 窗口完成官方登录，由 Host 验证并保存必需 Cookie。
- **原生菜单对比度**：剩余套餐/provider 选项显式配对系统前景和背景，避免深色界面出现白底白字。

### 延续的设置与可靠性改进

- **五等宽导航**：`Z.ai / Kimi / MiMo / OpenCode Go / Command` 单行显示，窄内容区改成选择框，不出现换行。
- **用量为主**：凭据与帮助折叠；顶部提供刷新当前/全部，保存按钮仅出现在编辑区。
- **共享刷新**：按厂商缓存与合并在途请求，药丸和设置页共享结果，活跃厂商每分钟检查更新。
- **两条状态轴**：数据获取成功不等于额度可用；额度不足、认证失效、缓存和部分数据均有独立说明。
- **准确限额**：原始比例决定是否限流，不把 99.5% 提前当作 100%；较长周期限额才向内层窗口连坐。
- **凭据来源**：可选择继承或自定义；读取结果不再回传完整 Key/Cookie。
- **编辑保护**：按厂商增量保存，未保存编辑不被刷新覆盖；配置版本检查防止多窗口旧表单覆盖新配置。
- **MiMo Cookie 验证**：支持标准串、多行 KV、成对 name/value、TAB 清单和 JSON 导出；解析失败保留原文，不再失焦自动破坏输入。

详细界面约定见 [设计说明](docs/design-ux.md)，维护注意事项见 [开发说明](docs/development.md)。

## 使用

### 药丸

选中已开启且未被默认隐藏的模型商时显示，例如 `✓ 余 87%`、`⚠ 7d 余 12%`、`✕ 7d 已达限额`。多窗口取最差一窗，点击看完整详情。关闭默认隐藏后，缺凭据时显示配置指引；可保留的临时网络错误会明确标注缓存，而非冒充当前成功。

### 设置

设置 → **订阅用量**：

1. 在「提供商管理」逐家开启/关闭，按需切换「没有检测到API的默认隐藏」；开关即时保存。
2. 上方按钮标签仅切换用量视图，窄屏自动换行；查看百分比、额度明细、重置时间与套餐。
3. 展开底部「提供商管理」，在目标厂商卡片展开「连接与凭据」，无需跳转即可编辑隐藏或关闭的厂商。
4. 更改来源、替换或清除凭据；MiMo 登录与 Cookie 导入也在本行完成。切换用量不影响编辑，切换另一家编辑器须先保存或取消，空输入不会清除原值。
5. 凭据保存先确认持久化，再独立验证。检测关闭的厂商只保存凭据，不发起用量验证；验证失败不意味着保存失败。

顶部 `X/Y 家数据获取成功` 仅表示接口读取健康度。厂商图标/颜色表达额度与异常情况；例如读取成功后仍可能显示「已达限额」。未获取额度的部分数据不能视为可用。

### 凭据与环境

| 模型商 | 默认继承变量 | 说明 |
|---|---|---|
| Z.ai | `ZAI_CODING_CN_API_KEY` | 团队套餐另填组织、项目 ID |
| Kimi | `KIMI_CODING_API_KEY` | 需要 Kimi Coding Key，不是 Moonshot 开平台 Key |
| MiMo | 不使用 API Key | 通过控制台 Cookie 会话读取 |
| OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go Key |
| MiniMax 国际 | `MINIMAX_API_KEY` | `minimax` 路由；国际站订阅 Key |
| MiniMax 中国 | `MINIMAX_CN_API_KEY` | `minimax-cn` 路由；中国站订阅 Key |
| Command Code | `COMMANDCODE_API_KEY` | 凭据由提供方插件管理，本页只读继承；也兜底读取 `~/.commandcode/auth.json`（`cmd login`） |

Z.ai / Kimi / OpenCode Go / MiniMax 的继承模式按凭据服务 → 启动环境 → 旧手动配置兜底解析；自定义模式仅使用保存的手动 Key。Command Code 仅沿用提供方凭据来源链，不接受本插件的手动 Key；MiMo 仅使用 Cookie。界面区分凭据服务、启动环境和自定义来源。修改启动环境后是否需要重启取决于目标部署，不能把用户环境即时变化当作已经被运行进程读到。

### MiMo 登录与 Cookie

推荐使用 MiMo「连接与凭据」中的 **登录并自动导入**：

1. 先保存或取消当前编辑，再开始登录。
2. 插件调用 `playwright-core`，打开**独立临时 Chrome 会话**的官方平台；密码、验证码由你在官方页面自行输入，插件不读取这些字段，也不读取日常 Chrome 配置。
3. Host 从该会话获取适用于官方 API 的 `api-platform_serviceToken` 和 `userId`（包括 HttpOnly Cookie），先验证账户接口，再保存并更新用量；Cookie 不通过 RPC 返回页面。
4. 可随时取消或关闭登录窗口；五分钟未完成会超时并关闭。取消、认证失败、网络验证未完成或同一 MiMo 配置已被外部修改时不覆盖凭据。
5. 账户验证成功但无订阅额度时可以保存登录，界面明确显示「额度未知」，不冒充有额度。

需要已安装 **Google Chrome**。新增依赖仅 `playwright-core`，不下载浏览器；缺少 Chrome 时显示错误。当前实现针对 Host 所在机器的可见浏览器，远程/无桌面环境请使用手动导入；真正账号登录与平台接口仍需由用户验收。

备用 **手动导入**：打开 <https://platform.xiaomimimo.com> 自行登录，从 DevTools → Application → Cookies 获取 Name/Value 或导出 JSON，再粘贴并保存。必须包含上述两个字段。导入错误会显示原因并保留原文，认证过期时重新登录。界面的「仅打开官网」链接不会自动导入日常浏览器的 Cookie。

JSON 中有域名的条目按 `platform.xiaomimimo.com` 的 Cookie 域规则过滤，无关站点的 Cookie 不导入。TAB 清单只读取 Name/Value，不把 Domain/Path 混入值；Netscape 导出支持注释和 `#HttpOnly_` 域前缀，并保留可选 Cookie 的空值（两个必需字段仍须非空）。

**安全说明**：Key/Cookie 不再通过用量读取接口回传，界面不回填已保存的秘密；但本版仍兼容原本机 JSON 配置存储，**不是加密凭据库**。该配置位于 `~/.dsh/dsh-subusage.json`，新建目录/临时文件在 POSIX 上按 `0700`/`0600` 创建，替换前再次收紧文件权限；Windows 的实际访问权限仍取决于目录 ACL，`chmod` 不能替代 ACL 或加密库。请勿上传、分享或写入日志。隔离浏览器仅用于你主动发起的官方登录；它不是后台扫描或导入日常浏览器全部凭据的工具。加密凭据存储通道仍未实施。

## 支持的数据

| 模型商 | 窗口 | 明细 |
|---|---|---|
| Z.ai | 5 小时、每周 | 已用/总计 Credits、套餐档 |
| Kimi | 5 小时、7 天 | 已用百分比、套餐档 |
| MiMo | 本周期额度池 | 用量明细、重置时间、套餐与余额 |
| OpenCode Go | 滚动、每周、每月 | 已用百分比、重置时间 |
| MiniMax 国际 / 中国 | 短周期（通常 5 小时）、每周 | 通用/编程池已用百分比、可信计数明细、重置时间 |
| Command Code | 5 小时、每周、月额度池 | 已用/上限（月总额为套餐快照）、重置/账期、套餐（planId）、月剩余、已购 + 赠送余额 |

非公开控制台接口可能变更；缺失或非法百分比不会当作零用量。部分数据、未知额度和暂时失败有明确状态，不能据此保证推理接口一定可用。

## 安装与生效

目标核心版本：**DeepSeek Harness `0.2.0-rc.2`**。插件声明精确 peer 版本；其它版本需重新核验 API 与兼容性。

```console
git clone https://github.com/KouzakiUmi/dsh-subusage.git
cd dsh-subusage
```

通过目标部署支持的官方插件管理/CLI 流程将工作区 bundle 安装并启用。不要直接修改核心或 ASAR；本地链接的解析方式、profile 层覆盖与重载行为应按目标环境确认。

**0.3.0 新增登录 RPC 和 `playwright-core` 依赖，必须让 Host/Client 及依赖一起更新。0.4.0 新增 Command Code 条目，同样要求两端一起更新（旧 Host 不识别 `commandcode`）。** 仅刷新页面不能升级正在运行的旧 Host。安装、重载或重启需要用户另行授权；仓库测试通过不代表运行中的插件已生效。

## 自动发布

推送或合并到 `main` 后，GitHub Actions 自动运行回归、清单/语法及打包检查，通过后发布当前提交的 GitHub Release。PR 只测试，不发布；不用手动打 tag，也不发布到 npm。

每个提交使用独立的 `build-<SHA>` 标签，安装包内仍保留当前项目版本。固定下载：[最新安装包](<https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz>)。发布不会自动安装或重启插件，详见 [发布说明](<docs/publish.md>)。

## 开发与测试

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
```

Host 私有 Remote：

- `read()`：初始化获取七个厂商/区域条目，使用每条目缓存。
- `refresh({ providerIds, force })`：按厂商刷新，结果条目由客户端合并。
- `save(settings)`：按厂商 patch 保存；读取/保存结果只含公开配置和凭据存在性。
- `startMimoLogin({ expectedRevision })`：立即返回任务状态，后台等待官方登录，不阻塞 RPC。
- `getMimoLoginStatus()`：轮询状态，成功结果只含公开配置和用量；账号变更后旧成功结果失效。
- `cancelMimoLogin({ jobId })`：只取消匹配的任务，阻止迟到验证保存。

可选的本机 Chrome 验收：使用 [离线预览脚本](<scripts/render-ui-preview.mjs>) 生成深浅主题的 530/500/499/360px MiMo 凭据预览（宽度指内部内容区），然后运行 [浏览器验收脚本](<scripts/check-browser-runtime.mjs>)。仅使用本地页面与虚构 Cookie，不连接 DSH 或真正 MiMo，不等于真实账号登录已验证。

回归测试覆盖归一化、限额边界、Cookie、RPC 契约、缓存/异常隔离、设置状态与 slot 装配。核心依赖与网络使用桩；真实 Loader composition、在线 API 和浏览器视觉仍须部署后验收，不把桩测试当作已上线证明。

## 许可

MIT。与 DeepSeek Harness 及各服务商无官方关联；请遵守各服务商的使用条款。
