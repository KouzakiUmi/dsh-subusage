# 开发与验证说明

## 1. 目标与授权边界

目标 API 为 DeepSeek Harness `0.2.0-rc.2`。本项目是树外 Host/Client bundle，`cordis.patch.yml` 插入 `subusage`，不修改核心、安装树或 ASAR。

工作区开发、安装启用、依赖安装/构建授权与重启是不同操作。修改并通过测试不代表运行环境已经生效。

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
- `save(settings)`：provider patch，包含 `providerId`、`expectedRevision`、来源模式、凭据保持/替换/清除动作与可选 Z.ai 参数。
- 公共 settings 只含 revision、非秘密参数、hasKeys、keyModes 与 xiaomi.hasCookie。
- 保存与验证分离。保存失败和保存后在线验证失败必须有不同反馈。
- revision 是配置版本令牌；刷新不得丢弃未保存编辑，过期表单不得覆盖新配置。

两端必须同时更新。Client 支持的新方法不能用于仍运行旧契约的 Host；遇到此情况应提示更新/重启目标 Host，而非无限等待。

## 4. 数据与缓存约定

- 是否耗尽按原始百分比/明确接口状态判断，不能按用于展示的四舍五入值判断。
- 非法/缺失百分比不是 0%；部分数据不能默认绿色可用。
- Z.ai 百分比为 0–100；MiMo `percent` 为 0–1；OpenCode Go 三窗通常包裹于 `usage`。
- Kimi 新格式仅兼容有明确窗口含义和数值依据的字段；未知结构报错，不猜测额度。
- 单厂商凭据、网络、解析异常不影响其它厂商条目。
- 按厂商共享 TTL 缓存与 in-flight 请求；配置/凭据变化使旧账号缓存失效。
- 允许保留的临时错误返回 stale 标记、上次成功时间与结构化错误；认证失效不保留旧额度。
- 429/临时错误使用退避，倒计时本地更新，重置后有界刷新而不制造请求循环。

## 5. 凭据与 MiMo

当前仍兼容旧本机 JSON 存储，并非加密凭据库；不输出真实 Key/Cookie到日志、测试、截图或读取结果。新建目录 mode 为 0700、临时文件为 0600，重命名前再收紧临时文件权限；不 chmod 已有共享配置目录。Windows chmod 不等同于 ACL 管理，部署者仍需保证目录 ACL 仅授权合适用户。

Client 不填回已保存秘密。Cookie 解析支持多行 KV、成对文本、JSON 与 TAB Name/Value；JSON 域规则按目标站点匹配。输入错误必须保留原文，Host 再做 header 安全及必需条目验证。

原 webview 取数桥已移除；普通官网链接仍不自动同步外部浏览器 Cookie。自动登录由 Host 的隔离 Chrome 会话实现，延迟加载 `playwright-core`，不使用 persistent context，不读取日常浏览器配置，不下载浏览器。

登录任务单实例、五分钟期限，start 立即返回，Client 每两秒串行查询活跃任务，卸载只停止 UI 轮询；Host 处理取消、关闭窗口、迟到启动、超时和 dispose。只提取官方 API 域/路径匹配的两个必需 Cookie，验证成功后同步检查 MiMo 材料冲突并保存。其他厂商修改可合并；认证/网络失败不提前持久化。有效登录但只有余额时保留 partial/额度未知语义。

成功登录状态不是永久可复用快照：MiMo 材料改变时返回 idle，其他厂商改变时刷新公开 revision；Client 同时使用请求 epoch 防止保存之后收到旧 success 再合并。浏览器异常使用固定安全说明，不回显原始 URL、Cookie 或令牌。真实官方登录仍需用户验收。

## 6. 测试与生效

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
```

测试用虚构凭据、桩网络和隔离文件系统。新增 service 测试不能访问 `~/.dsh` 的真实配置。

自动测试覆盖模块/slot装配、RPC 描述符、额度边界、凭据 patch、异常隔离、缓存、Cookie、React 状态路径。桩 React/ctx 不证明真实 Loader realm/fiber 或浏览器行为。

部署后另行检查：Host/Client 版本一致、真实 Remote 往返、scope卸载、约530px和窄内容区导航、125%缩放、中文/英文、深浅主题、实际四家API。Host变更需要目标部署提供的重载或重启；Client热生效依赖对应watcher及重建链路，不能一概认为Ctrl+R一定读到新产物。
