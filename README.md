# dsh-subusage —— DeepSeek Harness 订阅用量显示

在模型选择器旁显示当前模型商的订阅余量；点开药丸看用量、重置时间和套餐详情。支持 **Z.ai Coding CN / Kimi Coding / Xiaomi MiMo / OpenCode Go**。

## 0.3.0：按钮式凭据与 MiMo 自动登录

- **凭据按钮**：默认只展示当前来源；通过「更换 / 清除」进入编辑，再保存或取消，不再使用「保持 / 替换 / 清除」下拉菜单。
- **自动登录导入**：点击「登录并自动导入」，使用隔离的临时 Chrome 窗口完成官方登录，由 Host 验证并保存必需 Cookie。
- **原生菜单对比度**：剩余套餐/provider 选项显式配对系统前景和背景，避免深色界面出现白底白字。

### 延续的设置与可靠性改进

- **四等宽导航**：`Z.ai / Kimi / MiMo / OpenCode Go` 单行显示，窄内容区改成选择框，不出现 3+1 换行。
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

选中支持的模型商时显示，例如 `✓ 余 87%`、`⚠ 7d 余 12%`、`✕ 7d 已达限额`。多窗口取最差一窗，点击看完整详情。缺凭据时给配置指引；可保留的临时网络错误会明确标注缓存，而非冒充当前成功。

### 设置

设置 → **订阅用量**：

1. 选择厂商；正常宽度使用四等宽 tab，窄内容区使用选择框。
2. 查看百分比、额度明细、重置时间与套餐。
3. 展开「连接与凭据」更改来源、替换或清除凭据；空输入不会清除原值。
4. 保存先确认持久化，再独立刷新该厂商验证。验证失败不意味着保存失败。

顶部 `X/Y 家数据获取成功` 仅表示接口读取健康度。厂商图标/颜色表达额度与异常情况；例如读取成功后仍可能显示「已达限额」。未获取额度的部分数据不能视为可用。

### 凭据与环境

| 模型商 | 默认继承变量 | 说明 |
|---|---|---|
| Z.ai | `ZAI_CODING_CN_API_KEY` | 团队套餐另填组织、项目 ID |
| Kimi | `KIMI_CODING_API_KEY` | 需要 Kimi Coding Key，不是 Moonshot 开平台 Key |
| MiMo | 不使用 API Key | 通过控制台 Cookie 会话读取 |
| OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go Key |

继承模式按凭据服务 → 启动环境 → 旧手动配置兜底解析；自定义模式仅使用保存的手动 Key。界面区分凭据服务、启动环境和自定义来源。修改启动环境后是否需要重启取决于目标部署，不能把用户环境即时变化当作已经被运行进程读到。

### MiMo 登录与 Cookie

推荐使用 MiMo「连接与凭据」中的 **登录并自动导入**：

1. 先保存或取消当前编辑，再开始登录。
2. 插件调用 `playwright-core`，打开**独立临时 Chrome 会话**的官方平台；密码、验证码由你在官方页面自行输入，插件不读取这些字段，也不读取日常 Chrome 配置。
3. Host 从该会话获取适用于官方 API 的 `api-platform_serviceToken` 和 `userId`（包括 HttpOnly Cookie），先验证账户接口，再保存并更新用量；Cookie 不通过 RPC 返回页面。
4. 可随时取消或关闭登录窗口；五分钟未完成会超时并关闭。取消、认证失败、网络验证未完成或同一 MiMo 配置已被外部修改时不覆盖凭据。
5. 账户验证成功但无订阅额度时可以保存登录，界面明确显示「额度未知」，不冒充有额度。

需要已安装 **Google Chrome**。新增依赖仅 `playwright-core`，不下载浏览器；缺少 Chrome 时显示错误。当前实现针对 Host 所在机器的可见浏览器，远程/无桌面环境请使用手动导入；真正账号登录与平台接口仍需由用户验收。

备用 **手动导入**：打开 <https://platform.xiaomimimo.com> 自行登录，从 DevTools → Application → Cookies 获取 Name/Value 或导出 JSON，再粘贴并保存。必须包含上述两个字段。导入错误会显示原因并保留原文，认证过期时重新登录。界面的「仅打开官网」链接不会自动导入日常浏览器的 Cookie。

JSON 中有域名的条目按 `platform.xiaomimimo.com` 的 Cookie 域规则过滤，无关站点的 Cookie 不导入。TAB 清单只读取 Name/Value，不把 Domain/Path 混入值。

**安全说明**：Key/Cookie 不再通过用量读取接口回传，界面不回填已保存的秘密；但本版仍兼容原本机 JSON 配置存储，**不是加密凭据库**。该配置位于 `~/.dsh/dsh-subusage.json`，新建目录/临时文件在 POSIX 上按 `0700`/`0600` 创建，替换前再次收紧文件权限；Windows 的实际访问权限仍取决于目录 ACL，`chmod` 不能替代 ACL 或加密库。请勿上传、分享或写入日志。隔离浏览器仅用于你主动发起的官方登录；它不是后台扫描或导入日常浏览器全部凭据的工具。加密凭据存储通道仍未实施。

## 支持的数据

| 模型商 | 窗口 | 明细 |
|---|---|---|
| Z.ai | 5 小时、每周 | 已用/总计 Credits、套餐档 |
| Kimi | 5 小时、7 天 | 已用百分比、套餐档 |
| MiMo | 本周期额度池 | 用量明细、重置时间、套餐与余额 |
| OpenCode Go | 滚动、每周、每月 | 已用百分比、重置时间 |

非公开控制台接口可能变更；缺失或非法百分比不会当作零用量。部分数据、未知额度和暂时失败有明确状态，不能据此保证推理接口一定可用。

## 安装与生效

目标核心版本：**DeepSeek Harness `0.2.0-rc.2`**。插件声明精确 peer 版本；其它版本需重新核验 API 与兼容性。

```console
git clone https://github.com/KouzakiUmi/dsh-subusage.git
cd dsh-subusage
```

通过目标部署支持的官方插件管理/CLI 流程将工作区 bundle 安装并启用。不要直接修改核心或 ASAR；本地链接的解析方式、profile 层覆盖与重载行为应按目标环境确认。

**0.3.0 新增登录 RPC 和 `playwright-core` 依赖，必须让 Host/Client 及依赖一起更新。** 仅刷新页面不能升级正在运行的旧 Host。安装、重载或重启需要用户另行授权；仓库测试通过不代表运行中的插件已生效。

## 开发与测试

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
```

Host 私有 Remote：

- `read()`：初始化获取四家数据，使用每厂商缓存。
- `refresh({ providerIds, force })`：按厂商刷新，结果条目由客户端合并。
- `save(settings)`：按厂商 patch 保存；读取/保存结果只含公开配置和凭据存在性。
- `startMimoLogin({ expectedRevision })`：立即返回任务状态，后台等待官方登录，不阻塞 RPC。
- `getMimoLoginStatus()`：轮询状态，成功结果只含公开配置和用量；账号变更后旧成功结果失效。
- `cancelMimoLogin({ jobId })`：只取消匹配的任务，阻止迟到验证保存。

可选的本机 Chrome 验收：使用 [离线预览脚本](<scripts/render-ui-preview.mjs>) 生成深浅主题的 530/360px MiMo 凭据预览，然后运行 [浏览器验收脚本](<scripts/check-browser-runtime.mjs>)。仅使用本地页面与虚构 Cookie，不连接 DSH 或真正 MiMo，不等于真实账号登录已验证。

回归测试覆盖归一化、限额边界、Cookie、RPC 契约、缓存/异常隔离、设置状态与 slot 装配。核心依赖与网络使用桩；真实 Loader composition、在线 API 和浏览器视觉仍须部署后验收，不把桩测试当作已上线证明。

## 许可

MIT。与 DeepSeek Harness 及各服务商无官方关联；请遵守各服务商的使用条款。
