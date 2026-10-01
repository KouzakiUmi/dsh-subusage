// dsh-subusage —— 订阅用量显示（Client 侧）
//
// 两块 UI：
//   1. 用量药丸（conversation.input.right 槽，紧邻模型选择器左侧）：按当前选中模型的
//      provider 显示对应模型商的订阅用量，拉取成功 🟢 / 失败 🔴；点开看三窗明细。
//   2. 设置页（settings.section 槽，OpenCode Go 同款布局）：检测已配置模型商、继承
//      环境 Key、缺失项手动填写；小米凭据走内嵌登录窗（webview，persist 分区免提取
//      Cookie —— 在站点自身上下文里同源 fetch，httpOnly 也照常携带）。
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
			hint: "按当前会话选中的模型显示对应模型商的订阅额度。Key 优先继承环境变量（与 llm-pi-ai 的 apiKeyEnv 一致），未继承的可手动填写。数据每分钟刷新。",
			refresh: "立即刷新",
			refreshing: "刷新中…",
			save: "保存设置",
			saving: "保存中…",
			saved: "已保存",
			lastUpdated: "更新于",
			lightOk: "全部拉取成功",
			lightFail: "存在拉取失败",
			statusOk: "拉取成功",
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
			mimoCookie: "Cookie（必填，粘贴后自动归一化）",
			mimoCookieHint: "内嵌登录窗暂不可用，请用 Cookie 登录：Chrome 登录 platform.xiaomimimo.com 后，F12 → Application → Cookies 逐条抄成 name=value 粘贴，或整段粘贴 cookies.json / 多行清单（三种格式自动识别）。需含 api-platform_serviceToken 与 userId。",
			mimoLogin: "打开登录窗口（暂不可用）",
			mimoLoginTitle: "小米 MiMo 登录 —— 登录完成后点「完成」",
			mimoDone: "完成",
			mimoHide: "隐藏",
			mimoFallback: "登录窗暂不可用，请直接粘贴 Cookie（见上方说明）。",
			resets: "重置于",
			limited: "已达限额",
			cascadeLimited: "（受更长周期限额连累，暂不可用）",
			retry: "立即重试",
			loading: "正在读取用量…",
			unavailable: "暂不可用",
			planLabel: "套餐",
			balanceLabel: "余额",
			w5h: "5 小时",
			w7d: "7 天",
			wweek: "每周",
			wmonth: "每月",
			wperiod: "本周期",
			wsub: "本周期",
			wrolling: "滚动",
			wall: "全部",
			detailUsed: "已用 {used} / 总计 {limit} Credits",
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
			pillNeedCookie: "需登录 —— 请在 设置 → 订阅用量 打开登录窗登录，或粘贴 Cookie。",
			noUsageData: "暂无额度数据",
			providerUnavailable: "用量暂不可用"
		};
		const en = {
			nav: "Subscription usage",
			title: "Subscription usage display",
			hint: "Shows the subscription quota of the provider behind the currently selected model. API keys inherit from environment variables (same apiKeyEnv as llm-pi-ai); fill in manually what is missing. Data refreshes every minute.",
			refresh: "Refresh now",
			refreshing: "Refreshing…",
			save: "Save settings",
			saving: "Saving…",
			saved: "Saved",
			lastUpdated: "Updated",
			lightOk: "All fetches succeeded",
			lightFail: "Some fetches failed",
			statusOk: "Fetch OK",
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
			mimoCookie: "Cookie (required; pasted text is normalized automatically)",
			mimoCookieHint: "The embedded login window is unavailable for now — sign in at platform.xiaomimimo.com in Chrome, then paste cookies (F12 → Application → Cookies as name=value pairs, or paste cookies.json / a multi-line dump; all three formats are recognized). Must include api-platform_serviceToken and userId.",
			mimoLogin: "Open login window (unavailable)",
			mimoLoginTitle: "Xiaomi MiMo login — click “Done” after signing in",
			mimoDone: "Done",
			mimoHide: "Hide",
			mimoFallback: "The login window is unavailable for now — paste the Cookie directly (see above).",
			resets: "Resets",
			limited: "Limit reached",
			cascadeLimited: " (blocked by a larger window's limit)",
			retry: "Retry now",
			loading: "Loading usage…",
			unavailable: "Unavailable",
			planLabel: "Plan",
			balanceLabel: "Balance",
			w5h: "5 hours",
			w7d: "7 days",
			wweek: "Week",
			wmonth: "Month",
			wperiod: "Period",
			wsub: "Monthly",
			wrolling: "Rolling",
			wall: "All",
			detailUsed: "Used {used} / total {limit} Credits",
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
			providerUnavailable: "Usage unavailable"
		};
		const NS = "settings.subusage";
		const KIND_LABEL = { "5h": "w5h", "7d": "w7d", week: "wweek", month: "wmonth", period: "wperiod", sub: "wsub", rolling: "wrolling" };
		const KIND_SHORT = { "5h": "5h", "7d": "7d", week: "W", month: "M", period: "P", sub: "Sub", rolling: "R" };
		const PROVIDER_META = {
			"zai-coding-cn": { label: "Z.ai Coding (CN)", envName: "ZAI_CODING_CN_API_KEY" },
			"kimi-coding": { label: "Kimi Coding", envName: "KIMI_CODING_API_KEY" },
			"xiaomi-token-plan-cn": { label: "Xiaomi Token Plan (CN)", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" },
			"opencode-go": { label: "OpenCode Go", envName: "OPENCODE_API_KEY" }
		};
		const PROVIDER_ORDER = ["zai-coding-cn", "kimi-coding", "xiaomi-token-plan-cn", "opencode-go"];
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
			if (!entry || entry.state !== "ok") return "#ef4444";
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
			return `${short}${t("pillRemaining").replace("{p}", String(Math.max(0, 100 - w.percent)))}`;
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
		const settingsCodec = {
			mode: "strict",
			typeSymbol: "dsh-subusage#SubUsageSettings",
			schema: { parse: parseSettings },
			create: () => ({ parse: parseSettings })
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
				}
			]
		};

		// ── 小米 webview 桥（免 Cookie 提取的登录/取数通道）─────────────────────
		// webview 在站点自身上下文执行 fetch（credentials: include），httpOnly Cookie
		// 也随请求携带；Cookie 值自始至终无需离开 Electron 会话。partition 用
		// persist: 前缀让登录态跨重启保留。
		const MIMO_ORIGIN = "https://platform.xiaomimimo.com";
		const MIMO_FETCH_SCRIPT = `(async () => {
			const j = async (u) => {
				try {
					const r = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
					return { s: r.status, b: await r.text() };
				} catch (e) {
					return { s: 0, b: String(e) };
				}
			};
			return {
				bal: await j("/api/v1/balance"),
				det: await j("/api/v1/tokenPlan/detail"),
				use: await j("/api/v1/tokenPlan/usage")
			};
		})()`;

		// 小米三份响应合成用量（与 Host normalizeMimo 对齐）。
		// 注意：usage/monthUsage 的 percent 是 0–1 小数（0.4744 = 47.44%），需 ×100。
		function pct100(v) {
			return Math.max(0, Math.round((Number(v) || 0) * 100));
		}
		function windowRow(kind, percent, resetsAt, detail) {
			const p = Math.max(0, Math.round(Number(percent) || 0));
			return {
				kind,
				percent: p,
				resetsAt: typeof resetsAt === "string" && Number.isFinite(Date.parse(resetsAt)) ? resetsAt : void 0,
				status: p >= 100 ? "rate-limited" : "ok",
				...(detail && typeof detail === "object" ? { detail } : {})
			};
		}
		// 限额层级连坐（递归 🔴 判定）：外层窗口用尽，内层窗口即便 0% 也不可用。
		const WINDOW_SCOPE_RANK = { month: 0, sub: 0, period: 0, week: 1, "7d": 1, "5h": 2, rolling: 2 };
		function cascadeRateLimited(windows) {
			const rankOf = (w) => WINDOW_SCOPE_RANK[w.kind] ?? 3;
			let outerLimited = false;
			for (const w of [...windows].sort((a, b) => rankOf(a) - rankOf(b))) {
				if (outerLimited && w.status !== "rate-limited") {
					w.status = "rate-limited";
					w.cascade = true;
				}
				if (w.status === "rate-limited") outerLimited = true;
			}
			return windows;
		}
		function normalizeMimo(balBody, detailBody, usageBody) {
			const bal = balBody && balBody.data;
			if (!bal || typeof bal.balance !== "string") throw new Error("Invalid MiMo balance response");
			const data = usageBody && usageBody.data ? usageBody.data : {};
			const pick = (group, name) => group && Array.isArray(group.items)
				? (group.items.find((i) => i && i.name === name) ?? group.items[0])
				: void 0;
			const planItem = pick(data.usage, "plan_total_token");
			const monthItem = pick(data.monthUsage, "month_total_token");
			const detail = detailBody && detailBody.data ? detailBody.data : {};
			// 小米是月度额度池：周期一个月，重置于下月（detail.currentPeriodEnd）。
			// 只出一个「订阅用量」窗口 + 已用/总计 Credits 明细。
			const resetAt = typeof detail.currentPeriodEnd === "string" ? detail.currentPeriodEnd : void 0;
			const pool = planItem ?? monthItem;
			const windows = pool ? [windowRow("sub", pct100(pool.percent), resetAt, { used: pool.used, limit: pool.limit })] : [];
			const extras = [{ kind: "balance", value: `${bal.balance} ${bal.currency}` }];
			const planName = typeof detail.planName === "string" && detail.planName.length > 0
				? detail.planName
				: (typeof detail.planCode === "string" ? detail.planCode : void 0);
			if (planName) extras.push({ kind: "plan", value: planName });
			return { windows: cascadeRateLimited(windows), extras };
		}

		function mimoExtract(raw) {
			const parse = (part) => {
				if (!part || typeof part.b !== "string") return {};
				try {
					return JSON.parse(part.b);
				} catch {
					return {};
				}
			};
			const bal = parse(raw && raw.bal);
			if (bal && typeof bal === "object" && (bal.code === 401 || bal.code === 403)) throw new Error("login-required");
			return normalizeMimo(bal, parse(raw && raw.det), parse(raw && raw.use));
		}

		/** 归一化 Cookie 输入：支持 cookies.json 导出、多行 name/value 清单、标准 "a=b; c=d" 串。 */
		function normalizeCookieText(raw) {
			const text = String(raw || "").trim();
			if (text === "") return "";
			// 标准单行 a=b; c=d
			if (!text.includes("\n") && !text.startsWith("[") && !text.startsWith("{") && /^[^\s;=]+=[^;]*/.test(text)) return text;
			// JSON 导出（EditThisCookie / cookies.json：[{name,value,...}] 或 {name:value}）
			if (text.startsWith("[") || text.startsWith("{")) {
				try {
					const data = JSON.parse(text);
					const list = Array.isArray(data)
						? data
						: Object.keys(data).map((k) => ({ name: k, value: data[k] }));
					const pairs = list
						.filter((c) => c && typeof c.name === "string" && c.value !== void 0 && c.value !== null)
						.map((c) => `${c.name}=${typeof c.value === "string" ? c.value : String(c.value)}`);
					if (pairs.length > 0) return pairs.join("; ");
				} catch { /* JSON 解析失败落到行解析 */ }
			}
			// 多行清单：优先 name<TAB>value，其次 name/value 成对行（跳过"当前页面 Cookies"等表头）
			const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			const nameRe = /^[A-Za-z0-9_!#$%&'*+\-.^`|~]+$/;
			const pairs = [];
			const tabbed = lines.filter((l) => l.includes("\t"));
			if (tabbed.length > 0) {
				for (const l of tabbed) {
					const i = l.indexOf("\t");
					pairs.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]);
				}
			} else {
				for (let i = 0; i < lines.length; i++) {
					if (!nameRe.test(lines[i])) continue;
					const value = lines[i + 1];
					if (value === void 0 || value === "") continue;
					pairs.push([lines[i], value]);
					i += 1;
				}
			}
			return pairs.map(([n, v]) => `${n}=${v}`).join("; ");
		}

		const MimoBridge = {
			box: null,
			webview: null,
			loaded: null,
			/** 建持久容器（webview 不重挂载：重挂载会丢页面状态）。 */
			ensure() {
				if (this.box) return this.box;
				const box = document.createElement("div");
				// 不用 display:none：隐藏时保留布局盒，webview 客人才有真实尺寸（display:none 里创建 + 纯 flex:1 会渲染成空白）
				box.style.cssText = "position:fixed;inset:24px;z-index:2147483000;display:flex;visibility:hidden;opacity:0;pointer-events:none;flex-direction:column;border-radius:12px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.45);background:#1b1b1b;";
				const bar = document.createElement("div");
				bar.style.cssText = "display:flex;gap:8px;align-items:center;padding:8px 12px;background:#2b2b2b;color:#eee;font:13px/1.4 sans-serif;";
				const title = document.createElement("span");
				title.style.flex = "1";
				const done = document.createElement("button");
				done.style.cssText = "padding:4px 14px;border-radius:6px;border:0;background:#3b82f6;color:#fff;cursor:pointer;";
				const hide = document.createElement("button");
				hide.style.cssText = "padding:4px 12px;border-radius:6px;border:1px solid #555;background:transparent;color:#ddd;cursor:pointer;";
				let webview;
				try {
					webview = document.createElement("webview");
				} catch (error) {
					return null;
				}
				webview.setAttribute("partition", "persist:subusage-mimo");
				webview.setAttribute("src", MIMO_ORIGIN + "/#/console/balance");
				const wrap = document.createElement("div");
				wrap.style.cssText = "flex:1;position:relative;";
				webview.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;";
				webview.addEventListener("did-fail-load", (event) => {
					if (event.errorCode === -3) return; // ERR_ABORTED：SPA 正常换路由
					console.error("[dsh-subusage] 小米页加载失败:", event.errorCode, event.errorDescription, event.validatedURL);
				});
				bar.append(title, done, hide);
				wrap.appendChild(webview);
				box.append(bar, wrap);
				document.body.appendChild(box);
				this.box = box;
				this.webview = webview;
				this.loaded = new Promise((resolve) => {
					webview.addEventListener("did-finish-load", () => resolve(), { once: true });
					setTimeout(resolve, 15000);
				});
				this.texts = { title, done, hide };
				return box;
			},
			applyTexts(t) {
				if (!this.texts) return;
				this.texts.title.textContent = t("mimoLoginTitle");
				this.texts.done.textContent = t("mimoDone");
				this.texts.hide.textContent = t("mimoHide");
			},
			showLogin(t) {
				if (!this.ensure()) throw new Error("webview unavailable");
				this.applyTexts(t);
				this.texts.done.onclick = () => this.hideLogin();
				this.texts.hide.onclick = () => this.hideLogin();
				this.box.style.visibility = "visible";
				this.box.style.opacity = "1";
				this.box.style.pointerEvents = "auto";
			},
			hideLogin() {
				if (!this.box) return;
				this.box.style.visibility = "hidden";
				this.box.style.opacity = "0";
				this.box.style.pointerEvents = "none";
			},
			/** 站点同源 fetch 取用量（无需导出 Cookie）。 */
			async fetchUsage() {
				if (!this.ensure()) throw new Error("webview unavailable");
				await this.loaded;
				const raw = await this.webview.executeJavaScript(MIMO_FETCH_SCRIPT);
				return mimoExtract(raw);
			}
		};

		// ── 用量药丸（匹配当前选中模型的 provider）──────────────────────────────
		function severity(percent, status) {
			if (status === "rate-limited" || percent >= 100) return "limited";
			return percent >= 80 ? "high" : void 0;
		}

		/** 单窗口行（药丸弹层与设置页共用）：徽标 + 已用% 主数字 + 进度条 + 明细行。 */
		function UsageWindowRow({ w, t, getLocale }) {
			const tier = usageTier(w);
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
							? t("detailUsed").replace("{used}", fmtTokens(w.detail.used)).replace("{limit}", fmtTokens(w.detail.limit))
							: null,
						resetLine(w, t, getLocale),
						w.cascade ? t("cascadeLimited") : null
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
						const entry = await readEntry();
						if (alive) {
							setSnapshot({ entry, updatedAt: Date.now() });
							setFailed(null);
							setFailState(void 0);
						}
					} catch (error) {
						if (alive) {
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
				const timer = setInterval(() => void refresh(), 60000);
				const visible = () => void refresh();
				document.addEventListener("visibilitychange", visible);
				return () => {
					alive = false;
					retry.current = () => {};
					clearInterval(timer);
					document.removeEventListener("visibilitychange", visible);
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
			const entry = snapshot && snapshot.entry && snapshot.entry.state === "ok" ? snapshot.entry : null;
			const ok = entry !== null;
			const light = ok ? "🟢" : (snapshot !== null || failed !== null ? "🔴" : "🟡");
			const windows = entry ? entry.windows : [];
			const worst = windows.length > 0 ? worstWindow(windows) : null;
			const worstTier = worst ? usageTier(worst) : null;
			const summary = worst ? `${label}: ${pillText(worst, windows.length > 1, t)}` : (ok ? t("noUsageData") : t("providerUnavailable"));
			const stateText = !ok ? (snapshot && snapshot.entry ? snapshot.entry.state : failState) : void 0;
			const stateLabel = stateText === "no-key" ? t("statusNoKey")
				: stateText === "no-cookie" ? t("statusNoCookie")
				: stateText === "error" ? t("statusError")
				: stateText === void 0 ? t("loading") : t("statusError");
			// 配置缺失类失败给可行动指引，不倒裸报错。
			const needConfig = stateText === "no-key" ? t("pillNeedKey")
				: stateText === "no-cookie" ? t("pillNeedCookie")
				: null;
			const isConfig = stateText === "no-key" || stateText === "no-cookie";
			// 余额请求成功不代表有额度窗口（例如小米接口暂时只返回余额）。
			const triggerIcon = worstTier ? worstTier.icon : ok ? "ℹ" : isConfig ? "⚙" : light;
			const triggerText = worst ? pillText(worst, windows.length > 1, t) : ok ? t("noUsageData") : isConfig ? t("needConfigShort") : stateLabel;
			return h("span", { ref: root, style: { position: "relative", display: "inline-flex", alignItems: "center" } },
				h("button", {
					type: "button",
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					"aria-label": `${label}: ${summary}`,
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
					!ok && !snapshot ? h("p", { style: { margin: "6px 0 0", opacity: 0.8 } }, t("loading")) : null,
					windows.map((w) => h(UsageWindowRow, { key: w.kind, w, t, getLocale })),
					entry && entry.extras && entry.extras.length > 0
						? h("div", { style: { marginTop: 10, opacity: 0.85 } },
							entry.extras.map((x) => h("div", { key: x.kind }, `${x.kind === "plan" ? t("planLabel") : t("balanceLabel")}: ${x.value}`)))
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

		// ── 设置页（OpenCode Go 同款布局）──────────────────────────────────────
		function StatusLight({ ok, pending, text }) {
			return h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, font: "12px/1.4 sans-serif" } },
				h("span", { "aria-hidden": "true", style: { fontSize: 11 } }, pending ? "🟡" : ok ? "🟢" : "🔴"),
				h("span", { style: { opacity: 0.85 } }, text)
			);
		}

		function SubusageSection({ readAll, saveSettings, openLogin, t, getLocale }) {
			const [result, setResult] = react.useState(null);
			const [form, setForm] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [loadError, setLoadError] = react.useState(null);
			const [tab, setTab] = react.useState("zai-coding-cn");
			const refresh = react.useCallback(async (manual) => {
				setBusy(true);
				try {
					const value = await readAll();
					setResult(value);
					setLoadError(null);
					setForm((prev) => prev ?? {
						zai: { ...(value.settings && value.settings.zai) },
						xiaomi: { ...(value.settings && value.settings.xiaomi) },
						keys: { ...((value.settings && value.settings.keys) || {}) }
					});
					if (manual) setNotice({ ok: true, text: t("saved") });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					setLoadError(message);
					setNotice({ ok: false, text: message });
				} finally {
					setBusy(false);
				}
			}, [readAll, t]);
			react.useEffect(() => {
				void refresh(false);
			}, [refresh]);
			const entries = result ? result.entries : [];
			const allOk = entries.length > 0 && entries.every((e) => e.state === "ok");
			const setField = (path, value) => setForm((prev) => {
				const next = JSON.parse(JSON.stringify(prev));
				const [a, b] = path;
				if (b === void 0) next[a] = value;
				else next[a][b] = value;
				return next;
			});
			const onSave = async () => {
				setBusy(true);
				try {
					const normalized = JSON.parse(JSON.stringify(form));
					if (normalized.xiaomi) normalized.xiaomi.cookie = normalizeCookieText(normalized.xiaomi.cookie);
					setForm(normalized);
					const value = await saveSettings(normalized);
					setResult(value);
					setNotice({ ok: true, text: t("saved") });
				} catch (error) {
					setNotice({ ok: false, text: error instanceof Error ? error.message : String(error) });
				} finally {
					setBusy(false);
				}
			};
			const inputStyle = {
				width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
				border: "1px solid rgba(128,128,128,.4)", background: "transparent", color: "inherit", font: "inherit"
			};
			const btnStyle = {
				padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(128,128,128,.5)",
				background: "transparent", color: "inherit", cursor: "pointer", font: "inherit"
			};
			const cardStyle = {
				border: "1px solid rgba(128,128,128,.25)", borderRadius: 10, padding: 14, marginTop: 12
			};
			const rowOf = (id, meta) => {
				const entry = entries.find((e) => e.providerId === id);
				const configured = result && result.configured ? result.configured[id] : void 0;
				const keySource = entry ? entry.keySource : "none";
				const envName = entry ? entry.envName : meta.envName;
				const ok = entry && entry.state === "ok";
				const statusText = entry
					? entry.state === "ok" ? t("statusOk")
					: entry.state === "no-key" ? t("statusNoKey")
					: entry.state === "no-cookie" ? t("statusNoCookie")
					: t("statusError")
					: t("loading");
				return h("section", { key: id, style: cardStyle },
					h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
						h("strong", null, meta.label),
						h("span", { style: { opacity: 0.6, fontSize: 12 } }, id),
						h(StatusLight, { ok: !!ok, pending: !entry, text: statusText }),
						h("span", {
							style: {
								fontSize: 11, padding: "2px 8px", borderRadius: 999,
								border: "1px solid rgba(128,128,128,.4)", opacity: 0.85
							}
						}, configured === false ? t("notDetected") : t("detected"))
					),
					// 详细用量：与药丸弹层同款窗口行（徽标 + 已用% + 条 + 明细）
					entry && entry.state === "ok" ? h("div", { style: { marginTop: 10, display: "grid", gap: 2 } },
						(entry.windows || []).map((w) => h(UsageWindowRow, { key: w.kind, w, t, getLocale })),
						entry.extras && entry.extras.length > 0
							? h("div", { style: { opacity: 0.75, fontSize: 11, marginTop: 4 } },
								entry.extras.map((x) => `${x.kind === "plan" ? t("planLabel") : t("balanceLabel")}: ${x.value}`).join(" · "))
							: null
					) : null,
					h("div", { style: { marginTop: 10, fontSize: 12, opacity: 0.85 } },
						keySource === "env" ? t("keyEnv").replace("{name}", envName)
							: keySource === "manual" ? t("keyManual")
							: t("keyNone")),
					h("div", { style: { marginTop: 8 } },
						h("label", { style: { fontSize: 12, opacity: 0.8 } }, t("keyLabel")),
						h("input", {
							type: "password",
							value: form && form.keys ? (form.keys[id] ?? "") : "",
							placeholder: t("keyPlaceholder"),
							onChange: (e) => setField(["keys", id], e.target.value),
							style: inputStyle
						})
					),
					id === "zai-coding-cn" ? h(react.Fragment, null,
						h("div", { style: { marginTop: 8 } },
							h("label", { style: { fontSize: 12, opacity: 0.8 } }, t("zaiType")),
							h("select", {
								value: form && form.zai ? (form.zai.type === 2 ? "2" : "1") : "1",
								onChange: (e) => setField(["zai"], { ...form.zai, type: e.target.value === "2" ? 2 : 1 }),
								style: inputStyle
							},
								h("option", { value: "1" }, t("zaiTypePersonal")),
								h("option", { value: "2" }, t("zaiTypeTeam"))
							)
						),
						(form && form.zai && form.zai.type === 2) ? h(react.Fragment, null,
							h("div", { style: { marginTop: 8 } },
								h("label", { style: { fontSize: 12, opacity: 0.8 } }, t("zaiOrg")),
								h("input", {
									value: form.zai.organization ?? "",
									onChange: (e) => setField(["zai"], { ...form.zai, organization: e.target.value }),
									style: inputStyle
								})
							),
							h("div", { style: { marginTop: 8 } },
								h("label", { style: { fontSize: 12, opacity: 0.8 } }, t("zaiProject")),
								h("input", {
									value: form.zai.project ?? "",
									onChange: (e) => setField(["zai"], { ...form.zai, project: e.target.value }),
									style: inputStyle
								})
							),
							h("p", { style: { fontSize: 11, opacity: 0.7, margin: "6px 0 0" } }, t("zaiOrgHint"))
						) : null
					) : null,
					id === "xiaomi-token-plan-cn" ? h(react.Fragment, null,
						h("div", { style: { marginTop: 8 } },
							h("label", { style: { fontSize: 12, opacity: 0.8 } }, t("mimoCookie")),
							h("textarea", {
								rows: 2,
								value: form && form.xiaomi ? (form.xiaomi.cookie ?? "") : "",
								onChange: (e) => setField(["xiaomi"], { ...form.xiaomi, cookie: e.target.value }),
								onBlur: (e) => setField(["xiaomi"], { ...form.xiaomi, cookie: normalizeCookieText(e.target.value) }),
								style: { ...inputStyle, resize: "vertical" }
							})
						),
						h("p", { style: { fontSize: 11, opacity: 0.7, margin: "6px 0 0" } }, t("mimoCookieHint")),
						h("button", {
							type: "button",
							style: { ...btnStyle, marginTop: 8 },
							onClick: () => {
								try {
									openLogin(t);
								} catch (error) {
									setNotice({ ok: false, text: `${error instanceof Error ? error.message : String(error)} — ${t("mimoFallback")}` });
								}
							}
						}, t("mimoLogin"))
					) : null
				);
			};
			if (!form) return h("div", { style: { padding: 16 } },
				loadError
					? h("div", null,
						h("p", { style: { color: "#f87171", margin: "0 0 10px", whiteSpace: "pre-wrap" } }, `读取失败：${loadError}`),
						h("button", { type: "button", style: btnStyle, disabled: busy, onClick: () => refresh(true) }, t("retry"))
					)
					: h("div", { style: { opacity: 0.7 } }, t("loading"))
			);
			return h("div", { style: { padding: 16, maxWidth: 720, font: "13px/1.6 sans-serif" } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
					h("h2", { style: { margin: 0, fontSize: 16 } }, t("title")),
					h(StatusLight, { ok: allOk, pending: !result, text: !result ? t("loading") : allOk ? t("lightOk") : t("lightFail") }),
					h("button", { type: "button", style: btnStyle, disabled: busy, onClick: () => refresh(true) }, t(busy ? "refreshing" : "refresh")),
					h("button", { type: "button", style: { ...btnStyle, background: "#3b82f6", borderColor: "#3b82f6", color: "#fff" }, disabled: busy, onClick: onSave }, t(busy ? "saving" : "save")),
					result ? h("span", { style: { fontSize: 11, opacity: 0.7 } }, `${t("lastUpdated")} ${new Date(result.updatedAt).toLocaleString(getLocale())}`) : null
				),
				notice ? h("p", { style: { margin: "8px 0 0", fontSize: 12, color: notice.ok ? "#22c55e" : "#f87171" } }, notice.text) : null,
				h("p", { style: { opacity: 0.75, margin: "10px 0 0" } }, t("hint")),
				// 厂商 tag 栏：点击切换，只显示当前厂商的配置与用量
				h("div", { style: { display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" } },
					PROVIDER_ORDER.map((id) => {
						const entry = entries.find((e) => e.providerId === id);
						const ok = !!(entry && entry.state === "ok");
						const active = tab === id;
						return h("button", {
							key: id, type: "button",
							onClick: () => setTab(id),
							style: {
								...btnStyle,
								display: "inline-flex", alignItems: "center", gap: 7,
								background: active ? "#3b82f6" : "transparent",
								color: active ? "#fff" : "inherit",
								borderColor: active ? "#3b82f6" : "rgba(128,128,128,.5)"
							}
						},
							h("span", { style: { width: 8, height: 8, borderRadius: 99, background: tagColor(entry) } }),
							h("span", null, PROVIDER_META[id].label)
						);
					})
				),
				rowOf(tab, PROVIDER_META[tab])
			);
		}

		// ── 装配 ───────────────────────────────────────────────────────────────
		const name = "dsh-subusage";
		const inject = ["slots", "locale", "remote"];

		function apply(ctx) {
			try {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-subusage: copy dictionaries");
			} catch (error) {
				console.error("[dsh-subusage] locale 注册失败:", error);
			}
			const t = ctx.locale.bind(NS);
			const getLocale = () => ctx.locale.getLocale().active;
			let mounted = Promise.resolve();
			try {
				mounted = ctx.remote.$mount(subUsageRemote);
				ctx.effect(async () => await mounted, "dsh-subusage: mount remotes");
			} catch (error) {
				console.error("[dsh-subusage] remote 挂载失败:", error);
				mounted = Promise.reject(error);
				mounted.catch(() => {});
			}
			/** 远程调用统一入口：等挂载完成后经 remote.subUsage 透传（{ok,value,error} 信封在此拆封）。带挂载重试与 20s 超时。 */
			const call = async (method, ...args) => {
				const deadline = Date.now() + 20000;
				try { await mounted; } catch { /* 挂载失败时统一走下面的超时报错 */ }
				for (;;) {
					// ctx.get 免守卫读取（裸写 ctx.remote.subUsage 需 inject 声明，而该服务由我们自己的 $mount 创建，声明即死锁）
					const service = ctx.get("remote.subUsage");
					if (service !== void 0) {
						const rpc = service[method](...args).then((result) => {
							if (!result.ok) throw result.error;
							return result.value;
						});
						const timeout = new Promise((_, reject) => setTimeout(
							() => reject(new Error(`remote ${method} 调用超时（20 秒）`)),
							Math.max(1, deadline - Date.now())
						));
						return Promise.race([rpc, timeout]);
					}
					if (Date.now() > deadline) throw new Error("remote.subUsage 挂载超时（20 秒）：Host 端 subUsage 服务未就绪");
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
			};
			const readAll = () => call("read");
			const saveSettings = (settings) => call("save", settings);
			/** 单家取数：Host 直连；小米无 Cookie 时走 webview 桥。 */
			const readEntry = (providerId) => async () => {
				const value = await readAll();
				let entry = value.entries.find((e) => e.providerId === providerId);
				if (providerId === "xiaomi-token-plan-cn" && (!entry || entry.state !== "ok")
					&& !(value.settings && value.settings.xiaomi && value.settings.xiaomi.cookie)) {
					try {
						const { windows, extras } = await MimoBridge.fetchUsage();
						entry = {
							providerId,
							label: "MiMo",
							state: "ok",
							windows,
							extras,
							keySource: "session",
							envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY"
						};
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						entry = { providerId, label: "MiMo", state: message.includes("login-required") ? "no-cookie" : "error", error: message, keySource: "session", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" };
					}
				}
				if (!entry) throw new Error("provider not found: " + providerId);
				if (entry.state !== "ok") {
					const err = new Error(entry.error || entry.state);
					err.entry = entry;
					throw err;
				}
				return entry;
			};
			// 设置页：立即注册，不等任何远程/深层服务；故障在组件内以状态灯呈现。
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "subusage",
					order: 22,
					label: () => t("nav"),
					inject: () => ({
						readAll,
						saveSettings,
						openLogin: (tt) => MimoBridge.showLogin(tt),
						t,
						getLocale
					})
				}, SubusageSection));
				console.info("[dsh-subusage] 设置页已注册");
			} catch (error) {
				console.error("[dsh-subusage] 设置页注册失败:", error);
			}
			// 药丸：只等 modelDirectories（会话 store）。
			ctx.inject(["modelDirectories"], (scope) => {
				try {
					scope.slots.inject("conversation.input.right", () => scope.slots.register({
						name: "conversation.input.right",
						id: "subusage-usage",
						order: 1001,
						inject: (sessionId) => ({
							store: scope.modelDirectories.directoryFor(sessionId).store,
							readEntry,
							t,
							getLocale
						})
					}, SubusagePillEntry));
					console.info("[dsh-subusage] 用量药丸已注册");
				} catch (error) {
					console.error("[dsh-subusage] 药丸注册失败:", error);
				}
			});
			console.info("[dsh-subusage] client apply 完成");
		}

		/** 槽包装：先看当前模型的 provider，再分发到对应药丸。 */
		function SubusagePillEntry({ store, readEntry, t, getLocale }) {
			const state = react.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const provider = state.current && state.current.provider;
			const meta = provider === "zai-coding-cn" ? { label: "Z.ai", id: provider }
				: provider === "kimi-coding" ? { label: "Kimi", id: provider }
				: provider === "xiaomi-token-plan-cn" ? { label: "MiMo", id: provider }
				: provider === "opencode-go" ? { label: "OpenCode Go", id: provider }
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
