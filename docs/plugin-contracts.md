# 提供方插件契约核查

核查日期：2026-11-27。比对本仓库的消费代码、公开 npm 固定版本包与 GitHub 标签源码；桌面 Profile 清单另行确认了 DSH `0.2.2-rc.5`、dsh-subusage `1.0.1`、Antigravity ACP `0.1.53`、Devin `0.1.3` 与火山提供方 `0.2.21`。未调用真实账户接口或运行中的插件端点。路由存在、响应字段一致和实际账户取数是不同的检查。

## 已发现的差异

| 组件与证据 | 变化 | 本插件影响 |
|---|---|---|
| [dsh-tool-antigravity 0.6.0](https://www.npmjs.com/package/dsh-tool-antigravity/v/0.6.0)，`lib/types/quota.d.ts`、`lib/index.js` | `antigravityAuth.usage(signal?, force?)` 保持；分组枚举包括 `gemini`、`non-gemini`、`gemini-4`、`gemini-argon`，窗口仍为 `5h` / `weekly` | 当前归一化遍历所有上游组、保留未知标识并按组隔离；不再按固定两组描述 |
| [Command Code 0.19.0](https://www.npmjs.com/package/@mars-sea/dsh-commandcode-provider/v/0.19.0)，`lib/index.js` | `llm-commandcode`、`/alpha/billing/{credits,subscriptions}` 仍在；新版请求头为 `1.89.3`，部分读取支持组织参数 | 两条计费请求均同步版本头；账号与套餐额度表不变，不发送组织参数 |
| [dsh-codex-connect 0.2.0-alpha.16](https://www.npmjs.com/package/dsh-codex-connect/v/0.2.0-alpha.16)，`lib/index.js` | `openai-codex` 路由保留；Connect 自有 `.openai-codex-auth.json` v2 多账号存储 | 在 Subscription 之后、CLI 之前只读 Connect 的活动账号，兼容 v1；Connect 文件缺席才回退 CLI，坏文件不会换账号 |
| [Trae 4.19.3](https://www.npmjs.com/package/dsh-connect-trae/v/4.19.3)，`lib/index.js` | 仍注册余额 `GET /usage` 和逐账号 `GET /account-status?accountId=…`；增加独立 `account-credits`，总览可选 fast 模式。声明里逐账号的 POST 注释与实际 GET handler 不一致 | 现有 GET 路径仍在；适配器不需要改用 POST 或非现有读取路径。新版本真实响应未回放 |
| [WorkBuddy 5.33.0](https://www.npmjs.com/package/dsh-connect-workbuddy/v/5.33.0)，`lib/index.js` | `GET /usage` 支持 fast/full，仍有 `GET /account-credits`；`cn/global`、`selectionExplicit` 和 `cycleRefreshMs` 仍可见 | 本插件未请求 fast 投影，继续用默认 full；批量账号余额与完整包仍分开处理 |
| [Our Free Model v2.9.1](https://github.com/Ebony-Vinyl/dsh-our-free-model/blob/v2.9.1/vendor/channel-pack/pack.js) | GitHub 标签仍有 `/api/channel-pack`、`account.list({ provider })`、`usage.badge({ provider, force })`；npm `latest` 为 2.1.0，与 GitHub 标签版本不同 | RPC 参数与索引信封已核；十渠道各自的现行额度响应及宿主进程内接线未重验。历史实测仍记为 2.7.1 |

## 已复核的调用面与缺口

| 组件与证据 | 本插件消费面与此次结果 |
|---|---|
| [Antigravity ACP 0.1.53](https://www.npmjs.com/package/dsh-bundle-antigravity-host/v/0.1.53) | 保留 `agyQuota` 与 `QuotaSnapshot`；`read` 请求支持可选 `source`、`model`，本插件联动使用 `{ force }` |
| [Raccoon 0.2.6](https://www.npmjs.com/package/dsh-raccoon-connect/v/0.2.6) | 公开包仍有单账号状态构造及 `probeKey`；本插件只保留积分/状态所需字段，不把 `probeKey` 带入额度输出 |
| [Loomy 0.2.0](https://github.com/gdrpzym/dsh-loomy-connect/blob/main/src/web-status.ts) | GitHub `main` 清单为 0.2.0，公开源码仍有 `/status` 的永久/每日积分和 `updatedAt`；npm `latest` 未找到，未核独立发布包 |
| [Devin 0.1.3](https://www.npmjs.com/package/dsh-devin-provider/v/0.1.3) | 已装与 npm 版本一致；发布包 `USER_STATUS_RPC` 为 `GetUserStatus`，`CLI_VERSION` 为 `3000.11.3`，与本插件一致 |
| [火山提供方 0.2.21](https://www.npmjs.com/package/dsh-volcengine-provider/v/0.2.21) | 两条 `volcengine-*` 路由名仍在。本插件仅匹配路由，使用独立 IAM AK/SK 读取 Ark 额度，不复用其 OAuth |
| [OpenDesign CoRouter 0.3.5](https://www.npmjs.com/package/dsh-opendesign-corouter/v/0.3.5) | `opendesign-corouter-plan` / `opendesign-corouter-paid` 与本插件路由映射一致；控制台 Cookie 与额度端点不由 CoRouter 管理 |
| [Codex Subscription 3.2.33](https://www.npmjs.com/package/dsh-codex-subscription/v/3.2.33) | `codex-subscription/accounts` v1 grant、`activeId` 与活动账号 `credential` 仍在；本插件只读，不沿用其刷新过程 |
| [Grok Kit 0.2.13](https://www.npmjs.com/package/dsh-grok-kit/v/0.2.13) | 包仍导出 `XaiOAuthSession`，仍包含 `.grok/auth.json` 与 `models.getAuth("xai")`；实际动态加载与续约未执行 |
| [Copilot Auth 1.2.27](https://www.npmjs.com/package/@inventec/dsh-copilot-auth/v/1.2.27) | 仍围绕 DSH `github-copilot` 路由；本插件消费的是宿主凭据库中的 `llm-pi-ai/github-copilot`。未重验该版本实际写出的记录和 GitHub 额度响应 |
| [Magpie v0.1.4949](https://github.com/yetone/magpie/blob/v0.1.4949/internal/gateway/gateway.go) | 上游仍注册 `/v1/magpie/quotas?kept=1`、`/v1/magpie/usage/requests`、`/v1/magpie/concurrency` 与 `/v1/models` 的 GET 路由；未重验卡片和实时遥测全量字段 |
| DSH 内置 DeepSeek 账号、Codex 路由及 Go 桥接 | 本次确认了桌面 Profile Core 版本；未重跑 Cordis 服务的在线验证、账号查询或 Go 真机。不把安装清单升级为兼容性结论 |

`dsh-unified-router`、`dsh-kxyai-provider` 出现在当前 Profile 清单中，但本仓库未登记这两个插件的额度联动；前者的旧回退路径已经移除。其它同进程插件可使用 [额度上报](ingest-handoff.md)，无需新增单独适配器。
