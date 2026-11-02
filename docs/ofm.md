# Our Free Model 额度联动

本插件通过提供方的 `usage.badge` 只读接口取得额度，复用 Our Free Model 的账号池、取数逻辑和缓存。登录、凭据和账号启停由提供方管理。兼容独立渠道插件的条件是它保留相同的 `/api/channel-pack` 接口与返回结构。

## 渠道与显示范围

| 渠道 | 查询 ID | 读数 | 药丸自动匹配的模型 provider |
|---|---|---|---|
| 小浣熊 | `ofm-raccoon` | 可用积分、奖励/每日/会员/充值积分分项 | `raccoon` |
| Loomy | `ofm-loomy` | 可用积分、永久积分与每日赠送 | `loomy` |
| Qoder 国际版 | `ofm-qoder` | 套餐额度、资源包余量与容量 | `qoder` |
| Qoder 中国版 | `ofm-qodercn` | 套餐额度、资源包余量与容量 | `qodercn` |
| LobsterAI | `ofm-lobsterai` | 提供方返回的积分/余额包 | `lobsterai` |
| TRAE | `ofm-trae` | 提供方返回的积分/余额包 | 仅工具查询；保留原有 Trae 联动 |
| Cline | `ofm-cline` | Credits 与独立订阅窗口 | `cline` |
| MiniMax Code | `ofm-minimax` | 提供方返回的 Token/额度包 | 仅工具查询；保留原有 MiniMax 订阅匹配 |
| ZCode | `ofm-zcode` | 按模型分桶的 Token 额度 | `zcode` |
| Gemini | `ofm-gemini` | 按模型分组的剩余配额比例 | `gemini` |

查询全部 OFM 渠道可使用 `subusage_quota({ providers: ["ofm"] })`；也可以点名 `小浣熊`、`loomy`、`qoder`，或表中的完整查询 ID。`qoder` 同时匹配国际版与中国版。`ofm-trae` 与原有 `trae`、`ofm-minimax` 与原有 `minimax` 是不同来源，分别报告。

这些联动项不增加本插件的凭据槽或普通提供商设置卡片，也不进入手动绑定的目标订阅列表。多账号药丸显示账号数量，展开后分别列出各账号的额度；工具结果一账号一条。余额和容量不会跨账号相加，也不推断实际调用时选中了哪个账号。

## 数据语义

- 仅有剩余积分的快照显示绝对量。小浣熊和 Loomy 的包结构将当前余额同时写入 `total`，因此不能用它推算历史已用比例。
- Qoder、ZCode 与 Gemini 只有在提供方给出有效容量时才显示比例；总容量为零时不生成耗尽或充足百分比。多个模型池分别显示，Gemini 的百分比不相加为总余额。
- Cline 的 Credits 和订阅窗口分别保留；某一接口失败时仍可显示另一接口的成功读数，并标为部分数据。订阅窗口按提供方账号 ID 匹配。
- 包到期日显示为说明，只有订阅窗口明确提供重置时间时才写入 `resetsAt`。查询失败不转换为零余额。
- 使用 OFM 自己的缓存（2.7.1 为成功快照 120 秒、全部失败快照 15 秒），手动刷新将 `force: true` 传给提供方。本插件合并同渠道的在途读取。

## 宿主与实现

取数走宿主 Connection 的进程内 Fetch 分发：`createPeer()` 与 `createSharedFetchHandler("/api")`，只发送 `usage.badge`。请求不经过浏览器或本机 HTTP 端口。宿主缺少这两个公开方法、提供方未启用或接口不存在时，全量查询静默缺席；点名查询显示原因。接口已在场但查询失败时报告失败。

宿主读取与归一化实现在 [ofm.js](../lib/ofm.js)，由 [Host](../lib/index.js) 接入 `quota()` 和 `readLinked()`；药丸取数只合并额度，不覆盖设置快照。

## DSH Go 药丸

DSH Go 的 `panel` 网页岛把插件限制在底部面板中。药丸详情在这种容器内改用普通文档流向下展开，让网页岛按内容增长并承担滚动；键盘压缩视口后仍能滚动到刷新按钮。样式跟随 HTML 上的网页岛标记生效，支持标记晚于组件挂载的情况。桌面端继续使用向上弹层。

该适配仅作用于本插件的药丸，其他插件自行绘制的药丸不受影响。

## 验证范围

2026-11-02 核对 Our Free Model 2.7.1 的接口实现及本机 DSH 0.2.1-rc.5 的 Connection 实现。小浣熊、Loomy、Qoder 国际版与中国版已使用本地既有账号进行上游只读接口验证；凭据未写入源码或结果。其他渠道依据提供方实现和隔离回归，尚未逐家做真实账号验收。

- [Host 回归](../tests/test-ofm-link.mjs)：固定只读方法、十渠道、账号隔离、分桶单位、缓存刷新参数、缺席/失败与卸载。
- [Client 回归](../tests/test-client-ofm.mjs)：路由归并、与 Antigravity 开关隔离、逐账号明细和样式生命周期。
- [离线浏览器检查](../scripts/check-ofm-mobile.mjs)：运行 `node scripts/check-ofm-mobile.mjs`。需要本机已有 Chrome，以及兄弟目录 `dsh-Go` 中的网页岛 CSS；脚本使用虚构账号，覆盖深浅主题、320/360/430px、滚动、键盘缩小视口和桌面定位。它不替代 Android 真机验收。

工作区修改完成与安装、重载、真机生效分别验证。
