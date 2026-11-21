# 被动接入（ingest）交接文档

其它插件把额度数据**推**给本插件，本插件只做持久化与展示；数据由推送方负责，本插件不拉取、不轮询、不了解对方上游。

> 状态：**Host 侧已实现并验收（`npm run check` 全绿）；Client 设置页与文档未做。** 本文件是给接手实现的人看的规格，不是用户文档。

## 1. 需求边界

| 项 | 决定 |
|---|---|
| 接口形态 | **只做 Cordis 服务**（同进程插件互调）。不做 HTTP 端点 |
| 卡片 id | `ingest:<source>`；`source` 限制 `[a-z0-9][a-z0-9._-]{0,63}`，与 33 个内置 provider 彻底隔离 |
| 默认可见性 | **推来就显示**；开关用来关掉不想要的源 |
| 过期语义 | 推送方可选 `ttlMs`；过期只把 `freshness` 标成 `stale`，**不隐藏卡片**（数据归推送方，本插件不下"已失效"的判断） |
| 本插件职责 | 形状校验、持久化、按开关过滤、渲染 |
| 本插件不做 | 轮询、重试、凭据、药丸注册（ingest 卡没有模型路由）、删除按钮（删除已由服务方法提供） |

调用方式：

```js
ctx.get("subUsage").ingest({
  source: "relay-a",              // 必填，[a-z0-9][a-z0-9._-]{0,63}
  label: "Relay A",               // 可选，默认用 source
  windows: [{ kind: "5h", percent: 42, resetsAt: "2026-11-21T00:00:00Z" }],
  extras: [{ kind: "balance", value: "12.30 CNY" }],
  quotas: [],                     // 可选：直接给 QuotaEntry 元素
  state: "ok",                    // 或 "error"（配 error 字段）
  coverage: "complete",
  ttlMs: 600000                   // 可选
});
// → { ok: true, source, providerId, receivedAt } 或 { ok: false, error }
```

## 2. 已完成（Host 侧，已验收）

新文件 [lib/ingest.js](../lib/ingest.js)：

- `INGEST_PREFIX` / `INGEST_VERSION`
- `isValidIngestSource(source)` / `isIngestId(id)` / `ingestSourceOf(id)`
- `parseIngestPayload(payload, now)` → `{ record }` | `{ error }`：校验 source 命名、窗口 `percent` 0–100、未知 `kind` 退回 `period`、窗口/附加行条数上限、`ttlMs` 上限 7 天、**秘密闸门**（命中 `Bearer` / `sk-` / `eyJ…` 等形态整条拒绝）、单条 ≤64KB
- `ingestEntry(record, now)` → 规范化 QuotaEntry（`canonicalizeEntry`），过期只把 `freshness` 置 `stale`
- `IngestStore`：`<config 目录>/dsh-subusage-ingest.json`，0600 + tmp/rename 原子写，最多 50 个源（按最近推送淘汰）

[lib/index.js](../lib/index.js) 的接入点：

| 位置 | 做了什么 |
|---|---|
| 构造 | `this.ingestStore`（`options.ingestPath === null` 可关闭；默认 `join(dirname(config), "dsh-subusage-ingest.json")`） |
| 默认设置 | `ingest: { hidden: [] }` |
| 读盘 | `value.ingest.hidden` 只保留合法 source |
| 公开投影 | `ingest: { hidden: [...] }`（**待扩展，见 W1**） |
| 补丁校验 | `{ ingest: { hidden: string[] }, expectedRevision }`，整体替换，非法 source 拒绝 |
| 补丁应用 | `stored.ingest = { hidden: [...] }` |
| `parseQuery` | `known = id => IDS.includes(id) \|\| isIngestId(id)`，ingest id 不再进 `unknown` |
| `quota()` | 全量 `wanted` 并入 `enabledIngestIds(settings)`；`asked.filter(isIngestId)` 参与点名；`resolveProviderIds` 前先剔掉 ingest id（否则会被当成"一个名字都没认出来"而全量兜底） |
| `read()` | 全量兜底并入 `enabledIngestIds`，客户端刷新一次就能看到这些卡 |
| `provider()` | 开头 `if (isIngestId(id)) return this.ingestProvider(id, settings)` |
| 服务方法 | `ingest(payload)` / `revokeIngest(source)` / `listIngest()` / `enabledIngestIds(settings)` / `ingestProvider(id, settings)` |

回归：[tests/test-ingest.mjs](../tests/test-ingest.mjs)（6 组：形状校验、成卡与点名、重启后持久化、隐藏开关只影响显示、ttl 过期标 stale、撤回真删）。

## 3. 待做：W1 — Client 设置页与契约

独占写入：`lib/client.js`、`lib/index.js`、`tests/test-client-render.mjs`。

1. **Host 补投影**（唯一允许改 Host 的地方）：`publicSettings.ingest` 从 `{ hidden }` 扩成
   `{ hidden: string[], sources: [{ source, label, state, receivedAt, ttlMs?, error? }] }`。
   Client 靠它知道"有哪些源、要给哪些 id 发请求"；`receivedAt` 用毫秒数，保持与 `listIngest()` 一致。
2. **Client 首屏拉取**：`readAll` 的 `providerIds` 并入 `settings.ingest.sources` 映射出的 `ingest:<source>`。
   注意 `PROVIDER_ORDER` 是静态表，**不要**把 ingest id 塞进去（会污染计数断言与 tab 列表）。
3. **出站校验**：`lib/client.js` 的 `parseSettings`（visibility/ingest 分支）放行 `ingest: { hidden: string[] }`，
   `source` 用与 Host 同口径的正则校验。
4. **设置页分组**：在「绑定与匹配」页（`section === "custom"`）新增 `uiGroup` 标题「外部接入」：
   - 有源：每个源一行 `uiRow`，主文案 `label`，副文案 `source` + 「最后推送 …」（相对时间）；
     `state === "error"` 或 `freshness === "stale"` 时副文案补一句原因 / 「N 分钟未更新」
   - 右侧 `uiSwitch`：开 = 显示、关 = 隐藏；写 `usageStore.save({ expectedRevision, ingest: { hidden: [...] } })`
   - 无源：**一句空态**「还没有插件推送额度数据。其他插件可以调用 `ctx.get("subUsage").ingest({...})`。」不放假开关
   - `switchLocked` / `busy` 时禁用，与该页现有开关节奏一致
5. **明确不做**：药丸不注册、不碰 `lib/go-panel.js`、不做删除按钮、不动 `IDS` / `PROVIDER_ORDER` / `PROVIDER_META` / 各计数断言。
6. **验收**：`tests/test-client-render.mjs` 新增断言（有源渲染 label/时间/开关；点击开关发出正确 save 补丁；
   无源渲染空态；切到其它分组不渲染该区块）；`npm run check` 全绿。

## 4. 待做：W2 — 文档

独占写入：`AGENTS.md`、`README.md`、`docs/changelog.md`。与 W1 文件不相交，可并行。

1. **AGENTS.md 新增一节「被动接入（ingest）」**：接口契约、`ingest:<source>` 命名与理由、独立持久化文件与
   为什么不能复用额度暂存、开关只控制显示、`ttlMs` 只标 stale、秘密闸门与上限、不做轮询/药丸/删除按钮的理由。
2. **README.md**：用户视角三两句话 + 给插件作者的三行调用示例。
3. **docs/changelog.md**：未发布条目，写清 Host 与 Client 各自做了什么、数据责任在推送方。

## 5. 验收与收尾（由派单方执行）

1. 逐文件审 diff（本轮改动全部未提交，`git status` 可见）。
2. `npm run check`（= `node tests/run-all.mjs && node scripts/check-manifest.mjs`）。
3. 打包 `npm pack` → 复制成 `dsh-subusage-1.0.0-local<N>.tgz` → 装进 desktop profile → 与工作区逐字比对。
4. **不重启 DSH**（由用户手动重启）。

## 6. 交接须知

- 只需读：本文件、[lib/ingest.js](../lib/ingest.js)、`lib/client.js` 的「绑定与匹配」页与 `parseSettings`、
  `tests/test-client-render.mjs` 的现有写法、[tests/test-ingest.mjs](../tests/test-ingest.mjs)。**不要通读仓库**。
- Host 侧现有实现是**已验收基线**，除第 3 节第 1 条（补投影）外不要改动。
- 同一文件同一时间只有一个写入者：W1 与 W2 的文件集合不重叠，可并行。
- 现有 wire 约束：RPC/工具返回值必须是 lossless JSON——**字段缺席就不要写属性**，不写 `x: undefined`，
  `canonicalizeEntry` / `wireJson` 已在出口兜底，新增字段沿用条件展开的写法。
