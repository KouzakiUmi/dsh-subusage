# dsh-subusage —— DeepSeek Harness 订阅用量显示

在模型选择器旁显示当前提供商的订阅余量，点击查看各周期用量、重置时间和套餐信息。设置页集中管理十个提供商/区域的检测开关与凭据。

支持 **Z.ai Coding（中国与国际）/ Kimi Coding / Xiaomi MiMo / OpenCode Go / Command Code / MiniMax（国际与中国）/ Synthetic / NanoGPT**。

## 安装与快速开始

当前仓库版本 **0.8.2**，可从 GitHub Release 获取。npm 自动发布采用 Trusted Publishing（GitHub OIDC）；可用版本见 [npm](https://www.npmjs.com/package/dsh-subusage)。安装时使用目标 DSH 部署提供的插件管理器或 CLI，并启用本 bundle：

| 来源 | 安装标识或下载地址 |
|---|---|
| npm | `dsh-subusage`；支持 npm 源的插件管理器可使用该包名 |
| GitHub | `https://github.com/KouzakiUmi/dsh-subusage` |
| 安装包 | [最新 GitHub Release 安装包](https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz) |

只需取得 npm 最新压缩包时可运行 `npm pack dsh-subusage`；指定版本前可用 `npm view dsh-subusage version` 核对发布结果。普通 `npm install` 或下载压缩包并不等于已经在 DSH 中启用插件；具体安装参数以目标部署的帮助信息为准。

开发目标是 **DeepSeek Harness 0.2.0-rc.2**。核心 peer 范围为 `>=0.2.0-rc.1 <0.3.0-0`，允许该范围内的预发布版本；声明范围不代表所有版本均已实机验证。

1. 安装并启用 bundle，按部署方式重载或重启，使 Host、Client 与依赖一起生效。
2. 打开 **设置 → 订阅用量 → 提供商管理**，为需要的订阅配置凭据。
3. **Z.ai 国际、Synthetic、NanoGPT 默认关闭**，必须手动开启。原有七项默认开启；升级保留已保存的开关。
4. 点击「刷新当前」检查结果；选中对应提供商的模型后，输入区显示余量药丸。

「没有检测到API的默认隐藏」默认开启。首次没有可见条目时，管理区自动展开；关闭的提供商仍可配置凭据，但不会请求用量。插件不注册模型路由，药丸按提供商 ID 匹配，配置表见下文。

## 使用

### 药丸

选中已开启且未被默认隐藏的模型商时显示，例如 `✓ 余 87%`、`⚠ 7d 余 12%`、`✕ 7d 已达限额`。多窗口取最差一窗，点击看完整详情。Command Code 药丸弹层底部可切换提供方插件的服务账户（自动轮换 / 默认账户 / 各额外账户，与其设置页同一开关，即时生效）；切换后药丸与弹层上方的用量同步改为所选账户的额度（自动轮换时仍显示默认账户/顶层 Key 的用量，弹层有标注说明）。关闭默认隐藏后，缺凭据时显示配置指引；可保留的临时网络错误会明确标注缓存，而非冒充当前成功。

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
| Z.ai 国际 | `ZAI_CODING_API_KEY` | `zai-coding`，默认关闭，独立国际 Coding Plan Key |
| Synthetic | `SYNTHETIC_API_KEY` | `synthetic`，默认关闭，模型订阅请求额度 |
| NanoGPT | `NANOGPT_API_KEY` | `nanogpt`，默认关闭；也可手动填写 Usage only 管理令牌 |
| Kimi | `KIMI_CODING_API_KEY` | 需要 Kimi Coding Key，不是 Moonshot 开平台 Key |
| MiMo | 不使用 API Key | 通过控制台 Cookie 会话读取 |
| OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go Key |
| MiniMax 国际 | `MINIMAX_API_KEY` | `minimax` 路由；国际站订阅 Key |
| MiniMax 中国 | `MINIMAX_CN_API_KEY` | `minimax-cn` 路由；中国站订阅 Key |
| Command Code | `COMMANDCODE_API_KEY` | 凭据由提供方插件管理，本页只读继承；也兜底读取 `~/.commandcode/auth.json`（`cmd login`） |

Z.ai（中国与国际）/ Kimi / OpenCode Go / MiniMax / Synthetic / NanoGPT 的继承模式按凭据服务 → 启动环境 → 旧手动配置兜底解析；自定义模式仅使用保存的手动 Key。Command Code 仅沿用提供方凭据来源链，不接受本插件的手动 Key；MiMo 仅使用 Cookie。界面区分凭据服务、启动环境和自定义来源。修改启动环境后是否需要重启取决于目标部署，不能把用户环境即时变化当作已经被运行进程读到。

### MiMo 登录与 Cookie

推荐使用 MiMo「登录与凭据」中的 **登录并自动导入**：

1. 先保存或取消当前编辑，再开始登录。
2. 插件调用 `playwright-core`，打开**独立临时 Chrome 会话**的官方平台；密码、验证码由你在官方页面自行输入，插件不读取这些字段，也不读取日常 Chrome 配置。
3. Host 从该会话获取适用于官方 API 的 `api-platform_serviceToken` 和 `userId`（包括 HttpOnly Cookie），先验证账户接口，再保存并更新用量；Cookie 不通过 RPC 返回页面。
4. 可随时取消或关闭登录窗口；五分钟未完成会超时并关闭。取消、认证失败、网络验证未完成或同一 MiMo 配置已被外部修改时不覆盖凭据。
5. 账户验证成功但无订阅额度时可以保存登录，界面明确显示「额度未知」，不冒充有额度。

需要已安装 **Google Chrome**。新增依赖仅 `playwright-core`，不下载浏览器；缺少 Chrome 时显示错误。当前实现针对 Host 所在机器的可见浏览器，远程/无桌面环境请使用手动导入；真正账号登录与平台接口仍需由用户验收。

备用 **手动导入**：打开 <https://platform.xiaomimimo.com> 自行登录，从 DevTools → Application → Cookies 获取 Name/Value 或导出 JSON，再粘贴并保存。必须包含上述两个字段。导入错误会显示原因并保留原文，认证过期时重新登录。界面的「仅打开官网」链接不会自动导入日常浏览器的 Cookie。

JSON 中有域名的条目按 `platform.xiaomimimo.com` 的 Cookie 域规则过滤，无关站点的 Cookie 不导入。TAB 清单只读取 Name/Value，不把 Domain/Path 混入值；Netscape 导出支持注释和 `#HttpOnly_` 域前缀，并保留可选 Cookie 的空值（两个必需字段仍须非空）。

### Cookie 有效期与到期提醒

官方会话 Cookie **自签发起 24 小时有效**。无论自动登录还是手动导入，保存凭据的同一刻开始计时，并记录在 `~/.dsh/dsh-subusage.json` 的 `xiaomi.loginAt` 与 `xiaomi.expiresAt`（毫秒时间戳，**只是计时元数据，不是秘密**，不参与凭据有效性判断）。

| 剩余时间 | 用量药丸 | 设置页「登录与凭据」 |
|---|---|---|
| 超过 2 小时 | 保持原余量文案 | 显示登录时间与剩余时间 |
| 2 小时内 | ⚠ 黄色药丸，文案「Cookie N 小时后到期」 | 黄色提示剩余时间 |
| 30 分钟内 | ⚠ 橙色药丸，同文案 | 橙色提示 |
| 已到期 | ✕ 红色药丸，文案「Cookie 已过期，请重新登录」 | 红色提示 |
| 额度已用尽 | 仍优先显示额度告警 | — |

药丸弹层常驻显示剩余时间与到期时刻。到期只是**提醒**：插件不会因为倒计时归零就停用 Cookie，是否真的失效仍以官方接口返回为准（失效时按认证错误处理，重新登录即可）。倒计时也永远不会盖过接口的判定——官方已判定凭据失效时，药丸显示的是失效原因而非剩余时间（唯一例外是「已过期」本身，因为它就是重新登录的提示）。若浏览器报告的 Cookie 过期时间早于 24 小时，以更早者为准；旧版本保存的 Cookie 没有计时记录，界面会明确说明「未记录登录时间」而不是编造倒计时。

**安全说明**：Key/Cookie 不再通过用量读取接口回传，界面不回填已保存的秘密；但本版仍兼容原本机 JSON 配置存储，**不是加密凭据库**。该配置位于 `~/.dsh/dsh-subusage.json`，新建目录/临时文件在 POSIX 上按 `0700`/`0600` 创建，替换前再次收紧文件权限；Windows 的实际访问权限仍取决于目录 ACL，`chmod` 不能替代 ACL 或加密库。请勿上传、分享或写入日志。隔离浏览器仅用于你主动发起的官方登录；它不是后台扫描或导入日常浏览器全部凭据的工具。加密凭据存储通道仍未实施。

## 支持的数据

| 模型商 | 窗口 | 明细 |
|---|---|---|
| Z.ai 中国 | 5 小时、每周（按响应） | Token / Credits 配额、套餐档 |
| Z.ai 国际 | 5 小时、每周（按响应） | Token / Credits 配额，区域凭据独立 |
| Synthetic | 滚动订阅池 | 已用/总请求次数、重置时间 |
| NanoGPT | 每日、每周、试用周期（按响应） | 输入 Token 数、重置时间；不包含图像额度 |
| Kimi | 5 小时、7 天 | 已用百分比、套餐档 |
| MiMo | 本周期额度池 | 用量明细、重置时间、套餐与余额 |
| OpenCode Go | 滚动、每周、每月 | 已用百分比、重置时间 |
| MiniMax 国际 / 中国 | 短周期（通常 5 小时）、每周 | 通用/编程池已用百分比、可信计数明细、重置时间 |
| Command Code | 5 小时、每周、月额度池 | 已用/上限（月总额为套餐快照）、重置/账期、套餐（planId）、月剩余、已购 + 赠送余额 |

非公开控制台接口可能变更；缺失或非法百分比不会当作零用量。部分数据、未知额度和暂时失败有明确状态，不能据此保证推理接口一定可用。


## 常见问题

| 现象 | 排查方法 |
|---|---|
| 设置页没有提供商标签 | 展开提供商管理，确认开关和凭据；无凭据的条目默认隐藏，可临时关闭自动隐藏查看指引 |
| 已配置凭据却没有药丸 | 确认当前模型的提供商 ID 与支持表一致、检测已开启；自定义 ID 可在设置页查看，但不会自动映射 |
| 显示认证失效 | 检查是否用了对应产品/区域的订阅 Key；MiMo 重新登录或导入 Cookie；旧额度不会当作有效数据保留 |
| 显示缓存、部分数据或额度未知 | 查看更新时间和错误说明；缓存来自之前的成功读取，部分数据不保证有可用额度，余额也不等于订阅余量 |
| 刷新后数字暂未变化 | 成功结果按提供商缓存 60 秒；手动刷新可跳过普通 TTL，但仍遵守限流退避和 Retry-After |
| MiMo 自动登录无法启动 | Host 所在机器需安装 Google Chrome 并有桌面环境；远程或无桌面部署使用手动导入 |
| 药丸提示「Cookie N 小时后到期」 | MiMo 会话 Cookie 自签发起 24 小时有效，按提示重新登录即可续期；手动导入同样重新计时 |
| 药丸显示「未记录登录时间」 | 凭据由旧版本保存，没有计时元数据；重新登录或重新导入一次后开始计时 |
| 保存成功但验证失败 | 凭据已保存，检查网络、区域或账号后重试；保存与在线验证分别反馈 |
| 保存提示配置已改变 | 另一窗口或实例更新了设置；重新读取配置后再编辑，避免旧表单覆盖新值 |
| 升级后仍是旧界面或 RPC 不匹配 | 确认运行中的 Host 和 Client 都已重载；仅刷新页面不能保证 Host 升级 |
| Command Code 额度与实际账户不同 | 可在药丸弹层切换提供方插件的服务账户（activeAccount），切换后药丸与弹层用量同步显示所选账户的额度；「自动轮换」时仍显示默认账户（顶层 Key）的用量，不跟随轮换中的实际服务账户，提供方自定义 apiBase 也不跟随 |

## 提供商 ID 与默认开关

| 提供商 | ID | 新安装默认值 |
|---|---|---|
| Z.ai 中国 | `zai-coding-cn` | 开启 |
| Kimi Coding | `kimi-coding` | 开启 |
| MiMo | `xiaomi-token-plan-cn` | 开启 |
| OpenCode Go | `opencode-go` | 开启 |
| Command Code | `commandcode` | 开启 |
| MiniMax 国际 | `minimax` | 开启 |
| MiniMax 中国 | `minimax-cn` | 开启 |
| Z.ai 国际 | `zai-coding` | **关闭** |
| Synthetic | `synthetic` | **关闭** |
| NanoGPT | `nanogpt` | **关闭** |

开关只控制本插件的订阅检测与显示，关闭后保留凭据。默认隐藏只影响显示，不自动开启被关闭的提供商。新增三项在旧配置升级时也保持关闭。

## 界面预览

以下为 0.7.0 的离线组件测试截图，使用虚构用量数据，不包含真实账号信息，也不是运行中的 DSH 截图。市场截图由根目录的 `screenshots.json` 声明。

深色设置页：查看订阅用量、管理凭据与提供商；新增三家默认关闭。

![深色订阅设置页（离线测试预览）](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/settings-dark.png)

浅色用量弹层：查看每日与每周额度、用量明细。

![浅色 NanoGPT 用量弹层（离线测试预览）](https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/assets/screenshots/usage-popover-light.png)


## 开发、发布与文档

基础检查无需安装 DSH 或连接账号：

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
node --check lib/mimo-login.js
```

推送到 `main` 后，GitHub Actions 检查并发布提交对应的 GitHub Release。推送与包版本一致的 `vX.Y.Z` 标签后，受 npm 信任的 `release.yml` 通过 Trusted Publishing 自动发布新 npm 版本；已有版本跳过。发布产物不会自动安装或重启 DSH。

- [开发与验证](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/development.md)：RPC、缓存、凭据、离线预览与实机验收。
- [UX 设计](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/design-ux.md)：导航、状态、编辑保护与弹层行为。
- [发布与市场收录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/publish.md)：GitHub Release、npm、条目与截图维护。
- [更新记录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/changelog.md)：各版本功能变化。
- [0.7.0 审查记录](https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/code-review.md)：修复、接口来源和验证边界。

测试使用虚构凭据、桩网络和离线组件。真实 DSH Loader、实际账号在线接口与多账户映射尚未验收；截图不代表已通过这些检查。

## 许可

MIT。与 DeepSeek Harness 及各服务商无官方关联。
