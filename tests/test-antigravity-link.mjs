// 兄弟插件联动：dsh-antigravity-acp（`agyQuota` 服务）的额度并入 quota() 视图与
// `subusage_quota` 工具报告。
// 约束：联动项没有自己的凭据与检测开关；插件不在场时**不出现**该条目（不是「未配置」）；
// 它报的是剩余比例，对外必须换算成已用百分比；取数失败 / 超时只影响它自己那一条。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, apply, normalizeAntigravity } = await loadHostModule();

// ── [1] 快照映射：剩余 → 已用、窗口词汇、禁用窗口不冒充「已达限额」 ────────
{
	const entry = normalizeAntigravity({
		status: "ok",
		updatedAt: "2026-10-22T00:00:00.000Z",
		plan: "Google AI Pro",
		groups: [
			{ name: "Gemini Models", buckets: [
				{ name: "5 小时", window: "5h", remainingPct: 82, resetTime: "2026-10-22T05:00:00Z" },
				{ name: "每周", window: "7d", remainingFraction: 0.71 }
			] },
			{ name: "Claude and GPT models", buckets: [{ name: "5h", window: "5h", remainingPct: 43 }] },
			{ name: "Disabled group", buckets: [{ name: "每周", window: "7d", disabled: true }] },
			{ name: "Unknown group", buckets: [{ name: "每周", window: "7d" }] }
		],
		credits: { status: "ok", remainingCredits: 1234, planName: "Google AI Pro" }
	});
	assert.equal(entry.providerId, "antigravity");
	assert.equal(entry.label, "Antigravity");
	assert.equal(entry.state, "ok");
	assert.equal(entry.coverage, "complete");
	assert.equal(entry.freshness, "fresh");
	assert.equal(entry.lastSuccessAt, "2026-10-22T00:00:00.000Z");
	// 对外 percent = 已用；它给的是剩余（82% / 0.71 → 18% / 29% 已用）。
	assert.deepEqual(entry.windows.map(w => w.kind), ["5h", "week", "5h"], "窗口词汇收敛到本插件的 kind");
	assert.deepEqual(entry.windows.map(w => w.percent), [18, 29, 57]);
	assert.equal(entry.windows[0].status, "ok");
	assert.equal(entry.windows[0].resetsAt, "2026-10-22T05:00:00.000Z");
	// 多组时带分组标题，单组时省略——与本插件对 groupLabel 的既有语义一致。
	assert.equal(entry.windows[0].groupLabel, "Gemini Models");
	assert.equal(entry.windows[2].groupLabel, "Claude and GPT models");
	assert.ok(!("detail" in entry.windows[0]), "只有比例、没有绝对值，不得编造 detail");
	// 禁用窗口不产出窗口（「已停用」≠「已达限额」），未报告比例的窗口同理，两者各留一条说明。
	assert.deepEqual(entry.extras.filter(x => x.kind === "note").map(x => x.value), [
		"1 个额度窗口已停用（本账号不可用）",
		"1 个额度窗口未报告剩余比例"
	]);
	assert.deepEqual(entry.extras.filter(x => x.kind !== "note"), [
		{ kind: "plan", value: "Google AI Pro" },
		{ kind: "balance", value: "1234 credits" }
	]);
}

// ── [2] 边界：零剩余、失败快照、stale、单组不带 groupLabel ─────────────────
{
	const exhausted = normalizeAntigravity({ status: "ok", updatedAt: "2026-10-22T00:00:00.000Z", groups: [{ name: "Gemini", buckets: [{ window: "5h", remainingPct: 0 }] }] });
	assert.equal(exhausted.windows[0].percent, 100, "剩余 0 = 已用 100");
	assert.equal(exhausted.windows[0].status, "rate-limited");
	assert.equal(exhausted.windows[0].groupLabel, "Gemini", "单组也保留组名：它说明这条窗口约束哪批模型");

	const failed = normalizeAntigravity({ status: "error", updatedAt: "2026-10-22T00:00:00.000Z", groups: [], error: { code: "token-missing", message: "未找到官方 CLI 登录态" } });
	assert.equal(failed.state, "error");
	assert.equal(failed.error, "未找到官方 CLI 登录态");
	assert.deepEqual(failed.windows, []);
	assert.equal(failed.coverage, "partial");

	const stale = normalizeAntigravity({ status: "ok", updatedAt: "2026-10-22T00:00:00.000Z", stale: true, staleReason: "刷新失败", groups: [{ name: "Gemini", buckets: [{ window: "weekly", remainingFraction: 0.5 }] }] });
	assert.equal(stale.freshness, "stale");
	assert.equal(stale.windows[0].kind, "week", "weekly 也归到 week");
	assert.equal(stale.windows[0].percent, 50);

	// 完全不认识窗口写法时回落到 period，不丢窗口。
	const period = normalizeAntigravity({ status: "ok", updatedAt: "2026-10-22T00:00:00.000Z", groups: [{ name: "G", buckets: [{ name: "Billing cycle", remainingPct: 10 }] }] });
	assert.equal(period.windows[0].kind, "period");
}

// ── [3] 服务接线：ctx.get("agyQuota") → quota() 视图 ───────────────────────
const SNAPSHOT = {
	status: "ok", updatedAt: "2026-10-22T00:00:00.000Z", plan: "Pro",
	groups: [{ name: "Gemini Models", buckets: [{ name: "5 小时", window: "5h", remainingPct: 60 }] }],
	credits: { status: "ok", remainingCredits: 42 }
};
function harness(agy, options = {}) {
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const ctx = { get: name => name === "agyQuota" ? agy : undefined };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		fetch: async () => { throw new Error("测试不得发起网络请求"); },
		linkedTimeoutMs: options.linkedTimeoutMs ?? 50
	});
	return { service, files };
}
{
	const calls = [];
	const agy = { read: async request => { calls.push(request); return SNAPSHOT; } };
	const { service } = harness(agy);
	// 点名联动项：只回它一条，不夹带另外 30 家（否则模型问「Antigravity 还剩多少」会拿到一屏无关数据）。
	const only = await service.quota({ providerIds: ["antigravity"] });
	assert.deepEqual(only.providers.map(p => p.providerId), ["antigravity"]);
	assert.deepEqual(only.providers[0].windows.map(w => [w.kind, w.percent]), [["5h", 40]]);
	assert.deepEqual(only.providers[0].extras, [{ kind: "plan", value: "Pro" }, { kind: "balance", value: "42 credits" }]);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], { force: false }, "默认走提供方插件的缓存");
	await service.quota({ providerIds: ["agy"], force: true });
	assert.deepEqual(calls[1], { force: true }, "refresh 要透传给提供方插件");
	assert.deepEqual((await service.quota({ providerIds: ["antigravity-acp"] })).providers.map(p => p.providerId), ["antigravity"], "别名按大小写与分隔符归一");
	// 不点名：30 家 + 联动 1 家。
	const all = await service.quota();
	assert.equal(all.providers.length, 31);
	assert.ok(all.providers.some(p => p.providerId === "antigravity"));
	// 视图里不能出现 undefined 值的键（调用方 schema 会判成型别错误）。
	for (const entry of all.providers) for (const [key, value] of Object.entries(entry)) assert.notEqual(value, undefined, `${entry.providerId}.${key} 不得是 undefined`);
	service.dispose();
}
// 插件不在场：顺带读的全量查询里**不出现**该条目（不是「未配置凭据」）；点名时要回一条
// 可执行的说明——空列表会让模型以为「本机什么都没配」。
{
	const { service } = harness(undefined);
	const all = await service.quota();
	assert.equal(all.providers.length, 30, "没有兄弟插件就只有本插件登记的 30 家");
	assert.ok(!all.providers.some(p => p.providerId === "antigravity"));
	const named = await service.quota({ providerIds: ["antigravity"] });
	const row = named.providers.find(p => p.providerId === "antigravity");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("没有检测到它的额度服务"), "点名的联动项缺席时必须说清楚原因与下一步");
	assert.ok(row.error.includes("dsh-antigravity-acp"));
	service.dispose();
}
// 提供方插件报错 / 超时：只影响它自己那一条，其余家照常。
{
	const { service } = harness({ read: async () => ({ status: "error", updatedAt: "2026-10-22T00:00:00.000Z", groups: [], error: { code: "cli-failed", message: "agy /usage 退出码 1" } }) });
	const view = await service.quota({ providerIds: ["antigravity"] });
	assert.equal(view.providers[0].state, "error");
	assert.equal(view.providers[0].error, "agy /usage 退出码 1");
	service.dispose();
}
{
	const { service } = harness({ read: () => new Promise(() => {}) }, { linkedTimeoutMs: 20 });
	const view = await service.quota({ providerIds: ["antigravity"] });
	assert.equal(view.providers[0].state, "error");
	assert.ok(view.providers[0].error.includes("超过"), "超时要给出可读原因");
	service.dispose();
}

// ── [4] 工具报告：联动项出现在 subusage_quota 的输出与文本里 ───────────────
{
	const tools = [];
	const service = harness({ read: async () => SNAPSHOT }).service;
	const scope = {
		effect(fn) { const r = fn(); return typeof r === "function" ? r : () => {}; },
		typert: { register: () => () => {} },
		tools: { register: tool => { tools.push(tool); return () => {}; } },
		get: name => name === "subUsage" ? service : undefined,
		inject: (names, cb) => cb(scope),
		logger: { info() {}, warn() {}, error() {} }
	};
	apply({ get: name => name === "subUsage" ? service : undefined, inject: (names, cb) => cb(scope), plugin: () => {}, logger: scope.logger });
	const tool = tools.find(t => t.name === "subusage_quota");
	assert.ok(tool, "工具必须已注册");
	assert.ok(tool.description.includes("antigravity"), "描述里要交代这条联动项的存在");
	assert.ok(tool.parameters.providers.description.includes("antigravity"), "参数说明要能点名它");
	const asked = await tool.execute({ providers: ["antigravity"] }, {});
	assert.deepEqual(asked.providers.map(p => p.providerId), ["antigravity"]);
	// 不点名：其余 30 家都没配凭据被收起，联动项留下并计入 omitted。
	const auto = await tool.execute({}, {});
	assert.deepEqual(auto.providers.map(p => p.providerId), ["antigravity"], "没配凭据的家要被收起");
	assert.equal(auto.omitted, 30);
	const text = tool.output.render({}, auto)[0].text;
	assert.ok(text.includes("Antigravity [ok]"), "文本里要有一行能读的 antigravity");
	assert.ok(text.includes("60% 剩余"), "文本按剩余口径展示（条目里存的是已用 40%）");
	assert.ok(text.includes("Gemini Models · 5h"), "组名要留住，否则看不出这条百分比管哪批模型");
	assert.ok(text.includes("plan: Pro"));
	assert.ok(text.includes("另有 30 家"), "省略计数照旧");
	service.dispose();
}
// 插件不在场时，工具输出里不得出现 antigravity 行（也不能报成「未配置凭据」）。
{
	const tools = [];
	const service = harness(undefined).service;
	const scope = {
		effect(fn) { const r = fn(); return typeof r === "function" ? r : () => {}; },
		typert: { register: () => () => {} },
		tools: { register: tool => { tools.push(tool); return () => {}; } },
		get: name => name === "subUsage" ? service : undefined,
		inject: (names, cb) => cb(scope),
		logger: { info() {}, warn() {}, error() {} }
	};
	apply({ get: name => name === "subUsage" ? service : undefined, inject: (names, cb) => cb(scope), plugin: () => {}, logger: scope.logger });
	const tool = tools.find(t => t.name === "subusage_quota");
	const auto = await tool.execute({}, {});
	assert.ok(!auto.providers.some(p => p.providerId === "antigravity"));
	assert.ok(!tool.output.render({}, auto)[0].text.includes("Antigravity"));
	service.dispose();
}

console.log("PASS 兄弟插件联动：快照换算、别名、缺席/失败/超时降级与工具报告");
