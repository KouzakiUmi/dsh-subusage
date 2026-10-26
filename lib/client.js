// dsh-subusage —— 订阅用量显示（Client 侧）
//
// 两块 UI：
//   1. 用量药丸（conversation.input.right 槽，紧邻模型选择器左侧）：按当前选中模型的
//      provider 显示对应模型商的订阅用量，拉取成功 🟢 / 失败 🔴；点开看三窗明细。
//   2. 设置页（settings.section 槽，OpenCode Go 同款布局）：检测已配置模型商、继承
//      环境 Key、缺失项手动填写；MiMo 仅使用官方站点链接与显式 Cookie 替换。
//
// Remote 契约与 Host 的 lib/index.js 对齐（dsh-subusage#SubUsageResult / Settings）。

window.__ModuleLoader__.load({
	id: "dsh-subusage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		// ── 词典 ────────────────────────────────────────────────────────────────
		const zh = {
			nav: "订阅用量",
			title: "订阅用量显示",
			hint: "按当前会话模型显示对应模型商的订阅用量。Key 可继承凭据服务或环境变量，也可手动设置；MiMo 使用官方平台 Cookie。仅活跃模型商每分钟刷新，数据获取成功不表示仍有额度。",
			refresh: "立即刷新",
			refreshing: "刷新中…",
			save: "保存设置",
			saving: "保存中…",
			saved: "已保存",
			lastUpdated: "更新于",
			lightOk: "全部拉取成功",
			lightFail: "存在拉取失败",
			statusOk: "数据获取成功",
			statusPartial: "数据不完整",
			statusCache: "缓存数据",
			cacheAge: "缓存 · {n} 分钟前",
			cacheUnknown: "缓存时间未知",
			badgeUnknown: "未确认",
			statusDisabled: "订阅检测已关闭",
			statusNoKey: "未配置 API Key",
			statusNoCookie: "需登录",
			statusError: "拉取失败",
			detected: "已配置路由",
			notDetected: "未配置路由",
			keyEnv: "已继承环境变量 {name}",
			keyManual: "手动填写的 Key",
			keyNone: "未继承环境 Key",
			keyPlaceholder: "留空保持不变；填写即覆盖",
			keyLabel: "API Key",
			zaiType: "套餐类型",
			zaiTypePersonal: "个人（type=1）",
			zaiTypeTeam: "团队（type=2）",
			zaiOrg: "组织 ID（团队套餐）",
			zaiProject: "项目 ID（团队套餐）",
			zaiOrgHint: "仅团队套餐需要：在 bigmodel.cn/coding-plan 登录后从 DevTools 请求头 bigmodel-organization / bigmodel-project 抄取。",
			mimoCookie: "敏感 Cookie（仅替换，不回填）",
			mimoCookieHint: "在官方平台登录后导入 Cookie，支持 JSON、多行 name=value、TAB 表格；保存前验证并规范化，必须含 api-platform_serviceToken 与 userId。Cookie 不会回填，请仅在需要替换时输入。",
			resets: "重置于",
			limited: "已达限额",
			cascadeLimited: "（受更长周期限额连累，暂不可用）",
			loading: "正在读取用量…",
			unavailable: "暂不可用",
			planLabel: "套餐",
			balanceLabel: "余额",
			balanceLow: "余额偏低",
			pillNeedDeepseekAccount: "请在 DSH 设置 → 账号与余额登录；此入口不使用 API Key。",
			spendLabel: "已用",
			monthlyBalanceLabel: "月额度剩余",
			// OpenDesign 的两个美元数字分属两个池：套餐（订阅）额度、钱包合计（订阅 + 充值）。
			// 旧文案「月额度剩余 / 余额」让两个数看起来像在互相比较——谁大谁小、是不是同一份额度；
			// 按池子改名后各说各的，比较关系也就不必猜了。
			planBalanceLabel: "套餐余额",
			totalBalanceLabel: "总额度",
			planSnapshotLimit: "月总额来自套餐快照，不含已购/赠送余额；未知套餐不推算上限",
			w5h: "5 小时",
			w7d: "7 天",
			wweek: "每周",
			wday: "每日",
			wmonth: "每月",
			wperiod: "本周期",
			wsub: "本周期",
			wrolling: "滚动",
			// 药丸上的窗口短标签（只在有多个窗口时才出现）：不要用 W / M / D 这类缩写让人猜，直接给中文单位。
			s5h: "5时",
			s7d: "7天",
			sday: "日",
			sweek: "周",
			smonth: "月",
			speriod: "周期",
			ssub: "订阅",
			srolling: "滚动",
			wall: "全部",
			detailUsed: "已用 {used} / 总计 {limit} {unit}",
			detailReset: "重置于 {time}",
			detailResetIn: "重置于 {time}（还有 {rest}）",
			detailResetDue: "已到重置时间，等待刷新",
			restDays: "{n} 天",
			restHours: "{n} 小时",
			restMins: "{n} 分钟",
			// 档位词只描述「还剩多少」；旧的「偏高」没写清主语（用量高还是余量高），读起来自相矛盾。
			// 键名 badgeHigh 保留（它对应已用 71–90% 的档位），文案改成「偏少」。
			badgeOk: "充足",
			badgeHigh: "偏少",
			badgeTight: "即将用尽",
			badgeLimited: "已用尽",
			badgeBlocked: "受连累",
			statusPlenty: "额度充足",
			statusLow: "余量偏低",
			statusTight: "即将用尽",
			statusExhausted: "额度已用尽",
			statusBlocked: "暂不可用",
			statusWorst: "最紧张：{w} · 剩 {p}%",
			statusOnly: "{w} · 剩 {p}%",
			statusResetIn: "{rest}后重置",
			remainWord: "剩余",
			numUsed: "已用 {p}%",
			numLimited: "⚠ 已达限额",
			numBlocked: "⚠ 暂不可用",
			pillRemaining: "余 {p}%",
			pillLimited: "已用尽",
			pillBlocked: "受连累",
			needConfigShort: "需配置",
			pillNeedKey: "未配置 API Key —— 请打开 设置 → 订阅用量 填写，或导出同名环境变量后重启。",
			pillNeedCookie: "需登录 —— 请在 设置 → 订阅用量 访问官方平台并替换 Cookie。",
			mimoCookieTtl: "官方会话 Cookie 有效期 24 小时，登录或导入时开始计时；临近到期时用量药丸会提示。",
			mimoLoginAt: "登录于 {time}",
			mimoCookieUntracked: "未记录登录时间（旧版本保存的 Cookie），重新登录后开始计时",
			mimoCookieExpired: "Cookie 已过期，请重新登录",
			mimoCookieExpiredShort: "Cookie 已过期",
			pillCookieSoon: "Cookie {rest}后到期",
			pillCookieSoonShort: "Cookie 将到期",
			mimoCookieExpiresAt: "{time} 到期",
			afpGroupText: "文本 / 向量模型",
			afpGroupVision: "视觉 / 语音模型与 Harness",
			groupMemberBudget: "成员预算",
			groupCopilotPremium: "高级请求",
			groupCopilotChat: "聊天",
			groupCopilotCompletions: "代码补全",
			pillNeedCopilot: "需登录 —— 请在 设置 → GitHub Copilot（dsh-copilot-auth）完成设备码登录；额度读取复用该登录，本插件不保存凭据。",
			noUsageData: "暂无额度数据",
			statusPaygo: "可按量续用",
			statusPaygoSub: "已购余额或计费接口支持按量续用；实际请求与余额仍以服务端为准",
			statusIncludedAdvice: "基础额度已用尽，接口仍允许订阅续用",
			statusAvailabilityUnknown: "续用条件待确认",
			statusRestricted: "账户或预算已受限",
			statusScopeLimited: "部分能力额度已用尽",
			statusPoolAvailable: "轮换池仍有可用账户", statusPoolAvailableShort: "池可用", scopeAllShort: "共享额度",
			statusPoolUnknown: "轮换池可用性待确认",
			budgetKey: "Key 预算", budgetUser: "用户预算", budgetTeam: "团队预算", budgetScope: "上级预算",
			noteLabel: "说明", creditStatusLabel: "Credits 状态", statusUnlimited: "已报告的套餐窗口不设限",
			statusPaygoShort: "按量续用", statusIncludedShort: "仍可续用", statusUnknownShort: "续用待确认", statusScopeShort: "部分能力用尽", statusRestrictedShort: "已受限",
			providerUnavailable: "用量暂不可用",
			pillNeedCommandcode: "需配置 —— 可在 设置 → Command Code 登录、运行 cmd login，或导出 COMMANDCODE_API_KEY 后重试。",
			pillNeedGrok: "需登录 —— 可在 设置 → Grok Kit（xAI OAuth）登录或运行 grok login（共享登录文件 ~/.grok/auth.json）。",
			accountLabel: "账户",
			commandcodeManaged: "凭据由 Command Code 提供方插件（设置 → Command Code）管理；本页只读、不保存凭据。用量由本插件直接拉取其计费接口，取用同一凭据来源（凭据服务 COMMANDCODE_API_KEY → 启动环境 → ~/.commandcode/auth.json）。",
			commandcodeHelp: "并行读取 /alpha/billing/credits 和 /alpha/billing/subscriptions（默认 API 地址 https://api.commandcode.ai）。月总额按已知套餐快照推算，未知套餐只显示月剩余；月池耗尽不代表已购/赠送池不可用。显示选中账户的额度（未选择时为默认账户/顶层 Key），可能与实际服务账户不同；插件里自定义 apiBase 不会被跟随。账户切换就在下方「Command Code 账户」区，与药丸弹层同一开关；模型查询额度工具时会同时给出全部账户的余量与当前激活项。",
			grokManaged: "凭据由 dsh-grok-kit / Grok CLI 的 OAuth 登录文件（~/.grok/auth.json）管理；本页不保存凭据，平时只读该文件。access token 过期时，本插件借 dsh-grok-kit 的官方登录链自动续约（同一文件、同一把写锁，不会顶掉它的登录态）；未安装 dsh-grok-kit 或续约失败时才提示手动重新登录。用量优先直连 Grok CLI 计费代理（cli-chat-proxy.grok.com）；该代理的 credits 格式失败或成功但缺百分比时，用同一凭据回退或补查 grok.com 的 GetGrokCreditsConfig。",
			grokHelp: "The X Subscription 与旧 SuperGrok 共用此入口，并行读取 /v1/billing?format=credits 与 /v1/settings。credits 格式在部分迁移账号上会 500 时，回退 grok.com gRPC-web 周池百分比。新订阅的周池由该席位的 Grok、Grok Bot 和 Cursor 第一方用量共享，不另加一个 Cursor 池；套餐名取 subscription_tier_display，充值余额 prepaidBalance 以美元显示。代理缺百分比时最多补查一次 consumer gRPC（6 秒）；完整成功响应中的活跃周/月周期与代理一致时，可确认省略的协议零值为已用 0%。无法核实时仍显示部分数据，不把充值消费折算为订阅用量。团队周池按席位独立，充值余额共享；本入口只读取当前登录身份，不汇总工作区。需 OAuth 登录，XAI_API_KEY 不能替代。",
			ccAccountsTitle: "Command Code 账户",
			ccAccountAuto: "自动轮换",
			ccAccountDefault: "默认账户",
			ccAccountActive: "使用中",
			ccAccountsHint: "切换对 Command Code 提供方插件全局生效（与其设置页同一开关）；上方用量与药丸同步切换为所选账户的额度。设置页与药丸弹层用的是同一个开关。",
			ccAccountsUnavailable: "账户列表不可用（需要 Command Code 提供方插件在运行）",
			ccUsageAccount: "上方用量：{account}",
			ccUsageAutoNote: "自动轮换时下方数字是默认账户（顶层 Key）的额度，不是正在处理请求的账户",
			ccWindowsDefault: "默认账户额度（不是当前请求账户）",
			ccSwitching: "切换中…",
			ccSwitchFailed: "切换失败",
			// Command Code 自动轮换池健康度（其余账户用量由 Host 并行读取，各自缓存 60 秒）。
			ccPoolTitle: "轮换账户池",
			ccPoolDetails: "点击查看详情", ccPoolWindowLimited: "{windows}额度已用尽", ccPoolLimitUnknown: "额度受限（周期未知）", ccPoolPeriodUnknown: "未知周期",
			ccPoolAllHealthy: "{n} 个账户均可轮换使用",
			ccPoolCapacity: "{available}/{total} 个账户可用，{blocked} 个账户有额度窗口受限",
			ccPoolUnusable: "{unusable} 个账户无可用凭据或暂时读不到",
			ccPoolExhausted: "轮换账户均已达限额，新请求很可能被拒绝",
			ccPoolExhaustedShort: "池已满限额",
			ccPoolClickToPin: "点击可固定到此账户",
			// Host 失败原因按 errorCode 本地化（Host message 为中文兜底，原文保留在节点 title 供排障）。
			errNetwork: "网络请求失败或超时，请稍后重试",
			errHttp: "服务暂时不可用，请稍后重试",
			errRateLimit: "请求过于频繁，已按服务端要求退避，请稍后再试",
			errAuth: "登录或凭据已失效，请检查或重新配置",
			errCredentials: "凭据无法解析，请检查凭据来源",
			errIdentityTimeout: "凭据解析超时，请稍后重试",
			errResponse: "用量响应无法解析（上游接口可能已变更）",
			errConfig: "本机订阅设置无法读取或保存",
			errRevisionConflict: "设置已被其他窗口修改，请重新读取后再保存",
			errConfigChanged: "读取期间配置已改变，请刷新",
			errUnknownProvider: "本机运行中的 Host 版本较旧，不认识该提供商；重启 DSH 后生效",
			errTimeout: "查询超时，请稍后重试或减少查询家数",
			errDisposed: "服务已卸载"
		};
		const en = {
			nav: "Subscription usage",
			title: "Subscription usage display",
			hint: "Shows subscription usage for the current model provider. Keys inherit from the credential service or environment, or can be set manually. MiMo uses the official platform Cookie. Only active providers refresh every minute. Fetch success does not mean quota remains.",
			refresh: "Refresh now",
			refreshing: "Refreshing…",
			save: "Save settings",
			saving: "Saving…",
			saved: "Saved",
			lastUpdated: "Updated",
			lightOk: "All fetches succeeded",
			lightFail: "Some fetches failed",
			statusOk: "Fetch OK",
			statusPartial: "Partial data",
			statusCache: "Cached data",
			cacheAge: "Cached · {n} min ago",
			cacheUnknown: "Cache age unknown",
			badgeUnknown: "Unconfirmed",
			statusDisabled: "Subscription detection disabled",
			statusNoKey: "No API key configured",
			statusNoCookie: "Login required",
			statusError: "Fetch failed",
			detected: "Route configured",
			notDetected: "No route configured",
			keyEnv: "Inherited from {name}",
			keyManual: "Manual API key",
			keyNone: "No inherited key",
			keyPlaceholder: "Leave empty to keep; type to override",
			keyLabel: "API key",
			zaiType: "Plan type",
			zaiTypePersonal: "Personal (type=1)",
			zaiTypeTeam: "Team (type=2)",
			zaiOrg: "Organization ID (team plans)",
			zaiProject: "Project ID (team plans)",
			zaiOrgHint: "Team plans only: log in at bigmodel.cn/coding-plan and copy the bigmodel-organization / bigmodel-project request headers from DevTools.",
			mimoCookie: "Sensitive Cookie (replace only; never filled back)",
			mimoCookieHint: "Sign in on the official platform and import JSON, name=value lines or a TAB table. Cookie is validated before saving and is never filled back. Requires api-platform_serviceToken and userId.",
			resets: "Resets",
			limited: "Limit reached",
			cascadeLimited: " (blocked by a larger window's limit)",
			loading: "Loading usage…",
			unavailable: "Unavailable",
			planLabel: "Plan",
			balanceLabel: "Balance",
			balanceLow: "Low balance",
			pillNeedDeepseekAccount: "Sign in under DSH Settings → Account & balance; this entry does not use an API key.",
			spendLabel: "Spent",
			monthlyBalanceLabel: "Monthly credits remaining",
			planBalanceLabel: "Plan balance",
			totalBalanceLabel: "Total balance",
			planSnapshotLimit: "Monthly total uses a plan snapshot, excluding purchased/free credits; unknown plans have no estimated cap",
			w5h: "5 hours",
			w7d: "7 days",
			wweek: "Week",
			wday: "Day",
			wmonth: "Month",
			wperiod: "Period",
			wsub: "Monthly",
			wrolling: "Rolling",
			// Pill window tags (only shown when there are several windows): spell out the unit rather than D/W/M.
			s5h: "5h",
			s7d: "7d",
			sday: "1d",
			sweek: "1w",
			smonth: "1m",
			speriod: "cycle",
			ssub: "sub",
			srolling: "roll",
			wall: "All",
			detailUsed: "Used {used} / total {limit} {unit}",
			detailReset: "Resets {time}",
			detailResetIn: "Resets {time} (in {rest})",
			detailResetDue: "Reset due — waiting for refresh",
			restDays: "{n} d",
			restHours: "{n} h",
			restMins: "{n} min",
			// Tier words describe what is LEFT; the old "High" never said high what.
			badgeOk: "Plenty",
			badgeHigh: "Low",
			badgeTight: "Almost out",
			badgeLimited: "Used up",
			badgeBlocked: "Blocked",
			statusPlenty: "Plenty left",
			statusLow: "Running low",
			statusTight: "Almost out",
			statusExhausted: "Quota used up",
			statusBlocked: "Temporarily blocked",
			statusWorst: "Tightest: {w} · {p}% left",
			statusOnly: "{w} · {p}% left",
			statusResetIn: "resets in {rest}",
			remainWord: "left",
			numUsed: "Used {p}%",
			numLimited: "⚠ Limit reached",
			numBlocked: "⚠ Unavailable",
			pillRemaining: "{p}% left",
			pillLimited: "Used up",
			pillBlocked: "Blocked",
			needConfigShort: "Setup",
			pillNeedKey: "No API key — open Settings → Subscription usage to fill one in, or export the same-named env variable and restart.",
			pillNeedCookie: "Login required — paste a cookie in Settings → Subscription usage.",
			mimoCookieTtl: "The official session Cookie lasts 24 hours; the countdown starts at sign-in or import. The usage pill warns before it runs out.",
			mimoLoginAt: "Signed in {time}",
			mimoCookieUntracked: "Login time not recorded (Cookie saved by an older version); sign in again to start the countdown",
			mimoCookieExpired: "Cookie expired — sign in again",
			mimoCookieExpiredShort: "Cookie expired",
			pillCookieSoon: "Cookie expires in {rest}",
			pillCookieSoonShort: "Cookie expiring",
			mimoCookieExpiresAt: "Expires {time}",
			afpGroupText: "Text / embedding models",
			afpGroupVision: "Vision / speech models and Harness",
			groupMemberBudget: "Member budget",
			groupCopilotPremium: "Premium requests",
			groupCopilotChat: "Chat",
			groupCopilotCompletions: "Completions",
			pillNeedCopilot: "Login required — finish the device-code sign-in under Settings → GitHub Copilot (dsh-copilot-auth); quota reads reuse that login and this plugin stores no credentials.",
			noUsageData: "No quota data",
			statusPaygo: "Paid usage available",
			statusPaygoSub: "Purchased balance or billing advice permits paid usage; the server and actual balance remain authoritative",
			statusIncludedAdvice: "Base quota used up; subscription usage still advised",
			statusAvailabilityUnknown: "Continuation conditions not confirmed",
			statusRestricted: "Account or budget restricted",
			statusScopeLimited: "Some capability quotas used up",
			statusPoolAvailable: "Rotation pool still has usable accounts", statusPoolAvailableShort: "pool usable", scopeAllShort: "shared quota",
			statusPoolUnknown: "Rotation pool availability not confirmed",
			budgetKey: "Key budget", budgetUser: "User budget", budgetTeam: "Team budget", budgetScope: "Parent budget",
			noteLabel: "Note", creditStatusLabel: "Credits status", statusUnlimited: "Reported plan windows are unlimited",
			statusPaygoShort: "paid usage", statusIncludedShort: "usage advised", statusUnknownShort: "check continuation", statusScopeShort: "some quotas used up", statusRestrictedShort: "restricted",
			providerUnavailable: "Usage unavailable",
			pillNeedCommandcode: "Setup required — sign in under Settings → Command Code, run cmd login, or export COMMANDCODE_API_KEY and retry.",
			pillNeedGrok: "Login required — sign in under Settings → Grok Kit (xAI OAuth) or run grok login (shared login file ~/.grok/auth.json).",
			accountLabel: "Account",
			commandcodeManaged: "Credentials are managed by the Command Code provider plugin (Settings → Command Code); this page is read-only and stores nothing. Usage is fetched directly by this plugin from its billing endpoint, using the same credential sources (credential service COMMANDCODE_API_KEY → launch environment → ~/.commandcode/auth.json).",
			commandcodeHelp: "Parallel requests to /alpha/billing/credits and /alpha/billing/subscriptions (default API base https://api.commandcode.ai). Monthly totals use a known-plan snapshot; unknown plans show remaining credits only. Monthly-pool depletion does not imply purchased/free credits are unusable. Shows the selected account's quota (the default/top-level key account when none is selected), which may differ from the serving account; a custom apiBase in the provider plugin is not followed. Account switching lives in the “Command Code accounts” block below — the same switch as the pill popover; the quota tool reports every account plus which one is active.",
			grokManaged: "Credentials are the OAuth login file shared by dsh-grok-kit / Grok CLI (~/.grok/auth.json); this page stores nothing and only reads the file. When the access token expires, this plugin renews it through dsh-grok-kit's (≥0.2.0) official sign-in chain — same file, same write lock, so the shared login cannot be invalidated by this renewal; it only asks for a manual re-login when dsh-grok-kit is absent or renewal fails. Usage is fetched first from the Grok CLI billing proxy (cli-chat-proxy.grok.com); if that credits format fails or omits the percentage, the same credential is used against grok.com GetGrokCreditsConfig.",
			grokHelp: "The X Subscription and legacy SuperGrok share this entry: /v1/billing?format=credits plus /v1/settings. If the credits format returns 500 on a migrated account, weekly percent falls back to grok.com gRPC-web. The new weekly pool is shared by eligible first-party Grok, Grok Bot and Cursor usage for the seat, not an additional Cursor quota. The plan comes from subscription_tier_display; prepaidBalance is shown in USD. An omitted proxy percentage triggers one consumer gRPC check (6-second budget). A complete successful response with an active matching weekly/monthly period can confirm proto3 implicit zero as 0% used. Otherwise data stays partial; prepaid spending is never included usage. Team seats have individual weekly pools and a shared prepaid balance; this entry reads only the signed-in identity, not a workspace aggregate. OAuth sign-in is required; XAI_API_KEY is not a substitute.",
			ccAccountsTitle: "Command Code accounts",
			ccAccountAuto: "Automatic (rotation order)",
			ccAccountDefault: "Default account",
			ccAccountActive: "in use",
			ccAccountsHint: "Switching applies globally to the Command Code provider plugin (same switch as its settings page); the usage above and the pill follow the selected account. This page and the pill popover share one switch.",
			ccAccountsUnavailable: "Account list unavailable (requires the Command Code provider plugin to be running)",
			ccUsageAccount: "Usage above: {account}",
			ccUsageAutoNote: "with automatic rotation the numbers below are the default (top-level key) account, not the serving one",
			ccWindowsDefault: "Default account quota (not the serving account)",
			ccSwitching: "Switching…",
			ccSwitchFailed: "Switch failed",
			// Command Code rotation-pool health (the Host reads the other accounts in parallel, each cached 60s).
			ccPoolTitle: "Rotation account pool",
			ccPoolDetails: "Click to view details", ccPoolWindowLimited: "{windows} quota used up", ccPoolLimitUnknown: "Quota restricted (period unknown)", ccPoolPeriodUnknown: "Unknown period",
			ccPoolAllHealthy: "All {n} accounts are available",
			ccPoolCapacity: "{available}/{total} accounts available, {blocked} with limited quota windows",
			ccPoolUnusable: "{unusable} account(s) have no usable credentials or could not be read",
			ccPoolExhausted: "Every rotation account is at its limit; new requests are likely to be rejected",
			ccPoolExhaustedShort: "pool at limit",
			ccPoolClickToPin: "Click to pin to this account",
			// Host failure reasons localized by errorCode (the Host message stays Chinese; the raw text remains in node title for debugging).
			errNetwork: "Network request failed or timed out; retry shortly",
			errHttp: "The service is temporarily unavailable; retry shortly",
			errRateLimit: "Rate limited; backing off as the server asked, retry shortly",
			errAuth: "Sign-in or credentials were rejected; check or re-enter them",
			errCredentials: "Credentials could not be resolved; check the credential source",
			errIdentityTimeout: "Credential resolution timed out; retry shortly",
			errResponse: "The usage response could not be parsed (the upstream API may have changed)",
			errConfig: "The local subscription settings could not be read or saved",
			errRevisionConflict: "Settings were changed in another window; reload before saving",
			errConfigChanged: "Settings changed during the read; refresh",
			errUnknownProvider: "The running Host is older and does not know this provider; restart DSH to take effect",
			errTimeout: "The query timed out; retry shortly or query fewer providers",
			errDisposed: "The service has been unloaded"
		};
		const NS = "settings.subusage";
		const KIND_LABEL = { "5h": "w5h", "7d": "w7d", day: "wday", week: "wweek", month: "wmonth", period: "wperiod", sub: "wsub", rolling: "wrolling" };
		// 药丸的窗口短标签存的是 locale key：让人看 "W"/"M"/"D" 去猜是哪个窗口，不如直接给单位。
		const KIND_SHORT = { "5h": "s5h", "7d": "s7d", day: "sday", week: "sweek", month: "smonth", period: "speriod", sub: "ssub", rolling: "srolling" };
		const PROVIDER_META = {
			// 余额型：接口给账户余额而不是订阅窗口，药丸用余额兜底文案显示。
			"deepseek": { label: "DeepSeek API", short: "DeepSeek API", envName: "DEEPSEEK_API_KEY" },
			"deepseek-account": { label: "DeepSeek account", labelZh: "DeepSeek 账号", short: "DeepSeek 账号", envName: "", managedByPlugin: true },
			"zai-coding": { label: "Z.ai Coding (International)", labelZh: "Z.ai Coding（国际）", short: "Z.ai Intl", envName: "ZAI_CODING_API_KEY", defaultEnabled: false },
			"synthetic": { label: "Synthetic", short: "Synthetic", envName: "SYNTHETIC_API_KEY", defaultEnabled: false },
			"nanogpt": { label: "NanoGPT", short: "NanoGPT", envName: "NANOGPT_API_KEY", defaultEnabled: false },
			"zai-coding-cn": { label: "Z.ai Coding (CN)", labelZh: "Z.ai Coding（中国）", short: "Z.ai", envName: "ZAI_CODING_CN_API_KEY" },
			"kimi-coding": { label: "Kimi Coding", short: "Kimi", envName: "KIMI_CODING_API_KEY" },
			"xiaomi-token-plan-cn": { label: "Xiaomi Token Plan (CN)", labelZh: "小米 MiMo", short: "MiMo", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" },
			// 凭据引用有两种写法（与 Host 的 credentialRefNames 同序）：单列 Go 套餐时路由 apiKeyEnv 是
			// OPENCODE_GO_API_KEY；pi-ai 内置路由的默认名是与 Zen 余额共用的 OPENCODE_API_KEY。
			"opencode-go": { label: "OpenCode Go", short: "OpenCode Go", envName: "OPENCODE_GO_API_KEY", envAliases: ["OPENCODE_API_KEY"] },
			// 凭据与多账户由提供方插件管理；managedByPlugin 时不渲染本地凭据编辑。
			"commandcode": { label: "Command Code", short: "Command", envName: "COMMANDCODE_API_KEY", managedByPlugin: true },
			// SuperGrok / X Premium 订阅（dsh-grok-kit 的 xai-oauth 路由）：OAuth 登录文件凭据，无继承变量。
			"xai-oauth": { label: "Grok (X / SuperGrok)", short: "Grok", envName: "", managedByPlugin: true },
			// Codex / ChatGPT 订阅：凭据是 Codex CLI 的 OAuth 登录文件，只读、不刷新、不接受本地 Key。
			// 默认关闭：Codex 的提供方插件自带用量药丸，两个并排只是重复信息（仍可手动开启）。
			"openai-codex": { label: "Codex (ChatGPT)", labelZh: "Codex（ChatGPT）", short: "Codex", envName: "", managedByPlugin: true, defaultEnabled: false },
			// 国际版默认关闭，中国版保持默认开启。
			"minimax": { label: "MiniMax (International)", labelZh: "MiniMax（国际）", short: "MiniMax", envName: "MINIMAX_API_KEY", defaultEnabled: false },
			"minimax-cn": { label: "MiniMax (CN)", labelZh: "MiniMax（中国）", short: "MiniMax CN", envName: "MINIMAX_CN_API_KEY" },
			// 火山方舟：provider id 必须与官方插件 @volcengine/ark-plan-api 注册的路由逐字一致，
			// 否则选中方舟模型时药丸不会出现。凭据是共享的 IAM AK/SK（volc），与这里的推理
			// envName 是两套：推理 Key 查不到额度。
			// arkcli（官方 CLI）安装的路由：id 由 `arkcli helper` 写成 arkcli-<planType>，
			// 官方 CLI 是当前最主流的安装方式，故默认开启。
			"arkcli-agent-plan": { label: "ARK Agent Plan (arkcli)", labelZh: "方舟 Agent Plan", short: "ARK Plan", envName: "ARKCLI_AGENT_PLAN_API_KEY", volc: true },
			"arkcli-coding-plan": { label: "ARK Coding Plan (arkcli)", labelZh: "方舟 Coding Plan", short: "ARK Code", envName: "ARKCLI_CODING_PLAN_API_KEY", volc: true },
			// 企业版/团队版：额度按席位下发，需 AK/SK 有查看席位的权限。
			"arkcli-agent-plan-team": { label: "ARK Agent Plan Team (arkcli)", labelZh: "方舟 Agent Plan 团队", short: "ARK Plan Team", envName: "ARKCLI_AGENT_PLAN_TEAM_API_KEY", volc: true, defaultEnabled: false },
			"arkcli-coding-plan-team": { label: "ARK Coding Plan Team (arkcli)", labelZh: "方舟 Coding Plan 团队", short: "ARK Code Team", envName: "ARKCLI_CODING_PLAN_TEAM_API_KEY", volc: true, defaultEnabled: false },
			// 旧插件 @volcengine/ark-plan-api 的国内两条路由已从 Host 移除（实测与 arkcli 查同一份订阅、
			// 同一组 AK/SK）。它们的 id 不在本表里，由 ROUTE_PROVIDER_ALIAS 在入口归并到 arkcli 路由，
			// 装了旧插件的用户选中那些模型的药丸照常显示。
			// 余额型：接口给账户余额而不是订阅窗口，药丸用余额兜底文案显示。
			"siliconflow": { label: "SiliconFlow", short: "SiliconFlow", envName: "SILICONFLOW_API_KEY", defaultEnabled: false },
			// 余额端点只对 management / provisioning key 开放；普通 key 只显示限额与用量。
			"openrouter": { label: "OpenRouter", short: "OpenRouter", envName: "OPENROUTER_API_KEY", defaultEnabled: false },
			// 余额型聚合商：单体 GET + 一个余额数字，药丸用余额兜底文案显示。
			"novita": { label: "Novita AI", short: "Novita", envName: "NOVITA_API_KEY", defaultEnabled: false },
			"hyperbolic": { label: "Hyperbolic", short: "Hyperbolic", envName: "HYPERBOLIC_API_KEY", defaultEnabled: false },
			"deepinfra": { label: "DeepInfra", short: "DeepInfra", envName: "DEEPINFRA_API_KEY", defaultEnabled: false },
			"chutes": { label: "Chutes", short: "Chutes", envName: "CHUTES_API_KEY", defaultEnabled: false },
			"ollama-cloud": { label: "Ollama Cloud", short: "Ollama", envName: "OLLAMA_API_KEY", defaultEnabled: false },
			"vercel-ai-gateway": { label: "Vercel AI Gateway", short: "Vercel AI", envName: "AI_GATEWAY_API_KEY", defaultEnabled: false },
			// 额度端点只认 Management API Key，所以独立变量名。
			"zenmux": { label: "ZenMux", short: "ZenMux", envName: "ZENMUX_MANAGEMENT_API_KEY", defaultEnabled: false },
			// LiteLLM 是自建网关：除虚拟 Key 外还要填自己的 proxy 地址。
			"litellm": { label: "LiteLLM", short: "LiteLLM", envName: "LITELLM_API_KEY", defaultEnabled: false },
			// OpenDesign：Design Plan 订阅额度走控制台私有接口，凭据是浏览器的
			// 登录会话 Cookie（不是模型调用的 sk- API Key），所以继承变量名单独区分。
			"opendesign": { label: "OpenDesign", short: "OpenDesign", envName: "OPEN_DESIGN_COOKIE", defaultEnabled: false },
			// GitHub Copilot：只读 dsh-copilot-auth 写入凭据库的 OAuth 记录，无继承变量、无本地凭据编辑。
			"github-copilot": { label: "GitHub Copilot", short: "Copilot", envName: "", managedByPlugin: true, defaultEnabled: false }
		};
		// 顺序只影响展示：DeepSeek 放在末尾以免打乱既有条目位置；药丸匹配靠 provider id，与顺序无关。
		const PROVIDER_ORDER = ["zai-coding-cn", "kimi-coding", "xiaomi-token-plan-cn", "opencode-go", "commandcode", "openai-codex", "xai-oauth", "minimax", "minimax-cn", "zai-coding", "synthetic", "nanogpt", "siliconflow", "deepseek-account", "deepseek", "openrouter", "novita", "hyperbolic", "deepinfra", "chutes", "ollama-cloud", "vercel-ai-gateway", "zenmux", "litellm", "opendesign", "arkcli-agent-plan", "arkcli-coding-plan", "arkcli-agent-plan-team", "arkcli-coding-plan-team", "github-copilot"];
		// 支持「登录并自动导入」的两家：Host 上各自有独立的 CookieLogin 实例，这里只是方法名映射。
		const LOGIN_METHODS = { "xiaomi-token-plan-cn": { start: "startMimoLogin", status: "getMimoLoginStatus", cancel: "cancelMimoLogin" }, "opendesign": { start: "startOpenDesignLogin", status: "getOpenDesignLoginStatus", cancel: "cancelOpenDesignLogin" } };
		// 火山方舟的 4 条路由共用同一组 IAM AK/SK，设置页仍合并为一张卡片；个人版与 Team
		// 分别由 visibility.ark / visibility.arkTeam 控制，开启个人版不再顺带启用 Team 检测。
		const ARK_IDS = PROVIDER_ORDER.filter(id => PROVIDER_META[id]?.volc);
		const ARK_TEAM_IDS = ARK_IDS.filter(id => id.endsWith("-team"));
		const ARK_PERSONAL_IDS = ARK_IDS.filter(id => !ARK_TEAM_IDS.includes(id));
		const GROUP_LABEL_KEY = { "文本 / 向量模型": "afpGroupText", "视觉 / 语音模型与 Harness": "afpGroupVision", "Member budget": "groupMemberBudget", "Premium requests": "groupCopilotPremium", Chat: "groupCopilotChat", Completions: "groupCopilotCompletions", afpGroupText: "afpGroupText", afpGroupVision: "afpGroupVision", groupMemberBudget: "groupMemberBudget" };
		function providerDisplayName(id, field, getLocale) {
			const meta = PROVIDER_META[id];
			if (!meta) return id;
			const zh = String(typeof getLocale === "function" ? getLocale() : getLocale || "").startsWith("zh");
			if (zh && field === "label" && meta.labelZh) return meta.labelZh;
			if (zh && field === "short" && meta.shortZh) return meta.shortZh;
			return meta[field];
		}
		function displayGroupLabel(label, t) {
			if (!label) return label;
			const key = GROUP_LABEL_KEY[label];
			return key ? t(key) : label;
		}
		function windowKindLabel(kind, t) {
			return t(KIND_LABEL[kind] ?? "ccPoolPeriodUnknown");
		}
		/**
		 * 旧插件 @volcengine/ark-plan-api 注册的两个国内路由 id **已从本插件移除**：它们与 arkcli 的路由
		 * 查的是同一份订阅（同 Action、同 host、同 AK/SK，实测请求 URL 逐字相同），并列显示只会让人以为
		 * 买了两个套餐，数字还会因为各自缓存而差出几十秒的量。
		 * 但装了旧插件的用户，模型路由仍然是这两个 id —— 药丸必须在入口把它们归并到 arkcli 路由，
		 * 否则那些用户会突然失去用量显示。（第三条 BytePlus 已随实现一并移除：无 BytePlus 账号可验证。）
		 */
		const ROUTE_PROVIDER_ALIAS = { "ark-agent-plan-cn": "arkcli-agent-plan", "ark-coding-plan-cn": "arkcli-coding-plan", "deepseek-official": "deepseek-account" };
		function providerEnabled(settings, id) {
			if (PROVIDER_META[id]?.volc) {
				if (ARK_TEAM_IDS.includes(id)) return settings?.visibility?.arkTeam === true;
				// 组开关优先；旧配置里没有它时只按个人版路由迁移，不能让旧 Team 值把个人版重新打开。
				if (typeof settings?.visibility?.ark === "boolean") return settings.visibility.ark;
				return ARK_PERSONAL_IDS.some(key => settings?.visibility?.providers?.[key] === true) || ARK_PERSONAL_IDS.every(key => settings?.visibility?.providers?.[key] === undefined);
			}
			return settings?.visibility?.providers?.[id] ?? (PROVIDER_META[id]?.defaultEnabled !== false);
		}
		// provider id 就是路由 id，而路由由提供方插件/CLI 按「你实际订阅了什么」写入：例如 arkcli helper
		// 只会为真正持有的套餐写路由。对**按路由取数的**提供商来说，「本机没有这条路由」就等于「没订阅」，
		// 默认收起比「常量里默认开启」更贴近事实。undefined = 拿不到路由表，按「未知」放行，不谎报未安装。
		// 例外是火山方舟：它的额度走账号级管控面（一组 AK/SK 覆盖名下所有套餐），路由只是推理入口 —— 见 providerVisible。
		function providerRoutable(result, id) { return result?.configured?.[id] !== false; }
		// 凭据是 OAuth 记录/登录文件、路由由别的插件或内置提供：已检测到凭据就能查，不依赖推理路由表。
		const OAUTH_DETECTED_IDS = new Set(["openai-codex", "github-copilot"]);
		const BALANCE_ONLY_IDS = new Set(["deepseek", "deepseek-account", "siliconflow", "novita", "hyperbolic", "deepinfra", "vercel-ai-gateway"]);
		function providerCanQuery(result, id) {
			const detected = OAUTH_DETECTED_IDS.has(id) && result?.entries?.find(entry => entry.providerId === id)?.apiDetected === true;
			return BALANCE_ONLY_IDS.has(id) || !!PROVIDER_META[id]?.volc || detected || !!result?.settings?.hasKeys?.[id] || result?.settings?.keyModes?.[id] === "manual" || providerRoutable(result, id);
		}
		function providerVisible(settings, id, entry, result) {
			if (!providerEnabled(settings, id)) return false;
			// 关掉「没有检测到 API 的默认隐藏」就是要看全部，不再按路由、凭据或订阅状态收起。
			if (settings?.visibility?.hideWithoutApi === false) return true;
			// 火山方舟**不按推理路由收起**：额度是账号级订阅，路由装没装与额度无关——一组 IAM AK/SK 就能
			// 查到名下所有套餐（GetCodingPlanUsage 与 GetAFPUsage 同协议同凭据）。但它**要按接口回报的
			// 订阅状态收起**：4 条路由一律列出来，用户根本分不清哪个是哪个，而其中多数是「未检测到该套餐订阅」。
			// `subscribed === undefined` 表示还没拉到数据，按「未知」放行——不能因为一次没拉到就把有订阅的藏起来。
			if (PROVIDER_META[id]?.volc) {
				if (entry?.subscribed === false) return false;
				// 还没拉到任何订阅结论时，只在已启用的组内留一张代表卡；个人版关闭、
				// Team 开启时也不能让已关闭的个人版代表把 Team 标签压掉。
				const arkEntries = Array.isArray(result?.entries) ? result.entries : [];
				const enabledArkIds = ARK_IDS.filter(key => providerEnabled(settings, key));
				const known = enabledArkIds.some(key => {
					const item = arkEntries.find(row => row.providerId === key);
					return item?.subscribed === true || item?.subscribed === false;
				});
				if (!known) {
					const representative = enabledArkIds.find(key => providerRoutable(result, key)) ?? enabledArkIds[0];
					if (id !== representative) return false;
				}
			} else if (!providerCanQuery(result, id)) return false;
			// 官方余额与本机账号余额独立于模型路由；刚保存 Key 的旧 no-key 条目不能继续隐藏。
			if (settings?.hasKeys?.[id]) return true;
			return entry?.apiDetected !== false && !["no-key", "no-cookie"].includes(entry?.state);
		}
		/** token 数紧凑格式：1,234,567,890 → 1.23B */
		function fmtTokens(n) {
			const v = Number(n) || 0;
			if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
			if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
			if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
			return String(v);
		}
		/** 用量档位：颜色 + 徽标 + 主数字文案（药丸/弹层/设置页三重编码统一来源）。 */
		function usageTier(w) {
			if (w.status === "rate-limited") {
				return w.cascade
					? { icon: "✕", badge: "badgeBlocked", color: "#ef4444", num: "numBlocked", rank: 4 }
					: { icon: "✕", badge: "badgeLimited", color: "#ef4444", num: "numLimited", rank: 4 };
			}
			if (w.percent >= 91) return { icon: "⚠", badge: "badgeTight", color: "#f97316", num: null, rank: 3 };
			if (w.percent >= 71) return { icon: "⚠", badge: "badgeHigh", color: "#eab308", num: null, rank: 2 };
			return { icon: "✓", badge: "badgeOk", color: "#22c55e", num: null, rank: 1 };
		}
		/** 最差窗：档位最高者优先；同档时根因（非连坐）优先，再取已用更多者。 */
		function worstWindow(windows) {
			let worst = null;
			for (const w of windows) {
				if (worst === null) { worst = w; continue; }
				const a = usageTier(w);
				const b = usageTier(worst);
				if (a.rank !== b.rank) { if (a.rank > b.rank) worst = w; continue; }
				const ownA = w.status === "rate-limited" && !w.cascade;
				const ownB = worst.status === "rate-limited" && !worst.cascade;
				if (ownA !== ownB) { if (ownA) worst = w; continue; }
				if (w.percent > worst.percent) worst = w;
			}
			return worst;
		}
		function remainingPercent(percent) {
			return Math.round(Math.max(0, 100 - (Number(percent) || 0)) * 10) / 10;
		}
		/** 药丸文案：永远答「还能用多少」（余），限额/连坐直说。多窗带窗口短名。 */
		function pillText(w, multi, t) {
			// 短标签走 locale（中文「周 / 月 / 日」，英文 1w / 1m / 1d），不让人猜 W 是哪个窗口。
			const short = multi ? `${t(KIND_SHORT[w.kind] ?? "srolling")} ` : "";
			if (w.status === "rate-limited" && !w.cascade) return `${short}${t("pillLimited")}`;
			if (w.status === "rate-limited") return `${short}${t("pillBlocked")}`;
			return `${short}${t("pillRemaining").replace("{p}", String(remainingPercent(w.percent)))}`;
		}
		/**
		 * extras 标签：plan / account / balance 三类，未知类型回退为余额。
		 * OpenDesign 单独一套：它的 `monthly-balance`（套餐订阅额度）与 `balance`（钱包合计 =
		 * 订阅 + 充值）是两个池，用通用的「月额度剩余 / 余额」会被读成同份额度的两个比较值。
		 */
		function extraLabel(x, t, providerId) {
			if (providerId === "opendesign") {
				if (x.kind === "monthly-balance") return t("planBalanceLabel");
				if (x.kind === "balance") return t("totalBalanceLabel");
			}
			return x.kind === "plan" ? t("planLabel") : x.kind === "account" ? t("accountLabel") : x.kind === "monthly-balance" ? t("monthlyBalanceLabel") : ["note", "quota-status"].includes(x.kind) ? t("noteLabel") : x.kind === "credit-status" ? t("creditStatusLabel") : x.kind === "spend" || x.kind.endsWith("-spend") ? t("spendLabel") : t("balanceLabel");
		}
		/** 余额兜底文案：没有额度窗口但接口报告了余额时（余额型 provider、或额度接口暂时只给余额），余额就是唯一信息。 */
		function formatBalanceValue(value) {
			if (typeof value !== "string") return value;
			const match = value.trim().match(/^([¥￥$]?\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(\s*(?:[A-Z]{3}|credits)?)$/i);
			if (!match || !Number.isFinite(Number(match[2]))) return value;
			if (!/[eE]/.test(match[2]) && (match[2].split(".")[1]?.length ?? 0) <= 2) return value.trim();
			const amount = Number(match[2]);
			// 仅收敛展示精度；状态阈值仍使用未经四舍五入的原始金额。
			const formatted = String(Number(amount.toFixed(2)));
			return match[1] + formatted + match[3];
		}
		function balanceText(entry, t) {
			const row = entry && Array.isArray(entry.extras) ? entry.extras.find(x => x.kind === "balance") ?? entry.extras.find(x => x.kind === "spend") : undefined;
			return row ? `${extraLabel(row, t, entry?.providerId)} ${row.kind === "balance" ? formatBalanceValue(row.value) : row.value}` : null;
		}
		/** 余额只按自己的单位预警，不做汇率折算，也不把累计消费当余额。 */
		function balanceVisual(entry, t) {
			const row = Array.isArray(entry?.extras) ? entry.extras.find(x => x.kind === "balance" && typeof x.value === "string") : undefined;
			if (!row) return null;
			const text = row.value.trim();
			const decimal = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?)";
			const suffix = text.match(new RegExp("^" + decimal + "\\s+([A-Z]{3}|credits)$", "i"));
			const prefix = text.match(new RegExp("^([¥￥$])\\s*" + decimal + "$", "i"));
			const bare = text.match(new RegExp("^" + decimal + "$", "i"));
			const amount = suffix ? Number(suffix[1]) : prefix ? Number(prefix[2]) : bare ? Number(bare[1]) : NaN;
			const unit = suffix ? suffix[2].toUpperCase() : prefix ? prefix[1] === "$" ? "USD" : "CNY" : null;
			const rawAmount = suffix?.[1] ?? prefix?.[2];
			const value = formatBalanceValue(unit === "CNY" ? `¥${rawAmount}` : unit === "USD" ? `$${rawAmount}` : text);
			// 产品预警阈值，不是汇率或能运行多少次的保证。credits 没有跨厂商统一价值。
			const limits = unit === "CNY" ? { red: 1, amber: 5 } : unit === "USD" ? { red: 0.2, amber: 1 } : null;
			const rank = Number.isFinite(amount) ? amount <= 0 || limits && amount < limits.red ? 2 : limits && amount < limits.amber ? 1 : 0 : 0;
			return { value, color: rank === 2 ? "#ef4444" : rank === 1 ? "#eab308" : limits ? "#22c55e" : "#94a3b8", icon: rank > 0 ? "!" : limits ? "✓" : "ℹ", tinted: rank > 0, label: rank > 0 ? t("balanceLow") : "" };
		}
		/** 时长紧凑文案：窗口重置倒计时与 Cookie 剩余有效期共用同一档位。 */
		function durationText(ms, t) {
			if (!(ms > 0)) return t("restMins").replace("{n}", "1");
			const mins = Math.round(ms / 60000);
			return mins >= 1440 ? t("restDays").replace("{n}", String(Math.max(1, Math.floor(mins / 1440))))
				: mins >= 60 ? t("restHours").replace("{n}", String(Math.max(1, Math.floor(mins / 60))))
				: t("restMins").replace("{n}", String(Math.max(1, mins)));
		}
		/** 官方 MiMo 会话 Cookie 自签发起 24 小时有效：到期前 2 小时起提醒，30 分钟内升级为紧急。 */
		const MIMO_COOKIE_SOON_MS = 2 * 60 * 60 * 1000;
		const MIMO_COOKIE_URGENT_MS = 30 * 60 * 1000;
		/** Cookie 有效期判定：药丸、弹层与设置页共用；无记录时返回 null，绝不编造倒计时。 */
		function cookieExpiry(entry, t) {
			const expiresAt = Date.parse((entry && entry.cookieExpiresAt) || "");
			if (!Number.isFinite(expiresAt)) return null;
			const left = expiresAt - Date.now();
			const rest = durationText(left, t);
			if (left <= 0) return { rank: 4, icon: "✕", color: "#ef4444", expired: true, rest, expiresAt, label: t("mimoCookieExpired"), short: t("mimoCookieExpiredShort") };
			const label = t("pillCookieSoon").replace("{rest}", rest);
			const short = t("pillCookieSoonShort");
			if (left <= MIMO_COOKIE_URGENT_MS) return { rank: 3, icon: "⚠", color: "#f97316", rest, expiresAt, label, short };
			if (left <= MIMO_COOKIE_SOON_MS) return { rank: 2, icon: "⚠", color: "#eab308", rest, expiresAt, label, short };
			return { rank: 1, icon: "✓", color: "#22c55e", rest, expiresAt, label, short };
		}
		/** 设置页有效期说明：登录时间 + 剩余时间；旧版本保存的 Cookie 明确说明未记录。 */
		function cookieLifetimeLine(xiaomi, t, getLocale) {
			if (!xiaomi || !xiaomi.hasCookie) return null;
			const expiry = cookieExpiry({ cookieExpiresAt: xiaomi.expiresAt }, t);
			const parts = [];
			if (xiaomi.loginAt) parts.push(t("mimoLoginAt").replace("{time}", new Date(xiaomi.loginAt).toLocaleString(getLocale())));
			parts.push(expiry ? expiry.label : t("mimoCookieUntracked"));
			return h("p", { role: "status", style: { margin: "6px 0 0", color: expiry && expiry.rank >= 2 ? expiry.color : "inherit" } }, parts.join(" · "));
		}
		/** 重置行：带倒计时；到期未刷新显式说明。 */
		function resetLine(w, t, getLocale) {
			if (!w.resetsAt) return null;
			const at = new Date(w.resetsAt);
			const ms = at.getTime() - Date.now();
			if (!(ms > 0)) return t("detailResetDue");
			const rest = durationText(ms, t);
			return t("detailResetIn").replace("{time}", at.toLocaleString(getLocale())).replace("{rest}", rest);
		}

		// ── remote 契约（与 Host 对齐）────────────────────────────────────────
		function parseEntry(value) {
			if (!value || typeof value !== "object" || typeof value.providerId !== "string" || typeof value.state !== "string") {
				throw new Error("Invalid dsh-subusage entry");
			}
			return value;
		}
		function parseResult(value) {
			if (!value || typeof value !== "object" || !Array.isArray(value.entries)) throw new Error("Invalid dsh-subusage result");
			for (const e of value.entries) parseEntry(e);
			return value;
		}
		function parseSettings(value) {
			if (!value || typeof value !== "object") throw new Error("Invalid dsh-subusage settings");
			if (value.visibility !== undefined) {
				const v = value.visibility;
				// 白名单必须与 Host 的 parseSettings 逐字对齐：火山个人版 / Team 分别走
				// visibility.ark / visibility.arkTeam，漏掉任一端都会造成 schema 漂移。
				if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(value).some(k => !["visibility", "expectedRevision"].includes(k)) || typeof value.expectedRevision !== "string" || !value.expectedRevision || !Object.keys(v).length || Object.keys(v).some(k => !["providers", "hideWithoutApi", "ark", "arkTeam"].includes(k))) throw new Error("Invalid visibility patch");
				if (v.hideWithoutApi !== undefined && typeof v.hideWithoutApi !== "boolean") throw new Error("Invalid auto-hide switch");
				if (v.ark !== undefined && typeof v.ark !== "boolean") throw new Error("Invalid Ark group switch");
				if (v.arkTeam !== undefined && typeof v.arkTeam !== "boolean") throw new Error("Invalid Ark Team switch");
				if (v.providers !== undefined && (!v.providers || typeof v.providers !== "object" || Array.isArray(v.providers) || !Object.keys(v.providers).length || Object.entries(v.providers).some(([id, enabled]) => !PROVIDER_ORDER.includes(id) || typeof enabled !== "boolean"))) throw new Error("Invalid provider switches");
			}
			return value;
		}
		const resultCodec = {
			mode: "strict",
			typeSymbol: "dsh-subusage#SubUsageResult",
			schema: { parse: parseResult },
			create: () => ({ parse: parseResult })
		};
		const queryCodec = {
			mode: "strict", typeSymbol: "dsh-subusage#SubUsageQuery",
			schema: { parse: parseQuery }, create: () => ({ parse: parseQuery })
		};
		function parseQuery(value) {
			// 空 providerIds 是合法的「只读设置」请求（readSettings 就这样发）：与 Host 的 parseQuery
			// 同口径不要求非空，避免将来出站校验启用时把这条请求误判为非法。
			if (!value || !Array.isArray(value.providerIds) || value.providerIds.some((id) => !PROVIDER_ORDER.includes(id)) || typeof value.force !== "boolean") throw new Error("Invalid dsh-subusage query");
			return value;
		}
		const settingsCodec = {
			mode: "strict",
			typeSymbol: "dsh-subusage#SubUsageSettings",
			schema: { parse: parseSettings },
			create: () => ({ parse: parseSettings })
		};
		function parseLoginState(value) {
			if (!value || !["idle", "launching", "waiting", "verifying", "success", "cancelled", "error"].includes(value.state) || !(value.jobId === null || typeof value.jobId === "string")) throw new Error("Invalid dsh-subusage login state");
			if (value.result) parseResult(value.result);
			return value;
		}
		const loginCodec = { mode: "strict", typeSymbol: "dsh-subusage#SubUsageLoginState", schema: { parse: parseLoginState }, create: () => ({ parse: parseLoginState }) };
		const loginRequestCodec = (typeSymbol, field) => {
			const parse = (value) => { if (!value || typeof value[field] !== "string" || !value[field]) throw new Error("Invalid dsh-subusage login request"); return value; };
			return { mode: "strict", typeSymbol, schema: { parse }, create: () => ({ parse }) };
		};
		const subUsageRemote = {
			package: "dsh-subusage",
			descriptors: [
				{
					id: "dsh-subusage#subUsage/read",
					service: "subUsage",
					namespace: "subUsage",
					method: "read",
					invocation: { kind: "direct" },
					parameters: [{ name: "request", wire: "request", source: "json", acceptsUndefined: true, codec: queryCodec }],
					result: resultCodec
				},
				{
					id: "dsh-subusage#subUsage/refresh",
					service: "subUsage", namespace: "subUsage", method: "refresh",
					invocation: { kind: "direct" },
					parameters: [{ name: "request", wire: "request", source: "json", codec: queryCodec }], result: resultCodec
				},
				{
					id: "dsh-subusage#subUsage/save",
					service: "subUsage",
					namespace: "subUsage",
					method: "save",
					invocation: { kind: "direct" },
					parameters: [{
						name: "settings",
						wire: "settings",
						source: "json",
						codec: settingsCodec
					}],
					result: resultCodec
				},
				...[["startMimoLogin", "dsh-subusage#MimoLoginStart", "expectedRevision"], ["getMimoLoginStatus"], ["cancelMimoLogin", "dsh-subusage#MimoLoginCancel", "jobId"], ["startOpenDesignLogin", "dsh-subusage#OpenDesignLoginStart", "expectedRevision"], ["getOpenDesignLoginStatus"], ["cancelOpenDesignLogin", "dsh-subusage#OpenDesignLoginCancel", "jobId"]].map(([method, typeSymbol, field]) => ({
					id: `dsh-subusage#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" },
					parameters: field ? [{ name: "request", wire: "request", source: "json", codec: loginRequestCodec(typeSymbol, field) }] : [], result: loginCodec
				}))
			]
		};

		/** Cookie 解析失败抛错：调用者必须保留原输入，不允许静默清空。 */
		function normalizeCookieText(raw) {
			const text = String(raw || "").trim();
			if (!text) return "";
			if (/\r(?!\n)/.test(String(raw || "")) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(String(raw || ""))) throw new Error("Cookie 含非法控制字符 / Cookie contains illegal control characters");
			const pairs = [];
			const domainOK = (domain) => !domain || ["platform.xiaomimimo.com", "xiaomimimo.com"].includes(String(domain).toLowerCase().replace(/^\./, ""));
			const add = (name, value, domain) => {
				if (!domainOK(domain)) return;
				if (typeof name !== "string" || !/^[A-Za-z0-9_!#$%&'*+\-.^`|~]+$/.test(name)) throw new Error("Cookie 名称无效 / Invalid cookie name");
				if (value === undefined || value === null || typeof value === "object") throw new Error("Cookie 值无效 / Invalid cookie value");
				const v = String(value);
				if (!/^("[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*"|[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)$/.test(v)) throw new Error("Cookie 值含非法分隔符、空白、非 ASCII 字符或 CRLF / Cookie value contains illegal separators, whitespace, non-ASCII or CRLF");
				pairs.push([name, v]);
			};
			if (/^[\[{]/.test(text)) {
				let data;
				try { data = JSON.parse(text); } catch { throw new Error("Cookie JSON 解析失败，请检查格式（原输入已保留） / Cookie JSON parse failed (original input kept)"); }
				const list = Array.isArray(data) ? data : Array.isArray(data.cookies) ? data.cookies : Object.entries(data).map(([name, value]) => ({ name, value }));
				for (const item of list) { if (!item || typeof item !== "object") throw new Error("Cookie JSON 项无效 / Invalid Cookie JSON item"); add(item.name, item.value, item.domain); }
			} else {
				// TAB 末列可以是合法空值，不能用整行/整段 trim 丢掉分隔符。
				const lines = String(raw || "").split(/\r?\n/).filter((line) => line.trim()).map((line) => line.includes("\t") ? line : line.trim());
				if (lines.some((line) => line.includes("\t"))) {
					const netscape = lines.some((line) => { const cells = line.split("\t"); return cells.length >= 7 && /^(TRUE|FALSE)$/i.test(cells[1].trim()); });
					let columns = null;
					for (const line of lines) {
						if (netscape && /^#(?!HttpOnly_)/i.test(line.trim())) continue;
						const cells = line.split("\t").map((v) => v.trim());
						if (/^(name|名称)$/i.test(cells[0])) { columns = cells.map((v) => v.toLowerCase()); continue; }
						if (cells.length < 2) throw new Error("Cookie TAB 表格缺少值 / Cookie TAB table is missing a value");
						if (!columns && cells.length >= 7 && /^(TRUE|FALSE)$/i.test(cells[1])) { add(cells[5], cells[6], cells[0].replace(/^#HttpOnly_/i, "")); continue; }
						const domainIndex = columns ? columns.findIndex((v) => v === "domain" || v === "域") : 2;
						add(cells[0], cells[1], domainIndex >= 0 ? cells[domainIndex] : undefined);
					}
				} else if (lines.every((line) => line.includes("="))) {
					for (const line of lines) for (const part of line.split(";")) {
						if (!part.trim()) continue;
						const at = part.indexOf("=");
						if (at < 1) throw new Error("Cookie 必须为 name=value / Cookie must be name=value");
						add(part.slice(0, at).trim(), part.slice(at + 1).trim());
					}
				} else {
					if (lines[0] === "当前页面 Cookies") lines.shift();
					if (lines.length % 2) throw new Error("Cookie 多行清单名称和值必须成对（原输入已保留） / Cookie name/value lines must come in pairs (original input kept)");
					for (let i = 0; i < lines.length; i += 2) add(lines[i], lines[i + 1]);
				}
			}
			if (!pairs.length) throw new Error("未找到官方 MiMo 域的有效 Cookie（原输入已保留） / No valid Cookie for the official MiMo domain (original input kept)");
			return [...new Map(pairs)].map(([name, value]) => `${name}=${value}`).join("; ");
		}
		function validateCookieText(raw) {
			const text = normalizeCookieText(raw);
			const names = new Map(text.split("; ").map((pair) => { const at = pair.indexOf("="); return [pair.slice(0, at), pair.slice(at + 1).replace(/^"|"$/g, "")]; }));
			if (!names.get("api-platform_serviceToken") || !names.get("userId")) throw new Error("Cookie 必须包含非空 api-platform_serviceToken 和 userId（原输入已保留） / Cookie must include non-empty api-platform_serviceToken and userId (original input kept)");
			return text;
		}
		function canShowUsage(entry) {
			if (!entry || entry.state === "no-key" || entry.state === "no-cookie" || /auth|credential|no-key|no-cookie/i.test(entry.errorCode || "")) return false;
			if (entry.freshness === "stale") return entry.retainPrevious === true;
			return entry.state === "ok";
		}
		function statusText(entry, t) {
			if (!entry || entry.state === "loading") return t("loading");
			if (entry.state === "disabled") return t("statusDisabled");
			if (entry.state === "no-key") return t("statusNoKey");
			if (entry.state === "no-cookie") return t("statusNoCookie");
			if (entry.state !== "ok") return t("statusError");
			if (entry.freshness === "stale") return t("statusCache");
			if (entry.coverage === "partial") return t("statusPartial");
			return t("statusOk");
		}
		/**
		 * Host 的 failure message 是中文兜底（含错误特有的排障细节），英文界面直接渲染会中英混杂。
		 * 按稳定的 errorCode 出当前语言文案；认不出的 code 或传输层错误（无 code）保留原文——
		 * 原文可能携带只有它才有的信息（如 HTTP 状态、火山 Action 名），调用方把它放进节点 title。
		 */
		const ERROR_TEXT_KEY = {
			"subusage/network": "errNetwork",
			"subusage/http": "errHttp",
			"subusage/rate-limit": "errRateLimit",
			"subusage/auth": "errAuth",
			"subusage/credentials": "errCredentials",
			"subusage/identity-timeout": "errIdentityTimeout",
			"subusage/response": "errResponse",
			"subusage/config": "errConfig",
			"subusage/revision-conflict": "errRevisionConflict",
			"subusage/config-changed": "errConfigChanged",
			"subusage/unknown-provider": "errUnknownProvider",
			"subusage/timeout": "errTimeout",
			"subusage/disposed": "errDisposed"
		};
		function localError(errorCode, raw, t) {
			const key = typeof errorCode === "string" ? ERROR_TEXT_KEY[errorCode] : undefined;
			if (key) return t(key);
			return typeof raw === "string" && raw ? raw : t("statusError");
		}
		/**
		 * 需要用户行动时的内联入口类型。设置页的「状态」在上（用量面板）、「操作」在下（提供商管理），
		 * 出问题时用户得先去下面找到对应厂商才能修——这里让问题旁边直接出现修复动作。
		 * 正常状态返回 null：不打扰，也不重复管理区那份编辑器。
		 */
		function usageActionKind(entry, providerId, t) {
			if (!entry || entry.state === "loading" || entry.state === "disabled") return null;
			const authFailed = /auth|credential/i.test(entry.errorCode || "");
			if (providerId === "xiaomi-token-plan-cn") {
				const expiry = cookieExpiry(entry, t);
				if (expiry && expiry.expired) return "mimo-relogin";
				if (entry.state === "no-cookie" || authFailed) return "mimo-login";
				// rank ≥ 2 才是「临近到期」（与药丸同一档位判定）：还没失效，不要说「需要登录」。
				if (expiry && expiry.rank >= 2) return "mimo-renew";
				return null;
			}
			if (entry.state === "no-key" || entry.state === "no-cookie" || authFailed) return "credentials";
			return null;
		}
		/**
		 * 待处理程度的排序权重：读取失败与 Cookie 过期最急，额度用尽与即将到期次之，数据不完整再次。
		 * **「未配置凭据」刻意不算**——那是用户自己的取舍（默认隐藏就是为收起它们），
		 * 把它顶到最前面会让每个还没配的厂商都来抢位置。
		 */
		function usageAttentionRank(entry, t) {
			if (!entry) return 0;
			const status = computeStatus(entry, { providerId: entry.providerId, t, getLocale: () => undefined });
			if (status.key === "error" || status.key === "cookie" && status.expiry?.expired) return 3;
			if (["blocked", "restricted", "cookie"].includes(status.key)) return 2;
			if (["paygo", "included", "unknown", "scope", "pool-unknown", "degraded"].includes(status.key)) return 1;
			return status.key === "pool" && (entry.accountPool.blockedCount || entry.accountPool.unusableCount) ? 1 : 0;
		}
		function providerDescription(entry, t) {
			const windows = canShowUsage(entry) ? entry.windows || [] : [];
			const worst = worstWindow(windows);
			return `${statusText(entry, t)}${worst ? " · " + pillText(worst, windows.length > 1, t) : " · " + t("noUsageData")}`;
		}
		function cacheAge(entry, t) {
			if (!entry || entry.freshness !== "stale" || !canShowUsage(entry)) return null;
			const at = Date.parse(entry.lastSuccessAt);
			return Number.isFinite(at) ? t("cacheAge").replace("{n}", String(Math.max(0, Math.floor((Date.now() - at) / 60000)))) : t("cacheUnknown");
		}
		/** 每次 apply 一个 store；partial response 只合并请求项，所有槽共享 inflight 与活动计时。 */
		function createUsageStore(call) {
			let snapshot = { updatedAt: null, settings: null, configured: {}, entries: [] };
			let disposed = false, initial = null, settingsInitial = null, timer = null, epoch = 0, sequence = 0, metadataSequence = 0;
			let loginGeneration = 0, loginJobId = null, loginPending = false;
			// Command Code 显示账户：弹层账户区选中的账户（"" = 默认账户/顶层 Key）。
			// 所有 commandcode 读取（readAll/refresh/定时刷新）都携带它，切换后用量同步跟随。
			let ccAccount = "";
			const mergedLoginJobs = new Set();
			const providerSequence = new Map();
			const markRequest = (ids) => { const version = ++sequence; for (const id of ids) providerSequence.set(id, version); return { version, ids }; };
			const listeners = new Set(), active = new Map(), inflight = new Map(), readers = new Map(), resetSeen = new Set();
			const emit = () => { if (!disposed) for (const fn of listeners) fn(); };
			// 凭据被替换或清除时不能沿用旧 cookieExpiresAt：否则已删除的 Cookie 仍显示过期倒计时。
			// keep 表示“未改动”，保留计时以免保存后倒计时闪退。
			const invalidate = (ids, keepCookieExpiry = true) => {
				snapshot = { ...snapshot, entries: snapshot.entries.map((e) => ids.includes(e.providerId) ? { providerId: e.providerId, apiDetected: e.apiDetected, keySource: e.keySource, ...(keepCookieExpiry && e.cookieExpiresAt ? { cookieExpiresAt: e.cookieExpiresAt } : {}), state: "loading", coverage: "partial", freshness: "unknown", windows: [], extras: [] } : e) };
				for (const id of ids) inflight.delete(id);
			};
			const merge = (incoming, request = null, localChange = false) => {
				if (disposed) return snapshot;
				const value = { ...incoming };
				if (request && request.version < metadataSequence) { delete value.settings; delete value.configured; delete value.updatedAt; }
				// 过期请求的 settings 已在上一行丢掉，所以这里若还带着 settings，就是「当前代」看到的 Host 配置。
				// 另一窗口改过配置时采用它（开关跟着变），但不再 epoch++ / invalidate 全员——那会让非活跃条目永久 loading。
				if (value.settings) metadataSequence = request ? request.version : ++sequence;
				const entries = new Map(snapshot.entries.map((e) => [e.providerId, e]));
				for (const e of value.entries || []) if (!request || providerSequence.get(e.providerId) === request.version) entries.set(e.providerId, e);
				snapshot = { ...snapshot, ...value, entries: [...entries.values()] };
				emit(); return snapshot;
			};
			const readSettings = () => {
				if (snapshot.settings) return Promise.resolve(snapshot);
				if (!settingsInitial) {
					const request = markRequest([]);
					settingsInitial = Promise.resolve().then(() => call("read", { providerIds: [], force: false, commandCodeAccount: ccAccount })).then(value => merge(value, request)).catch(error => { settingsInitial = null; throw error; });
				}
				return settingsInitial.then(() => snapshot);
			};
			const refresh = (ids, force = false) => {
				if (disposed) return Promise.reject(new Error("Client 已卸载"));
				// Codex 等默认关闭的入口必须先读取用户保存的开关，否则冷启动会过滤自己，
				// 又没有任何 RPC 载入 settings，直到切去默认开启的其他厂商才恢复。
				if (!snapshot.settings && ids.some(id => PROVIDER_META[id]?.defaultEnabled === false)) {
					return readSettings().then(() => {
						if (!snapshot.settings) throw new Error("Client 设置尚未读取");
						return refresh(ids, force);
					});
				}
				// Ark 必须豁免路由检查：它的额度是账号级管控面订阅（一组 AK/SK 查名下全部套餐），
				// providerVisible 对 volc 同样不看推理路由——这里若按 providerRoutable 过滤，
				// 「有套餐但本机没装对应 arkcli 路由」的条目在激活刷新、重置到期补拉与定时刷新时
				// 全部静默不发请求，用户点「刷新当前」也空转，只有「刷新全部」走 read 才能更新。
				const unique = [...new Set(ids)].filter((id) => {
					if (!PROVIDER_ORDER.includes(id) || !providerEnabled(snapshot.settings, id)) return false;
					return providerCanQuery(snapshot, id);
				});
				const start = (id) => {
					if (inflight.has(id)) return inflight.get(id);
					const startedEpoch = epoch, request = markRequest([id]);
					const task = Promise.resolve().then(() => call("refresh", { providerIds: [id], force: !!force, commandCodeAccount: ccAccount })).then((value) => startedEpoch === epoch ? merge(value, request) : snapshot).catch((error) => {
						// 传输失败不能沿用旧额度；但也不能当作「凭据消失」的证据。
						// 否则 Codex 的无路由查询豁免随 apiDetected 丢失：药丸隐藏且后续刷新被过滤。
						if (startedEpoch === epoch) {
							const previous = snapshot.entries.find(entry => entry.providerId === id);
							merge({ entries: [{ providerId: id, ...(previous?.apiDetected !== undefined ? { apiDetected: previous.apiDetected } : {}), ...(previous?.keySource ? { keySource: previous.keySource } : {}), state: "error", error: error instanceof Error ? error.message : String(error), freshness: "unknown", coverage: "partial", windows: [], extras: [] }] }, request);
						}
						throw error;
					}).finally(() => { if (inflight.get(id) === task) inflight.delete(id); });
					inflight.set(id, task);
					return task;
				};
				const tasks = unique.map(start);
				// 调用方点名多家（刷新全部）即使过滤后只剩一家，也不把失败抬成整页错误。
				const tolerant = ids.length > 1;
				if (unique.length <= 1 && !tolerant) return (tasks[0] ?? Promise.resolve(snapshot)).then(() => snapshot);
				return Promise.all(tasks.map((task) => task.catch(() => null))).then(() => snapshot);
			};
			const visible = () => { if (typeof document === "undefined" || document.visibilityState !== "hidden") void refresh([...active.keys()]).catch(() => {}); };
			const tick = () => {
				snapshot = { ...snapshot }; emit();
				if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
				for (const id of active.keys()) {
					const e = snapshot.entries.find((item) => item.providerId === id);
					for (const w of canShowUsage(e) ? e.windows || [] : []) {
						const key = `${id}:${w.kind}:${w.resetsAt}`;
						if (w.resetsAt && Date.parse(w.resetsAt) <= Date.now() && !resetSeen.has(key)) { resetSeen.add(key); void refresh([id], true).catch(() => {}); }
					}
				}
				visible();
			};
			const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
			const activate = (id) => {
				active.set(id, (active.get(id) || 0) + 1);
				if (!timer) { timer = setInterval(tick, 60000); if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible); }
				return () => { const n = (active.get(id) || 1) - 1; if (n) active.set(id, n); else active.delete(id); if (!active.size && timer) { clearInterval(timer); timer = null; if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible); } };
			};
			// providerId 随状态一起回传：登录状态是组件级单值，切到另一家的标签页时不能把上一家
			// 的进度或错误画到这一家头上（两家在 Host 上各有独立登录器与任务）。
			const acceptLogin = (providerId, value, generation, startedEpoch, expectedJobId = null) => {
				if (disposed || generation !== loginGeneration || (value.state === "success" && value.result && startedEpoch !== epoch) || (expectedJobId && value.jobId !== expectedJobId && !(value.state === "idle" && value.jobId === null))) return null;
				loginJobId = value.jobId;
				loginPending = ["launching", "waiting", "verifying"].includes(value.state);
				if (value.state === "success" && value.result && !mergedLoginJobs.has(value.jobId)) {
					mergedLoginJobs.add(value.jobId);
					// 自动导入已经落盘：阻断旧账号在途额度与元数据，公共结果不含 Cookie。
					epoch++; markRequest(PROVIDER_ORDER); invalidate([providerId]); merge(value.result, null, true);
				}
				return { ...value, providerId };
			};
			const setCommandCodeAccount = (id) => {
				// "default" 与空串在 Host 端是同一个账户（同一缓存键、同一指纹，见 providerCacheKey）：
				// 归一后就不必为「固定到默认账户」多打一次强制刷新。
				const raw = typeof id === "string" ? id.trim() : "";
				const next = raw === "default" ? "" : raw;
				if (disposed || ccAccount === next) return Promise.resolve(snapshot);
				ccAccount = next;
				// 账户变了：旧账户的在途/缓存数据立即失效，强制按新账户重拉。
				invalidate(["commandcode"]);
				// invalidate 只重写快照不通知：补一次 emit 让药丸立即进入加载态，
				// 避免强制刷新返回前「标注已是新账户、数字还是旧账户」的瞬态错标。
				emit();
				return refresh(["commandcode"], true).catch(() => snapshot);
			};
			return {
				subscribe, getSnapshot: () => snapshot, refresh, activate,
				// 设置页先取本机元数据，不等待所有厂商的网络额度请求。
				readSettings,
				getCommandCodeAccount: () => ccAccount, setCommandCodeAccount,
				startMimoLogin: async (request) => { const generation = ++loginGeneration, startedEpoch = epoch; loginJobId = null; return acceptLogin("xiaomi-token-plan-cn", await call("startMimoLogin", request), generation, startedEpoch); },
				getMimoLoginStatus: async () => { const generation = loginGeneration, startedEpoch = epoch, jobId = loginPending ? loginJobId : null; return acceptLogin("xiaomi-token-plan-cn", await call("getMimoLoginStatus"), generation, startedEpoch, jobId); },
				cancelMimoLogin: async (request) => { if (loginJobId && request.jobId !== loginJobId) return null; const generation = ++loginGeneration, startedEpoch = epoch; return acceptLogin("xiaomi-token-plan-cn", await call("cancelMimoLogin", request), generation, startedEpoch, request.jobId); },
				startOpenDesignLogin: async (request) => { const generation = ++loginGeneration, startedEpoch = epoch; loginJobId = null; return acceptLogin("opendesign", await call("startOpenDesignLogin", request), generation, startedEpoch); },
				getOpenDesignLoginStatus: async () => { const generation = loginGeneration, startedEpoch = epoch, jobId = loginPending ? loginJobId : null; return acceptLogin("opendesign", await call("getOpenDesignLoginStatus"), generation, startedEpoch, jobId); },
				cancelOpenDesignLogin: async (request) => { if (loginJobId && request.jobId !== loginJobId) return null; const generation = ++loginGeneration, startedEpoch = epoch; return acceptLogin("opendesign", await call("cancelOpenDesignLogin", request), generation, startedEpoch, request.jobId); },
				readAll: () => { if (!initial) { const startedEpoch = epoch, request = markRequest(PROVIDER_ORDER); initial = Promise.resolve().then(() => call("read", { providerIds: PROVIDER_ORDER, force: false, commandCodeAccount: ccAccount })).then((value) => startedEpoch === epoch ? merge(value, request) : snapshot).catch((error) => { initial = null; throw error; }); } return initial.then(() => snapshot); },
				save: async (patch) => {
					const value = await call("save", patch);
					// 可见性开关只改 settings：不动 epoch、不重置在途请求序号——否则「刷新全部进行中拨开关」
					// 会把所有在途用量结果整批丢弃（startedEpoch !== epoch 直接放弃 merge）。merge 内部会推进
					// metadataSequence，让在途响应里的过期 settings 自动丢弃，本地新 revision 不被盖回。
					if (patch.visibility) return merge({ ...value, entries: snapshot.entries }, null, true);
					// 凭据变更改变用量语义：推进 epoch 丢弃在途。火山 AK/SK 是组内容共用的，必须整组失效。
					epoch++;
					const cookie = patch.cookieUpdate;
					const affected = PROVIDER_META[patch.providerId]?.volc && patch.volc ? ARK_IDS : [patch.providerId];
					invalidate(affected, !cookie || cookie.action === "keep"); return merge(value, null, true);
				},
				reader: (id) => {
					if (!readers.has(id)) {
						const current = () => { const e = snapshot.entries.find((item) => item.providerId === id); return { ...(e || { providerId: id, state: "loading", windows: [] }), visible: providerVisible(snapshot.settings, id, e, snapshot) }; };
						const fn = async (force = false) => { await refresh([id], force); return current(); };
						fn.subscribe = (cb) => subscribe(() => cb(current()));
						fn.activate = () => activate(id);
						readers.set(id, fn);
					}
					return readers.get(id);
				},
				dispose: () => { disposed = true; if (timer) clearInterval(timer); timer = null; if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible); listeners.clear(); active.clear(); inflight.clear(); readers.clear(); resetSeen.clear(); }
			};
		}

		// ── Command Code 账户切换（对齐提供方插件的账户显示）────────────────────
		// 账户列表与 id 规则对齐 @mars-sea/dsh-commandcode-provider 的 slots()：
		// 默认账户 id 固定 "default"；额外账户 id 取其 apiKeyEnv（凭据引用名）。
		// 与 slots() 的差异：仅配置 literal apiKey（无凭据引用）的槽位不进列表——
		// 其 Key 存在提供方配置内，本插件无法按引用解析，列出只会选中即报 no-key。
		// enrollment 进行中的账户不进列表（与其一致）。
		const COMMANDCODE_SETTINGS_NS = "llm-commandcode";
		function commandCodeAccountList(value) {
			const list = [{ id: "default", label: "default" }];
			const accounts = Array.isArray(value?.accounts) ? value.accounts : [];
			const tasks = Array.isArray(value?.accountEnrollmentTasks) ? value.accountEnrollmentTasks : [];
			const seen = new Set(["default"]);
			accounts.forEach((account, index) => {
				const refName = typeof account?.apiKeyEnv === "string" && account.apiKeyEnv.trim() !== "" ? account.apiKeyEnv.trim() : void 0;
				// 与 slots() 一致：无凭据引用的槽位不显示；登记任务未完成的账户暂不可选。
				if (refName === void 0) return;
				// 配置被手改出重复引用名时只列一次：否则同一账户出现两个选项，切换后读的还是同一份额度。
				if (seen.has(refName)) return;
				if (tasks.some((task) => task?.ref === refName && task.phase !== "naming")) return;
				seen.add(refName);
				list.push({ id: refName, label: typeof account.label === "string" && account.label.trim() !== "" ? account.label.trim() : `Account ${index + 2}` });
			});
			return list;
		}
		/** 当前固定账户：非空且命中账户列表才算固定；空串/"auto"/悬空引用都按自动轮换显示。 */
		function commandCodeActiveId(value, accounts) {
			const raw = typeof value?.activeAccount === "string" ? value.activeAccount.trim() : "";
			return raw !== "" && accounts.some((account) => account.id === raw) ? raw : "";
		}
		/**
		 * 账户切换控制器：读走 settings remote 的 describe（llm-commandcode ns 的
		 * accounts/activeAccount/revision），写走同一 ns 的 mutate——与 Command Code
		 * 设置页完全同一 wire 通道与 op 形式。describe/mutate 由调用方注入，namespace
		 * 未挂载（提供方插件未运行）时返回 not-ok，界面降级为不可用。
		 */
		function createCommandCodeAccounts({ describe, mutate }) {
			let disposed = false;
			const listeners = new Set();
			let state = { status: "idle", accounts: [], activeId: "", revision: null, writable: false, baseActive: "", switching: false, error: null };
			// 设置页与药丸弹层共用同一个控制器，可能同时驱动它：`loadSequence` 标记「哪一次读取才是当前的」，
			// `inflightLoad` 把同一代的并发 load 合并成一次 describe。没有这两样时，切换账户（mutate）在途
			// 期间返回的旧 describe 会把 activeId/revision 覆盖回切换前的快照，两处界面一起显示旧账户。
			let loadSequence = 0, inflightLoad = null;
			const emit = () => { for (const fn of [...listeners]) fn(state); };
			const parseRow = (row) => {
				const accounts = commandCodeAccountList(row?.value);
				return { accounts, activeId: commandCodeActiveId(row?.value, accounts), revision: typeof row?.revision === "number" ? row.revision : null, baseActive: typeof row?.base?.activeAccount === "string" ? row.base.activeAccount : "" };
			};
			const load = async (keepError = false) => {
				if (disposed) return state;
				// 同一代的并发 load 合并：两处界面同时挂载时只发一次 describe。
				if (inflightLoad?.sequence === loadSequence) return inflightLoad.promise;
				const sequence = ++loadSequence;
				state = { ...state, status: "loading", error: keepError ? state.error : null }; emit();
				const task = (async () => {
					try {
						const response = await describe();
						if (!response?.ok) throw new Error(response?.error?.message || "settings describe failed");
						// 切换账户（mutate）或更晚的 load 已经给出更新的状态：这次的结果一律作废，
						// 既不用旧快照覆盖，也不把状态留在 loading（mutate 那边已写回 ready）。
						if (disposed || sequence !== loadSequence) return state;
						const row = response.value?.namespaces?.find((candidate) => candidate?.ns === COMMANDCODE_SETTINGS_NS);
						if (!row) throw new Error("Command Code settings namespace not found");
						state = { ...state, status: "ready", writable: response.value.writable === true, ...parseRow(row) };
					} catch (error) {
						if (disposed || sequence !== loadSequence) return state;
						state = { ...state, status: "unavailable", error: String(error?.message || error) };
					}
					emit();
					return state;
				})();
				inflightLoad = { sequence, promise: task };
				try { return await task; } finally { if (inflightLoad?.promise === task) inflightLoad = null; }
			};
			const switchTo = async (id) => {
				if (disposed || state.status !== "ready" || state.switching) return state;
				// 回自动轮换：组合层已固定（base 非空）时写空串覆盖，否则直接清除该字段——
				// 与提供方插件设置页的 active intent 完全一致。
				const ops = id === ""
					? (state.baseActive !== "" ? [{ op: "set", path: ["activeAccount"], value: "" }] : [{ op: "unset", path: ["activeAccount"] }])
					: [{ op: "set", path: ["activeAccount"], value: id }];
				state = { ...state, switching: true, error: null }; emit();
				try {
					const response = await mutate(ops, state.revision);
					if (!response?.ok) throw new Error(response?.error?.message || "settings mutate failed");
					// 写入成功就是权威状态：作废在途的旧 describe，并把 status 明确拉回 ready
					// （load 开始时置的 loading 不该留在这里）。
					loadSequence++;
					state = { ...state, status: "ready", switching: false, ...parseRow(response.value) };
				} catch (error) {
					const message = String(error?.message || error);
					state = { ...state, switching: false, error: message };
					void load(true); // 写失败（含 revision 冲突）后以 Host 实际状态为准；失败原因保留给界面。
				}
				emit();
				return state;
			};
			return {
				load, switchTo,
				subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
				getSnapshot: () => state,
				dispose: () => { disposed = true; listeners.clear(); }
			};
		}

		// 未注入 cc（提供方插件未运行）时给 useSyncExternalStore 一对稳定引用：每次都新建函数
		// 会让 React 反复重新订阅。
		const NO_CC_STATE = () => null;
		const NO_CC_SUBSCRIBE = () => () => {};
		/** 弹层与设置页共用的 Command Code 账户区：自动轮换 + 默认账户 + 各额外账户。 */
		function CommandCodeAccountSwitch({ cc, ccState, t }) {
			if (!cc || !ccState) return null;
			// 状态没 ready（正在读账户配置 / 不可用）时按钮不可点：switchTo 在这种状态下会直接返回，
			// 可点的按钮换来的只是「点了没反应」。
			const locked = ccState.switching || ccState.status !== "ready" || !ccState.writable;
			const optionButton = (id, labelText) => h("button", {
				type: "button",
				onClick: () => void cc.switchTo(id),
				disabled: locked,
				"aria-pressed": ccState.activeId === id,
				style: {
					display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
					padding: "4px 8px", marginTop: 4, borderRadius: 6,
					border: `1px solid ${ccState.activeId === id ? "rgba(59,130,246,.55)" : "rgba(128,128,128,.3)"}`,
					background: ccState.activeId === id ? "rgba(59,130,246,.10)" : "transparent",
					color: "inherit", font: "inherit",
					cursor: locked ? "default" : "pointer"
				}
			},
				h("span", { "aria-hidden": "true" }, ccState.activeId === id ? "●" : "○"),
				h("span", { style: { flex: 1 } }, labelText),
				ccState.activeId === id ? h("span", { style: { fontSize: 11, opacity: 0.75 } }, t("ccAccountActive")) : null
			);
			// 账户多时这一坨会把上方的额度顶出视野：折进 details，summary 只留「当前账户 + 数量」，
			// 展开后列表自身限高滚动，弹层高度不随账户数增长。
			const activeName = ccState.status !== "ready" ? null
				: ccState.activeId === "default" ? t("ccAccountDefault")
				: (ccState.accounts.find(account => account.id === ccState.activeId)?.label ?? ccState.activeId);
			// summary 直接回答「现在是哪一个账户」：固定账户写账户名 + 使用中，自动轮换写模式名。
			const activeLabel = ccState.status !== "ready" ? null
				: ccState.activeId === "" ? t("ccAccountAuto")
				: `${activeName} · ${t("ccAccountActive")}`;
			const optionCount = ccState.status === "ready" ? ccState.accounts.length : 0;
			return h("details", { style: { marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(128,128,128,.25)" } },
				h("summary", { style: { cursor: "pointer", fontSize: 11, opacity: 0.8 } },
					`${t("ccAccountsTitle")}：${activeLabel ?? (ccState.status === "loading" || ccState.status === "idle" ? t("loading") : t("ccAccountsUnavailable"))}${optionCount > 1 ? `（${optionCount}）` : ""}`),
				ccState.status === "ready"
					? h("div", null,
						h("div", { style: { maxHeight: 240, overflowY: "auto" } },
							optionButton("", t("ccAccountAuto")),
							ccState.accounts.map((account) => optionButton(account.id, account.id === "default" ? t("ccAccountDefault") : account.label))),
						ccState.error ? h("p", { style: { color: "#f87171", margin: "6px 0 0", whiteSpace: "pre-wrap" } }, `${t("ccSwitchFailed")}: ${ccState.error}`) : null,
						h("p", { style: { margin: "6px 0 0", fontSize: 11, opacity: 0.65 } }, t("ccAccountsHint")))
					: h("p", { style: { margin: "4px 0 0", opacity: 0.7 } }, ccState.status === "loading" || ccState.status === "idle" ? t("loading") : t("ccAccountsUnavailable"))
			);
		}

		/**
		 * Command Code 自动轮换池健康摘要（弹层与设置页共用）：
		 * 数据来自 Host 挂在 commandcode entry 上的 accountPool（auto 模式才有）。
		 * 不简单取「最差账户」染红——账户间是独立配额，单个限额轮换器会避开它；
		 * 只有全部有凭据账户都限额（exhausted）才是真的要 429。点账户行可固定到它。
		 */
		function CommandCodePoolSummary({ pool, cc, t }) {
			if (!pool || pool.mode !== "auto" || !Array.isArray(pool.accounts) || pool.total <= 1) return null;
			const summary = pool.exhausted
				? t("ccPoolExhausted")
				: pool.blockedCount > 0 || pool.unusableCount > 0
					? t("ccPoolCapacity").replace("{available}", pool.available).replace("{total}", pool.total).replace("{blocked}", pool.blockedCount)
					: t("ccPoolAllHealthy").replace("{n}", pool.total);
			const tone = pool.exhausted ? "#ef4444" : pool.blockedCount > 0 || pool.unusableCount > 0 ? "#eab308" : "#22c55e";
			const rowFor = (account) => {
				const worst = worstWindow(account.windows || []);
				const tier = account.availability === "paygo" ? { color: "#eab308", icon: "ℹ" } : account.usable || account.blocked ? usageTier(worst || { percent: 0, status: "ok" }) : null;
				const blocked = account.blocked;
				const limited = (account.windows || []).filter(w => w.status === "rate-limited");
				const roots = limited.filter(w => !w.cascade);
				const kinds = [...new Set(roots.length ? roots.map(w => w.kind) : limited.flatMap(w => w.detail?.blockedBy?.length ? w.detail.blockedBy : [w.kind]))];
				const limitDetail = kinds.length ? t("ccPoolWindowLimited").replace("{windows}", kinds.map(kind => t(KIND_LABEL[kind] || "ccPoolPeriodUnknown")).join(" / ")) : t("ccPoolLimitUnknown");
				const unusable = !account.usable && !account.blocked;
				const dot = statusGlyph(unusable ? NEUTRAL : (tier ? tier.color : NEUTRAL), unusable ? "?" : blocked ? "✕" : (tier ? tier.icon : "?"), 14);
				const detail = unusable
					? (account.availability === "unknown" ? t("statusUnknownShort") : account.state === "error" ? t("statusError") : account.state === "disabled" ? t("statusDisabled") : account.state === "no-cookie" ? t("statusNoCookie") : t("statusNoKey"))
					: blocked
						? limitDetail
						: account.availability === "paygo" ? t("statusPaygoShort") : worst ? pillText(worst, (account.windows || []).length > 1, t)
						: t("noUsageData");
				const canPin = cc && account.id !== "default";
				return h("button", {
					key: account.id, type: "button", disabled: !canPin,
					title: canPin ? t("ccPoolClickToPin") : undefined,
					onClick: canPin ? () => void cc.switchTo(account.id) : undefined,
					style: { display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", marginTop: 4, padding: "3px 6px", borderRadius: 6, border: "1px solid rgba(128,128,128,.25)", background: "transparent", color: "inherit", font: "inherit", fontSize: 11, cursor: canPin ? "pointer" : "default" }
				},
					dot,
					h("span", { style: { flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, account.id === "default" ? t("ccAccountDefault") : account.label),
					h("span", { style: { opacity: 0.75, flex: "0 1 60%", minWidth: 0, textAlign: "right", whiteSpace: "normal", overflowWrap: "anywhere" } }, detail));
			};
			return h("div", { style: { marginTop: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${alpha(tone, ".35")}`, background: alpha(tone, ".07") } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: textTone(tone) } },
					h("span", null, t("ccPoolTitle")),
					h("span", { style: { flex: 1 } }),
					h("span", { style: { fontWeight: 500, opacity: 0.9 } }, `${pool.available}/${pool.total}`)),
				h("p", { role: pool.exhausted ? "alert" : "status", style: { margin: "3px 0 0", fontSize: 11, color: textTone(tone) } }, summary),
				pool.unusableCount > 0 ? h("p", { style: { margin: "2px 0 0", fontSize: 10.5, opacity: 0.7 } }, t("ccPoolUnusable").replace("{unusable}", pool.unusableCount)) : null,
				h("details", { style: { marginTop: 4 } },
					h("summary", { style: { cursor: "pointer", fontSize: 11, opacity: 0.8 } }, t("ccPoolDetails")),
					h("div", { style: { maxHeight: 240, overflowY: "auto", marginTop: 4 } }, pool.accounts.map(rowFor))));
		}

		// ── 视觉原语：扁平 + 状态色（药丸 / 弹层 / 设置页共用同一套）────────────────
		// 注意：下面这些都是**普通函数调用**而不是 React 组件元素——它们不用 Hook，直接内联展开，
		// 测试里的 React 桩也能看到它们渲染出的文字。
		const TRACK = "rgba(128,128,128,.22)";
		const NEUTRAL = "#94a3b8";
		const INFO = "#3b82f6";
		/** #rrggbb → rgba(r,g,b,a)：底色与描边都由状态色派生，保证同一状态到处同一个颜色。 */
		function alpha(color, a) {
			const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || "");
			return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(128,128,128,${a})`;
		}
		/** 状态色实心圆上的字形色：黄色配深字，其余白字。 */
		function onColor(color) { return color === "#eab308" ? "#1f1300" : "#fff"; }
		/** 状态色用作文字时的版本：纯黄在浅色主题上看不清，加深一档。 */
		function textTone(color) { return color === "#eab308" ? "#ca8a04" : color; }
		function windowLeft(w) { return w.status === "rate-limited" ? 0 : remainingPercent(w.percent); }
		/** 状态色实心圆 + 字形（✓ ⚠ ✕ ? ! ⚙ ℹ …）：颜色之外还有形状，不靠颜色单独传达。 */
		function statusGlyph(color, icon, size) {
			return h("span", { "aria-hidden": "true", style: { flex: "none", width: size, height: size, borderRadius: "50%", background: color, color: onColor(color), display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.62), fontWeight: 700, lineHeight: 1 } }, icon);
		}
		/** 小标签：状态色圆点 + 继承前景色的文字（文字不着色，深浅主题都清晰）。 */
		function statusChip(text, color) {
			return h("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, lineHeight: 1.5, padding: "1px 8px", borderRadius: 999, background: alpha(color, ".14"), whiteSpace: "nowrap" } },
				h("span", { "aria-hidden": "true", style: { width: 6, height: 6, borderRadius: "50%", background: color } }), text);
		}
		/**
		 * 药丸里的迷你余量条：一个窗口一根横条，满 = 100% 剩余，颜色是该窗口自己的档位色。
		 * 条的顺序与弹层里窗口行的顺序一致，所以不用文字也能一眼对上；窗口越多条越细（最多 5 根）。
		 */
		function miniBars(windows, muted) {
			const list = windows.slice(0, 5), n = list.length;
			const barH = n <= 1 ? 6 : n === 2 ? 5 : n === 3 ? 4 : n === 4 ? 3 : 2;
			return h("span", { "aria-hidden": "true", style: { display: "inline-flex", flexDirection: "column", justifyContent: "center", gap: n <= 2 ? 3 : 2, width: 34, flex: "none", opacity: muted ? 0.5 : 1 } },
				list.map((w, i) => {
					const left = windowLeft(w);
					return h("span", { key: `${w.kind}:${i}`, style: { display: "block", height: barH, borderRadius: 99, background: TRACK, overflow: "hidden" } },
						h("span", { style: { display: "block", width: `${left}%`, minWidth: left > 0 ? 3 : 0, height: "100%", borderRadius: 99, background: usageTier(w).color } }));
				}));
		}
		/**
		 * 订阅整体状态：一个对象回答「现在订阅怎么样」，药丸、弹层横幅、设置页横幅共用，
		 * 所以三处永远同一个结论、同一个颜色。优先级：额度用尽 > Cookie 到期 > 需配置 > 读取失败 > 缓存/不完整 > 额度档位。
		 * 返回 { key, color, icon, title, sub, short, tinted, ... }：
		 *   title/sub 给弹层横幅；short 是药丸上的**一个词**（正常时为空——绿色余量条本身就是答案）；
		 *   tinted 为真时药丸整体染色，提醒「这里需要你看一眼」。
		 */
		function computeStatus(rawEntry, { failed = null, failState, providerId, t, getLocale }) {
			const entry = canShowUsage(rawEntry) ? rawEntry : null;
			const windows = entry ? entry.windows || [] : [];
			const worst = windows.length ? worstWindow(windows) : null;
			const worstTier = worst ? usageTier(worst) : null;
			const multi = windows.length > 1;
			const degraded = !!(rawEntry && (rawEntry.state !== "ok" || rawEntry.freshness === "stale" || rawEntry.coverage === "partial"));
			const state = rawEntry ? rawEntry.state : failState;
			const expiry = cookieExpiry(rawEntry, t);
			const expiring = !!(expiry && expiry.rank >= 2);
			// 倒计时只用于展示，永远不能盖过官方接口的判定：凭据已被拒绝（state=error）时主文案仍是失败原因；
			// 例外是已过期——它本身就是「请重新登录」的行动项。
			const expiryActionable = expiring && (!(rawEntry && rawEntry.state === "error") || expiry.expired);
			const windowName = (w) => w.budgetScope ? t({ key: "budgetKey", user: "budgetUser", team: "budgetTeam", scope: "budgetScope" }[w.budgetScope] ?? "budgetScope") : t(KIND_LABEL[w.kind] ?? "wall") + (w.detail?.scope === "all" ? ` · ${t("scopeAllShort")}` : "");
			const windowShort = (w) => multi ? `${t(KIND_SHORT[w.kind] ?? "srolling")} ` : "";
			const windowSub = (w) => {
				const head = t(multi && worstTier?.rank >= 2 ? "statusWorst" : "statusOnly").replace("{w}", windowName(w)).replace("{p}", String(windowLeft(w)));
				const ms = w.resetsAt ? Date.parse(w.resetsAt) - Date.now() : NaN;
				return ms > 0 ? `${head} · ${t("statusResetIn").replace("{rest}", durationText(ms, t))}` : head;
			};
			const needConfig = state === "no-key" ? (providerId === "commandcode" ? t("pillNeedCommandcode") : providerId === "xai-oauth" ? t("pillNeedGrok") : providerId === "github-copilot" ? t("pillNeedCopilot") : providerId === "deepseek-account" ? t("pillNeedDeepseekAccount") : t("pillNeedKey"))
				: state === "no-cookie" ? t("pillNeedCookie") : null;
			const base = { entry, windows, worst, worstTier, multi, degraded, expiry, expiring, expiryActionable, needConfig };
			if ((!rawEntry && !failed && !failState) || state === "loading") return { ...base, key: "loading", color: NEUTRAL, icon: "…", title: t("loading"), sub: "", short: "", tinted: false };
			if (state === "disabled") return { ...base, key: "disabled", color: NEUTRAL, icon: "–", title: t("statusDisabled"), sub: "", short: t("statusDisabled"), tinted: false };
			const pool = rawEntry?.accountPool;
			if (pool?.mode === "auto" && pool.available > 0) return { ...base, key: "pool", color: pool.blockedCount || pool.unusableCount ? "#eab308" : "#22c55e", icon: "✓", title: t("statusPoolAvailable"), sub: `${pool.available}/${pool.total}`, short: pool.blockedCount || pool.unusableCount ? `${pool.available}/${pool.total} ${t("statusPoolAvailableShort")}` : "", tinted: !!(pool.blockedCount || pool.unusableCount) };
			if (pool?.mode === "auto" && !pool.exhausted && pool.accounts?.some(a => a.state === "error" || a.availability === "unknown")) return { ...base, key: "pool-unknown", color: "#eab308", icon: "?", title: t("statusPoolUnknown"), sub: "", short: t("statusPoolUnknown"), tinted: true };
			const freshAdvice = rawEntry?.state === "ok" && rawEntry.freshness !== "stale";
			if (freshAdvice && rawEntry.availability === "blocked" && (rawEntry.availabilityReason !== "quota-exhausted" || !worstTier || worstTier.rank < 4)) return { ...base, key: "restricted", color: "#ef4444", icon: "✕", title: t("statusRestricted"), sub: "", short: t("statusRestrictedShort"), tinted: true };
			if (freshAdvice && (["paygo", "unknown"].includes(rawEntry.availability) || rawEntry.availability === "included" && worstTier?.rank >= 4)) {
				const title = t(rawEntry.availability === "paygo" ? "statusPaygo" : rawEntry.availability === "included" ? "statusIncludedAdvice" : "statusAvailabilityUnknown");
				const wallet = !windows.length && rawEntry.coverage === "complete" && rawEntry.availability === "paygo" ? balanceVisual(rawEntry, t) : null;
				if (wallet && !expiryActionable) return { ...base, key: "paygo", color: wallet.color, icon: wallet.icon, title: balanceText(rawEntry, t), sub: [title, wallet.label].filter(Boolean).join(" · "), short: wallet.value, tinted: wallet.tinted };
				return { ...base, key: rawEntry.availability, color: "#eab308", icon: rawEntry.availability === "unknown" ? "?" : "ℹ", title, sub: rawEntry.availability === "paygo" ? t("statusPaygoSub") : worst ? windowSub(worst) : "", short: t(rawEntry.availability === "paygo" ? "statusPaygoShort" : rawEntry.availability === "included" ? "statusIncludedShort" : "statusUnknownShort"), tinted: true };
			}
			const scopeLimited = worstTier?.rank >= 4 && windows.some(w => w.status !== "rate-limited" && w.detail?.scope && w.detail.scope !== "all") && windows.filter(w => w.status === "rate-limited").every(w => w.detail?.scope && w.detail.scope !== "all");
			if (scopeLimited) return { ...base, key: "scope", color: "#eab308", icon: "⚠", title: t("statusScopeLimited"), sub: windowSub(worst), short: t("statusScopeShort"), tinted: true };
			if (worstTier && worstTier.rank >= 4) {
				const title = t(worst.cascade ? "statusBlocked" : "statusExhausted");
				return { ...base, key: "blocked", color: worstTier.color, icon: "✕", title, sub: windowSub(worst), short: windowShort(worst) + t(worst.cascade ? "pillBlocked" : "pillLimited"), tinted: true };
			}
			if (expiryActionable) {
				return { ...base, key: "cookie", color: expiry.color, icon: expiry.icon, title: expiry.label, sub: t("mimoCookieExpiresAt").replace("{time}", new Date(expiry.expiresAt).toLocaleString(getLocale())), short: expiry.short || expiry.label, tinted: true };
			}
			if (needConfig) {
				return { ...base, key: "config", color: INFO, icon: "⚙", title: t(state === "no-key" ? "statusNoKey" : "statusNoCookie"), sub: needConfig, short: t(state === "no-key" ? "needConfigShort" : "statusNoCookie"), tinted: true };
			}
			if (!entry) {
				const rawReason = failed || (rawEntry && rawEntry.error) || "";
				return { ...base, key: "error", color: "#ef4444", icon: "!", title: t("statusError"), sub: localError(rawEntry?.errorCode, rawReason, t), rawReason, short: t("statusError"), tinted: true };
			}
			if (degraded) {
				// 过期缓存即使 state=error 也要叫「缓存数据」：读取失败是原因，用户看到的是上次的数字。
				const label = rawEntry.freshness === "stale" ? t("statusCache") : rawEntry.coverage === "partial" ? t("statusPartial") : statusText(rawEntry, t);
				const worse = worstTier && worstTier.rank >= 3;
				return { ...base, key: "degraded", color: worse ? worstTier.color : "#eab308", icon: "?", title: label, sub: [cacheAge(rawEntry, t), worst ? windowSub(worst) : null].filter(Boolean).join(" · "), short: [!worst ? balanceVisual(entry, t)?.value : null, label].filter(Boolean).join(" · "), tinted: true };
			}
			if (worstTier) {
				const sub = windowSub(worst);
				if (worstTier.rank >= 3) return { ...base, key: "tight", color: worstTier.color, icon: "⚠", title: t("statusTight"), sub, short: windowShort(worst) + t(worstTier.badge), tinted: true };
				if (worstTier.rank === 2) return { ...base, key: "low", color: worstTier.color, icon: "⚠", title: t("statusLow"), sub, short: windowShort(worst) + t(worstTier.badge), tinted: true };
				return { ...base, key: "ok", color: worstTier.color, icon: "✓", title: t("statusPlenty"), sub, short: "", tinted: false };
			}
			if (entry.extras?.some(e => e.kind === "quota-status" && e.value === "unlimited")) return { ...base, key: "unlimited", color: NEUTRAL, icon: "ℹ", title: t("statusUnlimited"), sub: "", short: t("statusUnlimited"), tinted: false };
			// 成功但没有额度窗口：只有余额（或什么都没有）。余额就是唯一信息，不画成「充足」。
			const balance = balanceText(entry, t), visual = balanceVisual(entry, t);
			return { ...base, key: "balance", color: visual?.color ?? NEUTRAL, icon: visual?.icon ?? "ℹ", title: balance ?? t("noUsageData"), sub: visual?.label ?? "", short: visual?.value ?? balance ?? t("noUsageData"), tinted: visual?.tinted ?? false };
		}
		/** 弹层 / 设置页顶部的状态横幅：左侧实心状态圆，右侧一句结论 + 一行依据。 */
		function statusBanner(status) {
			return h("div", { role: "status", style: { display: "flex", alignItems: "center", gap: 12, marginTop: 10, padding: "12px 14px", borderRadius: 12, background: alpha(status.color, ".10"), border: `1px solid ${alpha(status.color, ".28")}` } },
				statusGlyph(status.color, status.icon, 30),
				h("div", { style: { minWidth: 0, flex: 1 } },
					h("div", { style: { fontSize: 15, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" } }, status.title),
					status.sub ? h("div", { style: { fontSize: 11.5, opacity: 0.75, marginTop: 2, overflowWrap: "anywhere", whiteSpace: "pre-wrap" } }, status.sub) : null));
		}
		/** 套餐名（extras 里 kind=plan）：放在标题行右侧做成小标签，不再混在余额明细里。 */
		function planName(entry) {
			const row = entry && Array.isArray(entry.extras) ? entry.extras.find((x) => x.kind === "plan") : undefined;
			return row ? row.value : null;
		}
		function RemainingBar({ value, color, label }) {
			const pct = Math.max(0, Math.min(100, Number(value) || 0));
			return h("div", {
				role: "progressbar",
				"aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-label": label,
				style: { width: "100%", height: 8, marginTop: 8, borderRadius: 99, background: TRACK, overflow: "hidden" }
			}, h("div", { style: { width: `${pct}%`, minWidth: pct > 0 ? 4 : 0, height: "100%", borderRadius: 99, background: color } }));
		}
		/**
		 * 单窗口行（药丸弹层与设置页共用）：徽标 + 余量% 主数字 + 进度条（满格=100% 剩余，随已用扣减）+ 明细行。
		 * 明细分两行：用量/适用范围一行，重置时间一行。挤在一行时「重置于 …（还有 …）」
		 * 会在窄弹层里被从中间折断，读起来像属性和数值分了家。
		 */
		function UsageWindowRow({ w, t, getLocale, uncertain = false }) {
			const tier = uncertain && w.status !== "rate-limited" ? { icon: "?", badge: "badgeUnknown", color: "#b7791f", rank: 2 } : usageTier(w);
			const blocked = w.status === "rate-limited";
			const left = blocked ? 0 : remainingPercent(w.percent);
			const usageLine = [
				w.detail && typeof w.detail.used === "number" && typeof w.detail.limit === "number" && w.detail.limit > 0
					? t("detailUsed").replace("{used}", fmtTokens(w.detail.used)).replace("{limit}", fmtTokens(w.detail.limit)).replace("{unit}", w.detail.unit || "")
					: null,
				// 不同额度线之间不可比（例如 AFP 的日限额只覆盖视觉 / 语音模型与 Harness）：如实标出适用范围，
				// 否则"日比周还高"会被读成插件算错。
				w.detail && w.detail.note ? w.detail.note : null,
				w.detail && w.detail.limitSource === "plan-snapshot" ? t("planSnapshotLimit") : null
			].filter(Boolean).join(" · ");
			const resetParts = [
				resetLine(w, t, getLocale),
				w.cascade ? t("cascadeLimited") + (w.detail && w.detail.blockedBy?.length ? ` · ${w.detail.blockedBy.map(kind => windowKindLabel(kind, t)).join(" / ")}` : "") : null
			].filter(Boolean).join(" · ");
			// 档位词只在「需要留意」时出现：充足时绿色长条与大数字已经说明一切，再贴一个「充足」只是噪音。
			const alert = tier.rank >= 2;
			const label = blocked ? t(tier.num) : t("pillRemaining").replace("{p}", String(left));
			return h("div", {
				style: { marginTop: 8, padding: "10px 12px", borderRadius: 10, background: blocked ? alpha(tier.color, ".09") : "rgba(128,128,128,.07)" }
			},
				h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
					h("span", { style: { fontSize: 12.5, fontWeight: 600 } }, w.budgetScope ? t({ key: "budgetKey", user: "budgetUser", team: "budgetTeam", scope: "budgetScope" }[w.budgetScope] ?? "budgetScope") : t(KIND_LABEL[w.kind] ?? "wall") + (w.detail?.scope === "all" ? ` · ${t("scopeAllShort")}` : "")),
					alert ? statusChip(t(tier.badge), tier.color) : null,
					h("span", { style: { flex: 1 } }),
					h("strong", { style: { fontSize: 18, lineHeight: 1.1, color: alert ? textTone(tier.color) : "inherit", whiteSpace: "nowrap" } }, `${left}%`),
					h("span", { style: { fontSize: 11, opacity: 0.65, whiteSpace: "nowrap" } }, t("remainWord"))
				),
				RemainingBar({ value: left, color: tier.color, label }),
				usageLine || resetParts
					? h("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 6 } },
						usageLine ? h("div", { style: { overflowWrap: "anywhere" } }, usageLine) : null,
						resetParts ? h("div", { style: { marginTop: usageLine ? 2 : 0, overflowWrap: "anywhere" } }, resetParts) : null)
					: null
			);
		}

		/**
		 * 窗口列表：额度线切换时插一条分组标题。AFP 的日限额只覆盖视觉 / 语音模型与 Harness，
		 * 与文本模型的 5 小时 / 周 / 月不是同一条线，混排会让人把两条线的配额当成一组互相比较。
		 * 弹层与设置页共用，避免只有其中一处带分组。
		 */
		function UsageWindowList({ windows, t, getLocale, uncertain = false }) {
			return (windows || []).map((w, index) => h(react.Fragment, { key: `${w.budgetScope ?? w.kind}:${index}` },
				w.groupLabel && w.groupLabel !== windows[index - 1]?.groupLabel
					? h("p", { role: "note", style: { margin: index ? "14px 0 0" : "6px 0 0", fontSize: 11, opacity: 0.6 } }, displayGroupLabel(w.groupLabel, t))
					: null,
				h(UsageWindowRow, { w, t, getLocale, uncertain })));
		}

		function UsagePill({ providerId, label, readEntry, t, getLocale, cc, setCommandCodeAccount }) {
			const [snapshot, setSnapshot] = react.useState(null);
			const [failed, setFailed] = react.useState(null);
			const [failState, setFailState] = react.useState(void 0);
			const [refreshing, setRefreshing] = react.useState(false);
			const [open, setOpen] = react.useState(false);
			const root = react.useRef(null);
			const retry = react.useRef(() => {});
			// Command Code 账户区：cc 由装配层注入（提供方插件未运行时为 null，区块整体隐藏）。
			// 兜底用模块级稳定引用（NO_CC_*）：内联箭头函数每次渲染都是新引用，会让 React 反复重新订阅。
			const ccState = react.useSyncExternalStore(cc ? cc.subscribe : NO_CC_SUBSCRIBE, cc ? cc.getSnapshot : NO_CC_STATE, cc ? cc.getSnapshot : NO_CC_STATE);
			react.useEffect(() => { if (open && cc) void cc.load(); }, [open, cc]);
			// 挂载即读一次账户配置：提供方插件固定了账户时，药丸本体不必等弹层打开就跟随。
			react.useEffect(() => { if (providerId === "commandcode" && cc) void cc.load(); }, [providerId, cc]);
			// 显示账户跟随账户区的当前固定项（含切换成功后的回读）：ready 才同步，
			// unavailable/loading 保持现状；store 内部对相同账户去重，不产生多余请求。
			react.useEffect(() => {
				if (providerId !== "commandcode" || !ccState || !setCommandCodeAccount) return;
				if (ccState.status === "ready") void setCommandCodeAccount(ccState.activeId).catch(() => {});
			}, [providerId, setCommandCodeAccount, ccState && ccState.status, ccState && ccState.activeId]);
			react.useEffect(() => {
				let alive = true;
				let busy = false;
				setSnapshot(null);
				setFailed(null);
				setFailState(void 0);
				const refresh = async (manual = false) => {
					if (busy || (!manual && document.visibilityState === "hidden")) return;
					busy = true;
					setRefreshing(true);
					try {
						const entry = await readEntry(manual);
						if (alive) {
							setSnapshot({ entry, updatedAt: entry.lastAttemptAt || entry.lastSuccessAt || Date.now() });
							setFailed(entry.state !== "ok" ? entry.error || entry.state : null);
							setFailState(entry.state !== "ok" ? entry.state : void 0);
						}
					} catch (error) {
						if (alive) {
							setSnapshot(error && error.entry ? { entry: error.entry, updatedAt: Date.now() } : null);
							setFailed(error instanceof Error ? error.message : String(error));
							setFailState(error && error.entry ? error.entry.state : "error");
						}
					} finally {
						busy = false;
						if (alive) setRefreshing(false);
					}
				};
				retry.current = () => void refresh(true);
				void refresh();
				const unsubscribe = readEntry.subscribe ? readEntry.subscribe((entry) => { if (alive && entry) { setSnapshot({ entry, updatedAt: entry.lastAttemptAt || entry.lastSuccessAt || Date.now() }); setFailed(entry.state !== "ok" ? entry.error || entry.state : null); setFailState(entry.state); } }) : () => {};
				const deactivate = readEntry.activate ? readEntry.activate() : () => {};
				const timer = readEntry.activate ? null : setInterval(() => void refresh(), 60000);
				const visible = () => void refresh();
				if (!readEntry.activate) document.addEventListener("visibilitychange", visible);
				return () => {
					alive = false;
					retry.current = () => {};
					if (timer) clearInterval(timer);
					unsubscribe(); deactivate();
					if (!readEntry.activate) document.removeEventListener("visibilitychange", visible);
				};
			}, [readEntry]);
			react.useEffect(() => {
				if (!open) return;
				const click = (event) => {
					if (!root.current || !root.current.contains(event.target)) setOpen(false);
				};
				const key = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", click);
				document.addEventListener("keydown", key);
				return () => {
					document.removeEventListener("mousedown", click);
					document.removeEventListener("keydown", key);
				};
			}, [open]);
			const rawEntry = snapshot && snapshot.entry;
			if (rawEntry?.visible === false || rawEntry?.state === "disabled") return null;
			// Command Code 自动轮换：默认账户健康不代表池健康。所有有凭据账户都限额（exhausted）
			// 时，用池里一条 rate-limited 窗口喂给 computeStatus，让药丸/横幅如实染红；部分受限不染红
			// （轮换器会避开该账户），只在弹层池摘要里提示容量降级。
			const pool = providerId === "commandcode" ? (rawEntry?.accountPool ?? null) : null;
			const exhaustedWindow = pool?.exhausted ? (pool.accounts.flatMap(a => a.windows || []).find(w => w.status === "rate-limited") ?? null) : null;
			const statusEntry = exhaustedWindow ? { ...rawEntry, state: "ok", coverage: "complete", freshness: "fresh", windows: [exhaustedWindow] } : rawEntry;
			// 整体状态由 computeStatus 一处判定：药丸、弹层横幅、设置页横幅读的是同一个结论。
			const st = computeStatus(statusEntry, { failed, failState, providerId, t, getLocale });
			const { entry, windows, worst, degraded, expiry, expiring } = st;
			const summary = worst ? pillText(worst, windows.length > 1, t) : entry ? (balanceText(entry, t) ?? t("noUsageData")) : t("providerUnavailable");
			// 药丸只回答「订阅现在怎么样」：状态图形 + 至多一个词。正常时只剩彩色余量条——
			// 厂商名就是旁边的模型选择器，具体百分比点开再看；文字与数字都收进 title / aria-label。
			const tip = `${label}: ${st.title}${["balance", "paygo"].includes(st.key) && st.sub ? " · " + st.sub : ""}${st.key === "ok" || st.key === "low" || st.key === "tight" || st.key === "blocked" || st.key === "degraded" ? " · " + summary : ""}${expiring && st.key !== "cookie" && st.key !== "blocked" ? " · " + expiry.label : ""}`;
			// 有窗口就画迷你余量条：Cookie 到期等行动项通过 short 文案表达，不牺牲余量信息；
			// 只有没有任何额度窗口时（需配置 / 失败 / 仅余额）才退回状态字形。
			const glyph = windows.length ? miniBars(windows, degraded) : st.icon === "" ? null : statusGlyph(st.color, st.icon, 16);
			return h("span", { ref: root, style: { position: "relative", display: "inline-flex", alignItems: "center" } },
				h("button", {
					type: "button",
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					"aria-label": tip,
					title: tip,
					onClick: () => setOpen(!open),
					style: {
						display: "inline-flex", alignItems: "center", gap: 8, padding: st.short ? "4px 11px 4px 9px" : "5px 10px", minHeight: 26, boxSizing: "border-box",
						borderRadius: 999, border: `1px solid ${st.tinted ? alpha(st.color, ".45") : "rgba(128,128,128,.3)"}`,
						background: st.tinted ? alpha(st.color, ".10") : "transparent",
						color: ["balance", "paygo"].includes(st.key) && st.tinted ? `color-mix(in srgb, ${st.color} 65%, currentColor)` : "inherit", font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", maxWidth: "min(46vw, 240px)", overflow: "hidden"
					}
				},
					glyph,
					st.short ? h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, st.short) : null
				),
				open && h("div", {
					role: "dialog",
					"aria-label": `${label} ${t("nav")}`,
					style: {
						position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 50,
						width: "min(340px, calc(100vw - 24px))", maxHeight: "min(70vh, calc(100vh - 72px))", overflowY: "auto", boxSizing: "border-box", overflowWrap: "anywhere", padding: 14, borderRadius: 14,
						background: "var(--dsh-surface, Canvas)", color: "var(--dsh-text, CanvasText)",
						border: "1px solid rgba(128,128,128,.28)",
						boxShadow: "0 12px 32px rgba(0,0,0,.28)", font: "12px/1.5 sans-serif"
					}
				},
					// 标题行：厂商名 + 套餐名小标签。
					h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
						h("strong", { style: { fontSize: 13 } }, label),
						h("span", { style: { flex: 1 } }),
						planName(entry) ? h("span", { style: { fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999, background: "rgba(128,128,128,.16)", whiteSpace: "nowrap" } }, planName(entry)) : null),
					// 状态横幅：先给结论（充足 / 偏少 / 即将用尽 / 已用尽 / 需配置 / 失败…）与一行依据。
					statusBanner(st),
					failed && st.key !== "error" && !st.needConfig ? h("p", { role: "alert", title: failed, style: { color: "#f87171", margin: "8px 0 0", whiteSpace: "pre-wrap" } }, localError(rawEntry?.errorCode, failed, t)) : null,
					// Cookie 到期常驻弹层：即使用量正常，也让用户看见 Cookie 还剩多久（已在横幅里说明时不重复）。
					expiry && st.key !== "cookie" ? h("p", { role: "status", style: { margin: "8px 0 0", fontSize: 11, color: expiring ? textTone(expiry.color) : "inherit", opacity: expiring ? 1 : 0.75 } }, `${expiry.label} · ${t("mimoCookieExpiresAt").replace("{time}", new Date(expiry.expiresAt).toLocaleString(getLocale()))}`) : null,
					// 用量账户标注：账户区 ready 时说明上方数字属于哪个账户；自动轮换时明确不跟随实际服务账户。
					providerId === "commandcode" && ccState && ccState.status === "ready"
						? h("p", { role: "note", style: ccState.activeId === ""
							? { margin: "8px 0 0", fontSize: 11, padding: "6px 8px", borderRadius: 8, background: "rgba(234,179,8,.10)", border: "1px solid rgba(234,179,8,.35)" }
							: { margin: "6px 0 0", fontSize: 11, opacity: 0.75 } },
							t("ccUsageAccount").replace("{account}", ccState.activeId === "" || ccState.activeId === "default" ? t("ccAccountDefault") : (ccState.accounts.find((a) => a.id === ccState.activeId)?.label ?? ccState.activeId)),
							ccState.activeId === "" ? h("span", null, ` · ${t("ccUsageAutoNote")}`) : null)
						: null,
					// 自动轮换池健康度：默认账户之外的账户也可能已限额，池耗尽时药丸已染红，这里给出逐账户明细。
					// 直接函数调用（非 React 元素），与 UsageWindowList 等视觉原语同约定，测试桩可见展开内容。
					pool ? CommandCodePoolSummary({ pool, cc, t }) : null,
					pool?.mode === "auto" && windows.length ? h("p", { style: { margin: "8px 0 0", fontSize: 11, fontWeight: 600, opacity: 0.8 } }, t("ccWindowsDefault")) : null,
					// 额度线切换时插一条分组标题：AFP 的日限额只覆盖视觉 / 语音模型与 Harness，与文本模型的
					// 5 小时 / 周 / 月不是同一条线，混排会让人把两条线的配额当成一组来互相比较。
					UsageWindowList({ windows, t, getLocale, uncertain: degraded || !!(expiry && expiry.expired) }),
					// 余额等补充项：套餐名已在标题行，这里只剩「标签 … 数值」两列。
					entry && entry.extras && entry.extras.some((x) => x.kind !== "plan")
						? h("div", { style: { marginTop: 10, padding: "6px 12px", borderRadius: 10, background: "rgba(128,128,128,.07)" } },
							entry.extras.filter((x) => x.kind !== "plan").map((x) => h("div", { key: x.kind, style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" } },
								h("span", { style: { opacity: 0.7 } }, extraLabel(x, t, providerId)),
								h("strong", { style: { fontWeight: 600, textAlign: "right" } }, x.kind === "balance" ? formatBalanceValue(x.value) : x.value))))
						: null,
					providerId === "commandcode" ? h(CommandCodeAccountSwitch, { cc, ccState, t }) : null,
					// 页脚：更新时间 + 刷新。
					h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 12 } },
						h("span", { style: { flex: 1, minWidth: 0, fontSize: 11, opacity: 0.6 } }, snapshot ? `${t("lastUpdated")} ${new Date(snapshot.updatedAt).toLocaleString(getLocale())}` : ""),
						h("button", {
							type: "button",
							onClick: () => retry.current(),
							disabled: refreshing,
							style: { padding: "4px 12px", borderRadius: 8, border: "none", background: alpha(INFO, ".14"), color: "inherit", font: "inherit", fontWeight: 600, cursor: refreshing ? "default" : "pointer", whiteSpace: "nowrap" }
						}, t(refreshing ? "refreshing" : "refresh"))
					)
				)
			);
		}

		// ── 设置页：提供商开关、响应式按钮导航、敏感凭据显式 patch ────────────
		function initialTab() {
			try { const id = window.localStorage.getItem("dsh-subusage:last-provider"); if (PROVIDER_ORDER.includes(id)) return id; } catch {}
			return PROVIDER_ORDER[0];
		}
		function draftFor(settings, id) {
			return { keyMode: settings && settings.keyModes && settings.keyModes[id] || "inherit", keyAction: "keep", key: "", cookieAction: "keep", cookie: "", zai: { type: 1, organization: "", project: "", ...(settings && settings.zai) }, volc: { accessKey: "", secret: "", clear: false }, litellm: { baseUrl: settings && settings.litellm && settings.litellm.baseUrl || "" } };
		}
		// 从网页/控制台复制值时常带上换行、制表或零宽字符，而这些字段本身都不含空白——
		// 剔除它们比「拒绝保存」省事得多：拒绝只会让用户觉得「填了没用」。
		function stripInvisible(raw) { return String(raw).replace(/[\s\u200b-\u200d\ufeff]/g, ""); }
		function settingsPatch(id, draft, revision) {
			if (typeof revision !== "string" || !revision) throw new Error("请先加载最新设置，再编辑保存 / Load settings before saving");
			const patch = { providerId: id, expectedRevision: revision };
			// 凭据由提供方插件管理的模型商没有任何本地凭据补丁可保存。
			if (PROVIDER_META[id].managedByPlugin) return patch;
			if (PROVIDER_META[id].volc) {
				// AK/SK 是秘密且不回填：只有真正填了值的那一项才发 replace，避免「只改 AK 把 SK 抹掉」；
				// 清除必须显式点按钮，空输入不是清空指令。
				patch.keyMode = draft.keyMode;
				if (draft.volc.clear) patch.volc = { accessKeyId: { action: "clear" }, secretAccessKey: { action: "clear" } };
				else {
					const volc = {};
					// 从控制台复制 AK/SK 时经常带上换行、制表或零宽字符，而 AK/SK 本身不含任何空白，
					// 所以这里**剔除**这些不可见字符而不是拒绝保存——拒绝过严会让用户只看到"没反应"。
					const accessKey = stripInvisible(draft.volc.accessKey), secret = stripInvisible(draft.volc.secret);
					for (const [field, value] of [["accessKeyId", accessKey], ["secretAccessKey", secret]]) {
						if (!value) continue;
						volc[field] = { action: "replace", value };
					}
					if (Object.keys(volc).length) patch.volc = volc;
				}
				return patch;
			}
			if (id === "xiaomi-token-plan-cn") {
				patch.cookieUpdate = { action: draft.cookieAction };
				if (draft.cookieAction === "replace") patch.cookieUpdate.value = validateCookieText(draft.cookie);
			} else {
				patch.keyMode = draft.keyMode;
				patch.keyUpdate = { action: draft.keyAction };
				if (draft.keyAction === "replace") {
					const key = stripInvisible(draft.key);
					if (!key) throw new Error("API Key 不能为空 / API key cannot be empty");
					patch.keyUpdate.value = key;
				}
				if (id === "zai-coding-cn") patch.zai = { ...draft.zai, organization: stripInvisible(draft.zai.organization), project: stripInvisible(draft.zai.project) };
				// LiteLLM 的代理地址不是秘密，原样提交；空串表示清空（请求时会按「未配置」提示）。
				if (id === "litellm") patch.litellm = { baseUrl: stripInvisible(draft.litellm.baseUrl) };
			}
			return patch;
		}
		function SubusageSection({ usageStore, t, getLocale, cc }) {
			const result = react.useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot);
			// Command Code 账户区：与弹层共用同一个控制器与组件；cc 由装配层注入，
			// 提供方插件未运行时为 undefined，区块整体隐藏。
			const ccState = react.useSyncExternalStore(cc ? cc.subscribe : NO_CC_SUBSCRIBE, cc ? cc.getSnapshot : NO_CC_STATE, cc ? cc.getSnapshot : NO_CC_STATE);
			const [tab, setTab] = react.useState(initialTab);
			const [draft, setDraft] = react.useState(() => draftFor(result.settings, tab));
			const [dirty, setDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [refreshing, setRefreshing] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [loadError, setLoadError] = react.useState(null);
			const [login, setLogin] = react.useState({ jobId: null, state: "idle" });
			const [editorOpen, setEditorOpen] = react.useState(false);
			const [usageTab, setUsageTab] = react.useState(initialTab);
			// 登录状态是组件级单值，但要按提供商区分：MiMo 与 OpenDesign 各有独立的 Host 登录器，
			// 在 A 家登录时切到 B 家的标签页，不该看到 A 家的进度或错误。
			const loginApi = LOGIN_METHODS[tab];
			const loginShown = login.providerId === undefined || login.providerId === tab;
			const loginActive = loginShown && ["launching", "waiting", "verifying"].includes(login.state);
			const loginRef = react.useRef(login);
			loginRef.current = login;
			const handledLogin = react.useRef(null);
			const aliveRef = react.useRef(true);
			react.useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
			const dirtyRef = react.useRef(false);
			const revisionRef = react.useRef(result.settings && result.settings.revision);
			const root = react.useRef(null);
			const local = getLocale().startsWith("zh");
			const text = (cn, en) => local ? cn : en;
			react.useEffect(() => {
				let alive = true;
				void (usageStore.readSettings ?? usageStore.readAll)().then(() => { if (alive) setLoadError(null); }).catch((error) => { if (alive) setLoadError(localError(error.code, String(error.message || error), t)); });
				return () => { alive = false; };
			}, [usageStore]);
			react.useEffect(() => {
				let alive = true;
				const enabled = editorOpen && providerEnabled(result.settings, tab);
				const deactivate = enabled ? usageStore.activate(tab) : () => {};
				void (usageStore.readSettings ?? usageStore.readAll)().then(() => { if (alive && enabled && providerEnabled(usageStore.getSnapshot().settings, tab)) return usageStore.refresh([tab], false); }).catch((error) => { if (alive) setLoadError(localError(error.code, String(error.message || error), t)); });
				return () => { alive = false; deactivate(); };
			}, [usageStore, tab, editorOpen, providerEnabled(result.settings, tab)]);
			react.useEffect(() => {
				if (!dirtyRef.current) { setDraft(draftFor(result.settings, tab)); revisionRef.current = result.settings && result.settings.revision; }
			}, [result.settings, tab]);
			// 设置卸载/切换只停止 UI 轮询；Host 负责浏览器任务的 lifetime。
			react.useEffect(() => {
				const api = LOGIN_METHODS[tab];
				if (!api || !usageStore[api.status]) return;
				let alive = true;
				void usageStore[api.status]().then((value) => { if (alive && value) setLogin(value); }).catch((error) => { if (alive) setLogin({ jobId: null, state: "error", providerId: tab, message: String(error.message || error) }); });
				return () => { alive = false; };
			}, [usageStore, tab]);
			react.useEffect(() => {
				const api = LOGIN_METHODS[tab];
				if (!api || !loginActive || !login.jobId) return;
				let alive = true, timer;
				const poll = async () => {
					try {
						const value = await usageStore[api.status]();
						if (!alive) return;
						if (value) setLogin(value);
						if (!value || ["launching", "waiting", "verifying"].includes(value.state)) timer = setTimeout(poll, 2000);
					} catch (error) { if (alive) setLogin({ jobId: login.jobId, state: "error", providerId: tab, message: String(error.message || error) }); }
				};
				timer = setTimeout(poll, 2000);
				return () => { alive = false; clearTimeout(timer); };
			}, [usageStore, tab, loginActive, login.jobId]);
			react.useEffect(() => {
				if (!loginShown || login.state !== "success" || !login.result || handledLogin.current === login.jobId) return;
				handledLogin.current = login.jobId;
				if (!dirtyRef.current) { setDraft(draftFor(login.result.settings, tab)); revisionRef.current = login.result.settings && login.result.settings.revision; }
				setNotice({ ok: true, text: dirtyRef.current ? text("登录凭据已自动保存；当前未保存编辑已保留，请取消或重新核对后保存。", "Login saved automatically; unsaved edits retained. Cancel or review before saving.") : text("登录成功，凭据已自动保存。", "Signed in; credentials saved automatically.") });
			}, [login, tab]);
			const startLogin = async () => {
				if (dirtyRef.current) { setNotice({ ok: false, text: text("自动登录会立即保存凭据，请先保存或取消当前编辑。", "Automatic login saves immediately. Save or cancel your edits first.") }); return; }
				if (["launching", "waiting", "verifying"].includes(loginRef.current.state) || busy) return;
				loginRef.current = { jobId: null, state: "launching", providerId: tab }; setLogin(loginRef.current); setNotice(null);
				try { const value = await usageStore[loginApi.start]({ expectedRevision: result.settings.revision }); if (aliveRef.current && value) setLogin(value); }
				catch (error) { if (aliveRef.current) setLogin({ jobId: null, state: "error", providerId: tab, message: String(error.message || error) }); }
			};
			const cancelLogin = async () => {
				const jobId = loginRef.current.jobId;
				if (!jobId) return;
				try { const value = await usageStore[loginApi.cancel]({ jobId }); if (aliveRef.current && loginRef.current.jobId === jobId && value) setLogin(value); }
				catch (error) { if (aliveRef.current && loginRef.current.jobId === jobId) setNotice({ ok: false, text: String(error.message || error) }); }
			};
			const editDraft = (patch) => { if ((loginApi && loginActive) || !result.settings || typeof result.settings.revision !== "string") return; dirtyRef.current = true; setDirty(true); setNotice(null); setDraft((prev) => ({ ...prev, ...patch })); };
			const cancel = () => { dirtyRef.current = false; setDirty(false); setDraft(draftFor(result.settings, tab)); revisionRef.current = result.settings && result.settings.revision; setNotice(null); };
			const openEditor = (id) => {
				if (id === tab) { setEditorOpen(true); return; }
				if (dirtyRef.current) { setNotice({ ok: false, text: text("请先保存或取消当前凭据编辑，再展开其他提供商。", "Save or cancel credential edits before opening another provider.") }); return; }
				setTab(id); setEditorOpen(true); setNotice(null); setLoadError(null);
			};
			const chooseUsage = (id) => {
				setUsageTab(id);
				if (!editorOpen && !dirtyRef.current) setTab(id);
				try { window.localStorage.setItem("dsh-subusage:last-provider", id); } catch {}
			};
			const refresh = async (all) => {
				setRefreshing(all ? "all" : "current");
				try { if (!result.settings) await (usageStore.readSettings ?? usageStore.readAll)(); else await usageStore.refresh(all ? PROVIDER_ORDER : usageId ? [usageId] : [], true); if (aliveRef.current) setLoadError(null); }
				catch (error) { if (aliveRef.current) setLoadError(localError(error.code, String(error.message || error), t)); }
				finally { if (aliveRef.current) setRefreshing(false); }
			};
			const saveVisibility = async (visibility) => {
				if (busy || !result.settings || !result.settings.revision) return;
				if (dirtyRef.current) { setNotice({ ok: false, text: text("请先保存或取消凭据编辑。", "Save or cancel credential edits first.") }); return; }
				setBusy(true);
				try {
					const saved = await usageStore.save({ expectedRevision: result.settings.revision, visibility });
					if (!aliveRef.current) return;
					revisionRef.current = saved.settings.revision;
					setNotice({ ok: true, text: text("提供商设置已保存", "Provider settings saved") });
					// 新启用条目先重新探测凭据；保存成功不与接口验证混为一谈。
					// Ark 个人版与 Team 是独立组开关：只刷新本次真正启用的那一组。
					const enabled = [...Object.entries(visibility.providers || {}).filter(([, value]) => value).map(([id]) => id), ...(visibility.ark === true ? ARK_PERSONAL_IDS : []), ...(visibility.arkTeam === true ? ARK_TEAM_IDS : [])];
					if (enabled.length) { try { await usageStore.refresh(enabled, false); } catch { if (aliveRef.current) setLoadError(text("设置已保存；用量刷新失败，可稍后重试。", "Settings saved; usage refresh failed. Retry later.")); } }
				} catch (error) { if (aliveRef.current) setNotice({ ok: false, text: localError(error.code, String(error.message || error), t) }); }
				finally { if (aliveRef.current) setBusy(false); }
			};
			const onSave = async () => {
				if (loginApi && ["launching", "waiting", "verifying"].includes(loginRef.current.state)) return;
				setBusy(true);
				try {
					const patch = settingsPatch(tab, draft, revisionRef.current);
					const saved = await usageStore.save(patch);
					if (!aliveRef.current) return;
					// 填了 AK/SK 却只得到一句「已保存」是最误导人的失败方式：这里如实回显到底存没存上。
					const intendedVolc = Boolean(PROVIDER_META[tab].volc && (patch.volc?.accessKeyId || patch.volc?.secretAccessKey));
					const storedVolc = Boolean(saved.settings?.volc?.hasAccessKeyId || saved.settings?.volc?.hasSecretAccessKey);
					dirtyRef.current = false; setDirty(false);
					setDraft(draftFor(saved.settings, tab)); revisionRef.current = saved.settings && saved.settings.revision;
					setNotice(intendedVolc && !storedVolc
						? { ok: false, text: text("设置已保存，但你填的 AK/SK 没有写入。请重试；或改用环境变量 VOLC_ACCESSKEY / VOLC_SECRETKEY（重启后生效）。", "Settings saved, but the AK/SK you entered was not stored. Retry, or use the VOLC_ACCESSKEY / VOLC_SECRETKEY environment variables (takes effect after restart).") }
						: { ok: true, text: t("saved") });
					if (!providerEnabled(saved.settings, tab)) return;
					// 保存已成功落盘；独立验证失败不改写成“保存失败”。
					try {
						const verified = await usageStore.refresh(PROVIDER_META[tab]?.volc ? ARK_IDS : [tab], true);
						const current = verified.entries.find((e) => e.providerId === tab);
						if (aliveRef.current) setLoadError(current && current.state === "ok" ? null : text("已保存；验证获取失败：", "Saved; validation fetch failed: ") + (current && current.error || statusText(current, t)));
					} catch (error) { if (aliveRef.current) setLoadError(text("已保存；验证获取失败：", "Saved; validation fetch failed: ") + String(error.message || error)); }
				} catch (error) { if (aliveRef.current) setNotice({ ok: false, text: localError(error.code, String(error.message || error), t) }); }
				finally { if (aliveRef.current) setBusy(false); }
			};
			const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,.4)", background: "transparent", color: "inherit", font: "inherit" };
			const btnStyle = { padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(128,128,128,.35)", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" };
			const primary = { ...btnStyle, background: "rgba(59,130,246,.12)", borderColor: "rgba(59,130,246,.65)" };
			const entries = result.entries || [];
			// 首次挂载时 settings 还没读到（readAll 在飞行中），providerVisible 对缺失一律「未知放行」，
			// 会让标签栏先闪现全部默认开启的提供商；未初始化期间标签栏、空状态与计数都不渲染。
			const initialized = !!result.settings;
			const entry = entries.find((e) => e.providerId === tab);
			// 待处理的排前面；组内保持登记顺序，所以顺序不会自己抖动。
			const visibleIds = !initialized ? [] : PROVIDER_ORDER
				.map((id, index) => ({ id, index, rank: usageAttentionRank(entries.find(e => e.providerId === id), t) }))
				.filter(item => providerVisible(result.settings, item.id, entries.find(e => e.providerId === item.id), result))
				.sort((a, b) => b.rank - a.rank || a.index - b.index)
				.map(item => item.id);
			const success = entries.filter((e) => visibleIds.includes(e.providerId) && e.state === "ok" && e.freshness !== "stale").length;
			// 顶部计数同时是「出问题的那几家在哪」的入口：点一下就切到第一家没读成功的。
			const troubledIds = visibleIds.filter(id => { const e = entries.find(item => item.providerId === id); return !(e && e.state === "ok" && e.freshness !== "stale"); });
			const hideWithoutApi = result.settings?.visibility?.hideWithoutApi !== false;
			react.useEffect(() => {
				if (visibleIds.length && !visibleIds.includes(usageTab)) setUsageTab(visibleIds[0]);
			}, [usageTab, visibleIds.join("|")]);
			const usageId = visibleIds.includes(usageTab) ? usageTab : visibleIds[0];
			const usageEntry = entries.find(e => e.providerId === usageId);
			const usageTitle = usageId ? providerDisplayName(usageId, "label", getLocale) : "";
			// 需要行动时（缺凭据/凭据被拒/Cookie 即将到期）在用量面板里内联修复入口。
			const usageAction = usageActionKind(usageEntry, usageId, t);
			// Command Code 自动轮换：池耗尽时横幅按池中一条限额窗口染红（与药丸同一结论）。
			const usagePool = usageId === "commandcode" ? (usageEntry?.accountPool ?? null) : null;
			const usageExhaustedWindow = usagePool?.exhausted ? (usagePool.accounts.flatMap(a => a.windows || []).find(w => w.status === "rate-limited") ?? null) : null;
			const usageStatusEntry = usageExhaustedWindow ? { ...usageEntry, state: "ok", coverage: "complete", freshness: "fresh", windows: [usageExhaustedWindow] } : usageEntry;
			const usageStatus = computeStatus(usageStatusEntry, { failed: usageEntry && usageEntry.state !== "ok" ? usageEntry.error || usageEntry.state : null, failState: usageEntry && usageEntry.state, providerId: usageId, t, getLocale });
			// 行动按钮把人送到对应厂商的凭据编辑器：展开管理区、打开该行、滚动过去。
			const revealEditor = (target) => {
				openEditor(target);
				const box = root.current?.querySelector?.("#subusage-provider-management");
				if (box) box.open = true;
				setTimeout(() => { const el = root.current?.querySelector?.(`#subusage-credentials-${target}`); if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" }); }, 0);
			};
			react.useEffect(() => {
				if (!usageId) return;
				const deactivate = usageStore.activate(usageId);
				void usageStore.refresh([usageId], false).catch(() => {});
				return deactivate;
			}, [usageStore, usageId]);
			// 设置页里的账户区与弹层共用同一个控制器：挂载即读一次账户配置，切到 Command Code
			// 那一屏就有数据可显示（读取只是一次 settings describe，不发任何计费请求）。
			react.useEffect(() => {
				if (!cc) return;
				void cc.load();
			}, [cc]);
			// 账户区 ready 后把当前固定账户同步为显示账户：设置页里切换账户后，上方面板与药丸
			// 一起改看所选账户的额度（与弹层的同步行为一致）。自动轮换（activeId 为空）同步为
			// 默认账户，store 内部对相同账户去重，不产生多余请求。
			react.useEffect(() => {
				if (usageId !== "commandcode" || !ccState || ccState.status !== "ready") return;
				// 旧 store stub / 更早版本的客户端装配没有这个方法：缺了就不同步，不影响其他功能。
				if (typeof usageStore.setCommandCodeAccount !== "function") return;
				void usageStore.setCommandCodeAccount(ccState.activeId).catch(() => {});
			}, [usageStore, usageId, ccState && ccState.status, ccState && ccState.activeId]);
			const meta = PROVIDER_META[tab];
			const source = entry && entry.keySource || "none";
			// auth-file 有三家（Grok / Codex / Command Code），凭据来源文件各不相同，不能只特判一家。
			const authFileLabel = tab === "xai-oauth" ? text("来自 ~/.grok/auth.json（Grok / Grok Kit 登录）", "From ~/.grok/auth.json (Grok / Grok Kit sign-in)")
				: tab === "openai-codex" ? text("来自 $CODEX_HOME/auth.json 或 ~/.codex/auth.json（codex login）", "From $CODEX_HOME/auth.json or ~/.codex/auth.json (codex login)")
				: text("来自 ~/.commandcode/auth.json（cmd login）", "From ~/.commandcode/auth.json (cmd login)");
			const sources = { credentials: text("来自凭据服务", "From credential service"), env: text("来自环境变量", "From environment"), manual: text("手动 Key", "Manual key"), none: text("无可用凭据", "No credentials"), cookie: text("官方平台 Cookie", "Platform Cookie"), "auth-file": authFileLabel, "account-service": text("本机 DeepSeek 账号余额", "Local DeepSeek account balance"), "subscription-credentials": text("Codex Subscription 活动账号（DSH 凭据服务）", "Codex Subscription active account (DSH credentials)"), "copilot-oauth": text("GitHub Copilot 登录（DSH 凭据服务）", "GitHub Copilot sign-in (DSH credentials)") };
			const credentialButtons = (kind, hasSaved) => h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
				draft[kind + "Action"] !== "replace" ? h("button", { type: "button", style: btnStyle, disabled: kind === "cookie" && loginActive, onClick: () => editDraft({ [kind + "Action"]: "replace", [kind]: "", ...(kind === "key" ? { keyMode: "manual" } : {}) }) }, text(kind === "cookie" ? "手动导入" : "更换", kind === "cookie" ? "Manual import" : "Change")) : null,
				hasSaved && draft[kind + "Action"] !== "clear" ? h("button", { type: "button", style: btnStyle, disabled: kind === "cookie" && loginActive, onClick: () => { editDraft({ [kind + "Action"]: "clear", [kind]: "" }); setNotice({ ok: false, text: text("待清除：保存设置后将删除已保存的敏感凭据；取消编辑可保留。", "Pending removal: saving will delete the saved secret. Cancel edits to keep it.") }); } }, text(kind === "cookie" ? "清除登录凭据" : "清除", kind === "cookie" ? "Clear login credentials" : "Clear")) : null,
				draft[kind + "Action"] === "clear" ? h("span", { role: "status" }, text("将删除凭据（尚未保存）", "Credential will be deleted (not saved yet)")) : null
			);
			// 界面里那些「要先去别处才能拿到」的凭据，直接给出官方入口与本仓库指引，
			// 省得用户猜菜单藏在哪一层——顺带把「推理 Key ≠ 额度凭据」讲清楚。
			const CREDENTIALS_DOC = "https://github.com/KouzakiUmi/dsh-subusage/blob/main/docs/credentials.md";
			const credentialsGuide = h("a", { href: CREDENTIALS_DOC, target: "_blank", rel: "noopener noreferrer" }, text("获取与配置指引", "Get & configure guide"));
			const externalLink = (href, label) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, label);
			const credentialEditor = h(react.Fragment, null,
				notice ? h("p", { role: "status", style: { color: notice.ok ? "inherit" : "#dc2626" } }, notice.text) : null,
					h("div", { style: { marginTop: 10 } },
						h("fieldset", { disabled: busy || !result.settings || typeof result.settings.revision !== "string", style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
						tab === "opendesign" ? h(react.Fragment, null,
							h("p", null, text("OpenDesign 的额度只在控制台接口上，凭据是浏览器的登录会话 Cookie，不是模型调用用的 sk- API Key（那把 Key 没有额度端点）。", "OpenDesign exposes quota only through its console API, authenticated by your browser session cookie — not the sk- model API key, which has no quota endpoint.")),
							// 0.14.2 曾实测自动登录在 Cloudflare 挑战处失败，该结论现已被证伪（2026-10-24 实测按钮
							// 可用）：临时浏览器不自报自动化身份之后，人机验证由用户在弹出窗口里亲自完成。这里
							// 引导完成验证，手动导入保留为备选，不再断言按钮不可用。
							h("p", { style: { fontSize: 12, opacity: .85 } }, text("「登录并自动导入」可用：它打开的临时浏览器不会自报自动化身份，遇到 Cloudflare 人机验证时在弹出窗口中亲自完成即可；不方便时也可按下面的步骤手动导入会话 Cookie。", "“Sign in & import” works here: the temporary browser it opens does not announce itself as automated — if a Cloudflare challenge appears, simply complete it in that window. The manual steps below remain an alternative.")),
							h("p", null, text("1) 在你自己日常的 Chrome 里登录 open-design.ai，进入「方案与余额」页；2) F12 打开 DevTools → Network，筛 Fetch/XHR；3) 按 F5 刷新，点开状态 200 的 coding-plan-usage 请求；4) 在 Headers → Request Headers 里找到 cookie: 这一行，复制整行（应包含 __Secure-better-auth.session_token）；5) 粘到下面的「会话 Cookie」输入框并保存。", "1) Sign in at open-design.ai in your everyday Chrome and open the plan & balance page; 2) open DevTools → Network and filter Fetch/XHR; 3) press F5, then open the coding-plan-usage request that returned 200; 4) under Headers → Request Headers find the cookie: line and copy the whole value (it should contain __Secure-better-auth.session_token); 5) paste it into the session cookie field below and save.")),
							h("p", { style: { fontSize: 12, opacity: .75 } }, text("读取 Design Plan 的 5 小时 / 7 天额度，以及个人钱包合计与订阅额度剩余。钱包为零不代表 Design Plan 不可用；不按模型扣除倍率推算钱包上限，不发起任何模型请求。", "Reads Design Plan 5-hour / 7-day quota plus personal wallet and subscription credits remaining. A zero wallet does not exhaust Design Plan. Model multipliers are not wallet limits; no model requests are made."))) :
						tab === "zai-coding" ? h("p", null, text("使用 Z.ai 国际站 Coding Plan Key；与中国站凭据独立。", "Use an international Z.ai Coding Plan key; credentials are separate from the China region.")) : null,
						tab === "deepseek" ? h("p", null, text("此入口只读取独立 API Key 的官方余额，不使用 DSH 账号或 OAuth。可继承 DEEPSEEK_API_KEY，或手动填写官方开放平台 API Key；余额查询不要求配置模型路由。", "This entry reads only the independent API-key balance, never the DSH account or OAuth. Inherit DEEPSEEK_API_KEY or enter an official platform API key; no model route is required.")) : null,
						tab === "synthetic" ? h("p", null, text("使用 Synthetic API Key，仅显示模型订阅请求额度。", "Use a Synthetic API key. Shows the model subscription request quota.")) : null,
						tab === "nanogpt" ? h("p", null, text("可用 NanoGPT API Key，推荐手动填写 Usage only 管理令牌（sk-nano-mgmt-…）。显示日/周输入 Token 与试用额度，图像额度单独计算，不纳入此处。", "Use a NanoGPT API key or, preferably, a manual Usage only management token (sk-nano-mgmt-…). Shows daily/weekly input tokens and trial quotas; image quotas are separate."), " ", h("a", { href: "https://nano-gpt.com/settings", target: "_blank", rel: "noopener noreferrer" }, text("打开官方设置", "Open official settings"))) : null,
						h("p", null, `${result.configured && result.configured[tab] ? t("detected") : t("notDetected")} · ${sources[source] || sources.none}`),
						tab === "deepseek-account" ? h("p", null, text("只读 DSH「账号与余额」中已登录账号的充值余额。默认开启；不读取、导出或保存 OAuth token，不使用独立 API Key。请在 DSH 的账号与余额页面登录。", "Reads the signed-in account's recharge balance from DSH Account & balance. Enabled by default; never reads, exports or stores OAuth tokens, and never uses an independent API key. Sign in on DSH Account & balance.")) : tab === "commandcode" ? h(react.Fragment, null, h("p", null, t("commandcodeManaged"))) : tab === "xai-oauth" ? h(react.Fragment, null, h("p", null, t("grokManaged"))) : tab === "github-copilot" ? h("p", null, text("只读 GitHub Copilot 提供方（dsh-copilot-auth）经 DSH 凭据服务保存的 OAuth 登录，无需另行登录或填写 Key。本页不保存凭据、不续期 token；登录与续约由 Copilot 提供方负责。额度来自 GitHub 的私有接口，字段可能变化，数字仅供参考。", "Reads the OAuth sign-in that the GitHub Copilot provider (dsh-copilot-auth) keeps in the DSH credential service; no separate sign-in or key is needed. This page never saves or renews tokens; sign-in and renewal belong to the Copilot provider. Quota comes from a private GitHub endpoint whose fields may change, so treat numbers as indicative.")) : tab === "openai-codex" ? h(react.Fragment, null,
							h("p", null, text("优先只读 Codex Subscription 的独立 OAuth 活动账号，无需 CLI；没有该来源再读 Codex CLI 的 ChatGPT 订阅登录（$CODEX_HOME/auth.json 或 ~/.codex/auth.json）。本页不保存凭据、不刷新 token；续约由凭据所属插件负责。请在 Subscription 设置页登录，或用 codex login；API Key 模式（auth_mode 不是 chatgpt）取不到订阅额度。", "Reads the Codex Subscription active OAuth account first (no CLI required), then the Codex CLI ChatGPT login ($CODEX_HOME/auth.json or ~/.codex/auth.json). This page never saves or refreshes tokens; renewal belongs to the owning plugin. Sign in in Subscription settings or with codex login; API-key mode (auth_mode not chatgpt) cannot read subscription quota."))) : PROVIDER_META[tab].volc ? h(react.Fragment, null,
							h("p", null, text("额度查询要用火山引擎 IAM 的 Access Key（AK/SK 配对，权限建议只给方舟只读），与推理用的方舟 API Key 不是同一套；Ark 的这几条路由共用这一组凭据。", "Quota lookup needs a Volcengine IAM Access Key pair (Ark read-only is enough). This is NOT the Ark inference API key; every Ark route here shares this pair.")),
							// 用户通常已经登录着控制台，直接给入口比让他自己翻菜单快得多。
							h("p", { style: { fontSize: 12 } }, externalLink("https://console.volcengine.com/iam/keymanage", text("打开火山引擎「API 访问密钥」创建 AK/SK", "Open Volcengine “API access keys”")), " · ", credentialsGuide),
							h("div", { role: "group", "aria-label": text("Key 来源模式", "Key source mode"), style: { display: "flex", gap: 8, flexWrap: "wrap" } },
								["inherit", "manual"].map((mode) => h("button", { key: mode, type: "button", "aria-pressed": draft.keyMode === mode, style: draft.keyMode === mode ? primary : btnStyle, onClick: () => editDraft({ keyMode: mode }) }, `${draft.keyMode === mode ? "✓ " : ""}${mode === "inherit" ? text("继承凭据 / 环境变量", "Inherit credentials / environment") : text("手动 AK/SK", "Manual AK/SK")}`))),
							h("p", { style: { fontSize: 12 } }, text("继承变量：", "Inherited variables: "), h("code", null, "VOLC_ACCESSKEY"), " / ", h("code", null, "VOLC_SECRETKEY")),
							h("p", { style: { fontSize: 12 } }, result.settings && result.settings.volc && result.settings.volc.hasAccessKeyId && result.settings.volc.hasSecretAccessKey ? text("已保存 AK 与 SK（不回填）", "AK and SK saved (never filled back)") : result.settings && result.settings.volc && (result.settings.volc.hasAccessKeyId || result.settings.volc.hasSecretAccessKey) ? text("只保存了一半：AK 与 SK 必须成对配置", "Only half saved: AK and SK must be configured together") : text("未保存 AK/SK", "No AK/SK saved")),
							(result.settings?.volc?.hasAccessKeyId || result.settings?.volc?.hasSecretAccessKey) && !draft.volc.clear ? h("button", { type: "button", style: btnStyle, disabled: busy, onClick: () => { editDraft({ volc: { accessKey: "", secret: "", clear: true } }); setNotice({ ok: false, text: text("待清除：保存后将删除已保存的 AK/SK；取消编辑可保留。", "Pending removal: saving deletes the saved AK/SK. Cancel edits to keep it.") }); } }, text("清除 AK/SK", "Clear AK/SK")) : null,
							draft.volc.clear ? h("span", { role: "status" }, text("将删除 AK/SK（尚未保存）", "AK/SK will be deleted (not saved yet)")) : null,
							h("label", null, "AccessKey ID", h("input", { autoComplete: "off", spellCheck: false, value: draft.volc.accessKey, disabled: busy, onChange: (e) => editDraft({ volc: { ...draft.volc, accessKey: e.target.value } }), style: inputStyle })),
							h("label", null, "SecretAccessKey", h("input", { type: "password", autoComplete: "new-password", value: draft.volc.secret, disabled: busy, onChange: (e) => editDraft({ volc: { ...draft.volc, secret: e.target.value } }), style: inputStyle })),
							h("p", { style: { fontSize: 12, opacity: .75 } }, text("留空表示不修改该项；AK 与 SK 必须来自同一个 IAM 用户，跨来源拼凑会被服务端判为签名无效。", "Leave a field empty to keep it. AK and SK must come from the same IAM user; mixed sources fail signature verification."))) : tab === "xiaomi-token-plan-cn" ? h(react.Fragment, null,
							h("button", { type: "button", style: primary, disabled: loginActive, onClick: startLogin }, text("登录并自动导入", "Sign in & import automatically")),
							loginActive ? h("div", { role: "status", "aria-live": "polite", style: { marginTop: 8 } },
								h("progress", { "aria-label": text("登录进度", "Login progress"), style: { width: 100, marginRight: 8 } }),
								({ launching: text("正在启动登录浏览器…", "Launching login browser…"), waiting: text("请在浏览器中完成登录…", "Complete sign-in in the browser…"), verifying: text("正在验证并导入…", "Verifying & importing…") })[login.state],
								h("button", { type: "button", style: btnStyle, disabled: !login.jobId, onClick: cancelLogin }, text("取消登录", "Cancel login"))) : null,
							loginShown && (login.state === "error" || login.state === "cancelled") ? h("p", { role: "status" }, login.state === "cancelled" ? text("登录已取消，可重新登录或手动导入。", "Login cancelled. Retry or import manually.") : text("自动登录失败，可重试或手动导入。", "Automatic login failed. Retry or import manually.") + (login.message ? " " + login.message : "")) : null,
							h("p", { style: { fontSize: 12 } }, externalLink("https://platform.xiaomimimo.com/console/plan-manage", text("仅打开 MiMo 控制台套餐页（不会自动导入）", "Open the MiMo console only (no automatic import)")), " · ", credentialsGuide),
							h("p", null, result.settings && result.settings.xiaomi && result.settings.xiaomi.hasCookie ? text("已保存 Cookie（不回填）", "Cookie saved (never filled back)") : t("statusNoCookie")),
							cookieLifetimeLine(result.settings && result.settings.xiaomi, t, getLocale),
							h("p", { style: { fontSize: 12, opacity: .75 } }, t("mimoCookieTtl")),
							credentialButtons("cookie", result.settings && result.settings.xiaomi && result.settings.xiaomi.hasCookie),
							draft.cookieAction === "replace" ? h(react.Fragment, null,
								h("label", null, t("mimoCookie"), h("textarea", { rows: 3, autoComplete: "off", spellCheck: false, value: draft.cookie, disabled: busy || loginActive, onChange: (e) => editDraft({ cookie: e.target.value }), style: { ...inputStyle, resize: "vertical" } })),
								h("button", { type: "button", style: btnStyle, disabled: busy, onClick: () => { try { const normalized = validateCookieText(draft.cookie); editDraft({ cookie: normalized }); setNotice({ ok: true, text: text("Cookie 格式验证通过，尚未保存。", "Cookie format validated; not saved yet.") }); } catch (error) { setNotice({ ok: false, text: String(error.message || error) }); } } }, text("验证并规范化导入", "Validate & normalize import")),
								h("p", { style: { fontSize: 12, opacity: .75 } }, t("mimoCookieHint"))) : null)
						: h(react.Fragment, null,
							tab === "opendesign" ? h(react.Fragment, null,
								h("button", { type: "button", style: primary, disabled: loginActive, onClick: startLogin }, text("登录并自动导入", "Sign in & import automatically")),
								loginActive ? h("div", { role: "status", "aria-live": "polite", style: { marginTop: 8 } },
									h("progress", { "aria-label": text("登录进度", "Login progress"), style: { width: 100, marginRight: 8 } }),
									({ launching: text("正在启动登录浏览器…", "Launching login browser…"), waiting: text("请在浏览器中完成登录…", "Complete sign-in in the browser…"), verifying: text("正在验证并导入…", "Verifying & importing…") })[login.state],
									h("button", { type: "button", style: btnStyle, disabled: !login.jobId, onClick: cancelLogin }, text("取消登录", "Cancel login"))) : null,
								loginShown && (login.state === "error" || login.state === "cancelled") ? h("p", { role: "status" }, login.state === "cancelled" ? text("登录已取消，可重新登录或手动粘贴 Cookie。", "Login cancelled. Retry or paste the cookie manually.") : text("自动登录失败，可重试或手动粘贴 Cookie。", "Automatic login failed. Retry or paste the cookie manually.") + (login.message ? " " + login.message : "")) : null,
								h("p", { style: { fontSize: 12 } }, externalLink("https://open-design.ai/cloud/dashboard", text("仅打开 OpenDesign 控制台（不会自动导入）", "Open the OpenDesign console only (no automatic import)")), " · ", credentialsGuide)) : null,
							h("div", { role: "group", "aria-label": text("Key 来源模式", "Key source mode"), style: { display: "flex", gap: 8, flexWrap: "wrap" } },
								["inherit", "manual"].map((mode) => h("button", { key: mode, type: "button", "aria-pressed": draft.keyMode === mode, style: draft.keyMode === mode ? primary : btnStyle, onClick: () => editDraft({ keyMode: mode }) }, `${draft.keyMode === mode ? "✓ " : ""}${mode === "inherit" ? text("继承凭据 / 环境变量", "Inherit credentials / environment") : text("手动 Key", "Manual key")}`))),
							h("p", { style: { fontSize: 12 } }, result.settings && result.settings.hasKeys && result.settings.hasKeys[tab] ? (tab === "opendesign" ? text("已保存会话 Cookie（不回填）", "Session cookie saved (never filled back)") : text("已保存 Key（不回填）", "Key saved (never filled back)")) : (tab === "opendesign" ? text("未保存会话 Cookie", "No session cookie saved") : text("未保存手动 Key", "No manual key saved"))),
							h("p", { style: { fontSize: 12 } }, credentialsGuide, " ", text("（含各家 API Key 的获取入口与环境变量名）", "(provider API-key sources and env var names)")),
							credentialButtons("key", result.settings && result.settings.hasKeys && result.settings.hasKeys[tab]),
							draft.keyAction === "replace" ? h("label", null, tab === "opendesign" ? text("会话 Cookie", "Session cookie") : t("keyLabel"), h("input", { type: "password", autoComplete: "new-password", value: draft.key, disabled: busy, onChange: (e) => editDraft({ key: e.target.value }), style: inputStyle })) : null),
						tab === "litellm" ? h(react.Fragment, null,
							h("label", null, text("代理地址", "Proxy base URL"), h("input", { autoComplete: "off", spellCheck: false, value: draft.litellm.baseUrl, disabled: busy, placeholder: "https://litellm.example.com", onChange: (e) => editDraft({ litellm: { ...draft.litellm, baseUrl: e.target.value } }), style: inputStyle })),
							h("p", { style: { fontSize: 12, opacity: .75 } }, text("管理端点在 proxy 根：末尾的 /v1 会被自动去掉。虚拟 Key 与推理用的是同一把。", "Admin endpoints live at the proxy root: a trailing /v1 is stripped. The virtual key is the same one you use for inference.")),
							h("p", { style: { fontSize: 12 } }, credentialsGuide)) : null,
						tab === "zai-coding-cn" ? h(react.Fragment, null,
							h("div", { role: "radiogroup", "aria-label": t("zaiType"), style: { display: "flex", gap: 8, flexWrap: "wrap" } }, [1, 2].map(type => h("button", { key: type, type: "button", role: "radio", "aria-checked": draft.zai.type === type, style: draft.zai.type === type ? primary : btnStyle, disabled: busy, onClick: () => editDraft({ zai: { ...draft.zai, type } }) }, t(type === 1 ? "zaiTypePersonal" : "zaiTypeTeam")))),
							draft.zai.type === 2 ? ["organization", "project"].map((name) => h("label", { key: name }, t(name === "organization" ? "zaiOrg" : "zaiProject"), h("input", { value: draft.zai[name] || "", disabled: busy, style: inputStyle, onChange: (e) => editDraft({ zai: { ...draft.zai, [name]: e.target.value } }) }))) : null,
							draft.zai.type === 2 ? h("p", { style: { fontSize: 12 } }, credentialsGuide, " ", text("（团队档的组织 / 项目 ID 在哪拿）", "(where to find team org / project IDs)")) : null) : null,
						dirty ? h("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, h("button", { type: "button", disabled: busy || (loginApi && loginActive), style: primary, onClick: onSave }, t(busy ? "saving" : "save")), h("button", { type: "button", disabled: busy, style: btnStyle, onClick: cancel }, text("取消编辑", "Cancel edits"))) : null)),
					h("details", { style: { marginTop: 12 } }, h("summary", { style: { cursor: "pointer" } }, text("技术信息与帮助", "Technical information & help")),
						h("code", null, tab), tab !== "xiaomi-token-plan-cn" && meta.envName ? h("p", null, text("继承变量：", "Inherited variable: "), h("code", null, [meta.envName, ...(meta.envAliases ?? [])].join(" / ")), meta.envAliases?.length ? text("（取第一个有值的）", " (the first one that is set wins)") : null) : null, h("p", null, t("hint")), ["minimax", "minimax-cn"].includes(tab) ? h("p", null, text("需要对应区域的 Token Plan / Coding Plan 订阅 Key，不是按量计费 Key。读取通用/编程池的剩余百分比；零总计、无上限或未报告的窗口不会显示为零用量，周加量不折算为额外百分比。", "Use a Token Plan / Coding Plan subscription key for the selected region, not a pay-as-you-go key. Shows the general/coding pool; zero-total, unlimited or absent windows are not displayed as zero usage. Weekly boosts are not converted into extra percentage.")) : null, tab === "zai-coding-cn" ? h("p", null, t("zaiOrgHint")) : null, tab === "commandcode" ? h("p", null, t("commandcodeHelp")) : null, tab === "xai-oauth" ? h("p", null, t("grokHelp")) : null,
						entry && entry.lastAttemptAt ? h("p", null, `${t("lastUpdated")} ${new Date(entry.lastAttemptAt).toLocaleString(getLocale())}`) : null)
			);
			const arkRepresentative = ARK_IDS.find(id => providerEnabled(result.settings, id) && providerRoutable(result, id)) ?? ARK_IDS.find(id => providerEnabled(result.settings, id)) ?? ARK_IDS.find(id => providerRoutable(result, id)) ?? ARK_IDS[0];
			const managementEnabled = (id) => PROVIDER_META[id]?.volc ? ARK_IDS.some(key => providerEnabled(result.settings, key)) : providerEnabled(result.settings, id);
			const providerManagement = h("details", { id: "subusage-provider-management", open: !visibleIds.length || undefined, "aria-label": text("提供商管理", "Provider management"), style: { border: "1px solid rgba(128,128,128,.3)", borderRadius: 10, padding: 12, marginTop: 16 } },
					h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, text("提供商管理", "Provider management")),
					h("p", { style: { opacity: .75 } }, text("开关立即保存；点击「配置」展开对应提供商，不会切换上方用量。这里只控制订阅检测，不删除凭据或禁用模型路由。", "Switches save immediately. Use Configure to expand a provider without changing the usage above. Detection settings never delete credentials or disable model routes.")),
					h("div", { style: { border: 0, margin: 0, padding: 0, minWidth: 0 } },
						!editorOpen && notice ? h("p", { role: "status", style: { color: notice.ok ? "inherit" : "#dc2626" } }, notice.text) : null,
						h("button", { type: "button", role: "switch", "aria-checked": hideWithoutApi, disabled: busy || dirty || !result.settings?.revision, "aria-label": text("没配 Key 或登录的，默认不显示", "Hide providers with no key or login"), style: hideWithoutApi ? primary : btnStyle, onClick: () => saveVisibility({ hideWithoutApi: !hideWithoutApi }) }, `${hideWithoutApi ? "✓ " : "○ "}${text("没配 Key 或登录的，默认不显示", "Hide providers with no key or login")}`),
						h("p", { style: { fontSize: 12, opacity: .75 } }, text("没填 API Key、也没登录的提供商，上面的标签栏先藏起来；认证失败或网络错误不会当成没配置。藏起来的仍可以在下面打开。", "Providers with no API key or login are hidden from the tab bar. Auth or network errors are not treated as missing credentials. Hidden providers stay configurable below.")),
						// 稳定的单列列表：名称与状态不伪装成按钮；开关、配置各有独立点击区域。
						// 编辑器只在当前行下方展开，不再让网格卡片突然跨列或依赖嵌套 summary 的点击行为。
						h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, [...PROVIDER_ORDER].filter(id => !PROVIDER_META[id]?.volc || id === arkRepresentative).sort((a, b) => Number(!managementEnabled(a)) - Number(!managementEnabled(b))).map(id => {
							const isArk = Boolean(PROVIDER_META[id].volc), arkPresent = isArk ? ARK_IDS.filter(key => providerRoutable(result, key)) : [];
							const personalId = isArk ? (ARK_PERSONAL_IDS.find(key => providerRoutable(result, key)) ?? ARK_PERSONAL_IDS[0]) : id;
							const enabled = providerEnabled(result.settings, personalId), teamEnabled = isArk && providerEnabled(result.settings, ARK_TEAM_IDS[0]);
							const e = entries.find(item => item.providerId === personalId), editing = tab === id && editorOpen;
							const title = isArk ? text("火山方舟（Ark）", "Volcengine Ark") : PROVIDER_META[id].short;
							const editorLabel = text(id === "xiaomi-token-plan-cn" ? "登录与凭据" : PROVIDER_META[id].managedByPlugin ? "凭据来源" : "连接与凭据", id === "xiaomi-token-plan-cn" ? "Login & credentials" : PROVIDER_META[id].managedByPlugin ? "Credential source" : "Connection & credentials");
							const status = !enabled ? text(isArk ? "个人版检测已关闭" : "检测已关闭", isArk ? "Personal plan detection disabled" : "Detection disabled") : !providerCanQuery(result, personalId) ? text("本机未注册对应路由；仍可配置共享凭据", "No matching route registered; shared credentials can still be configured") : e?.apiDetected === false || ["no-key", "no-cookie"].includes(e?.state) ? text(hideWithoutApi ? "未检测到 API · 默认隐藏" : "未检测到 API", "No API credentials detected") : e?.apiDetected === true || (e?.keySource && e.keySource !== "none") ? text("已检测到 API / 凭据", "API credentials detected") : text("待检测", "Detection pending");
							return h("div", { key: id, style: { border: `1px solid ${editing ? "rgba(59,130,246,.55)" : "rgba(128,128,128,.25)"}`, borderRadius: 8, background: editing ? "rgba(59,130,246,.05)" : "transparent", overflow: "hidden" } },
								h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "8px 10px" } },
									h("div", { style: { flex: "1 1 180px", minWidth: 0 } },
										h("div", { style: { fontWeight: 600 } }, title),
										h("div", { style: { marginTop: 2, fontSize: 12, opacity: .72 } }, isArk ? text(`个人版：${status}`, `Personal plans: ${status}`) : status)),
									h("div", { style: { display: "flex", gap: 6, marginLeft: "auto", flex: "none" } },
										h("button", { type: "button", role: "switch", "aria-checked": enabled, disabled: busy || dirty || !result.settings?.revision, "aria-label": `${text("启用", "Enable")} ${title}`, style: { ...(enabled ? primary : btnStyle), whiteSpace: "nowrap" }, onClick: () => saveVisibility(isArk ? { ark: !enabled } : { providers: { [id]: !enabled } }) }, isArk ? (enabled ? text("个人版已开启", "Personal on") : text("个人版已关闭", "Personal off")) : (enabled ? text("已开启", "On") : text("已关闭", "Off"))),
										h("button", { type: "button", "aria-label": `${editorLabel} ${PROVIDER_META[id].short}`, "aria-expanded": editing, "aria-controls": `subusage-credentials-${id}`, disabled: busy, style: { ...(editing ? primary : btnStyle), whiteSpace: "nowrap" }, onClick: () => { if (editing) setEditorOpen(false); else openEditor(id); } }, editing ? text("收起", "Collapse") : text("配置", "Configure")))),
								isArk ? h("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 10px", borderTop: "1px solid rgba(128,128,128,.18)", background: "rgba(128,128,128,.035)" } },
									h("div", { style: { flex: "1 1 180px", minWidth: 0 } },
										h("div", { style: { fontSize: 12, fontWeight: 600 } }, text("Team 检测", "Team detection")),
										h("div", { style: { fontSize: 11, opacity: .68 } }, text("独立控制 Agent Plan Team / Coding Plan Team，默认关闭", "Independently controls Agent Plan Team / Coding Plan Team; off by default"))),
									h("button", { type: "button", role: "switch", "aria-checked": teamEnabled, disabled: busy || dirty || !result.settings?.revision, "aria-label": text("启用 火山方舟 Team 检测", "Enable Volcengine Ark Team detection"), style: { ...(teamEnabled ? primary : btnStyle), whiteSpace: "nowrap" }, onClick: () => saveVisibility({ arkTeam: !teamEnabled }) }, teamEnabled ? text("Team 已开启", "Team on") : text("Team 已关闭", "Team off"))) : null,
								isArk ? h("div", { style: { padding: "0 10px 7px", fontSize: 11, opacity: .65 } }, text(`本机已注册 ${arkPresent.length}/${ARK_IDS.length} 条路由；个人版与 Team 开关互不影响`, `${arkPresent.length}/${ARK_IDS.length} routes registered; personal and Team switches are independent`)) : null,
								h("section", { id: `subusage-credentials-${id}`, role: "region", "aria-label": `${editorLabel} ${title}`, hidden: !editing, style: { padding: "0 10px 10px", borderTop: "1px solid rgba(128,128,128,.18)" } }, tab === id ? credentialEditor : null));
						}))
					)
				);
			return h("div", { ref: root, style: { padding: 16, maxWidth: 720, minWidth: 0, font: "13px/1.6 sans-serif", containerType: "inline-size", containerName: "subusage" } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
					h("h2", { style: { margin: 0, fontSize: 16 } }, t("title")),
					initialized ? h("button", {
						type: "button",
						disabled: !troubledIds.length,
						onClick: () => { if (troubledIds.length) chooseUsage(troubledIds[0]); },
						title: troubledIds.length ? text(`跳到 ${PROVIDER_META[troubledIds[0]].short}（共 ${troubledIds.length} 家待处理）`, `Jump to ${PROVIDER_META[troubledIds[0]].short} (${troubledIds.length} need attention)`) : text("全部获取成功", "All fetched"),
						"aria-label": text(`${success}/${visibleIds.length} 家数据获取成功；${troubledIds.length ? `点击跳到 ${PROVIDER_META[troubledIds[0]].short}` : "没有待处理项"}`, `${success}/${visibleIds.length} providers fetched; ${troubledIds.length ? `click to jump to ${PROVIDER_META[troubledIds[0]].short}` : "nothing needs attention"}`),
						style: { ...btnStyle, padding: "2px 8px", fontSize: 12, opacity: .85, cursor: troubledIds.length ? "pointer" : "default", color: troubledIds.length ? "#b7791f" : "inherit", textDecoration: troubledIds.length ? "underline" : "none" }
					}, text(`${success}/${visibleIds.length} 家数据获取成功${troubledIds.length ? " · 查看问题" : ""}`, `${success}/${visibleIds.length} providers fetched${troubledIds.length ? " · view issues" : ""}`)) : null,
					h("button", { type: "button", disabled: busy || refreshing || !usageId, style: { ...primary, cursor: busy || refreshing || !usageId ? "default" : "pointer" }, onClick: () => refresh(false) }, refreshing === "current" ? text("正在刷新当前…", "Refreshing current…") : text("刷新当前", "Refresh current")),
					h("button", { type: "button", disabled: busy || refreshing, style: { ...btnStyle, cursor: busy || refreshing ? "default" : "pointer" }, onClick: () => refresh(true) }, refreshing === "all" ? text("正在刷新全部…", "Refreshing all…") : text("刷新全部", "Refresh all"))
				),
				loadError ? h("p", { role: "alert", style: { color: "#dc2626", overflowWrap: "anywhere" } }, loadError) : null,
				initialized && !visibleIds.length ? h("p", { role: "status" }, text("没有可显示的提供商，请展开下方「提供商管理」开启、配置 API，或关闭默认隐藏。", "No visible providers. Expand Provider management below to enable a provider, configure API credentials, or turn off auto-hide.")) : null,
				initialized ? h("div", { className: "subusage-provider-tabs", role: "tablist", "aria-label": text("模型商", "Providers"), style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 14 } },
					visibleIds.map((id, index) => {
						const e = entries.find((item) => item.providerId === id), active = usageId === id;
						// 标签圆标与面板/药丸读同一个 computeStatus：缺凭据是蓝 ⚙ 而不是红 !，
						// 无窗口成功是中性 ℹ 而不是绿 ?（没有额度窗口不能默认标绿）。
						const tabStatus = computeStatus(e, { failed: e && e.state !== "ok" ? e.error || e.state : null, failState: e && e.state, providerId: id, t, getLocale });
						return h("button", { key: id, id: `subusage-tab-${id}`, role: "tab", type: "button", tabIndex: active || (!visibleIds.includes(usageId) && index === 0) ? 0 : -1, "aria-selected": active,
							"aria-controls": "subusage-provider-panel", title: `${providerDisplayName(id, "label", getLocale)}: ${providerDescription(e, t)}`, "aria-label": `${providerDisplayName(id, "short", getLocale)}: ${providerDescription(e, t)}`,
							onClick: () => chooseUsage(id), onKeyDown: (event) => {
								let next;
								if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % visibleIds.length;
								else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + visibleIds.length - 1) % visibleIds.length;
								else if (event.key === "Home") next = 0; else if (event.key === "End") next = visibleIds.length - 1; else return;
								event.preventDefault(); chooseUsage(visibleIds[next]);
								const button = event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]; if (button) button.focus();
							}, style: { ...btnStyle, display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, padding: "5px 12px 5px 8px", whiteSpace: "nowrap", fontSize: 12, fontWeight: active ? 600 : 400, borderRadius: 999, border: "1px solid transparent", background: active ? alpha(INFO, ".16") : "transparent" }
						}, statusGlyph(tabStatus.color, tabStatus.icon, 14), PROVIDER_META[id].short);
					})) : null,
				!!usageId ? h("section", { role: "tabpanel", id: "subusage-provider-panel", "aria-label": usageTitle, style: { marginTop: 12, border: "1px solid rgba(128,128,128,.25)", borderRadius: 14, padding: 16 } },
					h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
						h("strong", { style: { fontSize: 14 } }, usageTitle),
						h("span", { style: { flex: 1 } }),
						planName(usageEntry) ? h("span", { style: { fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999, background: "rgba(128,128,128,.16)", whiteSpace: "nowrap" } }, planName(usageEntry)) : null),
					// 一眼结论：与药丸、弹层同一个状态判定。读取成功只说明接口健康，额度档位另有结论。
					statusBanner(usageStatus),
					usageEntry && usageEntry.error && usageStatus.key !== "error" ? h("p", { role: "alert", title: usageEntry.error, style: { color: "#dc2626", overflowWrap: "anywhere" } }, localError(usageEntry.errorCode, usageEntry.error, t)) : null,
					usageAction ? h("div", { role: "group", "aria-label": text("建议操作", "Suggested action"), style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "10px 0", padding: "8px 10px", border: "1px solid rgba(234,179,8,.45)", borderRadius: 8, background: "rgba(234,179,8,.08)" } },
						h("span", { style: { flex: 1, minWidth: 150, fontSize: 12 } }, usageAction === "mimo-relogin" ? text("Cookie 已过期，重新登录即可恢复。", "Cookie expired — sign in again to restore.") : usageAction === "mimo-renew" ? text("Cookie 即将到期，现在续期可避免中断。", "Cookie expires soon — renew now to avoid interruption.") : usageAction === "mimo-login" ? text("需要登录 MiMo。", "MiMo sign-in needed.") : text("这家还没有可用的凭据。", "No usable credentials for this provider.")),
						usageAction !== "credentials" ? h("button", { type: "button", style: primary, disabled: busy || loginActive, onClick: startLogin }, usageAction === "mimo-login" ? text("登录并自动导入", "Sign in & import") : text("重新登录", "Sign in again")) : null,
						h("button", { type: "button", style: usageAction === "credentials" ? primary : btnStyle, disabled: busy, onClick: () => revealEditor(usageId) }, usageAction === "credentials" ? text("配置凭据", "Configure credentials") : text("手动填写", "Enter manually"))) : null,
					// 自动轮换池健康度（与弹层同一函数）：池耗尽时上方横幅已按池中限额窗口染红。
					usagePool ? CommandCodePoolSummary({ pool: usagePool, cc, t }) : null,
					usagePool?.mode === "auto" && canShowUsage(usageStatusEntry) && (usageStatusEntry.windows || []).length ? h("p", { style: { margin: "8px 0 0", fontSize: 11, fontWeight: 600, opacity: 0.8 } }, t("ccWindowsDefault")) : null,
					// 无窗口时的占位只给「成功但既无窗口也无余额」：余额/加载/需配置/失败等状态横幅已经说明，不再叠加「暂无额度数据」。
					// 窗口列表用 usageStatusEntry：池耗尽时它携带合成的限额窗口（非耗尽时与 usageEntry 同一对象）。
					canShowUsage(usageStatusEntry) && (usageStatusEntry.windows || []).length ? UsageWindowList({ windows: usageStatusEntry.windows, t, getLocale, uncertain: usageStatusEntry.coverage === "partial" || usageStatusEntry.freshness === "stale" || usageStatusEntry.state !== "ok" || !!(cookieExpiry(usageEntry, t)?.expired) })
						: usageStatus.key === "balance" && !(usageStatus.entry && balanceText(usageStatus.entry, t)) ? h("p", { style: { opacity: .75 } }, t("noUsageData")) : null,
					canShowUsage(usageEntry) && usageEntry.extras && usageEntry.extras.some((x) => x.kind !== "plan")
						? h("div", { style: { marginTop: 10, padding: "6px 12px", borderRadius: 10, background: "rgba(128,128,128,.07)" } },
							usageEntry.extras.filter((x) => x.kind !== "plan").map((x) => h("div", { key: x.kind, style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" } },
								h("span", { style: { opacity: 0.7 } }, extraLabel(x, t, usageId)),
								h("strong", { style: { fontWeight: 600, textAlign: "right" } }, x.kind === "balance" ? formatBalanceValue(x.value) : x.value))))
						: null,
					// 账户区与药丸弹层同一个组件、同一个控制器：设置页里也能切换 activeAccount，
					// 不必再跳去 Command Code 提供方插件的设置页。提供方插件未运行时整区降级。
					usageId === "commandcode" ? h(CommandCodeAccountSwitch, { cc, ccState, t }) : null,
					usageEntry?.lastAttemptAt ? h("p", { style: { opacity: .65 } }, `${t("lastUpdated")} ${new Date(usageEntry.lastAttemptAt).toLocaleString(getLocale())}`) : null
				) : null,
				providerManagement
			);
		}

		// ── 装配：只在 apply scope 创建共享 store 与生命周期 disposer ───────────
		const name = "dsh-subusage";
		const inject = ["slots", "locale", "remote"];
		function apply(ctx) {
			try { ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-subusage: copy dictionaries"); } catch (error) { console.error("[dsh-subusage] locale 注册失败:", error); }
			const t = ctx.locale.bind(NS);
			const getLocale = () => ctx.locale.getLocale().active;
			let mounted = Promise.resolve(), disposed = false;
			const pendingTimers = new Map();
			try { mounted = ctx.remote.$mount(subUsageRemote); ctx.effect(async () => await mounted, "dsh-subusage: mount remotes"); }
			catch (error) { mounted = Promise.reject(error); mounted.catch(() => {}); }
			const wait = (ms) => new Promise((resolve, reject) => { const timer = setTimeout(() => { pendingTimers.delete(timer); resolve(); }, ms); pendingTimers.set(timer, reject); });
			const call = async (method, ...args) => {
				const deadline = Date.now() + 20000;
				let mountTimer;
				const mountTimeout = new Promise((_, reject) => { mountTimer = setTimeout(() => { pendingTimers.delete(mountTimer); reject(new Error("remote 挂载超时（20 秒）")); }, 20000); pendingTimers.set(mountTimer, reject); });
				try { await Promise.race([mounted, mountTimeout]); } finally { clearTimeout(mountTimer); pendingTimers.delete(mountTimer); }
				for (;;) {
					if (disposed) throw new Error("Client 已卸载");
					const service = ctx.get("remote.subUsage");
					if (service !== undefined) {
						if (typeof service[method] !== "function") throw new Error(getLocale().startsWith("zh") ? `Host/Client 契约版本不匹配：Host 缺少 ${method}；请同时更新两端并重新加载或重启。` : `Host/Client contract version mismatch: Host has no ${method}; update both sides and reload or restart.`);
						let timer;
						const timeout = new Promise((_, reject) => { timer = setTimeout(() => { pendingTimers.delete(timer); reject(new Error(`remote ${method} 调用超时（20 秒）`)); }, Math.max(1, deadline - Date.now())); pendingTimers.set(timer, reject); });
						try {
							const rpc = Promise.resolve(service[method](...args)).then((result) => { if (!result.ok) throw result.error; return result.value; });
							return await Promise.race([rpc, timeout]);
						} finally { clearTimeout(timer); pendingTimers.delete(timer); }
					}
					if (Date.now() > deadline) throw new Error("remote.subUsage 挂载超时（20 秒）：Host 端 subUsage 服务未就绪");
					await wait(250);
				}
			};
			const usageStore = createUsageStore(call);
			ctx.effect(() => () => { disposed = true; usageStore.dispose(); for (const [timer, reject] of pendingTimers) { clearTimeout(timer); reject(new Error("Client 已卸载")); } pendingTimers.clear(); }, "dsh-subusage: dispose shared store and RPC timers");
			const readEntry = (id) => usageStore.reader(id);
			// Command Code 账户切换：settings namespace 由核心 remote 提供；提供方插件
			// 未运行时 describe 拿不到 llm-commandcode 行，账户区降级为不可用，不影响其他功能。
			let ccSettingsNamespace;
			const cc = createCommandCodeAccounts({
				describe: async () => ccSettingsNamespace ? await ccSettingsNamespace.describe() : { ok: false, error: { message: "settings remote namespace is not mounted" } },
				mutate: async (ops, revision) => ccSettingsNamespace ? await ccSettingsNamespace.mutate(COMMANDCODE_SETTINGS_NS, ops, revision) : { ok: false, error: { message: "settings remote namespace is not mounted" } }
			});
			ctx.inject(["remote.settings"], (settingsCtx) => { ccSettingsNamespace = settingsCtx.remote.settings; });
			ctx.effect(() => () => cc.dispose(), "dsh-subusage: commandcode account switch");
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "subusage", order: 22, label: () => t("nav"), inject: () => ({ usageStore, t, getLocale, cc }) }, SubusageSection));
			} catch (error) { console.error("[dsh-subusage] 设置页注册失败:", error); }
			ctx.inject(["modelDirectories"], (scope) => {
				try {
					scope.slots.inject("conversation.input.right", () => scope.slots.register({ name: "conversation.input.right", id: "subusage-usage", order: 1001,
						inject: (sessionId) => ({ store: scope.modelDirectories.directoryFor(sessionId).store, readEntry, t, getLocale, cc, setCommandCodeAccount: usageStore.setCommandCodeAccount }) }, SubusagePillEntry));
				} catch (error) { console.error("[dsh-subusage] 药丸注册失败:", error); }
			});
		}

		/** 槽包装：先看当前模型的 provider，再分发到对应药丸。 */
		function SubusagePillEntry({ store, readEntry, t, getLocale, cc, setCommandCodeAccount }) {
			const state = react.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const lastProvider = react.useRef(null);
			const currentProvider = state.current?.provider;
			// 宿主模型目录在重连/重建期间会以 loading/error + current:null 发布快照。
			// 只在这类暂态保留已知选择；ready 的空选择或显式换厂商不能沿用。
			if (currentProvider || !["loading", "error"].includes(state.status)) lastProvider.current = currentProvider ?? null;
			const provider = currentProvider ?? (["loading", "error"].includes(state.status) ? lastProvider.current : null);
			// 旧插件 @volcengine/ark-plan-api 的两个国内路由 id 不在本表里，但它们是**同一个 plan**：
			// 不管模型路由由哪个插件提供，都归并到 arkcli 路由再查——所以只会有**一个**面板，
			// 数据来自同一份订阅（实测两条路由的请求 URL 逐字相同）。
			const resolved = ROUTE_PROVIDER_ALIAS[provider] ?? provider;
			const info = PROVIDER_ORDER.includes(resolved) ? PROVIDER_META[resolved] : null;
			const meta = info ? { label: resolved === "commandcode" ? providerDisplayName(resolved, "label", getLocale) : providerDisplayName(resolved, "short", getLocale), id: resolved } : null;
			// 所有 Hook 必须先于条件返回：模型切换或重连时 provider 可能暂时为空。
			// 稳定引用：否则父组件每次渲染都新建函数，药丸 effect 会反复重启轮询。
			const providerId = meta ? meta.id : null;
			const reader = react.useMemo(() => providerId ? readEntry(providerId) : null, [readEntry, providerId]);
			if (!meta) return null;
			return h(UsagePill, {
				key: meta.id,
				providerId: meta.id,
				label: meta.label,
				readEntry: reader,
				t,
				getLocale,
				cc,
				setCommandCodeAccount
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
