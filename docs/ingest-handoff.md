# 外部插件额度上报（ingest）

同进程 Host 插件通过 Cordis 的 `subUsage` 服务上报额度快照。接入示例与方法返回值见 [README：外部插件被动接入](../README.md#外部插件被动接入)。上报服务不挂 HTTP 或 Typert 写入端点；Agent 的 `subusage_quota` 仍是只读工具。

## 上报字段

| 字段 | 约定 |
|---|---|
| `source` | 稳定且区分大小写，建议带插件名；1–64 位字母、数字、`.`、`_`、`-`，首位为字母或数字。同名上报覆盖该来源；收据返回完整 `ingest:<source>` ID |
| `label` | 显示名，可省略，默认使用 `source` |
| `windows` | 百分比窗口，`percent` 为 **已用** 0–100；`kind` 支持 `5h`、`day`、`week`、`month`、`period`、`rolling`、`7d`、`sub`。`resetsAt` 可填 ISO 时间 |
| `extras` | 附加行 `{ kind, value }`，如 `{ kind: "balance", value: "12.30 CNY" }`；也可传 `plan`、`spend`、`status`、`account`、`note` |
| `quotas` | 可选的非空 [QuotaEntry 元素数组](quota-entry.md#元素类型type-判别联合)，用于替代 `windows` / `extras`，不要混用两套形状 |
| `state` / `error` | 正常快照默认 `ok`，至少有一项额度；失败可上报 `state: "error"` 和已脱敏的用户可读说明 |
| `coverage` | 只读到部分数据时传 `"partial"` |
| `ttlMs` | 可选，最长 7 天；超时后仍可查询，标为 `stale`。省略则不因时间变旧 |

取数、刷新节奏和撤回由上报方负责。仅发送规范化额度与展示数据，不发送凭据或上游原始响应。Host 对疑似凭据形态拒收，窗口与附加行各最多 16 / 40 条。

## 查询、显示与生命周期

- Agent 可调用 `subusage_quota` 或按 `{"providers":["ingest:dsh-my-relay"]}` 点名；Host 调用 `quota({ providerIds: [receipt.providerId] })`。强制刷新仍读取该来源的最近快照。
- **设置 → 订阅用量 → 绑定与匹配 → 外部接入** 的接收开关默认开启。关闭后 `ingest()` 返回 `{ ok: false, error }`，已有快照和撤回不受影响。逐来源的显示开关保持独立：隐藏时全量查询不列出，点名返回隐藏原因。
- `listIngest()` 也列出隐藏的来源；`revokeIngest(source)` 撤回快照。上报源不注册模型路由，因此不进入输入区药丸或 Go 当前模型面板。
- 快照单独存于 `<配置目录>/dsh-subusage-ingest.json`，与可重拉的 `dsh-subusage-cache.json` 分开。设置页读取 `publicSettings.ingest` 的 `{ accepting, hidden, sources }`；设置补丁只修改提交的字段，`hidden` 数组整体替换。

## 实现与回归

- [上报校验与存储](../lib/ingest.js)、[Host 服务](../lib/index.js)、[设置页](../lib/client.js)。
- [上报至工具查询](../tests/test-ingest.mjs)覆盖持久化、覆盖、隐藏、过期、点名、强刷与撤回；[设置页回归](../tests/test-client-render.mjs)和[双端契约回归](../tests/test-contract.mjs)覆盖界面与 RPC。上述测试使用隔离 Host/Client，无需真实账号。
