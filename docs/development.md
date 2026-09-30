# 开发笔记 / 避坑记录

开发过程中踩过的坑与对应的机制解释，改代码前先过一遍。

## 1. Junction 插件 import 核心包必须声明 peerDependencies（致命）

**症状**：插件在 market 里状态永远是「重启后生效」，loader entry 存在但 fiber 永不激活，无任何报错。

**机制**：profile 的 `node_modules` 里以 Junction/软链外置的插件（真实路径在 profile 之外），其模块 import 走运行时解析器的 `routeLinked` 分支——**只有在插件自己的 `peerDependencies` 里声明过的核心包才会被转发到安装域解析**；未声明的裸包名退回原生解析，从外置路径的 node_modules 逐级向上找不到 `@deepseek-ai/*`，模块加载静默失败。

**做法**：host/client 代码里 import 的每个 `@deepseek-ai/*` 都写进 `package.json` 的 `peerDependencies`。本仓库**严格锁定当前环境**（核心与依赖包同版）：`@deepseek-ai/dsh` 及三个依赖包均精确钉死 `0.2.0-rc.2`——loader 的兼容性检查（`evaluatePluginCompatibility`）会按此比对运行核心版本，不匹配的环境会拒绝加载；升级核心后需同步修改。

## 2. Cordis 服务守卫：`ctx.get` 免声明，裸属性访问要声明

裸写 `ctx.remote.subUsage` 会抛 `cannot get property "remote.subUsage" without inject`。而把它写进 `inject` 又会死锁（该服务由本插件自己的 `$mount` 创建，apply 等它、它等 apply）。

**做法**：`ctx.get("remote.subUsage")` 读 + 判空 + 轮询重试（见 client.js 的 `call()`）。同理 `ctx.get("slots")` 等均可免声明。

## 3. Client 模块是 `window.__ModuleLoader__.load` 手接格式

不是裸 ESM。工厂体内 `require` 只能取平台模块表里的词（`react` 等 10 个），require 其它词物化时直接抛 `missed the module table`。`exports = { name, inject, apply }`；`dsh.client.inject` 里列全用到的服务提供包（信息性加载序边，未知包名静默跳过，多写无害）。

## 4. 生效时机

| 改动 | 生效方式 |
|---|---|
| Host（lib/index.js、归一化、取数） | **完全退出并重启** DeepSeek Harness |
| Client（lib/client.js） | 窗口内 `Ctrl+R`（bundle 按文件变更重读） |
| package.json / cordis.patch.yml | 重启 |

**禁用/启用开关不能代替重启**——组合只在启动时跑（market 日志里的 `nothing was composing` 就是这个含义）。

## 5. 各家 API 量纲与包裹层不同（实测）

- MiMo `percent` 是 **0–1 小数**（0.4744 = 47.44%），不 ×100 会显示 0%。
- OpenCode Go 的三窗在响应的 **`usage` 外层**里：`{ usage: { rolling, weekly, monthly } }`，直接读顶层会得 0 窗 → 报"拉取失败"。
- Kimi `/usages` **双格式并存**：旧 `usages.limit_5h/limit_7d.used_ratio`（0–1）与新版 `usage`/`limits[]`（limit/used/remaining + resetTime）；`/me` 有 `user_level_name` 套餐档名。
- Z.ai `percentage` 是 0–100；`currentValue/usage/remaining` 是 Credits 明细；`nextResetTime` 是 epoch 毫秒。

## 6. UI 经验

- **失败不能伪装成加载态**：曾用 `if (!form) return loading` 吞掉所有错误，导致"永远转圈"；错误必须上屏（红字 + 重试）。
- 状态灯三态：🟡 加载中 / 🟢 成功 / 🔴 失败，加载态标红很吓人。
- 药丸弹层**向上**展开（`bottom: calc(100% + …)`）。
- **`<webview>` 登录窗在当前桌面壳下仍渲染空白（未解，疑似壳的 guest 策略）**：已验证主窗口 `webviewTag: primary` 已开、布局修正（定位容器 + 绝对尺寸 + visibility 显隐）后依然空白、`did-fail-load` 无任何报错。功能暂缓，MiMo 只走 Cookie；后续可考虑改用壳持有的 `WebContentsView` 通道（主进程 `browserGuests`）。
- 配置缺失类失败（no-key / no-cookie）给**可行动指引**，不倒裸报错。

## 7. 测试

`node tests/run-all.mjs`：核心包 import 打桩后载入 host/client 模块，验证归一化、级连、Cookie 归一化、slot 注册装配。新增逻辑请补断言；响应样例尽量用真实 API 抓包。
