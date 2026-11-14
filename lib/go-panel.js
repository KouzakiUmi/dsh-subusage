// dsh-subusage —— DSH Go 原生面板（对话详情「插件」页签）的视图与数据构造。
//
// 桌面网页版用输入区药丸 + 弹层；DSH Go 上药丸不显示（Client 检测岛标记后不注册
// conversation.input.right），额度改由这里的声明式面板承担。面板数据来自同一份
// QuotaEntry（service.quota()），只把「收起药丸+弹层」需要的字段压成 ≤32KiB 的
// 视图模型：状态行、窗口行（最紧窗高亮）、金额/说明行。纯函数、无 IO，方便隔离测试。
//
// ROUTE_USAGE_ID 与 lib/client.js 的 ROUTE_PROVIDER_ALIAS 是同一张事实表的两端：
// 客户端把「模型路由 provider id」归并到订阅入口 id，这里在宿主侧做同一件事。
// test-go-panel.mjs 从 client.js 源码抽出该表做逐键比对，两端漂移会直接失败。

/** 模型路由 provider id → 本插件订阅入口 id（含联动项）。 */
export const ROUTE_USAGE_ID = {
	// 见 lib/client.js ROUTE_PROVIDER_ALIAS 的注释：旧插件与第三方提供方插件注册的
	// 路由 id 必须归并到同一个订阅入口，否则装过旧路由的用户会突然看不到用量。
	"ark-agent-plan-cn": "arkcli-agent-plan",
	"ark-coding-plan-cn": "arkcli-coding-plan",
	"volcengine-agent-plan": "arkcli-agent-plan",
	"volcengine-coding-plan": "arkcli-coding-plan",
	"opendesign-corouter-plan": "opendesign",
	"opendesign-corouter-paid": "opendesign",
	"deepseek-official": "deepseek-account",
	"google-antigravity": "antigravity",
	qoder: "ofm-qoder", qodercn: "ofm-qodercn",
	lobsterai: "ofm-lobsterai", cline: "ofm-cline", zcode: "ofm-zcode", gemini: "ofm-gemini",
	// 自建 New API / one-api 系是同一类自建网关（与 Client ROUTE_PROVIDER_ALIAS 同口径）。
	"new-api": "newapi", "one-api": "newapi",
	magpie: "magpie", "magpie-responses": "magpie", "magpie-anthropic": "magpie"
};

/** 订阅入口 id → 面板显示名（zh 默认，en 走 label）。联动项只有简称表。 */
export const LINKED_LABELS = {
	antigravity: "Antigravity", trae: "Trae", "trae-global": "Trae Global", "trae-enterprise": "Trae Enterprise",
	workbuddy: "WorkBuddy", "workbuddy-global": "WorkBuddy Global",
	raccoon: "小浣熊", loomy: "Loomy", magpie: "Magpie",
	"ofm-raccoon": "小浣熊 · OFM", "ofm-loomy": "Loomy · OFM",
	"ofm-qoder": "Qoder · OFM", "ofm-qodercn": "Qoder CN · OFM",
	"ofm-lobsterai": "LobsterAI · OFM", "ofm-cline": "Cline · OFM",
	"ofm-zcode": "ZCode · OFM", "ofm-gemini": "Gemini · OFM",
	"ofm-trae": "TRAE · OFM", "ofm-minimax": "MiniMax Code · OFM"
};

const KIND_ZH = { "5h": "5 小时", day: "每日", week: "每周", month: "每月", "7d": "7 天", rolling: "滚动", sub: "订阅", period: "周期" };
const KIND_EN = { "5h": "5 hours", day: "Daily", week: "Weekly", month: "Monthly", "7d": "7 days", rolling: "Rolling", sub: "Subscription", period: "Period" };

const STATE_ZH = { ok: "已获取", error: "查询失败", disabled: "已关闭", "no-key": "未配置凭据", "no-cookie": "未配置 Cookie" };
const STATE_EN = { ok: "ok", error: "query failed", disabled: "disabled", "no-key": "no credential", "no-cookie": "no cookie" };

const zhOf = (locale) => !String(locale ?? "").toLowerCase().startsWith("en");

export function goPanelWords(locale) {
	const zh = zhOf(locale);
	return {
		modelLabel: zh ? "当前模型" : "Model",
		stateLabel: zh ? "状态" : "State",
		refresh: zh ? "刷新" : "Refresh",
		noData: zh ? "未检测到该订阅的用量" : "No usage reported for this subscription",
		noModel: zh ? "本对话还没有模型路由记录" : "No model route recorded in this chat yet",
		unsupported: zh ? "该模型提供商没有订阅用量入口" : "No subscription usage entry for this provider",
		serviceOff: zh ? "订阅用量服务不可用" : "Usage service unavailable",
		queryFailed: zh ? "额度查询失败，点击刷新重试" : "Quota query failed — tap refresh to retry",
		account: zh ? "账户" : "Account",
		live: zh ? "当前调用" : "Now serving",
		hit: zh ? "上次命中" : "Last hit",
		balance: zh ? "余额" : "Balance",
		limited: zh ? "已限流" : "Rate limited",
		blocked: zh ? "连带限流" : "Blocked (cascade)",
		left: zh ? "余" : "left",
		updated: zh ? "更新于" : "Updated",
		stale: zh ? "旧数据" : "stale",
		reset: zh ? "重置" : "Resets",
		state: (state) => (zh ? STATE_ZH : STATE_EN)[state] ?? state,
		kind: (kind) => (zh ? KIND_ZH : KIND_EN)[kind] ?? kind,
	};
}

/**
 * 从会话事件还原当前模型选择：对齐 dsh-api-session-controller 的
 * model-selection 投影——`model/selection` 是 pending，命中下一次
 * `request/header` 就落地为 lastUsed；当前值 = pending ?? lastUsed。
 * @param {Array<{type:string,data?:any}>} [events] snapshotEvents() 的事件列表。
 * @returns {{provider:string,model:string,reasoningEffort?:string}|null}
 */
export function goPanelModel(events) {
	if (!Array.isArray(events)) return null;
	const same = (a, b) => a === b || (a && b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort);
	const pick = (sel) => {
		const provider = typeof sel?.provider === "string" ? sel.provider : "";
		const model = typeof sel?.model === "string" ? sel.model : "";
		if (!provider || !model) return null;
		const out = { provider, model };
		if (typeof sel.reasoningEffort === "string" && sel.reasoningEffort) out.reasoningEffort = sel.reasoningEffort;
		return out;
	};
	let lastUsed = null, pending = null;
	for (const event of events) {
		if (event?.type === "model/selection") {
			const sel = pick(event.data);
			if (sel && !same(sel, pending)) pending = sel;
			continue;
		}
		if (event?.type !== "request/header") continue;
		const sel = pick(event.data?.header?.config);
		if (!sel) continue;
		lastUsed = same(sel, lastUsed) ? lastUsed : sel;
		if (same(pending, sel)) pending = null;
	}
	return pending ?? lastUsed;
}

/**
 * 把路由 provider id 归并到订阅入口 id：显式 RouteBinding / 实例 routeIds > 手动映射 > 路由别名表 > 原名。
 * 与 Client 的 resolved 规则一致；认不出的原名原样返回（quota() 会走全名解析兜底）。
 * @param {string} provider 模型选择里的 provider id。
 * @param {{providerMappings?: Record<string, string[]>, manualMatching?: boolean}} [visibility] 设置里的手动绑定。
 * @param {{routeBindings?: Record<string, string>, instances?: Array<{id:string, routeIds?:string[]}>}} [settings]
 */
export function goPanelUsageId(provider, visibility, settings) {
	const id = String(provider ?? "").trim();
	if (!id) return "";
	// routeBindings 是手动层：manualMatching 关闭时保留不生效；实例 routeIds 不受门控。
	if (visibility?.manualMatching === true) {
		const rb = settings?.routeBindings?.[id];
		if (typeof rb === "string" && rb.trim()) {
			return rb.trim();
		}
		if (rb && typeof rb === "object" && typeof rb.targetId === "string" && rb.targetId.trim()) {
			return rb.targetId.trim();
		}
	}
	if (Array.isArray(settings?.instances)) {
		const boundInst = settings.instances.find(inst => inst?.id === id || (Array.isArray(inst?.routeIds) && inst.routeIds.includes(id)));
		if (boundInst) return boundInst.id;
	}
	if (visibility?.manualMatching === true) {
		for (const [usageId, routes] of Object.entries(visibility.providerMappings ?? {})) {
			if (Array.isArray(routes) && routes.includes(id)) return usageId;
		}
	}
	// Magpie 分组绑定的键是路由 id：绑定在场即归到 magpie 联动项（与 Client 药丸同口径，
	// 自建 magpie-* 路由不用逐个加 routeBinding）；优先于内置别名，不受 manualMatching 门控。
	const magpieBound = typeof settings?.magpieRoutes?.[id] === "string";
	return magpieBound ? "magpie" : (ROUTE_USAGE_ID[id] ?? id);
}

/** 面板显示名：订阅入口优先用 Host 表 label（zh 只翻少数已知家），联动项走简称表，自定义实例取其 label。 */
export function goPanelProviderName(usageId, providers, locale, settings) {
	const id = String(usageId ?? "").trim();
	if (!id) return "";
	const label = providers?.[id]?.label;
	if (label) return label;
	if (LINKED_LABELS[id]) return LINKED_LABELS[id];
	if (Array.isArray(settings?.instances)) {
		const inst = settings.instances.find(item => item?.id === id);
		if (inst?.label) return inst.label;
	}
	return id;
}

const remainingOf = (w) => {
	if (!Number.isFinite(w?.percent)) return null;
	return Math.max(0, Math.min(100, Math.round(100 - w.percent)));
};

const toneOf = (w) => {
	const left = remainingOf(w);
	if (left === null) return undefined;
	if (w?.status === "rate-limited" || left <= 9) return "bad";
	if (left <= 29) return "warn";
	return undefined;
};

const compactAmount = (v) => Math.abs(v) >= 1000 ? `${Math.round(v).toLocaleString("en-US")}` : `${Math.round(v * 100) / 100}`;

/** 窗口行名：优先上游原名（detail.note），没有原名才用周期档位词。 */
export function goPanelWindowName(w, locale) {
	const words = goPanelWords(locale);
	const note = typeof w?.detail?.note === "string" ? w.detail.note.trim() : "";
	const group = typeof w?.groupLabel === "string" ? w.groupLabel.trim() : "";
	const name = note || words.kind(w?.kind);
	return group ? `${group} · ${name}` : name;
}

const groupIdOf = (value) => String(value || "").replace(/^(?:auto|group)\//i, "");

/** 模型 id 比较键：去掉 magpie 的 auto/ group/ 网关前缀再小写（见 ROUTE_USAGE_ID 旁的说明域）。 */
const routeModelKey = (value) => String(value || "").trim().replace(/^(?:auto|group)\//i, "").toLowerCase();

/**
 * 这条路由遥测是不是**别的模型**的请求：magpie 的 concurrency 与 usage 日志不区分会话
 * （DSH 不发 X-Magpie-Session），切到另一个对话后它们往往属于**另一个对话正在跑**的请求。
 * 拿它当本会话的命中卡，就会把别的对话的上游渠道画到本会话头上。`req` 缺席时无法证伪，
 * 维持原行为（认它）。与 lib/client.js 药丸的 foreignRoute 同口径。
 */
const foreignRoute = (rc, modelId) => {
	const mine = routeModelKey(modelId);
	const theirs = routeModelKey(rc?.req);
	return !!mine && !!theirs && mine !== theirs;
};

/**
 * 模型 → 上游分组（与客户端药丸同口径）：模型 id 的 `provider/` 前缀（kimi/k3.1-pro）
 * 直接是分组；`auto/*`、`group/*` 组模型没有前缀时查快照里 /v1/models 的 owned_by
 * （先完整 id、再认组名后缀）。认不出返回 ""。
 */
function modelOwnedByGroup(modelId, accounts, models) {
	const id = String(modelId || "").trim();
	if (!id) return "";
	const groups = new Set(accounts.map(a => a?.providerGroup).filter(Boolean));
	const prefix = id.match(/^([a-z0-9][a-z0-9._-]*)\//i)?.[1]?.toLowerCase() || "";
	if (prefix && groups.has(prefix)) return prefix;
	const wanted = groupIdOf(id);
	if (!wanted || !Array.isArray(models) || !models.length) return "";
	const byModel = models.find(m => String(m?.id || "") === id)
		?? models.find(m => groupIdOf(m?.id) === wanted);
	return String(byModel?.owned_by || "").trim().toLowerCase();
}

/** 模型 → 额度池匹配器（Antigravity 分池卡）：与客户端 poolForModel 同口径。 */
export function goPanelPoolMatcher(model) {
	const m = String(model || "").toLowerCase();
	if (!m) return null;
	const argon = /argon/.test(m);
	const claudeGpt = !argon && /claude|opus|sonnet|gpt/.test(m);
	const gemini = /gemini/.test(m);
	return (w) => {
		const pool = String(w?.groupLabel || "");
		if (!pool) return null; // 非池行不参与匹配
		if (/argon/i.test(pool)) return argon;
		if (/non-gemini|claude/i.test(pool)) return claudeGpt;
		if (/gemini/i.test(pool)) return gemini && !argon;
		return m.includes(pool.toLowerCase());
	};
}

/**
 * 聚合卡（Magpie）的「当前调用的上游卡」，与客户端药丸同一命中顺序：
 * 本会话的在途 live > 当前模型归组 > 本会话的上次路由 provider；`cardId` 回指只在同组时接受
 * （旧 Host/迟到快照可能把上一渠道的 cardId 拼到 live provider 上，跨组一律拒绝）。
 * 属于别的模型的遥测（另一个对话正在跑的请求）不参与命中，见 foreignRoute。
 * 返回 { card, provider, via: "live"|"model"|"recent"|"card" } 或 null。
 */
export function goPanelServingCard(entry, modelId) {
	const accounts = Array.isArray(entry?.linkedAccounts) ? entry.linkedAccounts : [];
	if (!accounts.length) return null;
	const raw = (entry?.routeContext && typeof entry.routeContext === "object") ? entry.routeContext : null;
	const rc = raw !== null && foreignRoute(raw, modelId) ? null : raw;
	const groups = new Set(accounts.map(a => a?.providerGroup).filter(Boolean));
	const ownedBy = modelOwnedByGroup(modelId, accounts, entry?.models);
	let provider = "", via = null;
	if (rc?.live) { provider = String(rc.provider || ""); via = "live"; }
	else if (ownedBy && groups.has(ownedBy)) { provider = ownedBy; via = "model"; }
	else { provider = String(rc?.provider || ""); via = provider ? "recent" : null; }
	if (!provider) return null;
	if (rc?.cardId && String(rc.provider) === provider) {
		const card = accounts.find(a => a?.accountId === rc.cardId
			&& (!a.providerGroup || a.providerGroup === provider));
		if (card) return { card, provider, via: via === "live" ? "live" : "card" };
	}
	const card = accounts.find(a => a?.providerGroup === provider);
	return card ? { card, provider, via } : null;
}

/**
 * 面板的视图模型。输入一份 QuotaEntry（service.quota() 里的单条 providers[] 元素，
 * 可能带 linkedAccounts）和当前模型，输出绑定到 goPanelView 的 data。
 * 多账号取行顺序：聚合卡服务卡（当前模型命中的上游）> 激活行 > 第一行 > 顶层；
 * 服务卡再按当前模型收窄到额度池（分池卡同池窗口优先）。
 * @param {{usageId:string, name:string, model:string}} ctx 订阅入口、显示名、模型名。
 * @param {object|null|undefined} entry 命中条目；undefined 表示还没读到。
 * @param {{locale?:string, now?:number}} [opts]
 */
export function goPanelData(ctx, entry, opts = {}) {
	const words = goPanelWords(opts.locale);
	const now = Number.isFinite(opts.now) ? opts.now : Date.now();
	const data = {
		provider: ctx.name || "",
		model: ctx.model || "",
		state: "unknown",
		stateText: "",
		headline: "",
		caption: "",
		note: entry === undefined ? "" : words.noData,
		updated: "",
		windows: [],
		extras: [],
	};
	if (entry === undefined) return data;
	if (!entry || typeof entry !== "object") {
		data.state = "error"; data.stateText = words.state("error"); data.headline = words.queryFailed; data.note = words.queryFailed;
		return data;
	}
	// 多账号行里选「当前调用的上游卡」：聚合卡（Magpie）按 routeContext/模型归组命中
	// servingCard；没有路由口径的条目照旧取激活行 > 第一行 > 顶层。
	const accounts = Array.isArray(entry.linkedAccounts) ? entry.linkedAccounts : [];
	const serving = goPanelServingCard(entry, ctx.model);
	const scope = serving?.card ?? accounts.find(a => a?.accountActive === true) ?? accounts[0] ?? entry;
	data.state = typeof entry.state === "string" ? entry.state : "unknown";
	data.stateText = words.state(data.state);
	if (scope !== entry && scope && typeof scope === "object") {
		// 聚合卡（Magpie）用卡片自报的组名当标题；普通多账号条目沿用「账户 …」。
		const group = scope.providerName || scope.providerGroup || "";
		const tag = serving?.via === "live" ? words.live : (serving && serving.via !== "model" ? words.hit : "");
		const who = group || (scope.account || scope.accountId ? `${words.account} ${scope.account || scope.accountId}` : "");
		data.caption = [who, tag].filter(Boolean).join(" · ");
	}
	// 分池卡（Antigravity 等 groupLabel 池）按当前模型收窄窗口；认不出池时该卡窗口照旧全给。
	// 属于别的模型的遥测（另一个对话的请求）不参与池收窄，见 foreignRoute。
	const rawRc = entry?.routeContext && typeof entry.routeContext === "object" ? entry.routeContext : null;
	const rc = rawRc !== null && foreignRoute(rawRc, ctx.model) ? null : rawRc;
	// DisplayProfile 投影优先：hidden/labels/orders 只改变展示，不改 quotas 事实。
	let windowsSrc = Array.isArray(scope?.displayWindows) ? scope.displayWindows : (Array.isArray(scope?.windows) ? scope.windows : []);
	const poolMatch = serving
		? goPanelPoolMatcher(serving.via === "live" && rc?.model ? rc.model : (ctx.model || rc?.model))
		: null;
	if (poolMatch) {
		const narrowed = windowsSrc.filter(w => poolMatch(w) === true);
		if (narrowed.length) windowsSrc = narrowed;
	}
	if (typeof entry.updatedAt === "string") {
		const at = new Date(entry.updatedAt);
		if (Number.isFinite(at.getTime())) {
			const pad = n => String(n).padStart(2, "0");
			data.updated = `${words.updated} ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}${entry.freshness === "stale" ? ` · ${words.stale}` : ""}`;
		}
	}
	const windows = windowsSrc;
	const extras = Array.isArray(scope?.displayExtras) ? scope.displayExtras : (Array.isArray(scope?.extras) ? scope.extras : []);
	data.windows = windows.slice(0, 8).map((w) => {
		const left = remainingOf(w);
		const trailing = w?.status === "rate-limited" ? (w?.cascade ? words.blocked : words.limited)
			: left !== null ? `${words.left} ${left}%` : "";
		const parts = [];
		const d = w?.detail ?? {};
		if (Number.isFinite(d.left) && d.left > 0) parts.push(`${words.left} ${compactAmount(d.left)}${d.unit ? ` ${d.unit}` : ""}`);
		else if (Number.isFinite(d.used) && Number.isFinite(d.limit) && d.limit > 0) parts.push(`${compactAmount(d.used)} / ${compactAmount(d.limit)}${d.unit ? ` ${d.unit}` : ""}`);
		if (w?.resetsAt) {
			const at = new Date(w.resetsAt);
			if (Number.isFinite(at.getTime()) && at.getTime() > now - 86400000) {
				const pad = n => String(n).padStart(2, "0");
				parts.push(`${words.reset} ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`);
			}
		}
		const row = { title: goPanelWindowName(w, opts.locale), trailing };
		const subtitle = parts.join(" · ");
		if (subtitle) row.subtitle = subtitle;
		const tone = toneOf(w);
		if (tone) row.tone = tone;
		return row;
	});
	data.extras = extras.slice(0, 8).map(x => ({ label: typeof x?.kind === "string" ? x.kind : "note", value: String(x?.value ?? "") })).filter(x => x.value);
	// 收起药丸口径的标题：最紧窗剩余 > DisplayProfile 主指标 > 余额 > 状态。
	const worst = windows.filter(w => Number.isFinite(w?.percent)).sort((a, b) => b.percent - a.percent)[0];
	const limited = windows.find(w => w?.status === "rate-limited" && !w?.cascade);
	const balance = extras.find(x => x?.kind === "balance" || x?.kind === "monthly-balance");
	if (limited) data.headline = words.limited;
	else if (typeof entry?.displayPrimary?.text === "string" && entry.displayPrimary.text) data.headline = entry.displayPrimary.text;
	else if (worst) data.headline = `${words.left} ${remainingOf(worst)}%`;
	else if (balance) data.headline = `${words.balance} ${String(balance.value ?? "")}`;
	else data.headline = data.stateText || "—";
	data.note = data.headline && (windows.length || extras.length)
		? (limited ? words.limited : "")
		: data.note;
	return data;
}

/**
 * 面板视图（声明式组件树，v1 目录）：状态行 + 窗口列表 + 金额/说明 + 更新时间 + 刷新。
 * 全部数值走 data 绑定，刷新后 App 收到补丁而不是新视图。
 */
export function goPanelView(scope, caps) {
	const words = goPanelWords(caps?.locale);
	return {
		type: "stack",
		children: [
			{ type: "row", children: [
				{ type: "metric", label: words.modelLabel, value: { $: "data.model" } },
				{ type: "metric", label: words.stateLabel, value: { $: "data.stateText" } },
			] },
			{ type: "text", text: { $: "data.headline" }, style: { weight: "bold" } },
			{ type: "text", text: { $: "data.caption" }, tone: "muted" },
			{ type: "list", items: { $: "data.windows" } },
			{ type: "keyValue", items: { $: "data.extras" } },
			{ type: "text", text: { $: "data.note" }, tone: "muted" },
			{ type: "text", text: { $: "data.updated" }, tone: "muted" },
			{ type: "actions", items: [{ label: words.refresh, icon: "restart", action: "refresh" }] },
		],
	};
}
