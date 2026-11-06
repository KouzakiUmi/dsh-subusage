# QuotaEntry：统一额度 wire 契约

**单一事实源：[lib/quota-entry.js](../lib/quota-entry.js)**。所有 provider、联动项、聚合器的额度在 wire 上只有一种形状。provider/联动侧只做一件事：**把数据喂进来**——每个额度元素自己声明 `order`（排序）、`label`（名字）、`amount.unit`（单位）；状态推断、覆盖率、阈值告警、布局、i18n、弹层密度全部由 schema 管线与渲染端口统一负责。不再存在「每家一个协议」。

## 组合模型

```
QuotaEntry
├─ providerId / label / state / error / errorCode / coverage / freshness
├─ retryable / retainPrevious / lastSuccessAt / lastAttemptAt
├─ keySource / keyRef / apiDetected            凭据元数据（不含量）
├─ availability / availabilityReason         计费可用性咨询
├─ account / accountId / accountActive / accountMode / accountEnabled
├─ authStatus / authExpiresAt                鉴权元数据
├─ quotas[]                                  ★ 顶层额度元素（规范字段，恒为数组）
├─ linkedAccounts[]                          账号/卡行（一行一个，行内同样收编）
│    └─ quotas[]                             该行自己的额度元素
├─ accountPool / keyAccounts                 CC 轮换池 / 多 Key 监控
├─ routeContext                              路由上下文端口（字段在场即有路由口径）
├─ cookieExpiresAt / cookieRenewable / renewFailed / subscribed   渠道专属扩展
├─ windows[] / extras[]                      渲染管线现行消费形状（见「双轨期」）
└─ <未知字段>                                 透传，契约升级不丢数据
```

组合维度是 **账户 × 池 × 元素**：`linkedAccounts` 给账户维度，元素上的 `pool`/`poolLabel` 给池维度（Antigravity 分池、AFP 分组、Magpie 渠道组），元素本身给额度维度。三者自由组合，任何形状都能表达。

## 元素类型（`type` 判别联合）

| type | 语义 | 关键字段 |
|---|---|---|
| `window` | 周期窗口（百分比） | `period`（5h/day/week/month/period/rolling/sub/7d）、`percent`（已用 0–100）、`used`/`limit`/`amount`（结构数字）、`resetsAt`、`status: "rate-limited"`、`cascade`/`blockedBy`（连坐）、`scope`/`budgetScope` |
| `amount` | 数值额度 | `role`：balance 余额/积分、bonus 附赠、wallet 充值钱包、plan 套餐内剩余、monthly 月度余额、spend 花费；`amount: {value, unit, unitKind}`，`unitKind` ∈ cash/credit/token/quota（白名单，认不出留空）；`componentOf` = 总额分项，合计时跳过 |
| `package` | 额度包 | `role`：recurring/temporary/permanent；`amount`/`remaining`（结构量）、`expiresAt`、`label` |
| `plan` | 套餐名徽标 | `value` |
| `status` | 状态行 | `value`（unlimited / restricted / 原文） |
| `note` | 说明行（兜底） | `role`（account/plan/note）、`text` |

所有元素共享 `id`（稳定身份）、`order`（缺省取数组位序）、`label`、`pool`/`poolLabel`。枚举字段只按白名单收，认不出的丢或归安全值（`period`→period、`role`→balance/note），**不猜**；未知字段原样透传。

**池语义**：`pool`/`poolLabel` 只声明「这个元素属于哪个池」。`poolScope:"independent"`（仅 window 元素）才声明**独立预算**——同池任一窗口耗尽即限制该池；没写 `poolScope` 的窗口共享约束，最差窗定整体状态。`groupLabel` 派生时 `pool` 兜底 `poolLabel`，**不**自动设 `poolScope`（OFM 把窗口类型名放 groupLabel，不是独立池；Antigravity 的组名才是真分池）。

**单位与合计**：`amount.unitId` 是聚合键（`unitIdOf()` 归一：credit(s)/积分→credit、token(s)→token、usd/$→usd、cny/¥/元→cny、request(s)/次→request；未知单位小写原文，不猜）。账号总额 = `role:balance` 金额按 `unitId` 分组求和；`componentOf` 元素是总额的分项（Trae Work/通用积分 ⊆ available），跳过防重复计数；package/bonus/wallet/plan/monthly/spend 不进总额；多单位永不合并。

## provider 侧只需喂什么

- 每个元素：`type`、可选 `label`、`order`、`pool`/`poolLabel`；
- 数值：`amount.value` + `amount.unit`（原文单位）+ 可选 `amount.unitKind`；
- 窗口：`period`（白名单）+ `percent` 或 `used`/`limit`；
- 语义：`role`（白名单）、`expiresAt`、`resetsAt`。
- **不喂**：state 推断（管线管 coverage/freshness/availability）、告警阈值（客户端按 unitKind 判定）、显示布局（端口按 type 渲染）、i18n（Client 统一）。

## 边界收编 `canonicalizeEntry()`

Host 出边界统一调用（`provider()` 缓存前 / `linkedProvider()` 返回 / `quota()` 未知条目）：

1. `ofmAccounts` → `linkedAccounts` 别名折叠（wire 上不再有 `ofmAccounts`）；
2. **`quotas` 在场即权威**：是数组（含显式 `[]`）就按它派生 windows/extras，不从 legacy 反向导入（否则 `quotas:[]` 会被旧 extras 复活、双轨可分叉）；整体缺席才从 windows/extras 转换；
3. `linkedAccounts` 行内同样收编；`Symbol` 键与未知字段保留。

`windows`/`extras` 保留「缺席 ≠ 空」语义（错误条目不得带出陈旧数据时断言 `undefined`），`quotas` 恒为数组。`used`/`limit` 能推导时 `windowFromQuota` 才写 `percent`（绝不给 NaN）；`pool` 无 `poolLabel` 时 `pool` 兜底 `groupLabel`；amount 带 `label` 时 legacy 行保留名字（多池金额可分）。规范化丢弃/降级的字段记入 `diagnostics[]`（仅在有记录时存在，`{where, reason}`）。

## 双轨期

`quotas` 是**规范**形状（结构化、可组合），`windows`/`extras` 是**渲染**形状（管线现行消费）。归一化器逐步迁移到只产 `quotas`；全部迁完且渲染端全量消费 `quotas` 后，`windows`/`extras` 可退役。当前两者并存，由 `canonicalizeEntry` 保证一致。

## 渲染端口（Client）

按字段在场渲染，不查 `providerId`：

| 端口 | 触发字段 | 渲染 |
|---|---|---|
| 状态行 | `routeContext`（含空对象） | live→「正在服务」、recent→「上次路由」、空→「暂无路由记录 / auto 组发出请求才定上游」 |
| 账号区 | `linkedAccounts` | 按 `providerGroup` 分组平铺，焦点组置顶，>12 收进单折叠块 |
| 分池窗 | window 元素 `poolScope:"independent"`（旧条目按 antigravity 兜底） | 同池取最紧，跨池计数，部分耗尽黄、全耗尽红 |
| 余额/花费 | `extras` 或 `quotas.amount` | 结构数字优先（`readAmounts` 选器），文本兜底；按单位给告警阈值，合计按 `unitId` 分组 |
| 池汇总 | `accountPool` | CC 轮换池形态 |
| 计费标注 | `subscribed` + routeKind | OpenDesign 套餐/余额来源 |

## 回归

[tests/test-quota-schema.mjs](../tests/test-quota-schema.mjs)：元素白名单、legacy↔quotas 双向、边界收编与别名折叠。
