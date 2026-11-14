/**
 * RouteBinding（路由绑定模型）：
 * - 统一管理模型路由（routeId）到目标额度实例/提供商（targetId）及可选账户/Key（accountId / keyRef）的映射；
 * - 100% 兼容既有 visibility.manualMatching 与 visibility.providerMappings；
 * - 严格保证单一路由唯一性（同一 routeId 只能绑定到一个目标），修改绑定不触发额度缓存失效。
 */

export function validateRouteBindings(raw, validTargetIds = null) {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("routeBindings 必须是键值对象");
	}
	const entries = Object.entries(raw);
	if (entries.length > 64) {
		throw new Error("routeBindings 最多支持 64 条路由绑定");
	}
	const out = {};
	for (const [rawRouteId, binding] of entries) {
		const routeId = String(rawRouteId ?? "").trim();
		if (!routeId || routeId.length > 64 || /[\s\r\n]/.test(routeId)) {
			throw new Error(`路由 ID「${routeId.slice(0, 32)}」格式无效`);
		}
		if (typeof binding === "string" && binding.trim()) {
			const targetId = binding.trim();
			if (validTargetIds instanceof Set && !validTargetIds.has(targetId)) {
				throw new Error(`路由「${routeId}」绑定了未知的目标实例/提供商「${targetId}」`);
			}
			out[routeId] = { targetId };
			continue;
		}
		if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
			throw new Error(`路由「${routeId}」的绑定配置必须是对象或目标 ID 字符串`);
		}
		const targetId = typeof binding.targetId === "string" ? binding.targetId.trim() : "";
		if (!targetId) {
			throw new Error(`路由「${routeId}」的 targetId 不能为空`);
		}
		if (validTargetIds instanceof Set && !validTargetIds.has(targetId)) {
			throw new Error(`路由「${routeId}」绑定了未知的目标实例/提供商「${targetId}」`);
		}
		const normalized = { targetId };
		if (typeof binding.accountId === "string" && binding.accountId.trim()) {
			normalized.accountId = binding.accountId.trim().slice(0, 128);
		}
		if (typeof binding.keyRef === "string" && binding.keyRef.trim()) {
			normalized.keyRef = binding.keyRef.trim().slice(0, 128);
		}
		out[routeId] = normalized;
	}
	return out;
}

/**
 * 解析当前对话路由（routeId）应展示的额度目标：
 * 优先级：
 *   1. 当 visibility.manualMatching === true 时：
 *      a) routeBindings[routeId]（支持细粒度 accountId / keyRef）
 *      b) visibility.providerMappings（既有提供商级手动映射）
 *   2. 自定义实例显式关联的 routeIds（或实例 ID 同名匹配）
 *   3. magpieRoutes 绑定键（路由 id → magpie 联动项）
 *   4. 内置 ROUTE_PROVIDER_ALIAS / ROUTE_USAGE_ID 别名表或同名提供商
 */
export function resolveRouteTarget(routeId, settings = {}, builtinAliases = {}, builtinIds = new Set()) {
	const route = typeof routeId === "string" ? routeId.trim() : "";
	if (!route) return undefined;

	// 手动层全部要求 manualMatching 开启，关闭时绑定保留但不生效；
	// 实例 routeIds 属实例自身声明，不算手动覆盖，不受开关门控。
	// 统一顺序（与 Client 药丸/go-panel 一致）：routeBindings > 实例 routeIds > providerMappings > 内置别名。
	const manualEnabled = settings?.visibility?.manualMatching === true;
	if (manualEnabled) {
		const rb = settings?.routeBindings?.[route];
		if (typeof rb === "string" && rb.trim()) {
			return { targetId: rb.trim(), source: "manual" };
		}
		if (rb && typeof rb === "object" && typeof rb.targetId === "string" && rb.targetId.trim()) {
			return {
				targetId: rb.targetId.trim(),
				...(rb.accountId ? { accountId: rb.accountId } : {}),
				...(rb.keyRef ? { keyRef: rb.keyRef } : {}),
				source: "manual"
			};
		}
	}
	const instances = Array.isArray(settings?.instances) ? settings.instances : [];
	for (const inst of instances) {
		if (!inst || inst.enabled === false) continue;
		if (inst.id === route || (Array.isArray(inst.routeIds) && inst.routeIds.includes(route))) {
			return { targetId: inst.id, source: "instance" };
		}
	}
	if (manualEnabled) {
		const mappings = settings?.visibility?.providerMappings;
		if (mappings && typeof mappings === "object") {
			for (const [providerId, routes] of Object.entries(mappings)) {
				if (Array.isArray(routes) && routes.includes(route)) {
					return { targetId: providerId, source: "manual" };
				}
			}
		}
	}

	// Magpie 分组绑定的键是路由 id：绑定在场即归到 magpie 联动项，并取绑定值做渠道分组。
	// 优先于内置别名、不受 manualMatching 门控（与 Client 药丸/goPanelUsageId 同口径）。
	if (typeof settings?.magpieRoutes?.[route] === "string" && settings.magpieRoutes[route].trim()) {
		return { targetId: "magpie", source: "magpie-route" };
	}

	// 3. 自动层：内置别名与同名
	if (builtinAliases && typeof builtinAliases === "object" && typeof builtinAliases[route] === "string") {
		return { targetId: builtinAliases[route], source: "auto" };
	}
	if (builtinIds instanceof Set && builtinIds.has(route)) {
		return { targetId: route, source: "auto" };
	}

	return undefined;
}
