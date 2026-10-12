# 提供商覆盖与取舍

记录 dsh-subusage 的覆盖范围，以及**评估过但不接入**的厂商与理由——避免同一个候选被反复评估、或在没有新证据的情况下被重新提起。

> 本文件是决策记录，不是接入指引。当前行为、凭据与窗口语义见 [README](../README.md)。

## 已支持（27 条 provider id）

| provider id | 额度类型 | 鉴权 | 默认 |
|---|---|---|---|
| `deepseek` | 余额（账户） | Bearer，与推理同 Key | 开 |
| `zai-coding-cn` / `zai-coding` | 订阅窗口 | 中国 Bearer（团队档另加组织/项目头）/ 国际裸 `authorization` | 中国开 / 国际关 |
| `kimi-coding` | 订阅窗口 | Bearer | 开 |
| `xiaomi-token-plan-cn` | 周期额度池 | 官方平台 Cookie（含登录流程） | 开 |
| `opencode-go` | 订阅窗口 | Bearer | 开 |
| `commandcode` | 5h / 周 / 月额度池 | 提供方插件的凭据链 | 开 |
| `openai-codex` | ChatGPT 订阅窗口 | 只读 Codex CLI 的 OAuth 登录文件 | 关（提供方插件自带用量药丸） |
| `xai-oauth` | 周期池 | 共享 Grok CLI 登录文件，过期经 grok-kit 官方链续约 | 开 |
| `minimax-cn` | 短周期 / 周 | Bearer | 开 |
| `arkcli-agent-plan` / `arkcli-coding-plan` | 订阅窗口（AFP / 按次数） | 管控面 IAM AK/SK 签名 | 开 |
| `minimax` | 短周期 / 周 | Bearer | 关（国际版实际使用少） |
| `synthetic` | 滚动订阅池 | Bearer | 关 |
| `arkcli-agent-plan-team` / `arkcli-coding-plan-team` | 席位额度（AFP / 百分比） | 同 AK/SK，另需查看席位的权限 | 关 |
| `siliconflow` | 余额 | Bearer，与推理同 Key | 关 |
| `openrouter` | 限额窗口 + 余额 | 推理 Key（余额需 management key） | 关 |
| `novita` / `hyperbolic` / `deepinfra` / `chutes` / `ollama-cloud` / `vercel-ai-gateway` | 余额或配额 | 各自推理 Key（Ollama 用裸 Authorization） | 关 |
| `nanogpt` | 日 / 周配额 + 余额 | 单 Key（余额端点用 x-api-key） | 关 |
| `zenmux` | 5h 配额 + PAYG 余额 | **Management API Key** | 关 |
| `litellm` | 预算 + 花费 | 虚拟 Key + **用户自填 proxy 地址** | 关 |

> 火山方舟以官方 CLI（`arkcli helper configure`）写入的 `arkcli-*` 为准：个人版 2 条 + 团队版 2 条，共 **4 条**，共用一组 IAM AK/SK。旧插件 `@volcengine/ark-plan-api` 的两个国内 id（`ark-agent-plan-cn` / `ark-coding-plan-cn`）已从 Host 移除，但 Client 入口（`ROUTE_PROVIDER_ALIAS`）会把它们**归并**到对应的 arkcli 路由——装了旧插件的用户选中那些模型时，药丸仍显示同一份订阅数据，不需要改装。BytePlus 站点（`ark-coding-plan-byteplus`）本机无账号可验证，已整条移除：Host 不识别、Client 也不归并。企业版 / 团队版需要查看席位的权限，默认关闭。


## 评估后不接入

| 厂商 / 产品 | 调研结论 | 不接入的理由 |
|---|---|---|
| **Requesty** | `GET /v1/manage/apikey/{id}/usage`；**无余额端点** | ①只有花费/用量，不是订阅额度；②**GET 带 requestBody** 属非标准调用，上游一改就断；③文档两处 host 不一致（`api.requesty.ai` vs `api-v2.requesty.ai`），管理端点是否接受推理 key 未证实 |
| **Portkey** | `GET /v1/analytics/graphs/cost`（头 `x-portkey-api-key`） | ①只有一个花费分析端点，无余额；②**响应字段结构未证实**（文档站曾 526，仅证实端点存在），接进去可能是错的 |
| **Groq** | 普通 API Key **查不到**额度；只有浏览器 Cookie（`stytch_session`）或 Enterprise key 两条路 | ①与"只用凭据、不抓浏览器会话"的架构冲突（本插件唯一的 Cookie 路径是 MiMo，且有完整登录流程支撑）；②Enterprise 路径要求 `GET /v1/metrics/prometheus/api/v1/query`，普通 key 返回 404 |
| **Together AI** | 未找到公开额度/计费 API | 只有控制台页面；文档只提"programmatic monitoring"但无端点 |
| **Cerebras** | 未找到额度 API | 用量与计费都在 Cloud Console |
| **讯飞星火 / 国家超算 SCNet / 腾讯 CodeBuddy / 无问芯穹 / 美团 LongCat / 京东云** | 官方文档明确只有控制台 | 无接口可接，不是实现成本问题 |
| **潞晨云** | 公有云 **2026-09-21 已停服** | 服务不存在 |

## 已由用户决策跳过

| 厂商 | 决策 | 说明 |
|---|---|---|
| **Anthropic（Claude Pro / Max）** | 2026-10-09 用户决定**跳过** | 理由：地缘政治导致实际使用的人很少。**接口本身是可接入的**（`GET https://api.anthropic.com/api/oauth/usage`，凭据为 Claude Code 的 OAuth 登录文件，需 `user:profile` scope + `anthropic-beta: oauth-2025-04-20`），CodexBar / cc-switch / QuotaRadar 三家实现互相印证。若将来用户群变化，这是最值得回头做的一家。 |

## 候选但尚未评估完

| 厂商 | 状态 |
|---|---|
| 联通云 / 移动云 / 天翼云 / 优云智算 / 九章智算云 / 摩尔线程 / GitCode AtomCode | 只在第三方汇总里确认套餐存在，**未逐个核查是否有额度 API** |
| 商汤 SenseNova Token Plan / 昆仑万维天工 | 未找到额度端点证据，**无法判定** |
| Baseten / Modal / RunPod / Nebius / SambaNova 等算力平台 | 未评估（与"模型订阅额度"目标偏离） |
