/**
 * 联动条目的「来源」模型：把一个渠道原来隐式的回退链，拆成可逐项停用、可按路由单独绑定的来源。
 *
 * 背景：`raccoon` / `loomy` / `trae` / `workbuddy` 各自有本机直取、独立插件与 Our Free Model 等多条读法。
 * 自动回退的问题是用户无法控制——主来源没数据时，界面会静默换成另一份（可能账号不同、单位不同）的读数。现在改成：
 *
 *  - 每个来源有稳定 key（`local` / `plugin` / `ofm` / `magpie`），可逐项停用；
 *  - 每条模型路由可以绑定「某条目的某个来源」，绑定即只读那一个；
 *  - **未绑定**时只走该条目的「主来源组」（同属本机直读的 local + plugin），不再自动补位到
 *    OFM —— 也就是说，缺数据就如实报缺席，不换一份别的账号的数字顶上。
 *
 * 本模块是纯函数，不读宿主状态：可用来源由调用方传入的条目元数据推导。
 */

/** 来源 key 的固定顺序：顺序即「未绑定时的尝试顺序」的依据。 */
export const SOURCE_KEYS = Object.freeze(["local", "plugin", "ofm", "magpie"]);

export const SOURCE_LABELS = Object.freeze({
	local: "本机直取",
	plugin: "独立插件",
	ofm: "Our Free Model",
	magpie: "Magpie 网关"
});

/** 独立插件的 via 值：它们读的是兄弟插件自己的路由（页面代取或宿主直读）。 */
const PLUGIN_VIA = new Set(["desktop-route", "trae-route", "workbuddy-route", "agyQuota"]);
/** 哪些 via 背后有 OFM 的同一批账号可当备选来源（Antigravity 不在 OFM 覆盖范围内）。 */
const OFM_CAPABLE_VIA = new Set(["desktop-route", "trae-route", "workbuddy-route"]);

/**
 * 某条目**可以**提供哪些来源（按 SOURCE_KEYS 顺序）。
 * - `local`：本机凭据库里有该渠道账号，本插件自己调上游（见 lib/local-usage.js）；
 * - `plugin`：兄弟插件的登录态（Antigravity 的两个提供方通道归为同一来源）；
 * - `ofm`：Our Free Model 的账号索引；
 * - `magpie`：本机 Magpie 网关。
 */
export function linkedSourceKeys(meta, { id, localChannels } = {}) {
	if (!meta || typeof meta !== "object") return [];
	const keys = [];
	const linkedId = id ?? meta.id ?? "";
	const localChannel = localChannels && ((linkedId && Object.hasOwn(localChannels, linkedId)) || (meta.channel && Object.hasOwn(localChannels, meta.channel)));
	if (localChannel) keys.push("local");
	if (PLUGIN_VIA.has(meta.via)) keys.push("plugin");
	// ofm-only 条目（`ofm-*`）与「本机插件类」条目都可以把 OFM 当作一个可选来源。
	if (meta.via === "ofm" || OFM_CAPABLE_VIA.has(meta.via)) keys.push("ofm");
	if (meta.via === "magpie") keys.push("magpie");
	return keys.filter((key, index) => keys.indexOf(key) === index && SOURCE_KEYS.includes(key));
}

/**
 * 未绑定路由时的「主来源组」：本机直取（若该渠道支持）+ 该条目**原生**的那一级，
 * **不含** OFM 的额外补位（`ofm-*` 条目的原生那一级本来就是 OFM）。
 *
 * 这就是「不自动回退」的落点：主来源缺席时如实报缺席，不换一份别的账号的读数顶上。
 * 注意 `local` 与原生来源不是回退关系——两者读的是**同一批本机账号**（直取 vs 插件路由），
 * 保留原顺序即可；跨账号边界的补位（→ OFM）才需要用户显式绑定。
 */
export function defaultSourceOrder(meta, { id, localChannels } = {}) {
	if (!meta || typeof meta !== "object") return [];
	const available = linkedSourceKeys(meta, { id, localChannels });
	const native = meta.via === "ofm" ? "ofm" : meta.via === "magpie" ? "magpie" : PLUGIN_VIA.has(meta.via) ? "plugin" : undefined;
	const order = [];
	if (available.includes("local")) order.push("local");
	if (native && available.includes(native)) order.push(native);
	return order;
}

/** 停用表 → 某条目被停用的来源集合（容错：格式不对按「没停用」处理）。 */
function disabledOf(prefs, linkedId) {
	const list = prefs?.disabled?.[linkedId];
	return Array.isArray(list) ? new Set(list.filter(key => typeof key === "string")) : new Set();
}

/**
 * 解出某条目在某条路由上应尝试的来源（有序、已剔除停用项）。
 *
 * - 路由绑定命中该条目 → 只返回绑定的那一个来源（除非它被停用或该条目不支持它 → 空）；
 * - 否则返回主来源组里未被停用的来源。
 *
 * 返回空数组表示「这轮没有可用来源」，由调用方决定如何说明（缺席指引），不要自己猜一个顶上。
 */
export function resolveLinkedSources(meta, prefs, routeId, { id, localChannels } = {}) {
	if (!meta) return [];
	const linkedId = id ?? meta.id ?? "";
	const available = new Set(linkedSourceKeys(meta, { id: linkedId, localChannels }));
	const disabled = disabledOf(prefs, linkedId);
	const bindings = prefs?.bindings;
	const bound = routeId && bindings && typeof bindings === "object" ? bindings[routeId] : undefined;
	if (bound && bound.linkedId === linkedId && typeof bound.source === "string") {
		return available.has(bound.source) && !disabled.has(bound.source) ? [bound.source] : [];
	}
	return defaultSourceOrder(meta, { id: linkedId, localChannels }).filter(key => available.has(key) && !disabled.has(key));
}

/**
 * 校验并归一化 `settings.sourcePrefs`（对外的唯一入口）。
 * - `disabled`：`{ [linkedId]: string[] }`，只保留该条目支持的来源 key、去重、最多 8 个；
 * - `bindings`：`{ [routeId]: { linkedId, source } }`，条目与来源都必须真实存在，最多 64 条；
 *   格式坏掉的整体报错（与 routeBindings 同口径：宁可拒绝也不静默丢用户的绑定）。
 */
export function validateSourcePrefs(raw, { linkedIds, sourcesOf } = {}) {
	const out = { disabled: {}, bindings: {} };
	if (raw === undefined || raw === null) return out;
	if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("sourcePrefs 必须是键值对象");
	const ids = linkedIds instanceof Set ? linkedIds : null;
	const supported = id => {
		const keys = typeof sourcesOf === "function" ? sourcesOf(id) : null;
		return Array.isArray(keys) ? keys : SOURCE_KEYS;
	};
	if (raw.disabled !== undefined && raw.disabled !== null) {
		if (typeof raw.disabled !== "object" || Array.isArray(raw.disabled)) throw new Error("sourcePrefs.disabled 必须是键值对象");
		for (const [rawId, list] of Object.entries(raw.disabled)) {
			const id = String(rawId ?? "").trim();
			if (!id || (ids && !ids.has(id))) throw new Error(`来源停用表里的条目「${id.slice(0, 32)}」不是联动项`);
			if (!Array.isArray(list)) throw new Error(`条目「${id}」的停用来源必须是数组`);
			const keys = supported(id);
			const kept = [...new Set(list.filter(key => typeof key === "string" && keys.includes(key)))];
			if (kept.length) out.disabled[id] = kept;
		}
	}
	if (raw.bindings !== undefined && raw.bindings !== null) {
		if (typeof raw.bindings !== "object" || Array.isArray(raw.bindings)) throw new Error("sourcePrefs.bindings 必须是键值对象");
		const entries = Object.entries(raw.bindings);
		if (entries.length > 64) throw new Error("sourcePrefs.bindings 最多支持 64 条路由绑定");
		for (const [rawRouteId, binding] of entries) {
			const routeId = String(rawRouteId ?? "").trim();
			if (!routeId || routeId.length > 64 || /[\s\r\n]/.test(routeId)) throw new Error(`路由 ID「${routeId.slice(0, 32)}」格式无效`);
			if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`路由「${routeId}」的来源绑定必须是对象`);
			const linkedId = typeof binding.linkedId === "string" ? binding.linkedId.trim() : "";
			const source = typeof binding.source === "string" ? binding.source.trim() : "";
			if (!linkedId || (ids && !ids.has(linkedId))) throw new Error(`路由「${routeId}」绑定了未知的条目「${linkedId.slice(0, 32)}」`);
			if (!supported(linkedId).includes(source)) throw new Error(`条目「${linkedId}」不支持来源「${source}」`);
			out.bindings[routeId] = { linkedId, source };
		}
	}
	return out;
}
