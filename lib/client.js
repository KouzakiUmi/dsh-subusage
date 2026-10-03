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
			statusPartial: "数据不完整，额度未知",
			statusCache: "缓存数据",
			cacheAge: "缓存 · {n} 分钟前",
			cacheUnknown: "缓存时间未知",
			badgeUnknown: "未确认",
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
			retry: "立即重试",
			loading: "正在读取用量…",
			unavailable: "暂不可用",
			planLabel: "套餐",
			balanceLabel: "余额",
			monthlyBalanceLabel: "月额度剩余",
			planSnapshotLimit: "月总额来自套餐快照，不含已购/赠送余额；未知套餐不推算上限",
			w5h: "5 小时",
			w7d: "7 天",
			wweek: "每周",
			wmonth: "每月",
			wperiod: "本周期",
			wsub: "本周期",
			wrolling: "滚动",
			wall: "全部",
			detailUsed: "已用 {used} / 总计 {limit} {unit}",
			detailReset: "重置于 {time}",
			detailResetIn: "重置于 {time}（还有 {rest}）",
			detailResetDue: "已到重置时间，等待刷新",
			restDays: "{n} 天",
			restHours: "{n} 小时",
			restMins: "{n} 分钟",
			badgeOk: "可用",
			badgeHigh: "偏高",
			badgeTight: "紧张",
			badgeLimited: "不可用",
			badgeBlocked: "受连累",
			numUsed: "已用 {p}%",
			numLimited: "⚠ 已达限额",
			numBlocked: "⚠ 暂不可用",
			pillRemaining: "余 {p}%",
			pillLimited: "已达限额",
			pillBlocked: "受连累",
			needConfigShort: "需配置",
			pillNeedKey: "未配置 API Key —— 请打开 设置 → 订阅用量 填写，或导出同名环境变量后重启。",
			pillNeedCookie: "需登录 —— 请在 设置 → 订阅用量 访问官方平台并替换 Cookie。",
			noUsageData: "暂无额度数据",
			providerUnavailable: "用量暂不可用",
			pillNeedCommandcode: "需配置 —— 可在 设置 → Command Code 登录、运行 cmd login，或导出 COMMANDCODE_API_KEY 后重试。",
			accountLabel: "账户",
			commandcodeManaged: "凭据由 Command Code 提供方插件（设置 → Command Code）管理；本页只读、不保存凭据。用量由本插件直接拉取其计费接口，取用同一凭据来源（凭据服务 COMMANDCODE_API_KEY → 启动环境 → ~/.commandcode/auth.json）。",
			commandcodeHelp: "并行读取 /alpha/billing/credits 和 /alpha/billing/subscriptions（默认 API 地址 https://api.commandcode.ai）。月总额按已知套餐快照推算，未知套餐只显示月剩余；月池耗尽不代表已购/赠送池不可用。多账户轮换或固定 activeAccount 时这里显示默认账户（顶层 Key）的额度，可能与实际服务账户不同；插件里自定义 apiBase 不会被跟随。"
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
			statusPartial: "Partial data; quota unknown",
			statusCache: "Cached data",
			cacheAge: "Cached · {n} min ago",
			cacheUnknown: "Cache age unknown",
			badgeUnknown: "Unconfirmed",
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
			retry: "Retry now",
			loading: "Loading usage…",
			unavailable: "Unavailable",
			planLabel: "Plan",
			balanceLabel: "Balance",
			monthlyBalanceLabel: "Monthly credits remaining",
			planSnapshotLimit: "Monthly total uses a plan snapshot, excluding purchased/free credits; unknown plans have no estimated cap",
			w5h: "5 hours",
			w7d: "7 days",
			wweek: "Week",
			wmonth: "Month",
			wperiod: "Period",
			wsub: "Monthly",
			wrolling: "Rolling",
			wall: "All",
			detailUsed: "Used {used} / total {limit} {unit}",
			detailReset: "Resets {time}",
			detailResetIn: "Resets {time} (in {rest})",
			detailResetDue: "Reset due — waiting for refresh",
			restDays: "{n} d",
			restHours: "{n} h",
			restMins: "{n} min",
			badgeOk: "OK",
			badgeHigh: "High",
			badgeTight: "Tight",
			badgeLimited: "Unavailable",
			badgeBlocked: "Blocked",
			numUsed: "Used {p}%",
			numLimited: "⚠ Limit reached",
			numBlocked: "⚠ Unavailable",
			pillRemaining: "{p}% left",
			pillLimited: "Limit reached",
			pillBlocked: "Blocked",
			needConfigShort: "Setup",
			pillNeedKey: "No API key — open Settings → Subscription usage to fill one in, or export the same-named env variable and restart.",
			pillNeedCookie: "Login required — paste a cookie in Settings → Subscription usage.",
			noUsageData: "No quota data",
			providerUnavailable: "Usage unavailable",
			pillNeedCommandcode: "Setup required — sign in under Settings → Command Code, run cmd login, or export COMMANDCODE_API_KEY and retry.",
			accountLabel: "Account",
			commandcodeManaged: "Credentials are managed by the Command Code provider plugin (Settings → Command Code); this page is read-only and stores nothing. Usage is fetched directly by this plugin from its billing endpoint, using the same credential sources (credential service COMMANDCODE_API_KEY → launch environment → ~/.commandcode/auth.json).",
			commandcodeHelp: "Parallel requests to /alpha/billing/credits and /alpha/billing/subscriptions (default API base https://api.commandcode.ai). Monthly totals use a known-plan snapshot; unknown plans show remaining credits only. Monthly-pool depletion does not imply purchased/free credits are unusable. With account rotation or a pinned activeAccount this shows the default (top-level key) account's quota, which may differ from the serving account; a custom apiBase in the provider plugin is not followed."
		};
		const NS = "settings.subusage";
		const KIND_LABEL = { "5h": "w5h", "7d": "w7d", week: "wweek", month: "wmonth", period: "wperiod", sub: "wsub", rolling: "wrolling" };
		const KIND_SHORT = { "5h": "5h", "7d": "7d", week: "W", month: "M", period: "P", sub: "Sub", rolling: "R" };
		const PROVIDER_META = {
			"zai-coding-cn": { label: "Z.ai Coding (CN)", short: "Z.ai", envName: "ZAI_CODING_CN_API_KEY" },
			"kimi-coding": { label: "Kimi Coding", short: "Kimi", envName: "KIMI_CODING_API_KEY" },
			"xiaomi-token-plan-cn": { label: "Xiaomi Token Plan (CN)", short: "MiMo", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" },
			"opencode-go": { label: "OpenCode Go", short: "OpenCode Go", envName: "OPENCODE_API_KEY" },
			// 凭据与多账户由提供方插件管理；managedByPlugin 时不渲染本地凭据编辑。
			"commandcode": { label: "Command Code", short: "Command", envName: "COMMANDCODE_API_KEY", managedByPlugin: true }
		};
		const PROVIDER_ORDER = ["zai-coding-cn", "kimi-coding", "xiaomi-token-plan-cn", "opencode-go", "commandcode"];
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
		/** tag 圆点色：最差窗口档位色（绿/黄/橙/红）；拉取失败红。 */
		function tagColor(entry) {
			if (!entry || entry.state === "loading") return "#94a3b8";
			if (entry.state !== "ok") return "#ef4444";
			if ((entry.windows || []).some((w) => w.status === "rate-limited")) return "#ef4444";
			if (entry.coverage === "partial" || entry.freshness === "stale") return "#eab308";
			const rank = { "#22c55e": 0, "#eab308": 1, "#f97316": 2, "#ef4444": 3 };
			let worst = "#22c55e";
			for (const w of entry.windows || []) {
				const c = usageTier(w).color;
				if (rank[c] > rank[worst]) worst = c;
			}
			return worst;
		}
		/** 数字色：0–70 白（前景），其余随档位。 */
		function numColor(w) {
			return usageTier(w).rank === 1 ? "inherit" : usageTier(w).color;
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
		/** 药丸文案：永远答「还能用多少」（余），限额/连坐直说。多窗带窗口短名。 */
		function pillText(w, multi, t) {
			const short = multi ? `${KIND_SHORT[w.kind] ?? w.kind} ` : "";
			if (w.status === "rate-limited" && !w.cascade) return `${short}${t("pillLimited")}`;
			if (w.status === "rate-limited") return `${short}${t("pillBlocked")}`;
			return `${short}${t("pillRemaining").replace("{p}", String(Math.round(Math.max(0, 100 - w.percent) * 10) / 10))}`;
		}
		/** extras 标签：plan / account / balance 三类，未知类型回退为余额。 */
		function extraLabel(x, t) {
			return x.kind === "plan" ? t("planLabel") : x.kind === "account" ? t("accountLabel") : x.kind === "monthly-balance" ? t("monthlyBalanceLabel") : t("balanceLabel");
		}
		/** 重置行：带倒计时；到期未刷新显式说明。 */
		function resetLine(w, t, getLocale) {
			if (!w.resetsAt) return null;
			const at = new Date(w.resetsAt);
			const ms = at.getTime() - Date.now();
			if (!(ms > 0)) return t("detailResetDue");
			const mins = Math.round(ms / 60000);
			const rest = mins >= 1440 ? t("restDays").replace("{n}", String(Math.round(mins / 1440)))
				: mins >= 60 ? t("restHours").replace("{n}", String(Math.round(mins / 60)))
				: t("restMins").replace("{n}", String(Math.max(1, mins)));
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
			if (!value || !Array.isArray(value.providerIds) || !value.providerIds.length || value.providerIds.some((id) => !PROVIDER_ORDER.includes(id)) || typeof value.force !== "boolean") throw new Error("Invalid dsh-subusage query");
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
					parameters: [],
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
				...[["startMimoLogin", "dsh-subusage#MimoLoginStart", "expectedRevision"], ["getMimoLoginStatus"], ["cancelMimoLogin", "dsh-subusage#MimoLoginCancel", "jobId"]].map(([method, typeSymbol, field]) => ({
					id: `dsh-subusage#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" },
					parameters: field ? [{ name: "request", wire: "request", source: "json", codec: loginRequestCodec(typeSymbol, field) }] : [], result: loginCodec
				}))
			]
		};

		/** Cookie 解析失败抛错：调用者必须保留原输入，不允许静默清空。 */
		function normalizeCookieText(raw) {
			const text = String(raw || "").trim();
			if (!text) return "";
			if (/\r(?!\n)/.test(String(raw || "")) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(String(raw || ""))) throw new Error("Cookie 含非法控制字符");
			const pairs = [];
			const domainOK = (domain) => !domain || ["platform.xiaomimimo.com", "xiaomimimo.com"].includes(String(domain).toLowerCase().replace(/^\./, ""));
			const add = (name, value, domain) => {
				if (!domainOK(domain)) return;
				if (typeof name !== "string" || !/^[A-Za-z0-9_!#$%&'*+\-.^`|~]+$/.test(name)) throw new Error("Cookie 名称无效");
				if (value === undefined || value === null || typeof value === "object") throw new Error("Cookie 值无效");
				const v = String(value);
				if (!/^("[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*"|[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)$/.test(v)) throw new Error("Cookie 值含非法分隔符、空白、非 ASCII 字符或 CRLF");
				pairs.push([name, v]);
			};
			if (/^[\[{]/.test(text)) {
				let data;
				try { data = JSON.parse(text); } catch { throw new Error("Cookie JSON 解析失败，请检查格式（原输入已保留）"); }
				const list = Array.isArray(data) ? data : Array.isArray(data.cookies) ? data.cookies : Object.entries(data).map(([name, value]) => ({ name, value }));
				for (const item of list) { if (!item || typeof item !== "object") throw new Error("Cookie JSON 项无效"); add(item.name, item.value, item.domain); }
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
						if (cells.length < 2) throw new Error("Cookie TAB 表格缺少值");
						if (!columns && cells.length >= 7 && /^(TRUE|FALSE)$/i.test(cells[1])) { add(cells[5], cells[6], cells[0].replace(/^#HttpOnly_/i, "")); continue; }
						const domainIndex = columns ? columns.findIndex((v) => v === "domain" || v === "域") : 2;
						add(cells[0], cells[1], domainIndex >= 0 ? cells[domainIndex] : undefined);
					}
				} else if (lines.every((line) => line.includes("="))) {
					for (const line of lines) for (const part of line.split(";")) {
						if (!part.trim()) continue;
						const at = part.indexOf("=");
						if (at < 1) throw new Error("Cookie 必须为 name=value");
						add(part.slice(0, at).trim(), part.slice(at + 1).trim());
					}
				} else {
					if (lines[0] === "当前页面 Cookies") lines.shift();
					if (lines.length % 2) throw new Error("Cookie 多行清单名称和值必须成对（原输入已保留）");
					for (let i = 0; i < lines.length; i += 2) add(lines[i], lines[i + 1]);
				}
			}
			if (!pairs.length) throw new Error("未找到官方 MiMo 域的有效 Cookie（原输入已保留）");
			return [...new Map(pairs)].map(([name, value]) => `${name}=${value}`).join("; ");
		}
		function validateCookieText(raw) {
			const text = normalizeCookieText(raw);
			const names = new Map(text.split("; ").map((pair) => { const at = pair.indexOf("="); return [pair.slice(0, at), pair.slice(at + 1).replace(/^"|"$/g, "")]; }));
			if (!names.get("api-platform_serviceToken") || !names.get("userId")) throw new Error("Cookie 必须包含非空 api-platform_serviceToken 和 userId（原输入已保留）");
			return text;
		}
		function canShowUsage(entry) {
			if (!entry || entry.state === "no-key" || entry.state === "no-cookie" || /auth|credential|no-key|no-cookie/i.test(entry.errorCode || "")) return false;
			if (entry.freshness === "stale") return entry.retainPrevious === true;
			return entry.state === "ok";
		}
		function statusText(entry, t) {
			if (!entry || entry.state === "loading") return t("loading");
			if (entry.state === "no-key") return t("statusNoKey");
			if (entry.state === "no-cookie") return t("statusNoCookie");
			if (entry.state !== "ok") return t("statusError");
			if (entry.freshness === "stale") return t("statusCache");
			if (entry.coverage === "partial") return t("statusPartial");
			return t("statusOk");
		}
		function providerDescription(entry, t) {
			const windows = canShowUsage(entry) ? entry.windows || [] : [];
			const worst = worstWindow(windows);
			return `${statusText(entry, t)}${worst ? " · " + pillText(worst, windows.length > 1, t) : " · " + t("noUsageData")}`;
		}
		function providerIcon(entry) {
			if (!entry || entry.state === "loading") return "…";
			if ((entry.windows || []).some((w) => w.status === "rate-limited")) return "✕";
			if (entry.state !== "ok") return "!";
			if (entry.coverage === "partial" || entry.freshness === "stale") return "?";
			const worst = worstWindow(entry.windows || []);
			return worst ? usageTier(worst).icon : "?";
		}
		function cacheAge(entry, t) {
			if (!entry || entry.freshness !== "stale" || !canShowUsage(entry)) return null;
			const at = Date.parse(entry.lastSuccessAt);
			return Number.isFinite(at) ? t("cacheAge").replace("{n}", String(Math.max(0, Math.floor((Date.now() - at) / 60000)))) : t("cacheUnknown");
		}
		/** 每次 apply 一个 store；partial response 只合并请求项，所有槽共享 inflight 与活动计时。 */
		function createUsageStore(call) {
			let snapshot = { updatedAt: null, settings: null, configured: {}, entries: [] };
			let disposed = false, initial = null, timer = null, epoch = 0, sequence = 0, metadataSequence = 0;
			let loginGeneration = 0, loginJobId = null, loginPending = false;
			const mergedLoginJobs = new Set();
			const providerSequence = new Map();
			const markRequest = (ids) => { const version = ++sequence; for (const id of ids) providerSequence.set(id, version); return { version, ids }; };
			const listeners = new Set(), active = new Map(), inflight = new Map(), readers = new Map(), resetSeen = new Set();
			const emit = () => { if (!disposed) for (const fn of listeners) fn(); };
			const invalidate = (ids) => {
				snapshot = { ...snapshot, entries: snapshot.entries.map((e) => ids.includes(e.providerId) ? { providerId: e.providerId, state: "loading", coverage: "partial", freshness: "unknown", windows: [], extras: [] } : e) };
				for (const id of ids) inflight.delete(id);
			};
			const merge = (incoming, request = null) => {
				if (disposed) return snapshot;
				const value = { ...incoming };
				if (request && request.version < metadataSequence) { delete value.settings; delete value.configured; delete value.updatedAt; }
				if (value.settings) metadataSequence = request ? request.version : ++sequence;
				if (snapshot.settings && value.settings && snapshot.settings.revision !== value.settings.revision) { epoch++; invalidate(PROVIDER_ORDER); }
				const entries = new Map(snapshot.entries.map((e) => [e.providerId, e]));
				for (const e of value.entries || []) if (!request || providerSequence.get(e.providerId) === request.version) entries.set(e.providerId, e);
				snapshot = { ...snapshot, ...value, entries: [...entries.values()] };
				emit(); return snapshot;
			};
			const refresh = (ids, force = false) => {
				if (disposed) return Promise.reject(new Error("Client 已卸载"));
				const unique = [...new Set(ids)].filter((id) => PROVIDER_ORDER.includes(id));
				const missing = unique.filter((id) => !inflight.has(id));
				if (missing.length) {
					const startedEpoch = epoch, request = markRequest(missing);
					const task = Promise.resolve().then(() => call("refresh", { providerIds: missing, force: !!force })).then((value) => startedEpoch === epoch ? merge(value, request) : snapshot).catch((error) => {
						// 传输失败不能擅自 retainPrevious：只有 Host 明确标 stale 才保留。
						if (startedEpoch === epoch) merge({ entries: missing.map((providerId) => ({ providerId, state: "error", error: error instanceof Error ? error.message : String(error), freshness: "unknown", coverage: "partial", windows: [], extras: [] })) }, request);
						throw error;
					}).finally(() => { for (const id of missing) if (inflight.get(id) === task) inflight.delete(id); });
					for (const id of missing) inflight.set(id, task);
				}
				return Promise.all([...new Set(unique.map((id) => inflight.get(id)))]).then(() => snapshot);
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
			const acceptLogin = (value, generation, startedEpoch, expectedJobId = null) => {
				if (disposed || generation !== loginGeneration || (value.state === "success" && value.result && startedEpoch !== epoch) || (expectedJobId && value.jobId !== expectedJobId && !(value.state === "idle" && value.jobId === null))) return null;
				loginJobId = value.jobId;
				loginPending = ["launching", "waiting", "verifying"].includes(value.state);
				if (value.state === "success" && value.result && !mergedLoginJobs.has(value.jobId)) {
					mergedLoginJobs.add(value.jobId);
					// 自动导入已经落盘：阻断旧账号在途额度与元数据，公共结果不含 Cookie。
					epoch++; markRequest(PROVIDER_ORDER); invalidate(["xiaomi-token-plan-cn"]); merge(value.result);
				}
				return value;
			};
			return {
				subscribe, getSnapshot: () => snapshot, refresh, activate,
				startMimoLogin: async (request) => { const generation = ++loginGeneration, startedEpoch = epoch; loginJobId = null; return acceptLogin(await call("startMimoLogin", request), generation, startedEpoch); },
				getMimoLoginStatus: async () => { const generation = loginGeneration, startedEpoch = epoch, jobId = loginPending ? loginJobId : null; return acceptLogin(await call("getMimoLoginStatus"), generation, startedEpoch, jobId); },
				cancelMimoLogin: async (request) => { if (loginJobId && request.jobId !== loginJobId) return null; const generation = ++loginGeneration, startedEpoch = epoch; return acceptLogin(await call("cancelMimoLogin", request), generation, startedEpoch, request.jobId); },
				readAll: () => { if (!initial) { const startedEpoch = epoch, request = markRequest(PROVIDER_ORDER); initial = Promise.resolve().then(() => call("read")).then((value) => startedEpoch === epoch ? merge(value, request) : snapshot).catch((error) => { initial = null; throw error; }); } return initial.then(() => snapshot); },
				save: async (patch) => { const value = await call("save", patch); epoch++; invalidate([patch.providerId]); return merge(value); },
				reader: (id) => {
					if (!readers.has(id)) {
						const fn = async (force = false) => { await refresh([id], force); return snapshot.entries.find((e) => e.providerId === id) || { providerId: id, state: "loading", windows: [] }; };
						fn.subscribe = (cb) => subscribe(() => cb(snapshot.entries.find((e) => e.providerId === id)));
						fn.activate = () => activate(id);
						readers.set(id, fn);
					}
					return readers.get(id);
				},
				dispose: () => { disposed = true; if (timer) clearInterval(timer); timer = null; if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible); listeners.clear(); active.clear(); inflight.clear(); readers.clear(); resetSeen.clear(); }
			};
		}

		// ── 用量药丸（匹配当前选中模型的 provider）──────────────────────────────
		function severity(percent, status) {
			if (status === "rate-limited" || percent >= 100) return "limited";
			return percent >= 80 ? "high" : void 0;
		}

		/** 单窗口行（药丸弹层与设置页共用）：徽标 + 已用% 主数字 + 进度条 + 明细行。 */
		function UsageWindowRow({ w, t, getLocale, uncertain = false }) {
			const tier = uncertain && w.status !== "rate-limited" ? { icon: "?", badge: "badgeUnknown", color: "#b7791f", rank: 2 } : usageTier(w);
			const blocked = w.status === "rate-limited";
			return h("div", {
				style: {
					marginTop: 8, padding: "8px 10px", borderRadius: 8,
					background: blocked ? "rgba(239,68,68,.08)" : "transparent",
					border: blocked ? "1px solid rgba(239,68,68,.35)" : "1px solid transparent"
				}
			},
				h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
					h("span", { style: { fontSize: 12, opacity: 0.85, minWidth: 52 } }, t(KIND_LABEL[w.kind] ?? "wall")),
					h("span", {
						style: {
							fontSize: 11, padding: "1px 8px", borderRadius: 999, whiteSpace: "nowrap",
							border: `1px solid ${tier.color}`, color: tier.color
						}
					}, `${tier.icon} ${t(tier.badge)}`),
					h("span", { style: { flex: 1 } }),
					h("strong", { style: { fontSize: 13, color: numColor(w), whiteSpace: "nowrap" } },
						blocked ? t(tier.num) : t("numUsed").replace("{p}", String(w.percent)))
				),
				h("progress", {
					max: 100, value: Math.min(100, w.percent),
					style: { width: "100%", height: 6, marginTop: 6, accentColor: tier.color }
				}),
				h("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 4 } },
					[
						w.detail && typeof w.detail.used === "number" && typeof w.detail.limit === "number" && w.detail.limit > 0
							? t("detailUsed").replace("{used}", fmtTokens(w.detail.used)).replace("{limit}", fmtTokens(w.detail.limit)).replace("{unit}", w.detail.unit || "")
							: null,
						w.detail && w.detail.limitSource === "plan-snapshot" ? t("planSnapshotLimit") : null,
						resetLine(w, t, getLocale),
						w.cascade ? t("cascadeLimited") + (w.detail && w.detail.blockedBy ? ` [${w.detail.blockedBy.join(", ")}]` : "") : null
					].filter(Boolean).join(" · "))
			);
		}

		function UsagePill({ providerId, label, readEntry, t, getLocale }) {
			const [snapshot, setSnapshot] = react.useState(null);
			const [failed, setFailed] = react.useState(null);
			const [failState, setFailState] = react.useState(void 0);
			const [refreshing, setRefreshing] = react.useState(false);
			const [open, setOpen] = react.useState(false);
			const root = react.useRef(null);
			const retry = react.useRef(() => {});
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
			const entry = canShowUsage(rawEntry) ? rawEntry : null;
			const ok = !!(rawEntry && rawEntry.state === "ok" && rawEntry.freshness !== "stale" && rawEntry.coverage !== "partial");
			const light = ok ? "🟢" : (snapshot !== null || failed !== null ? "🔴" : "🟡");
			const windows = entry ? entry.windows || [] : [];
			const worst = windows.length > 0 ? worstWindow(windows) : null;
			const worstTier = worst ? usageTier(worst) : null;
			const degraded = !!(rawEntry && (rawEntry.state !== "ok" || rawEntry.freshness === "stale" || rawEntry.coverage === "partial"));
			const summary = worst ? pillText(worst, windows.length > 1, t) : (entry ? t("noUsageData") : t("providerUnavailable"));
			const stateText = !ok ? (snapshot && snapshot.entry ? snapshot.entry.state : failState) : void 0;
			const stateLabel = rawEntry ? statusText(rawEntry, t) : failState === "no-key" ? t("statusNoKey") : failState === "no-cookie" ? t("statusNoCookie") : failed ? t("statusError") : t("loading");
			// 配置缺失类失败给可行动指引，不倒裸报错。
			const needConfig = stateText === "no-key" ? (providerId === "commandcode" ? t("pillNeedCommandcode") : t("pillNeedKey"))
				: stateText === "no-cookie" ? t("pillNeedCookie")
				: null;
			const isConfig = stateText === "no-key" || stateText === "no-cookie";
			// 余额请求成功不代表有额度窗口（例如小米接口暂时只返回余额）。
			const triggerIcon = worstTier && worstTier.rank >= 4 ? worstTier.icon : degraded ? "⚠" : worstTier ? worstTier.icon : ok ? "ℹ" : isConfig ? "⚙" : light;
			const triggerText = worst ? `${degraded ? statusText(rawEntry, t) + " · " : ""}${pillText(worst, windows.length > 1, t)}` : entry ? `${degraded ? stateLabel + " · " : ""}${t("noUsageData")}` : isConfig ? t("needConfigShort") : stateLabel;
			return h("span", { ref: root, style: { position: "relative", display: "inline-flex", alignItems: "center" } },
				h("button", {
					type: "button",
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					"aria-label": `${label}: ${stateLabel} · ${summary}`,
					title: `${label}: ${stateLabel} · ${summary}`,
					onClick: () => setOpen(!open),
					style: {
						display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
						borderRadius: 999, border: "1px solid rgba(128,128,128,.35)", background: "transparent",
						color: "inherit", font: "inherit", cursor: "pointer", whiteSpace: "nowrap",
						...(worstTier && worstTier.rank >= 4 ? { background: "rgba(239,68,68,.10)", borderColor: "rgba(239,68,68,.45)" } : {})
					}
				},
					h("span", { "aria-hidden": "true", style: { fontSize: 11, lineHeight: 1 } }, triggerIcon),
					h("span", { style: worstTier && worstTier.rank > 1 ? { color: worstTier.color } : null }, triggerText),
					failed && ok ? h("span", { style: { opacity: 0.7, fontSize: 11 } }, `(${t("unavailable")})`) : null
				),
				open && h("div", {
					role: "dialog",
					"aria-label": `${label} ${t("nav")}`,
					style: {
						position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 50,
						minWidth: 240, padding: 12, borderRadius: 10,
						background: "var(--dsh-surface, rgba(40,40,40,.98))",
						border: "1px solid rgba(128,128,128,.35)",
						boxShadow: "0 8px 24px rgba(0,0,0,.35)", font: "12px/1.6 sans-serif"
					}
				},
					h("strong", null, label),
					needConfig ? h("p", { style: { margin: "6px 0 0", opacity: 0.9 } }, needConfig) : null,
					failed && !needConfig ? h("p", { style: { color: "#f87171", margin: "6px 0 0", whiteSpace: "pre-wrap" } }, failed) : null,
					!ok && !snapshot && !failed ? h("p", { style: { margin: "6px 0 0", opacity: 0.8 } }, t("loading")) : null,
					cacheAge(rawEntry, t) ? h("p", { style: { color: "#b7791f" } }, cacheAge(rawEntry, t)) : null,
					windows.map((w) => h(UsageWindowRow, { key: w.kind, w, t, getLocale, uncertain: degraded })),
					entry && entry.extras && entry.extras.length > 0
						? h("div", { style: { marginTop: 10, opacity: 0.85 } },
							entry.extras.map((x) => h("div", { key: x.kind }, `${extraLabel(x, t)}: ${x.value}`)))
						: null,
					snapshot ? h("div", { style: { marginTop: 10, opacity: 0.7 } }, `${t("lastUpdated")} ${new Date(snapshot.updatedAt).toLocaleString(getLocale())}`) : null,
					h("button", {
						type: "button",
						onClick: () => retry.current(),
						disabled: refreshing,
						style: { marginTop: 10, padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(128,128,128,.5)", background: "transparent", color: "inherit", cursor: "pointer" }
					}, t(refreshing ? "refreshing" : "retry"))
				)
			);
		}

		// ── 设置页：用量优先、窄容器 select、敏感凭据显式 patch ────────────────
		function initialTab() {
			try { const id = window.localStorage.getItem("dsh-subusage:last-provider"); if (PROVIDER_ORDER.includes(id)) return id; } catch {}
			return PROVIDER_ORDER[0];
		}
		function draftFor(settings, id) {
			return { keyMode: settings && settings.keyModes && settings.keyModes[id] || "inherit", keyAction: "keep", key: "", cookieAction: "keep", cookie: "", zai: { type: 1, organization: "", project: "", ...(settings && settings.zai) } };
		}
		function settingsPatch(id, draft, revision) {
			if (typeof revision !== "string" || !revision) throw new Error("请先加载最新设置，再编辑保存 / Load settings before saving");
			const patch = { providerId: id, expectedRevision: revision };
			// 凭据由提供方插件管理的模型商没有任何本地凭据补丁可保存。
			if (PROVIDER_META[id].managedByPlugin) return patch;
			if (id === "xiaomi-token-plan-cn") {
				patch.cookieUpdate = { action: draft.cookieAction };
				if (draft.cookieAction === "replace") patch.cookieUpdate.value = validateCookieText(draft.cookie);
			} else {
				patch.keyMode = draft.keyMode;
				patch.keyUpdate = { action: draft.keyAction };
				if (draft.keyAction === "replace") {
					if (!draft.key.trim() || /[\r\n\x00-\x1f\x7f]/.test(draft.key)) throw new Error("API Key 不能为空或包含控制字符");
					patch.keyUpdate.value = draft.key.trim();
				}
				if (id === "zai-coding-cn") patch.zai = { ...draft.zai };
			}
			return patch;
		}
		function SubusageSection({ usageStore, t, getLocale }) {
			const result = react.useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot);
			const [tab, setTab] = react.useState(initialTab);
			const [draft, setDraft] = react.useState(() => draftFor(result.settings, tab));
			const [dirty, setDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [loadError, setLoadError] = react.useState(null);
			const [login, setLogin] = react.useState({ jobId: null, state: "idle" });
			const loginActive = ["launching", "waiting", "verifying"].includes(login.state);
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
				void usageStore.readAll().then(() => { if (alive) setLoadError(null); }).catch((error) => { if (alive) setLoadError(String(error.message || error)); });
				return () => { alive = false; };
			}, [usageStore]);
			react.useEffect(() => {
				let alive = true;
				const deactivate = usageStore.activate(tab);
				void usageStore.readAll().then(() => { if (alive) return usageStore.refresh([tab], false); }).catch((error) => { if (alive) setLoadError(String(error.message || error)); });
				return () => { alive = false; deactivate(); };
			}, [usageStore, tab]);
			react.useEffect(() => {
				if (!dirtyRef.current) { setDraft(draftFor(result.settings, tab)); revisionRef.current = result.settings && result.settings.revision; }
			}, [result.settings, tab]);
			// 设置卸载/切换只停止 UI 轮询；Host 负责浏览器任务的 lifetime。
			react.useEffect(() => {
				if (tab !== "xiaomi-token-plan-cn") return;
				let alive = true;
				if (usageStore.getMimoLoginStatus) void usageStore.getMimoLoginStatus().then((value) => { if (alive && value) setLogin(value); }).catch((error) => { if (alive) setLogin({ jobId: null, state: "error", message: String(error.message || error) }); });
				return () => { alive = false; };
			}, [usageStore, tab]);
			react.useEffect(() => {
				if (tab !== "xiaomi-token-plan-cn" || !loginActive || !login.jobId) return;
				let alive = true, timer;
				const poll = async () => {
					try {
						const value = await usageStore.getMimoLoginStatus();
						if (!alive) return;
						if (value) setLogin(value);
						if (!value || ["launching", "waiting", "verifying"].includes(value.state)) timer = setTimeout(poll, 2000);
					} catch (error) { if (alive) setLogin({ jobId: login.jobId, state: "error", message: String(error.message || error) }); }
				};
				timer = setTimeout(poll, 2000);
				return () => { alive = false; clearTimeout(timer); };
			}, [usageStore, tab, loginActive, login.jobId]);
			react.useEffect(() => {
				if (login.state !== "success" || !login.result || handledLogin.current === login.jobId) return;
				handledLogin.current = login.jobId;
				if (!dirtyRef.current) { setDraft(draftFor(login.result.settings, tab)); revisionRef.current = login.result.settings && login.result.settings.revision; }
				setNotice({ ok: true, text: dirtyRef.current ? text("登录凭据已自动保存；当前未保存编辑已保留，请取消或重新核对后保存。", "Login saved automatically; unsaved edits retained. Cancel or review before saving.") : text("登录成功，凭据已自动保存。", "Signed in; credentials saved automatically.") });
			}, [login, tab]);
			const startLogin = async () => {
				if (dirtyRef.current) { setNotice({ ok: false, text: text("自动登录会立即保存凭据，请先保存或取消当前编辑。", "Automatic login saves immediately. Save or cancel your edits first.") }); return; }
				if (["launching", "waiting", "verifying"].includes(loginRef.current.state) || busy) return;
				loginRef.current = { jobId: null, state: "launching" }; setLogin(loginRef.current); setNotice(null);
				try { const value = await usageStore.startMimoLogin({ expectedRevision: result.settings.revision }); if (aliveRef.current && value) setLogin(value); }
				catch (error) { if (aliveRef.current) setLogin({ jobId: null, state: "error", message: String(error.message || error) }); }
			};
			const cancelLogin = async () => {
				const jobId = loginRef.current.jobId;
				if (!jobId) return;
				try { const value = await usageStore.cancelMimoLogin({ jobId }); if (aliveRef.current && loginRef.current.jobId === jobId && value) setLogin(value); }
				catch (error) { if (aliveRef.current && loginRef.current.jobId === jobId) setNotice({ ok: false, text: String(error.message || error) }); }
			};
			const editDraft = (patch) => { if ((tab === "xiaomi-token-plan-cn" && loginActive) || !result.settings || typeof result.settings.revision !== "string") return; dirtyRef.current = true; setDirty(true); setNotice(null); setDraft((prev) => ({ ...prev, ...patch })); };
			const cancel = () => { dirtyRef.current = false; setDirty(false); setDraft(draftFor(result.settings, tab)); revisionRef.current = result.settings && result.settings.revision; setNotice(null); };
			const choose = (id) => {
				if (id === tab) return;
				if (dirtyRef.current) { setNotice({ ok: false, text: text("请先保存或取消当前编辑，再切换模型商。", "Save or cancel the current edits before switching provider.") }); return; }
				setTab(id); setNotice(null); setLoadError(null);
				try { window.localStorage.setItem("dsh-subusage:last-provider", id); } catch {}
			};
			const refresh = async (all) => {
				setBusy(true);
				try { await usageStore.refresh(all ? PROVIDER_ORDER : [tab], true); if (aliveRef.current) setLoadError(null); }
				catch (error) { if (aliveRef.current) setLoadError(String(error.message || error)); }
				finally { if (aliveRef.current) setBusy(false); }
			};
			const onSave = async () => {
				if (tab === "xiaomi-token-plan-cn" && ["launching", "waiting", "verifying"].includes(loginRef.current.state)) return;
				setBusy(true);
				try {
					const patch = settingsPatch(tab, draft, revisionRef.current);
					const saved = await usageStore.save(patch);
					if (!aliveRef.current) return;
					dirtyRef.current = false; setDirty(false);
					setDraft(draftFor(saved.settings, tab)); revisionRef.current = saved.settings && saved.settings.revision;
					setNotice({ ok: true, text: t("saved") });
					// 保存已成功落盘；独立验证失败不改写成“保存失败”。
					try {
						const verified = await usageStore.refresh([tab], true);
						const current = verified.entries.find((e) => e.providerId === tab);
						if (aliveRef.current) setLoadError(current && current.state === "ok" ? null : text("已保存；验证获取失败：", "Saved; validation fetch failed: ") + (current && current.error || statusText(current, t)));
					} catch (error) { if (aliveRef.current) setLoadError(text("已保存；验证获取失败：", "Saved; validation fetch failed: ") + String(error.message || error)); }
				} catch (error) { if (aliveRef.current) setNotice({ ok: false, text: String(error.message || error) }); }
				finally { if (aliveRef.current) setBusy(false); }
			};
			const inputStyle = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,.4)", background: "transparent", color: "inherit", font: "inherit" };
			const btnStyle = { padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(128,128,128,.35)", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" };
			const primary = { ...btnStyle, background: "rgba(59,130,246,.12)", borderColor: "rgba(59,130,246,.65)" };
			const entries = result.entries || [];
			const entry = entries.find((e) => e.providerId === tab);
			const success = entries.filter((e) => e.state === "ok" && e.freshness !== "stale").length;
			const meta = PROVIDER_META[tab];
			const stateLabel = statusText(entry, t);
			const display = canShowUsage(entry);
			const source = entry && entry.keySource || "none";
			const sources = { credentials: text("来自凭据服务", "From credential service"), env: text("来自环境变量", "From environment"), manual: text("手动 Key", "Manual key"), none: text("无可用凭据", "No credentials"), cookie: text("官方平台 Cookie", "Platform Cookie"), "auth-file": text("来自 ~/.commandcode/auth.json（cmd login）", "From ~/.commandcode/auth.json (cmd login)") };
			const optionStyle = { color: "CanvasText", backgroundColor: "Canvas" };
			const selectStyle = { ...inputStyle, ...optionStyle, colorScheme: "light dark" };
			const credentialButtons = (kind, hasSaved) => h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
				draft[kind + "Action"] !== "replace" ? h("button", { type: "button", style: btnStyle, disabled: kind === "cookie" && loginActive, onClick: () => editDraft({ [kind + "Action"]: "replace", [kind]: "", ...(kind === "key" ? { keyMode: "manual" } : {}) }) }, text(kind === "cookie" ? "手动导入" : "更换", kind === "cookie" ? "Manual import" : "Change")) : null,
				hasSaved && draft[kind + "Action"] !== "clear" ? h("button", { type: "button", style: btnStyle, disabled: kind === "cookie" && loginActive, onClick: () => { editDraft({ [kind + "Action"]: "clear", [kind]: "" }); setNotice({ ok: false, text: text("待清除：保存设置后将删除已保存的敏感凭据；取消编辑可保留。", "Pending removal: saving will delete the saved secret. Cancel edits to keep it.") }); } }, text(kind === "cookie" ? "清除登录凭据" : "清除", kind === "cookie" ? "Clear login credentials" : "Clear")) : null,
				draft[kind + "Action"] === "clear" ? h("span", { role: "status" }, text("将删除凭据（尚未保存）", "Credential will be deleted (not saved yet)")) : null
			);
			return h("div", { ref: root, style: { padding: 16, maxWidth: 720, minWidth: 0, font: "13px/1.6 sans-serif", containerType: "inline-size", containerName: "subusage" } },
				h("style", null, ".subusage-provider-select{display:none}@container subusage (max-width:499px){.subusage-provider-tabs{display:none!important}.subusage-provider-select{display:block}}"),
				h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
					h("h2", { style: { margin: 0, fontSize: 16 } }, t("title")),
					h("span", { title: text("仅表示数据获取成功，不表示还有额度", "Fetch success only; not remaining quota"), style: { opacity: .75 } }, text(`${success}/${PROVIDER_ORDER.length} 家数据获取成功`, `${success}/${PROVIDER_ORDER.length} providers fetched`)),
					h("button", { type: "button", disabled: busy, style: primary, onClick: () => refresh(false) }, text("刷新当前", "Refresh current")),
					h("button", { type: "button", disabled: busy, style: btnStyle, onClick: () => refresh(true) }, text("刷新全部", "Refresh all"))
				),
				notice ? h("p", { role: "status", style: { color: notice.ok ? "inherit" : "#dc2626" } }, notice.text) : null,
				loadError ? h("p", { role: "alert", style: { color: "#dc2626" } }, loadError) : null,
				h("select", { className: "subusage-provider-select", "aria-label": text("模型商", "Provider"), value: tab, onChange: (e) => choose(e.target.value), style: { ...selectStyle, marginTop: 14 } },
					PROVIDER_ORDER.map((id) => h("option", { key: id, value: id, style: optionStyle }, `${PROVIDER_META[id].short} — ${providerDescription(entries.find((e) => e.providerId === id), t)}`)))
				 , h("div", { className: "subusage-provider-tabs", role: "tablist", "aria-label": text("模型商", "Providers"), style: { display: "grid", gridTemplateColumns: `repeat(${PROVIDER_ORDER.length}, minmax(0, 1fr))`, gap: 4, marginTop: 14 } },
					PROVIDER_ORDER.map((id, index) => {
						const e = entries.find((item) => item.providerId === id), active = tab === id;
						return h("button", { key: id, id: `subusage-tab-${id}`, role: "tab", type: "button", tabIndex: active ? 0 : -1, "aria-selected": active,
							"aria-controls": "subusage-provider-panel", title: `${PROVIDER_META[id].label}: ${providerDescription(e, t)}`, "aria-label": `${PROVIDER_META[id].short}: ${providerDescription(e, t)}`,
							onClick: () => choose(id), onKeyDown: (event) => {
								let next;
								if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % PROVIDER_ORDER.length;
								else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + PROVIDER_ORDER.length - 1) % PROVIDER_ORDER.length;
								else if (event.key === "Home") next = 0; else if (event.key === "End") next = PROVIDER_ORDER.length - 1; else return;
								event.preventDefault(); choose(PROVIDER_ORDER[next]);
								if (!dirtyRef.current) { const button = event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]; if (button) button.focus(); }
							}, style: { ...btnStyle, minWidth: 0, padding: "7px 2px", whiteSpace: "nowrap", fontSize: 12, borderRadius: "6px 6px 0 0", border: "1px solid transparent", borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent", background: active ? "rgba(59,130,246,.10)" : "transparent" }
						}, h("span", { "aria-hidden": true, style: { display: "inline-block", width: 6, height: 6, marginRight: 4, borderRadius: 99, background: tagColor(e) } }), h("span", { "aria-hidden": true, style: { marginRight: 3 } }, providerIcon(e)), PROVIDER_META[id].short);
					})),
				h("section", { role: "tabpanel", id: "subusage-provider-panel", "aria-label": meta.label, style: { marginTop: 12, border: "1px solid rgba(128,128,128,.25)", borderRadius: 10, padding: 14 } },
					h("strong", null, meta.label),
					h("p", { role: "status", style: { margin: "4px 0", color: entry && entry.state !== "ok" ? "#dc2626" : "inherit" } }, stateLabel),
					cacheAge(entry, t) ? h("p", { style: { color: "#b7791f" } }, cacheAge(entry, t)) : null,
					entry && entry.error ? h("p", { role: "alert", style: { color: "#dc2626", overflowWrap: "anywhere" } }, entry.error) : null,
					display && (entry.windows || []).length ? (entry.windows || []).map((w) => h(UsageWindowRow, { key: w.kind, w, t, getLocale, uncertain: entry.coverage === "partial" || entry.freshness === "stale" || entry.state !== "ok" })) : h("p", { style: { opacity: .75 } }, entry ? t("noUsageData") : t("loading")),
					display && entry.extras ? h("p", { style: { opacity: .75 } }, entry.extras.map((x) => `${extraLabel(x, t)}: ${x.value}`).join(" · ")) : null,
					h("details", { style: { marginTop: 14 } }, h("summary", { style: { cursor: "pointer" } }, text("连接与凭据", "Connection & credentials")),
						h("fieldset", { disabled: busy || !result.settings || typeof result.settings.revision !== "string", style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
						h("p", null, `${result.configured && result.configured[tab] ? t("detected") : t("notDetected")} · ${sources[source] || sources.none}`),
						tab === "commandcode" ? h(react.Fragment, null, h("p", null, t("commandcodeManaged"))) : tab === "xiaomi-token-plan-cn" ? h(react.Fragment, null,
							h("button", { type: "button", style: primary, disabled: loginActive, onClick: startLogin }, text("登录并自动导入", "Sign in & import automatically")),
							loginActive ? h("div", { role: "status", "aria-live": "polite", style: { marginTop: 8 } },
								h("progress", { "aria-label": text("登录进度", "Login progress"), style: { width: 100, marginRight: 8 } }),
								({ launching: text("正在启动登录浏览器…", "Launching login browser…"), waiting: text("请在浏览器中完成登录…", "Complete sign-in in the browser…"), verifying: text("正在验证并导入…", "Verifying & importing…") })[login.state],
								h("button", { type: "button", style: btnStyle, disabled: !login.jobId, onClick: cancelLogin }, text("取消登录", "Cancel login"))) : null,
							login.state === "error" || login.state === "cancelled" ? h("p", { role: "status" }, login.state === "cancelled" ? text("登录已取消，可重新登录或手动导入。", "Login cancelled. Retry or import manually.") : text("自动登录失败，可重试或手动导入。", "Automatic login failed. Retry or import manually.") + (login.message ? " " + login.message : "")) : null,
							h("p", null, h("a", { href: "https://platform.xiaomimimo.com", target: "_blank", rel: "noopener noreferrer" }, text("仅打开 MiMo 官网（不会自动导入）", "Open MiMo website only (no automatic import)"))),
							h("p", null, result.settings && result.settings.xiaomi && result.settings.xiaomi.hasCookie ? text("已保存 Cookie（不回填）", "Cookie saved (never filled back)") : t("statusNoCookie")),
							credentialButtons("cookie", result.settings && result.settings.xiaomi && result.settings.xiaomi.hasCookie),
							draft.cookieAction === "replace" ? h(react.Fragment, null,
								h("label", null, t("mimoCookie"), h("textarea", { rows: 3, autoComplete: "off", spellCheck: false, value: draft.cookie, disabled: busy || loginActive, onChange: (e) => editDraft({ cookie: e.target.value }), style: { ...inputStyle, resize: "vertical" } })),
								h("button", { type: "button", style: btnStyle, disabled: busy, onClick: () => { try { const normalized = validateCookieText(draft.cookie); editDraft({ cookie: normalized }); setNotice({ ok: true, text: text("Cookie 格式验证通过，尚未保存。", "Cookie format validated; not saved yet.") }); } catch (error) { setNotice({ ok: false, text: String(error.message || error) }); } } }, text("验证并规范化导入", "Validate & normalize import")),
								h("p", { style: { fontSize: 12, opacity: .75 } }, t("mimoCookieHint"))) : null)
						: h(react.Fragment, null,
							h("div", { role: "group", "aria-label": text("Key 来源模式", "Key source mode"), style: { display: "flex", gap: 8, flexWrap: "wrap" } },
								["inherit", "manual"].map((mode) => h("button", { key: mode, type: "button", "aria-pressed": draft.keyMode === mode, style: draft.keyMode === mode ? primary : btnStyle, onClick: () => editDraft({ keyMode: mode }) }, `${draft.keyMode === mode ? "✓ " : ""}${mode === "inherit" ? text("继承凭据 / 环境变量", "Inherit credentials / environment") : text("手动 Key", "Manual key")}`))),
							h("p", { style: { fontSize: 12 } }, result.settings && result.settings.hasKeys && result.settings.hasKeys[tab] ? text("已保存 Key（不回填）", "Key saved (never filled back)") : text("未保存手动 Key", "No manual key saved")),
							credentialButtons("key", result.settings && result.settings.hasKeys && result.settings.hasKeys[tab]),
							draft.keyAction === "replace" ? h("label", null, t("keyLabel"), h("input", { type: "password", autoComplete: "new-password", value: draft.key, disabled: busy, onChange: (e) => editDraft({ key: e.target.value }), style: inputStyle })) : null),
						tab === "zai-coding-cn" ? h(react.Fragment, null,
							h("label", null, t("zaiType"), h("select", { value: draft.zai.type === 2 ? "2" : "1", style: selectStyle, disabled: busy, onChange: (e) => editDraft({ zai: { ...draft.zai, type: Number(e.target.value) } }) }, h("option", { value: "1", style: optionStyle }, t("zaiTypePersonal")), h("option", { value: "2", style: optionStyle }, t("zaiTypeTeam")))),
							draft.zai.type === 2 ? ["organization", "project"].map((name) => h("label", { key: name }, t(name === "organization" ? "zaiOrg" : "zaiProject"), h("input", { value: draft.zai[name] || "", disabled: busy, style: inputStyle, onChange: (e) => editDraft({ zai: { ...draft.zai, [name]: e.target.value } }) }))) : null) : null,
						dirty ? h("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, h("button", { type: "button", disabled: busy || (tab === "xiaomi-token-plan-cn" && loginActive), style: primary, onClick: onSave }, t(busy ? "saving" : "save")), h("button", { type: "button", disabled: busy, style: btnStyle, onClick: cancel }, text("取消编辑", "Cancel edits"))) : null)),
					h("details", { style: { marginTop: 12 } }, h("summary", { style: { cursor: "pointer" } }, text("技术信息与帮助", "Technical information & help")),
						h("code", null, tab), h("p", null, t("hint")), tab === "zai-coding-cn" ? h("p", null, t("zaiOrgHint")) : null, tab === "commandcode" ? h("p", null, t("commandcodeHelp")) : null,
						entry && entry.lastAttemptAt ? h("p", null, `${t("lastUpdated")} ${new Date(entry.lastAttemptAt).toLocaleString(getLocale())}`) : null)
				)
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
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "subusage", order: 22, label: () => t("nav"), inject: () => ({ usageStore, t, getLocale }) }, SubusageSection));
			} catch (error) { console.error("[dsh-subusage] 设置页注册失败:", error); }
			ctx.inject(["modelDirectories"], (scope) => {
				try {
					scope.slots.inject("conversation.input.right", () => scope.slots.register({ name: "conversation.input.right", id: "subusage-usage", order: 1001,
						inject: (sessionId) => ({ store: scope.modelDirectories.directoryFor(sessionId).store, readEntry, t, getLocale }) }, SubusagePillEntry));
				} catch (error) { console.error("[dsh-subusage] 药丸注册失败:", error); }
			});
		}

		/** 槽包装：先看当前模型的 provider，再分发到对应药丸。 */
		function SubusagePillEntry({ store, readEntry, t, getLocale }) {
			const state = react.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const provider = state.current && state.current.provider;
			const meta = provider === "zai-coding-cn" ? { label: "Z.ai", id: provider }
				: provider === "kimi-coding" ? { label: "Kimi", id: provider }
				: provider === "xiaomi-token-plan-cn" ? { label: "MiMo", id: provider }
				: provider === "opencode-go" ? { label: "OpenCode Go", id: provider }
				: provider === "commandcode" ? { label: "Command Code", id: provider }
				: null;
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
				getLocale
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
