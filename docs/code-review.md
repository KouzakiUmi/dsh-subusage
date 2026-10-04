# 2026-10-04 代码、功能与 UX 审查

## 已修复

| 优先级 | 问题与影响 | 处理与验证 |
|---|---|---|
| P1 | 重置时间到达时跳过整个缓存条件，连同 429 Retry-After 一并跳过，可能反复请求已限流接口 | 退避优先于重置与强制刷新；测试覆盖重置前 429、跨过重置、退避结束 |
| P1 | 保存单家凭据后，公共 revision 改变触发全厂商失效，未受影响的用量持续显示加载中 | 已知本地修改仅失效对应条目；外部 revision 变化仍保守失效全部；覆盖迟到响应与其他厂商数据保留 |
| P2 | 初始化 read 失败后，“刷新全部”只调用 refresh，无法完成初始化，开关可能一直锁定 | 没有公共配置时重新 read；错误在工具栏下显示，可直接重试 |
| P2 | 没有可见提供商时配置入口仍折叠，用户难以找到下一步 | 空状态默认展开管理区，十家均保留就地配置入口 |
| P2 | 药丸左对齐弹层在右侧工具栏容易超出屏幕；固定深色背景无法适应浅色主题 | 右侧对齐、限制视口宽度、长文本断行，使用配对的主题/系统表面与文字颜色 |
| P2 | Z.ai 只接受 CREDIT_LIMIT，无法读取官方插件使用的 TOKENS_LIMIT | 支持明确的 Token 窗口；旧版未提供 unit 的 TOKENS_LIMIT 按官方脚本的 5 小时含义处理，忽略 MCP TIME_LIMIT |

## 新增订阅商

新增 `zai-coding`、`synthetic`、`nanogpt`，Host 与 Client 的默认值一致。即使检测到凭据也不会自行开启；保存凭据不会改变开关。旧配置升级保持原有七项的开关和凭据。

- Z.ai 国际：[官方查询实现](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)。国际监控请求使用原始 Authorization Key，不尝试中国站 Key。`zai-coding` 不复用中国团队组织/项目参数。
- Synthetic：[官方 quotas 文档](https://dev.synthetic.new/docs/synthetic/quotas)。只使用 subscription 的 requests/limit/renewsAt，不合并搜索和工具池，不猜测窗口时长。
- NanoGPT：[订阅接口](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage)与[管理接口](https://docs.nano-gpt.com/api-reference/management-api)。percentUsed 是比例，resetAt 是毫秒；展示输入 Token 池并忽略图像池。管理令牌按官方前缀选择固定管理接口，普通 Key 选择固定推理 Key 用量接口，不跨接口尝试凭据。降级/缺数据为部分数据，inactive 不展示历史配额为当前可用额度。

未添加需要另建账号登录流程或缺少可核验接口契约的厂商。

## 验证与剩余限制

回归测试使用内存文件、虚构凭据和桩网络，覆盖两端 RPC、新增项默认关闭、持久化开关、区域和认证接口隔离、单位与比例、异常数据和缓存退避。浏览器布局检查使用离线真实组件输出和隔离 Chrome，覆盖深浅主题与 530/500/499/360px 内容区。

验收结果：16 个回归文件全部通过；清单、Host/Client 语法、diff 格式和 npm 打包预检通过。8 组设置页布局无横向溢出；额外检查深浅主题 × 280/360/530px 的 6 组药丸弹层边界与前景/背景颜色，并目视确认截图；三家新增提供商关闭状态下仍能展开凭据配置，360px 无溢出。离线预览脚本新增 `pill` 模式，例如 `node scripts/render-ui-preview.mjs 280 nanogpt light pill`。

真实 DSH Loader、实际账号在线响应与多账户映射未验收。模型药丸按提供商 ID 匹配，自定义路由使用其他 ID 时只能在设置页查看。Command Code 当前仍显示默认顶层账户，未跟随提供方插件的 activeAccount 或自定义 apiBase；已在 UI 中说明。非公开接口可能变更。配置仍保存为本机 JSON，尚未迁移到加密凭据库。

本次只修改工作区，未安装、重启运行中的 DSH 或发布版本。
