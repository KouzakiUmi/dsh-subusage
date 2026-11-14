// New API / One API 一等入口回归：声明式适配器、探测签名优先级、站点根归一与编辑器简化。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

import { NEWAPI_ADAPTER_RECIPE, normalizeNewApiPayload } from "../lib/adapters/declarative/newapi.js";
import { DECLARATIVE_RECIPES, listDeclarativeRecipes, isDeclarativeAdapterId, recipeNormalizedBaseUrl, getDeclarativeRecipe } from "../lib/platform/registry.js";
import { matchKnownRecipeSignature } from "../lib/detection/recipes.js";
import { probeConnectionEndpoint } from "../lib/detection/detector.js";
import { classifyNewApiUsage, NEWAPI_QUOTA_PER_CREDIT } from "../lib/providers/newapi.js";

// ── [1] 配方注册 ────────────────────────────────────────────────────────────
assert.equal(NEWAPI_ADAPTER_RECIPE.id, "newapi");
assert.equal(NEWAPI_ADAPTER_RECIPE.baseUrlMode, "newapi-root");
assert.equal(NEWAPI_ADAPTER_RECIPE.defaultUsagePath, "/api/usage/token");
assert.deepEqual(NEWAPI_ADAPTER_RECIPE.candidatePaths, ["/api/usage/token", "/api/usage/token/"]);
assert.deepEqual(NEWAPI_ADAPTER_RECIPE.supportedAuthKinds, ["bearer"]);
assert.ok(isDeclarativeAdapterId("newapi"));
assert.ok(DECLARATIVE_RECIPES.get("newapi").normalize, "注册表要挂 normalize");
assert.ok(listDeclarativeRecipes().some(r => r.adapterId === undefined && r.id === "newapi" || r.id === "newapi"));
assert.ok(!JSON.stringify(listDeclarativeRecipes()).includes("normalize"), "目录下发不得携带函数字段");
// 目录顺序：newapi 排在 custom-http 之前（一等入口优先于兜底）
const recipeIds = listDeclarativeRecipes().map(r => r.id);
assert.ok(recipeIds.indexOf("newapi") < recipeIds.indexOf("custom-http"), "newapi 应排在 custom-http 之前");

// ── [2] 归一化：三种形态与错误语义 ────────────────────────────────────────────
// 2a. 有限令牌（code:true 信封）：窗口 + 令牌余额，500000 quota = 1 Credits
const limited = normalizeNewApiPayload({
	code: true,
	data: { name: "my-token", unlimited_quota: false, total_granted: NEWAPI_QUOTA_PER_CREDIT * 10, total_used: NEWAPI_QUOTA_PER_CREDIT * 2.5, total_available: NEWAPI_QUOTA_PER_CREDIT * 7.5, user_quota: { total_available: NEWAPI_QUOTA_PER_CREDIT * 0.2, total_used: 5 } }
}, { now: Date.parse("2026-01-01T00:00:00Z") });
const win = limited.quotas.find(q => q.type === "window");
assert.ok(win, "有限令牌要产窗口");
assert.equal(win.percent, 25);
assert.equal(win.used, 2.5);
assert.equal(win.limit, 10);
assert.equal(win.amount.unit, "Credits");
const limitedBalance = limited.quotas.find(q => q.type === "amount" && q.id === "balance");
assert.equal(limitedBalance.label, "令牌余额");
assert.equal(limitedBalance.amount.value, 7.5);
assert.ok(limited.quotas.some(q => q.type === "note" && /账户余额另有 0\.2 Credits/.test(q.text)), "账户钱包只作说明行");
assert.equal(limited.coverage, "complete");

// 2b. success:true 信封（部分 one-api 系）
const alt = normalizeNewApiPayload({ success: true, data: { name: "ulim", unlimited_quota: true, user_quota: { total_available: NEWAPI_QUOTA_PER_CREDIT * 3, total_used: NEWAPI_QUOTA_PER_CREDIT } } }, { now: Date.parse("2026-01-01T00:00:00Z") });
const altBalance = alt.quotas.find(q => q.type === "amount" && q.id === "balance");
assert.equal(altBalance.role, "wallet");
assert.equal(altBalance.amount.value, 3);
assert.ok(alt.quotas.some(q => q.type === "amount" && q.role === "spend"), "无限令牌的累计消费走 spend");
assert.ok(alt.quotas.some(q => q.type === "note" && /无限额度令牌/.test(q.text)));

// 2c. legacy：旧版不报 unlimited_quota
const legacy = normalizeNewApiPayload({ code: true, data: { name: "old", user_quota: { total_available: NEWAPI_QUOTA_PER_CREDIT * 2 } } }, { now: Date.parse("2026-01-01T00:00:00Z") });
assert.equal(legacy.quotas.find(q => q.id === "balance").amount.value, 2);

// 2d. 令牌到期说明：未来日期带剩余天数，过期不带
const future = normalizeNewApiPayload({ code: true, data: { unlimited_quota: false, total_granted: NEWAPI_QUOTA_PER_CREDIT, total_used: 0, total_available: NEWAPI_QUOTA_PER_CREDIT, expires_at: Math.floor(Date.parse("2026-03-01T00:00:00Z") / 1000) } }, { now: Date.parse("2026-01-01T00:00:00Z") });
assert.ok(future.quotas.some(q => q.type === "note" && /令牌到期 2026-03-01（还有 \d+ 天）/.test(q.text)));
const past = normalizeNewApiPayload({ code: true, data: { unlimited_quota: false, total_granted: NEWAPI_QUOTA_PER_CREDIT, total_used: 0, total_available: NEWAPI_QUOTA_PER_CREDIT, expires_at: Math.floor(Date.parse("2025-01-01T00:00:00Z") / 1000) } }, { now: Date.parse("2026-01-01T00:00:00Z") });
assert.ok(past.quotas.some(q => q.type === "note" && /令牌已于 2025-01-01 到期/.test(q.text)));

// 2e. 认证拒绝与形状错误
assert.throws(() => normalizeNewApiPayload({ code: false, message: "无权进行此操作" }), error => error.code === "subusage/auth" && /sk- Key/.test(error.message));
assert.throws(() => normalizeNewApiPayload({ code: true }), error => error.code === "subusage/response");
assert.throws(() => normalizeNewApiPayload({ code: true, data: { name: "x" } }), error => error.code === "subusage/response");

// ── [3] 探测签名：newapi 抢在 openai-credit-grants 之前 ──────────────────────
assert.equal(matchKnownRecipeSignature({ code: true, data: { unlimited_quota: true, user_quota: { total_available: 1 } } }, "/api/usage/token")?.adapterId, "newapi");
assert.equal(matchKnownRecipeSignature({ code: true, data: { total_granted: 1, total_used: 0, total_available: 1 } }, "/api/usage/token")?.adapterId, "newapi", "有 code 信封时不得被 openai-grants 抢走");
assert.equal(matchKnownRecipeSignature({ success: true, data: { total_granted: 1, total_used: 0, total_available: 1 } }, "/api/usage/token")?.adapterId, "newapi");
const openai = matchKnownRecipeSignature({ total_granted: 1, total_used: 0, total_available: 1 }, "/v1/dashboard/billing/credit_grants");
assert.equal(openai?.adapterId, "custom-http", "无信封的 grants 三元组仍走 openai-grants");
assert.equal(matchKnownRecipeSignature({ planName: "Pro", subscription: { daily_usage_usd: 2, daily_limit_usd: 10 }, balance: 30 }, "/v1/usage")?.adapterId, "sub2api", "sub2api 签名不受影响");

// ── [4] 站点根归一 ──────────────────────────────────────────────────────────
const recipe = getDeclarativeRecipe("newapi");
assert.equal(recipeNormalizedBaseUrl(recipe, "https://site.com/v1/"), "https://site.com");
assert.equal(recipeNormalizedBaseUrl(recipe, "https://site.com/api"), "https://site.com");
assert.equal(recipeNormalizedBaseUrl(recipe, "https://site.com/sub/v1"), "https://site.com/sub");
assert.equal(recipeNormalizedBaseUrl(getDeclarativeRecipe("custom-http"), "https://site.com/v1"), "https://site.com/v1", "非 newapi 配方不归一根");

// ── [5] 探测端到端：newapi 适配器 + 根归一 + identified ───────────────────────
const envelope = { code: true, data: { name: "t", unlimited_quota: false, total_granted: NEWAPI_QUOTA_PER_CREDIT * 4, total_used: NEWAPI_QUOTA_PER_CREDIT, total_available: NEWAPI_QUOTA_PER_CREDIT * 3 } };
let requestedUrl = "";
const identified = await probeConnectionEndpoint(
	{
		baseUrl: "https://site.example.com/v1",
		adapterId: "newapi",
		credential: { key: "sk-test", source: "manual" }
	},
	{
		fetch: async url => {
			requestedUrl = url;
			return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => JSON.stringify(envelope) };
		}
	}
);
assert.equal(identified.status, "identified");
assert.equal(identified.adapterId, "newapi");
assert.equal(identified.usagePath, "/api/usage/token");
assert.ok(requestedUrl.startsWith("https://site.example.com/api/usage/token"), `站点根要归一：${requestedUrl}`);
assert.ok(identified.normalizedPreview.quotas.some(q => q.type === "window"), "identified 结果要带内置归一化预览");

// ── [6] 探测端到端：code:false → auth-required ───────────────────────────────
const authFail = await probeConnectionEndpoint(
	{
		baseUrl: "https://site.example.com",
		adapterId: "newapi",
		credential: { key: "sk-wrong", source: "manual" }
	},
	{
		fetch: async url => ({ ok: true, status: 200, url, headers: { get: () => null }, text: async () => JSON.stringify({ code: false, message: "无权进行此操作" }) })
	}
);
assert.equal(authFail.status, "auth-required");
assert.ok(/无权进行此操作|上游返回失败/.test(authFail.reason));

// ── [7] 客户端：newapi 草稿隐藏映射编辑器，占位符本地化 ────────────────────────
{
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	const states = [];
	let hookIndex = 0;
	let render = null;
	let current = null;
	const rerender = () => { hookIndex = 0; current = render(); };
	const react = {
		createElement: (type, props, ...children) => typeof type === "function" ? type({ ...(props || {}) }) : ({ type, props: props || {}, children }),
		Fragment: "fragment",
		useState(init) {
			const i = hookIndex++;
			if (states.length <= i) states.push(typeof init === "function" ? init() : init);
			return [states[i], update => { states[i] = typeof update === "function" ? update(states[i]) : update; rerender(); }];
		},
		useRef: value => ({ current: value }),
		useMemo: factory => factory(),
		useEffect: () => {},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
	};
	let spec;
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { InstanceEditor }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: value => { spec = value; } } }, console });
	const { InstanceEditor } = spec.factory(() => react).__test;
	const RECIPE = { adapterId: "custom-http", label: "x", defaultUsagePath: "/v1/usage", defaultAuthKind: "bearer", supportedAuthKinds: ["bearer"] };
	const NEWAPI_RECIPE = { adapterId: "newapi", label: "New API / One API 站点", defaultUsagePath: "/api/usage/token", defaultAuthKind: "bearer", supportedAuthKinds: ["bearer"] };
	const walk = (node, visit) => {
		if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
		if (!node || typeof node !== "object") return;
		visit(node);
		const kids = node.children;
		for (const child of Array.isArray(kids) ? kids : kids ? [kids] : []) walk(child, visit);
	};
	const flattenText = node => { const parts = []; walk(node, n => { const c = n.children; for (const x of Array.isArray(c) ? c : c ? [c] : []) if (typeof x === "string") parts.push(x); }); return parts.join(""); };
	const findButton = (root, label) => { let hit = null; walk(root, n => { if (!hit && n.type === "button" && flattenText(n).includes(label)) hit = n; }); return hit; };
	let seenArgs = null;
	const props = {
		inst: null, profile: null, catalog: { recipes: [RECIPE, NEWAPI_RECIPE] }, revision: "r",
		call: async (method, args) => {
			if (method === "detectInstance") seenArgs = args;
			return { status: "identified", matched: true, confidence: "high", usagePath: "/api/usage/token", explanations: ["命中"], rawPreview: envelope, attempts: [] };
		},
		usageStore: { save: async p => p, refresh: async () => {} },
		onDone: () => {}, text: cn => cn, setNotice: () => {}
	};
	render = () => InstanceEditor(props);
	hookIndex = 0; rerender();
	// 适配器下拉要包含 newapi
	assert.ok(flattenText(current).includes("New API / One API 站点 (newapi)"), "适配器下拉要有一等入口");
	// 切到 newapi：映射编辑器按钮消失、内置提示出现
	const select = (() => {
		let hit = null;
		walk(current, n => {
			if (!hit && n.type === "select") walk(n.children, c => { if (c && typeof c === "object" && c.type === "option" && c.props?.value === "newapi") hit = n; });
		});
		return hit;
	})();
	assert.ok(select, "适配器下拉要渲染为 select");
	select.props.onChange({ target: { value: "newapi" } });
	assert.ok(flattenText(current).includes("内置字段映射与单位换算"), "newapi 要显示内置映射提示");
	assert.ok(!findButton(current, "映射编辑器"), "newapi 不应显示映射编辑器按钮");
	assert.ok(flattenText(current).includes("显示配置（DisplayProfile）"), "newapi 保留 DisplayProfile");
	// 探测调用要携带 adapterId（组件在渲染时捕获 call，捕获桩从一开始就在场）
	await findButton(current, "测试连接").props.onClick();
	assert.equal(seenArgs.adapterId, "newapi", "探测请求要携带 adapterId");
}

console.log("PASS New API 一等入口：配方注册、内置归一化、签名优先级、根归一、探测端到端与编辑器简化");
