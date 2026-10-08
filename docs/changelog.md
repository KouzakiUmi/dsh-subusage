# 更新记录

以下按发布版本保留当时的功能与验证记录。旧版本的导航、登录方案及兼容性描述不代表当前行为；当前使用方法见 [README](../README.md)。

## 0.8.3：Kimi 月度窗口与响应形态兼容

- 修复「Invalid Kimi usage response」：`/coding/v1/usages` 的窗口集合按账户下发，部分账户只返回 `usages.limit_5h` + `limit_month_total`（无 `limit_7d`），而旧代码把 `limit_7d` 当必需字段，对这类 Key 一律判为结构非法。现在 `limit_5h` / `limit_7d` / `limit_month_total` 各自按下发内容成窗；`limit_month_code` 是月池的 Code 份额而非独立预算，不单独成窗。月池是最外层窗口，耗尽时连坐 5 小时与 7 天窗口。
- 旧形态兜底：没有比例池时，用 `limits[]` 中 `window.duration=300` / `TIME_UNIT_MINUTE` 项的 `limit` / `remaining` 反推 5 小时窗口，再用顶层 `usage` 的 `limit` / `remaining` 反推周额度；未知结构仍报错，不猜测额度。
- 测试：`tests/test-cascade.mjs` 覆盖月池耗尽连坐 5 小时、连坐来源标注与反向不连坐；`tests/test-host-service.mjs` 用实测现行响应（`limit_5h` + 月池 + `booster_wallet`）与旧绝对形态断言窗口集合与百分比。`node tests/run-all.mjs` 全部通过。

## 0.8.2：Command Code 账户切换同步控制用量显示

- 药丸弹层内的账户切换不再只影响提供方插件：切换后药丸本体与弹层上方的用量窗口同步改为显示所选账户的额度。显示账户跟随账户区的当前固定项（含初始 describe 发现的固定账户）；选择「自动轮换」时仍显示默认账户（顶层 Key）的用量，弹层标注明确说明不跟随实际服务账户。
- Client store 维护显示账户状态，所有 Command Code 读取（初始读取、刷新、定时轮询、设置页刷新）自动携带；切换账户时旧账户在途数据立即失效并强制重拉。Host 端 `read`/`refresh` RPC 新增可选 `commandCodeAccount` 参数（缺省/空串 = 默认账户），额外账户按其凭据引用名（`apiKeyEnv`）从凭据服务 → 启动环境解析 Key，与提供方插件 `slots()`/`resolveRef` 同一通道；缓存指纹计入账户，不同账户不串缓存，entry 新增 `account` 字段标注所属账户。
- 兼容性：read 的 `request` 参数在两端描述符声明 `acceptsUndefined`，缺参/undefined 按全量默认账户查询处理——旧版 Client bundle（无参 read）与新 Host 共存的窗口期内初始读取优雅降级，而不是整体失败。
- 弹层在用量窗口上方新增「上方用量：{账户}」标注行；账户区提示文案同步更新。设置页 Command Code 帮助文案改为说明显示所选账户的额度。
- 测试：`tests/test-commandcode.mjs` 覆盖按账户解析 Key（凭据服务/环境/缺失/非法引用名）、账户切换不复用缓存、同账户 TTL 命中与 query 校验；`tests/test-commandcode-accounts.mjs` 覆盖 store 显示账户状态、readAll/refresh 携带参数与弹层标注渲染；`tests/test-host-service.mjs`、`tests/test-client-behavior.mjs` 同步 RPC 契约断言，`tests/test-contract.mjs` 的两端描述符比较无需改动即覆盖 read 新参数。`node tests/run-all.mjs` 全部通过。

## 0.8.1：发布渠道修复

- 与 0.8.0 同一功能集（MiMo Cookie 有效期监控、Command Code 药丸账户切换）；0.8.0 已发布 GitHub Release（build-3e929375bf14）但未到达 npm。
- CI 新增 npm 自动发布：GitHub Release 之后用仓库 Secret `NPM_TOKEN` 发布同一构建验证过的 tarball，registry 已有该版本时跳过；手动发布流程保留为兜底。详见 [发布说明](publish.md)。

## 0.8.0：MiMo Cookie 有效期监控与 Command Code 药丸账户切换

### Command Code 药丸账户切换

- Command Code 用量药丸弹层新增「Command Code 账户」区：列出自动轮换、默认账户与各额外账户（label 与 id 规则对齐提供方插件 `slots()`），点击即切换 `activeAccount`，当前项高亮。
- 读写走 DSH settings remote 的 `llm-commandcode` namespace，与 Command Code 提供方插件设置页完全同一通道与 op 形式（固定账户 set；回自动按组合层 base 决定写空串或 unset）。切换即时生效于提供方插件的后续请求，无需重启。
- 账户列表来自 settings describe，不发起任何计费请求；提供方插件未运行或 namespace 不可用时区块降级为「账户列表不可用」，不影响用量显示。
- 药丸与弹层的额度数字仍为默认账户（顶层 Key）的用量，不随切换改变，弹层文案明确说明。切换失败（含 revision 冲突）保留失败原因并回读 Host 实际状态。
- 新增 `tests/test-commandcode-accounts.mjs` 覆盖账户列表解析、activeAccount 判定、mutate 通道、并发拒绝、失败回读与弹层渲染。

### MiMo Cookie 有效期监控

- 官方 MiMo 会话 Cookie 自签发起 **24 小时**有效。自动登录与手动导入都在凭据写入的同一刻开始计时，落盘 `xiaomi.loginAt` / `xiaomi.expiresAt`；自动登录额外参考浏览器观测到的 Cookie 过期时间，取更早者。
- 用量药丸新增凭据时效提示：剩余 2 小时内 ⚠ 黄、30 分钟内 ⚠ 橙、已过期 ✕ 红，文案「Cookie N 后到期 / 已过期，请重新登录」。额度已用尽时仍优先显示额度告警；药丸弹层常驻显示剩余时间与到期时刻。
- 设置页「MiMo 登录与凭据」显示登录时间与剩余生效时间，并说明 24 小时有效期。旧版本保存的 Cookie 没有计时记录，界面明确写「未记录登录时间」，不编造倒计时。
- 倒计时只用于展示：归零不改变凭据可用性，真实失效仍以官方接口返回为准；接口已判定凭据失效时，药丸主文案仍是失败原因，不被倒计时覆盖。计时字段是本地元数据，不是秘密，Cookie 本身不经 RPC 回传，计时则作为非敏感信息随 `settings.xiaomi` 与 entry 的 `cookieExpiresAt` 下发。
- 新增 `tests/test-mimo-cookie-expiry.mjs` 覆盖 Host 计时/落盘/下发/清除/损坏字段与 Client 四档提醒、药丸优先级、弹层与设置页文案；离线布局预览的 MiMo 假数据改为「临近到期」档位。

两项功能均通过离线回归、清单校验与组件预览核对；真实 DSH 实机验收与真实账号在线验证仍待完成。

## 0.7.0：审查修复与新增订阅商

- 新增 `zai-coding`（国际版）、`synthetic`、`nanogpt`：新安装与旧配置升级均默认关闭，即使有环境凭据也不请求用量。可在「提供商管理」手动开启；原有七项的默认值和用户已保存开关保持不变。
- Z.ai 国际版依据[官方查询脚本](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)直连监控接口，区域凭据独立；补齐 `TOKENS_LIMIT` 格式。Synthetic 使用[官方 quotas API](https://dev.synthetic.new/docs/synthetic/quotas)，只读取模型订阅请求池。
- NanoGPT 使用[官方订阅用量 API](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage)，显示每日/每周输入 Token 及试用 Token 池；支持手动填写 `sk-nano-mgmt-…` [Usage only 管理令牌](https://docs.nano-gpt.com/api-reference/management-api)，自动选择只读管理接口。忽略图像池，未开通、缺数据、降级响应不会显示虚假剩余额度。
- 修复额度重置时绕过 `Retry-After`、保存一家凭据导致其他用量消失，以及首次读取失败后无法重新初始化的问题。
- 空状态自动展开提供商管理；刷新错误始终在工具栏下可见；药丸弹层适应窄屏和深浅主题。
- Host/Client 必须一起更新。已做离线回归与浏览器布局检查，未使用真实账号在线验证。详见[审查记录](code-review.md)。

## 0.6.0：提供商管理与默认隐藏

- 设置 → 订阅用量底部新增默认折叠的「提供商管理」：七个提供商/区域独立开启或关闭，立即持久化；关闭后隐藏用量标签与药丸，停止订阅用量请求，不删除凭据、不修改模型路由。
- 新增「没有检测到API的默认隐藏」开关，默认开启。按实际 Key / MiMo Cookie 是否存在判断，不以模型路由是否注册或接口是否成功判断；认证失败、网络错误仍展示异常。
- 管理区始终列出全部提供商：每家开关与「连接与凭据」在同一卡片，就地展开编辑；MiMo 为「登录与凭据」，Command Code 为只读凭据来源。移除跨区域「配置」跳转，隐藏/关闭条目仍可就地编辑。
- 上方只显示用量，查看用量与正在编辑的提供商独立，切换用量不丢失草稿；保存结果和错误在管理区就地反馈。关闭自动隐藏后，无凭据条目恢复指引，手工关闭的提供商不会被自动重新开启。
- 开关保存与凭据保存互相隔离，脏草稿期间锁定开关，多窗口使用 revision 防止覆盖；仅改变默认隐藏不清除 Host 用量缓存。
- 所有导航与套餐选择改为按钮，窄屏自然换行，整个设置页不使用下拉列表。
- **Host 与 Client 必须一起加载新版**。本地 link 安装直接指向工作区；磁盘更新不代表正在运行的 Host/Client 已重载，必要时重启 DSH。在线账号与真实应用界面仍需验收。

## 0.5.0：MiniMax 订阅检测

- 新增 `minimax` / `minimax-cn`，分别继承 `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`，也可在设置中保存独立的订阅 Key。区域之间不自动尝试或转发 Key。
- 直连对应区域的 `/v1/token_plan/remains`，只显示 `general` 或旧版 `MiniMax-M*` 编程池，忽略视频/图像池，不累加共享额度。
- 显示短周期和周已用百分比及重置时间；优先采用 `remaining_percent`，计数明细按[官方 CLI 消歧规则](https://github.com/MiniMax-AI/cli/blob/main/src/utils/quota.ts)校准，无法匹配时只显示百分比。旧版无百分比响应按剩余计数解释。
- 无上限、未报告或零总计且无百分比的窗口不绘制，标记部分数据；没有可绘制窗口时额度未知。不推断套餐名称，周加量不折算额外百分比。
- 设置导航扩展为七个区域条目，内部宽度 ≤699px 时切换选择框。
- **Host 与 Client 必须一起更新**；未执行在线账号验收或安装。接口参考：[官方 Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq)、[官方 CLI 端点](https://github.com/MiniMax-AI/cli/blob/main/src/client/endpoints.ts)。

## 0.4.1：补齐 Command Code 月额度

- 显示月额度剩余，并按已知套餐总额计算月已用百分比和已用/上限；例如 GOAT 总额 70、剩余 55.86，显示已用 14.14 / 70（20.2%）。
- 套餐及账期来自 `/alpha/billing/subscriptions`，失败时可回退 credits 内的 planId；没有账期时不编造重置日期。
- 月总额是[提供方插件套餐表](https://github.com/Mars-Sea/dsh-commandcode-provider/blob/main/src/capabilities.ts)的快照，不是计费接口直接报告的硬上限；未知套餐只显示剩余金额并标记部分数据。套餐变更后需核对更新。
- 月余额不包含已购/赠送余额；月池耗尽不据此连坐周/5小时窗口。
- 修复非法重置日期导致整包失败，以及旧配置中的 Command Code 手动 Key 绕过托管凭据来源的问题。
- 修复 MiMo 普通刷新/缓存中的接口 Cookie 回显；脱敏正确处理分号后空格和带引号的值。
- 修复 Netscape Cookie 导入：兼容注释、`#HttpOnly_` 域前缀及 TAB 末列空值，仍严格过滤外域。
- MiMo 登录只锁定本厂商的手动导入/清除，不再阻止其他厂商更换 Key，也不产生实际未执行的待清除提示。

## 0.4.0：Command Code 用量显示

- **支持 Command Code**：该路由由另一个插件 [`@mars-sea/dsh-commandcode-provider`](https://github.com/Mars-Sea/dsh-commandcode-provider) 注册；本插件显示其 5 小时 / 每周 / 月额度池、重置时间、套餐（planId）、月剩余与已购 + 赠送余额，周窗用尽会连坐 5 小时窗口。
- **快速直连刷新**：不消费提供方插件的用量服务（它按账户逐个串行多端点、超时预算长，作为药丸来源太慢），改为自读同一凭据后并行直连 `/alpha/billing/credits` 和 `/alpha/billing/subscriptions`（各 10 秒超时）；不读取请求统计、不串行遍历账户。
- **同一凭据来源**：凭据服务 `COMMANDCODE_API_KEY` → 启动环境 → `~/.commandcode/auth.json`（`cmd login` 写入，解析方式与提供方插件一致）。本插件**不保存** Command Code 凭据；Key、登录与多账户在 设置 → Command Code 管理。
- **已知限制**：多账户轮换或固定 `activeAccount` 时显示默认（顶层 Key）账户的额度，可能与实际服务账户不同；提供方插件里自定义 `apiBase` 不会被跟随。
- **五等宽导航**：设置页厂商导航改为五等宽单行，窄内容区（≤499px）切换为选择框。

**两端必须同时更新**：旧 Host 会拒绝含 `commandcode` 的刷新请求。

## 0.3.0：按钮式凭据与 MiMo 自动登录

- **凭据按钮**：默认只展示当前来源；通过「更换 / 清除」进入编辑，再保存或取消，不再使用「保持 / 替换 / 清除」下拉菜单。
- **自动登录导入**：点击「登录并自动导入」，使用隔离的临时 Chrome 窗口完成官方登录，由 Host 验证并保存必需 Cookie。
- **原生菜单对比度**：剩余套餐/provider 选项显式配对系统前景和背景，避免深色界面出现白底白字。

### 延续的设置与可靠性改进

- **五等宽导航**：`Z.ai / Kimi / MiMo / OpenCode Go / Command` 单行显示，窄内容区改成选择框，不出现换行。
- **用量为主**：凭据与帮助折叠；顶部提供刷新当前/全部，保存按钮仅出现在编辑区。
- **共享刷新**：按厂商缓存与合并在途请求，药丸和设置页共享结果，活跃厂商每分钟检查更新。
- **两条状态轴**：数据获取成功不等于额度可用；额度不足、认证失效、缓存和部分数据均有独立说明。
- **准确限额**：原始比例决定是否限流，不把 99.5% 提前当作 100%；较长周期限额才向内层窗口连坐。
- **凭据来源**：可选择继承或自定义；读取结果不再回传完整 Key/Cookie。
- **编辑保护**：按厂商增量保存，未保存编辑不被刷新覆盖；配置版本检查防止多窗口旧表单覆盖新配置。
- **MiMo Cookie 验证**：支持标准串、多行 KV、成对 name/value、TAB 清单和 JSON 导出；解析失败保留原文，不再失焦自动破坏输入。
