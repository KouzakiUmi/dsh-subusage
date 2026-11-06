// Magpie 本地网关（yetone/magpie）只读额度与路由上下文。
//
// Magpie 在本机 127.0.0.1:3425 跑一个聚合网关：上游各订阅（Cursor / Codex / Copilot /
// Trae / WorkBuddy / Devin …）的额度卡片由它统一读取并缓存，只读 GET 对本机请求免鉴权
// （跨机才需要 gateway key）。本模块只发 GET：refresh / codex-reset 等写接口一概不碰。
//
// 数据形状（GET /v1/magpie/quotas）：
//   { data: [{ provider, name, kind, plan, user, windows: [{ name, used, remaining, resetsAt,
//     holds, holdsWhy }], readAt, lastServedAt, last, error }] }
//   · used / remaining 是百分比；last:true 标记 30 天内最后实际服务过的卡。
// 路由上下文（GET /v1/magpie/usage/requests）：
//   { rows: [{ agent, req, provider, providerAccount, model, served, status, t }] }
//   · req 是请求方报上的模型 id（auto/* 是路由组），provider / providerAccount 是实际
//     命中的上游与账号——DSH 不发 X-Magpie-Session，这是唯一能在不知道会话 id 时回答
//     「auto 组当前走了谁」的途径。

import { unitIdOf } from "./quota-entry.js";

export const MAGPIE_ID = "magpie";
export const MAGPIE_DEFAULT_ORIGIN = "http://127.0.0.1:3425";

const text = value => typeof value === "string" ? value : "";
const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const object = value => value && typeof value === "object" && !Array.isArray(value);
const pct = value => { const n = num(value); return n === undefined ? undefined : Math.max(0, Math.min(100, n)); };
/** 读数超过一天视为旧数据（网关背景刷新失败或长时间未轮询），如实标 stale。 */
const STALE_MS = 24 * 3600e3;

/** K/M/B 量纲换算：display 里的 "38B"、"450k"、"2.1M" 都折成原数。 */
const MAGNITUDE = { k: 1e3, m: 1e6, b: 1e9 };

/** display 的数-数对："770.4 / 1500"、"30.3B / 38B credits"、"26 / 450k credits"。 */
function parsePair(str) {
	const m = text(str).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([kmb])?\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))([kmb])?\s*(\S[\s\S]*)?$/i);
	if (!m) return null;
	const n = i => Number(m[i]) * (MAGNITUDE[(m[i + 1] || "").toLowerCase()] || 1);
	return { a: n(1), b: n(3), unit: text(m[5]).trim() };
}

/** display 的单数："19685 积分"、"450k"。 */
function parseSingle(str) {
	const m = text(str).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([kmb])?\s*(\S[\s\S]*)?$/i);
	if (!m) return null;
	return { value: Number(m[1]) * (MAGNITUDE[(m[2] || "").toLowerCase()] || 1), unit: text(m[3]).trim() };
}

/** 已知窗口名归一到插件统一档位；认不出的名字按「读数到重置点的时长」粗判，都不给就 period。 */
export function magpieWindowKind(name, resetsAt, readAt) {
	const n = text(name).trim().toLowerCase();
	if (n) {
		if (n === "5h" || /^5\s*(h|hours?|小时)$/.test(n)) return "5h";
		if (/week|周|7\s*d(ays?)?/.test(n)) return "week";
		if (/month|月|30\s*d/.test(n)) return "month";
		if (/^days?$|daily|日|today|今日|24\s*h|1\s*day/.test(n)) return "day";
		if (/hour|小时/.test(n)) return "5h";
	}
	// 用重置时间倒推窗口宽度：读数到重置点不超过窗口长度，取上界档位。
	const ms = Number.isFinite(Date.parse(resetsAt)) && Number.isFinite(Date.parse(readAt)) ? Date.parse(resetsAt) - Date.parse(readAt) : NaN;
	if (!Number.isFinite(ms) || ms <= 0) return "period";
	if (ms <= 6 * 3600e3) return "5h";
	if (ms <= 36 * 3600e3) return "day";
	if (ms <= 8 * 86400e3) return "week";
	if (ms <= 32 * 86400e3) return "month";
	return "period";
}

/**
 * 把 /v1/magpie/quotas 的卡片列表折算成联动条目：一张卡 = linkedAccounts 里一行，
 * 按上游 provider 分组排序，最后服务过的卡标 accountActive。
 * 返回 null 表示「一张卡也没有」（空列表 = 网关在场但没东西可读，与读取失败分开）。
 */
export function normalizeMagpie(value, providerId = MAGPIE_ID, label = "Magpie", now = Date.now()) {
	const cards = Array.isArray(value?.data) ? value.data.filter(object) : [];
	if (!cards.length) return null;
	const rows = cards.map((card, index) => {
		const provider = text(card.provider) || "unknown";
		const name = text(card.name) || provider;
		const user = text(card.user).trim();
		const plan = text(card.plan).trim();
		const kind = text(card.kind).trim();
		const error = text(card.error).trim();
		const readAt = text(card.readAt);
		// 部分卡（Raccoon 等纯余额渠道）没有百分比窗口，余额/别名/到期在卡片顶层。
		const balance = text(card.balance).trim();
		const alias = text(card.alias).trim();
		const until = text(card.until);
		const balanceMatch = balance ? balance.match(/^([¥￥$]?\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(\S.*)?$/) : null;
		const balanceAmount = balanceMatch ? Number(balanceMatch[2]) : NaN;
		const balanceUnit = balanceMatch ? `${balanceMatch[1].trim()}${balanceMatch[3] || ""}`.trim() : "";
		const untilDate = Number.isFinite(Date.parse(until)) ? new Date(until).toISOString().slice(0, 10) : "";
		const stale = Number.isFinite(Date.parse(readAt)) && now - Date.parse(readAt) > STALE_MS;
		const windows = [];
		for (const w of Array.isArray(card.windows) ? card.windows : []) {
			const used = pct(w?.used);
			if (used === undefined) continue;
			const remaining = pct(w?.remaining);
			const resetsAt = text(w?.resetsAt);
			const wname = text(w?.name).trim();
			const wkind = magpieWindowKind(wname, resetsAt, readAt || new Date(now).toISOString());
			const detail = {};
			// 「holdsWhy」是整窗估算的可信度说明：读不出整体时如实给原因，不猜数字。
			if (wname && wname.toLowerCase() !== wkind) detail.note = wname;
			if (text(w?.holdsWhy)) detail.holdsWhy = text(w.holdsWhy);
			// 积分型窗口（SenseNova 等）带着实际数量：display「已用 / 总量」、limit、unit。
			// 如实下发给弹层大字与药丸，不只报一个百分比——剩多少积分才是用户要的数。
			const wunit = text(w?.unit).trim();
			const wlimit = num(w?.limit);
			const wamount = num(w?.amount);
			if (wlimit !== undefined && wlimit > 0) detail.limit = wlimit;
			if (wamount !== undefined) detail.used = wamount;
			if (wunit) detail.unit = wunit;
			// 剩余量按 remaining 百分比回推（上游不给直接数字时与 display 口径一致，不猜）。
			if (wlimit !== undefined && remaining !== undefined) detail.left = Math.round(Math.max(0, wlimit * remaining / 100) * 100) / 100;
			// text:true = 「纯剩余文本」窗（Loomy 永久积分）：display 就一个数（无 limit/已用），
			// 解析出剩余量喂给统一出口，不再把占位的 remaining:100 报成「100%」。
			if (w?.text === true && detail.left === undefined) {
				const dm = parseSingle(w?.display);
				if (dm) detail.left = Math.round(Math.max(0, dm.value) * 100) / 100;
				if (dm?.unit && !detail.unit) detail.unit = dm.unit;
			}
			// display "a / b" 兜底（不限 text:true）：上游给了文本但没给结构化字段时照样算剩余量。
			// 各家语义不统一，拿 remaining 百分比与 amount 交叉判 a 的角色：
			//   amount===a → a 是已用（amount 恒为已用：Trae/SenseNova/WorkBuddy/Loemy 今日积分）→ 余 b−a；
			//   a/b≈remaining% → a 是剩余（Loomy）→ 余 a；
			//   否则按主流口径 a=已用 → 余 b−a（Copilot premium、MiMo 30.3B/38B、OpenDesign、MiniMax）。
			if (detail.left === undefined) {
				const pair = parsePair(w?.display);
				if (pair && pair.b > 0) {
					if (detail.limit === undefined) detail.limit = pair.b;
					const aIsUsed = (wamount !== undefined && Math.abs(wamount - pair.a) <= Math.max(1, pair.a * 0.001))
						|| (remaining === undefined) || (Math.abs(pair.a / pair.b * 100 - remaining) > Math.abs((pair.b - pair.a) / pair.b * 100 - remaining));
					const left = aIsUsed ? pair.b - pair.a : pair.a;
					detail.left = Math.round(Math.max(0, left) * 100) / 100;
					if (aIsUsed && detail.used === undefined) detail.used = Math.round(pair.a * 100) / 100;
					if (pair.unit && !detail.unit) detail.unit = pair.unit;
				} else if (!pair) {
					const disp = text(w?.display).trim();
					const single = parseSingle(disp);
					if (single && detail.left === undefined) detail.left = Math.round(Math.max(0, single.value) * 100) / 100;
					else if (disp && !single) detail.leftText = disp; // "Unlimited" 等非数值口径，原文下发
				}
			}
			// 只有「已解析出数值剩余量」才补单位归属：display 没写单位时，Copilot 是 requests（官方 premium requests 口径），其余认 credits。
			if (detail.left !== undefined && !detail.unit) detail.unit = /copilot/i.test(card?.provider || "") ? "requests" : "credits";
			windows.push({
				kind: wkind,
				// windows[].percent 在插件统一口径里是「已用」；magpie 的 used 同义。
				percent: used,
				status: remaining === 0 || used >= 100 ? "rate-limited" : "ok",
				// rawName/poolName 只服务 antigravity 去重择优（见下方），不进 detail。
				rawName: wname,
				poolName: wname.includes("·") ? wname : "",
				...(Number.isFinite(Date.parse(resetsAt)) ? { resetsAt: new Date(resetsAt).toISOString() } : {}),
				...(Object.keys(detail).length ? { detail } : {})
			});
		}
		// Antigravity 上游把每模型的同一额度按「模型 × 档位」复制下发（Opus/Sonnet/Argon
		// 各 3 档完全相同），另附「池 · 周期」池级名行——同一额度最多出现 4 份。
		// 池结构照抄独立通道 normalizeAntigravityAuthView 的池词汇：non-gemini（Opus/Sonnet
		// 同一个 Claude&GPT 预算）、gemini-argon（Argon 独立池）、gemini。先按行名归池，
		// 再按「池 | 周期 | 已用% | 重置时间」分组合并——不只看百分比与重置时间，否则 Argon 与
		// Gemini 同比例同重置会被误并，缺 resetsAt 时同池 5h/周也会误并。未知池保留原名作为
		// 池身份，不把两个同名比例的新池塞进同一个「未知」桶。组内只留一行：优先池级名行
		// （名字带周期信息，如「Claude & GPT · 7 days」），无池级名时模型级行去 (tier) 后缀留首行。
		// 上游没报的窗（如当前 non-gemini 的 5h）不补造。
		if (provider === "antigravity") {
			const agyPoolOf = (w) => {
				const n = (w.poolName || w.rawName || "").toLowerCase();
				if (/argon/.test(n)) return "gemini-argon";
				if (/claude|opus|sonnet|gpt/.test(n)) return "non-gemini";
				if (/gemini/.test(n)) return "gemini";
				return "";
			};
			const groups = new Map();
			for (const [index, w] of windows.entries()) {
				const base = (w.rawName || "").replace(/\s*\((high|low|medium)\)\s*$/i, "").trim();
				// 已知池用统一词汇；未知「池 · 周期」取池段，未知模型行去掉 tier 后留模型名。
				// 完全没名字的各行保留独立 key，绝不因 percent/resetsAt 相同而合并。
				const label = agyPoolOf(w) || (w.poolName ? w.poolName.split("·")[0].trim() : base);
				const key = `${label || `row-${index}`}|${w.kind}|${w.percent}|${w.resetsAt || ""}`;
				const g = groups.get(key);
				if (!g) groups.set(key, { label, rows: [w] }); else g.rows.push(w);
			}
			const deduped = [];
			for (const { label, rows } of groups.values()) {
				const picked = rows.find(w => (w.rawName || "").includes("·")) || rows[0];
				if (!((picked.rawName || "").includes("·"))) {
					const base = (picked.rawName || "").replace(/\s*\((high|low|medium)\)\s*$/i, "").trim();
					if (base && picked.detail?.note && picked.detail.note !== base) picked.detail = { ...picked.detail, note: base };
				}
				// label 缺席时不能写 `groupLabel: undefined`：windows 行原样进工具输出，
			// undefined 属性值会被 typert 的 lossless-JSON 校验拒掉。
			if (label) picked.groupLabel = label; else delete picked.groupLabel;
				deduped.push(picked);
			}
			windows.length = 0; windows.push(...deduped);
		}
		const extras = [];
		if (plan) extras.push({ kind: "plan", value: plan });
		if (kind && kind !== "subscription") extras.push({ kind: "note", value: kind });
		if (balance) extras.push({ kind: "balance", value: balance });
		if (untilDate) extras.push({ kind: "note", value: `until ${untilDate}` });
		// 原生 quotas：每张卡的窗口带 pool=providerGroup（同一渠道的多卡共池，shared 语义）；
		// 窗口 note / holdsWhy 保留原文说明。余额型卡只给 amount 元素，不补造百分比窗口。
		const quotas = [];
		let qOrder = 0;
		// antigravity 的分池是真独立预算：pool/poolLabel 用窗级 groupLabel（池名），
		// poolScope:"independent" 与独立通道同口径；其余卡 pool=providerGroup（同渠道多卡共池）。
		for (const w of windows) quotas.push({ type: "window", order: qOrder++, period: w.kind, percent: w.percent, ...(w.status === "rate-limited" ? { status: "rate-limited" } : {}),
			pool: provider === "antigravity" ? w.groupLabel || provider : provider,
			poolLabel: provider === "antigravity" ? w.groupLabel || name : name,
			...(provider === "antigravity" ? { poolScope: "independent" } : {}),
			...(w.detail?.used !== undefined ? { used: w.detail.used } : {}),
			...(w.detail?.limit !== undefined ? { limit: w.detail.limit } : {}),
			...(w.detail?.left !== undefined ? { left: w.detail.left } : {}),
			...(w.detail?.leftText ? { leftText: w.detail.leftText } : {}),
			...(w.detail?.unit ? { amount: { value: w.detail.used ?? w.detail.left ?? 0, unit: w.detail.unit, unitId: unitIdOf(w.detail.unit) } } : {}),
			...(w.resetsAt ? { resetsAt: w.resetsAt } : {}), ...(w.detail?.note ? { note: w.detail.note } : {}), ...(w.detail?.holdsWhy ? { holdsWhy: w.detail.holdsWhy } : {}) });
		if (plan) quotas.push({ type: "plan", order: qOrder++, value: plan });
		if (balance) quotas.push({ type: "amount", order: qOrder++, role: "balance", ...(Number.isFinite(balanceAmount) ? { amount: { value: balanceAmount, unit: balanceUnit, unitId: unitIdOf(balanceUnit) } } : {}), text: balance });
		if (kind && kind !== "subscription") quotas.push({ type: "note", order: qOrder++, role: "plan", text: kind });
		if (untilDate) quotas.push({ type: "note", order: qOrder++, text: `until ${untilDate}` });
		return {
			providerId,
			accountId: `magpie:${provider}:${user || name}#${index}`,
			// 卡片 user 是提供方内部 ID；有 alias（掩码账号）用它做显示名，user 仍保留给路由回指。
			account: alias ? `${name} · ${alias}` : user ? `${name} · ${user}` : name,
			...(user ? { user } : {}),
			providerGroup: provider,
			providerName: name,
			state: error && !windows.length && !balance ? "error" : "ok",
			windows,
			extras,
			quotas,
			coverage: error || (!windows.length && !balance) ? "partial" : "complete",
			freshness: stale ? "stale" : "fresh",
			...(card.last === true ? { accountActive: true, accountMode: "auto" } : {}),
			...(text(card.lastServedAt) ? { lastServedAt: text(card.lastServedAt) } : {}),
			...(readAt ? { readAt } : {}),
			...(error ? { error } : {})
		};
	});
	// 按 provider 分组（同 provider 的卡连续排列），组内保持上游顺序。
	const groups = [...new Set(rows.map(row => row.providerGroup))];
	const ordered = groups.flatMap(group => rows.filter(row => row.providerGroup === group));
	const readable = ordered.filter(row => row.state === "ok");
	return {
		providerId, label, state: readable.length ? "ok" : "error", windows: [], extras: [],
		coverage: ordered.every(row => row.state === "ok" && row.coverage === "complete") ? "complete" : "partial",
		freshness: readable.length ? (ordered.some(row => row.freshness === "stale") ? "stale" : "fresh") : "unknown",
		...(readable.length ? { lastSuccessAt: new Date(now).toISOString() } : {}),
		linkedAccounts: ordered,
		...(readable.length ? {} : { error: "Magpie 网关在场但没有可读的额度卡片" })
	};
}

/**
 * 从 usage/requests 的行里提取「当前/最近路由」：
 * - agent == "dsh" 的行才与本插件相关（其他 agent 的请求不进报告）；
 * - req 以 auto/ 或 group/ 开头的是路由组请求，provider / providerAccount / served 是实际命中。
 * cards 是归一化后的 linkedAccounts 行：匹配上时给 cardId 供前端高亮。
 * 返回 null 表示「没有可报告的 DSH 路由」（还没发过请求，或网关日志窗口外）。
 */
export function magpieRouteContext(usage, rows) {
	const list = Array.isArray(usage?.rows) ? usage.rows : [];
	const hits = list.filter(row => row && row.agent === "dsh" && text(row.provider));
	if (!hits.length) return null;
	const latest = hits[0];
	const req = text(latest.req);
	const provider = text(latest.provider);
	const account = text(latest.providerAccount);
	const card = Array.isArray(rows)
		? rows.find(row => row.providerGroup === provider && (!account || (row.user && account.includes(row.user)) || (row.account && row.account === account)))
		: undefined;
	return {
		provider,
		providerName: card?.providerName || provider,
		account,
		model: text(latest.served) || text(latest.model),
		req,
		group: /^auto\/|^group\//.test(req),
		...(num(latest.status) !== undefined ? { status: latest.status } : {}),
		...(text(latest.t) ? { at: text(latest.t) } : {}),
		...(card ? { cardId: card.accountId } : {})
	};
}

/**
 * 额度读取器：三个只读 GET（quotas / usage/requests / concurrency）。
 * `?kept=1` 取网关已缓存的读数，不向厂商重复请求；force 目前同样走 kept=1——
 * 网关自己决定何时去上游（POST refresh 有 30 秒节流），我们不替它刷新。
 * 60 秒内复用快照，与 EAC / 桌面渠道同口径。
 */
export class MagpieUsageReader {
	constructor({ fetcher, origin = MAGPIE_DEFAULT_ORIGIN, now = Date.now } = {}) {
		if (typeof fetcher !== "function") throw new TypeError("MagpieUsageReader 需要 fetcher");
		this.fetcher = fetcher; this.origin = origin; this.now = now;
		this.cache = new Map(); this.pending = new Map(); this.versions = new Map(); this.disposed = false;
	}
	async fetchJson(path, signal) {
		const url = new URL(path, this.origin).href;
		const response = await this.fetcher(url, { headers: { accept: "application/json" }, signal });
		if (!response || !response.ok) {
			const status = response && typeof response.status === "number" ? response.status : 0;
			const error = new Error(`Magpie 网关返回 HTTP ${status}`);
			error.code = "subusage/transport"; error.status = status;
			throw error;
		}
		const body = await response.json().catch(() => null);
		if (body === null || typeof body !== "object") {
			const error = new Error("Magpie 网关没有返回 JSON");
			error.code = "subusage/response";
			throw error;
		}
		return body;
	}
	/** 读「已缓存的额度卡片」：kept=1 不触发上游刷新，用于轮询与工具查询。 */
	async readCards({ kept = true, signal } = {}) {
		return this.fetchJson(kept ? "/v1/magpie/quotas?kept=1" : "/v1/magpie/quotas", signal);
	}
	async readUsage({ signal } = {}) {
		return this.fetchJson("/v1/magpie/usage/requests?period=30d&limit=50", signal);
	}
	async readConcurrency({ signal } = {}) {
		return this.fetchJson("/v1/magpie/concurrency", signal);
	}
	/** 模型目录：auto/* 组模型 → owned_by 分组。只读 OpenAI 标准 GET。 */
	async readModels({ signal } = {}) {
		return this.fetchJson("/v1/models", signal);
	}
	/** 一次性快照：卡片是基础（失败即本次读取失败），路由上下文降级为空（不连累卡片）。 */
	read(force = false, { signal } = {}) {
		if (this.disposed) throw new Error("Magpie 读取器已卸载");
		const cached = this.cache.get("snapshot"), time = this.now();
		if (!force && this.pending.has("snapshot")) return this.pending.get("snapshot");
		if (!force && cached && time >= cached.at && time - cached.at < 60000) return structuredClone(cached.value);
		const version = (this.versions.get("snapshot") ?? 0) + 1; this.versions.set("snapshot", version);
		const task = Promise.resolve().then(async () => {
			const [cards, usage, concurrency, models] = await Promise.all([
				this.readCards({ kept: true, signal }),
				this.readUsage({ signal }).catch(() => ({ rows: [] })),
				this.readConcurrency({ signal }).catch(() => ({ active: [] })),
				this.readModels({ signal }).catch(() => ({ data: [] }))
			]);
			return { cards, usage, concurrency, models };
		}).then(value => {
			if (!this.disposed && this.versions.get("snapshot") === version) {
				this.cache.set("snapshot", { at: this.now(), value: structuredClone(value) });
			}
			return value;
		}).finally(() => { if (this.pending.get("snapshot") === task) this.pending.delete("snapshot"); });
		this.pending.set("snapshot", task);
		return task;
	}
	dispose() { this.disposed = true; this.cache.clear(); this.pending.clear(); this.versions.clear(); }
}
