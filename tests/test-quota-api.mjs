// 额度查询 API：对外只读视图 quota() 与 subusage_quota Agent 工具。
// 约束：只暴露额度本身，**不返回 settings / keySource / apiDetected / 任何 Key**；
// 单家失败不能拖垮其它家；工具的 render 要能直说未配置、已关闭与限流。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, apply } = await loadHostModule();
const DEEPSEEK = "deepseek", OPENROUTER = "openrouter";

function harness(fetchImpl) {
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const keys = { [DEEPSEEK]: "sk-fixture-deepseek", [OPENROUTER]: "sk-or-fixture" };
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => keys[id] ? { value: keys[id] } : undefined,
		resolveEnvironment: () => undefined,
		fetch: fetchImpl(calls)
	});
	return { service, calls, files };
}
const okFetch = calls => async (url, options) => {
	calls.push({ url, options });
	if (url === "https://api.deepseek.com/user/balance") return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "42.50" }] }) };
	if (url.endsWith("/key")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { limit: 40, limit_remaining: 30, limit_reset: "monthly" } }) };
	return { ok: false, status: 403, headers: { get: () => null }, text: async () => JSON.stringify({ error: {} }) };
};

// ── [1] 只读视图：形状与"不暴露内部状态" ─────────────────────────────────
{
	const h = harness(okFetch);
	let result = await h.service.read();
	await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [DEEPSEEK]: true, [OPENROUTER]: true } } });
	const view = await h.service.quota({ providerIds: [DEEPSEEK, OPENROUTER] });
	assert.equal(typeof view.updatedAt, "string");
	assert.deepEqual(view.providers.map(p => p.providerId), [DEEPSEEK, OPENROUTER]);
	const deepseek = view.providers[0];
	assert.equal(deepseek.state, "ok");
	assert.deepEqual(deepseek.windows, []);
	assert.equal(deepseek.extras[0].value, "42.50 CNY");
	assert.equal(deepseek.label, "DeepSeek");
	assert.equal(deepseek.coverage, "complete");
	// 第三方消费者只需要额度：设置、凭据状态与来源都不该出现。
	assert.equal(view.settings, undefined, "不返回 settings");
	const raw = JSON.stringify(view);
	for (const leak of ["settings", "keySource", "apiDetected", "envName", "sk-fixture", "sk-or-fixture"]) assert.ok(!raw.includes(leak), `视图不得包含 ${leak}`);
	// 调用方（尤其是模型）手里的名字未必是本插件的 provider id，所以：认不出的原样回报、
	// 命中多条时全返回、一个都认不出时照样把全量数据给出去——三种情况都不能是空。
	const mixed = await h.service.quota({ providerIds: ["nope", DEEPSEEK] });
	assert.equal(JSON.stringify(mixed.providers.map(p => p.providerId)), JSON.stringify(["nope", DEEPSEEK]), "认不出的名字排在最前，命中的照常返回");
	assert.equal(mixed.providers[0].state, "error");
	assert.ok(mixed.providers[0].error.includes("不认识提供商名「nope」"), "要说出是哪个名字不认识");
	assert.ok(mixed.providers[0].error.includes("zai") && mixed.providers[0].error.includes("省略 providers"), "要给出可用的写法与下一步");
	assert.equal((await h.service.quota({ providerIds: ["nope"] })).providers.length, 31, "一个都没认出来时给说明 + 全部 30 条数据");
	assert.equal((await h.service.quota()).providers.length, 30, "缺省读全部 30 家");
	// 别名：厂商名、大小写与分隔符都无关；一个别名命中多条路由就全给（各自带真实状态，不猜也不吞）。
	const aliased = await h.service.quota({ providerIds: ["zai"] });
	assert.equal(JSON.stringify(aliased.providers.map(p => p.providerId)), JSON.stringify(["zai-coding-cn", "zai-coding"]), "zai 命中中国版与国际版两条");
	assert.equal(JSON.stringify((await h.service.quota({ providerIds: ["Z.AI"] })).providers.map(p => p.providerId)), JSON.stringify(["zai-coding-cn", "zai-coding"]), "大小写与分隔符无关");
	assert.equal(JSON.stringify((await h.service.quota({ providerIds: ["zai_coding_cn"] })).providers.map(p => p.providerId)), JSON.stringify(["zai-coding-cn"]), "归一化后按 id 命中");
	assert.equal((await h.service.quota({ providerIds: ["ark"] })).providers.length, 7, "ark 命中全部 7 条路由");
	assert.equal(JSON.stringify((await h.service.quota({ providerIds: ["Kimi"] })).providers.map(p => p.providerId)), JSON.stringify(["kimi-coding"]));
	assert.equal(JSON.stringify((await h.service.quota({ providerIds: ["grok"] })).providers.map(p => p.providerId)), JSON.stringify(["xai-oauth"]));
	// 视图里不能出现 `undefined` 值的键：调用方的 schema 校验会把它判成型别错误（DSH 就会），
	// 而且「字段缺席」本来就该表示「这家没报告」，不是「报告了空」。
	for (const entry of (await h.service.quota()).providers) {
		for (const [key, value] of Object.entries(entry)) assert.notEqual(value, undefined, `${entry.providerId}.${key} 不得是 undefined`);
	}
	h.service.dispose();
	console.log("PASS quota 只读视图：形状、别名与未知名字的兜底、不泄露内部状态");
}

// ── [2] 单家失败不拖垮其它家 ─────────────────────────────────────────────
{
	const failing = calls => async (url, options) => {
		if (url === "https://api.deepseek.com/user/balance") throw new Error("network down");
		return okFetch(calls)(url, options);
	};
	const h = harness(failing);
	let result = await h.service.read();
	await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [DEEPSEEK]: true, [OPENROUTER]: true } } });
	const view = await h.service.quota({ providerIds: [DEEPSEEK, OPENROUTER], force: true });
	const deepseek = view.providers.find(p => p.providerId === DEEPSEEK);
	const openrouter = view.providers.find(p => p.providerId === OPENROUTER);
	assert.equal(deepseek.state, "error", "失败的那家如实标错");
	assert.ok(deepseek.error, "带上失败原因");
	assert.equal(openrouter.state, "ok", "另一家照常返回");
	assert.equal(openrouter.windows[0].percent, 25);
	h.service.dispose();
	console.log("PASS quota 隔离：单家失败只影响自己，错误原因随条目返回");
}

// ── [3] 工具契约与 render 文案 ───────────────────────────────────────────
{
	const tools = [];
	const scope = { effect(fn) { const r = fn(); return typeof r === "function" ? r : () => {}; }, typert: { register: () => () => {} }, tools: { register: tool => { tools.push(tool); return () => {}; } }, get: name => name === "subUsage" ? service : undefined, inject: (names, cb) => cb(scope), logger: { info() {}, warn() {}, error() {} } };
	const service = { quota: async () => ({ updatedAt: "2026-10-09T00:00:00.000Z", providers: [
		{ providerId: "deepseek", label: "DeepSeek", state: "ok", windows: [], extras: [{ kind: "balance", value: "42.50 CNY" }], coverage: "complete", freshness: "fresh" },
		{ providerId: "kimi-coding", label: "Kimi", state: "no-key", windows: [], extras: [] },
		{ providerId: "zai-coding", label: "Z.ai International", state: "disabled", windows: [], extras: [] },
		{ providerId: "chutes", label: "Chutes", state: "ok", windows: [{ kind: "period", percent: 100, status: "rate-limited", resetsAt: "2026-10-10T00:00:00.000Z" }], extras: [], coverage: "complete", freshness: "stale" },
		{ providerId: "novita", label: "Novita AI", state: "error", windows: [], extras: [], error: "HTTP 500" }
	] }) };
	const ctx = { get: name => name === "subUsage" ? service : undefined, inject: (names, cb) => cb(scope), plugin: () => {}, logger: scope.logger };
	apply(ctx);
	assert.equal(tools.length, 1);
	const tool = tools[0];
	assert.equal(tool.name, "subusage_quota");
	assert.equal(tool.output.schema.type, "object");
	assert.equal(tool.output.schema.properties.providers.type, "array");
	assert.equal(tool.output.schema.properties.providers.items.properties.state.required, true);
	// 输出结构不会发给模型（DSH 只投影 name/description/parameters），所以它同时也是**返回值校验器**
	// ——写错会让工具在真实运行时报 ToolOutputError。至少要保证两个数组有元素级 schema。
	assert.equal(tool.output.schema.properties.providers.items.properties.windows.items.properties.percent.required, true, "windows 元素有字段级 schema");
	assert.equal(tool.output.schema.properties.providers.items.properties.windows.items.additionalProperties, true, "窗口形态随厂商变化，保留扩展余地");
	assert.equal(tool.output.schema.properties.providers.items.properties.extras.items.properties.value.required, true, "extras 元素有字段级 schema");
	// 模型看不到 output schema，所以「怎么用」必须写在描述里。
	assert.ok(tool.description.includes("no arguments"), "描述要说明可以不传参数");
	assert.ok(tool.description.includes("vendor names"), "描述要说明可以传厂商名");
	assert.ok(tool.parameters.providers.description.includes("unmatched name"), "参数说明要交代认不出时的行为");
	assert.ok(tool.parameters.providers.description.includes("separators"), "参数说明要交代大小写与分隔符无关");
	// execute 经服务拿数据，并把 providers/refresh 映射到 quota 的参数。
	const seen = [];
	service.quota = async request => { seen.push(request); return { updatedAt: "x", providers: [] }; };
	await tool.execute({ providers: ["deepseek"], refresh: true }, {});
	assert.equal(JSON.stringify(seen[0]), JSON.stringify({ providerIds: ["deepseek"], force: true }));
	assert.equal(JSON.stringify((await tool.execute({}, {})).providers), "[]", "缺参也能调用");
	// render 文案：未配置、已关闭、限流、失败与余额都要能直说。
	const text = tool.output.render({}, { providers: [
		{ providerId: "deepseek", label: "DeepSeek", state: "ok", windows: [], extras: [{ kind: "balance", value: "42.50 CNY" }] },
		{ providerId: "kimi-coding", label: "Kimi", state: "no-key", windows: [], extras: [] },
		{ providerId: "zai-coding", label: "Z.ai International", state: "disabled", windows: [], extras: [] },
		{ providerId: "chutes", label: "Chutes", state: "ok", windows: [{ kind: "period", percent: 100, status: "rate-limited", resetsAt: "2026-10-10T00:00:00.000Z" }], extras: [], freshness: "stale" },
		{ providerId: "novita", label: "Novita AI", state: "error", windows: [], extras: [], error: "HTTP 500" }
	] })[0].text;
	assert.ok(text.includes("DeepSeek [ok]") && text.includes("balance: 42.50 CNY"), "成功条目带余额");
	assert.ok(text.includes("未配置凭据"), "未配置要说清");
	assert.ok(text.includes("检测已关闭"), "关闭要说清");
	assert.ok(text.includes("已达限额") && text.includes("重置"), "限流与重置时刻");
	assert.ok(text.includes("缓存数据"), "缓存要标注");
	assert.ok(text.includes("HTTP 500"), "失败原因要透出");
	assert.ok(!text.includes("undefined"), "不留 undefined");
	// render 的文本才是模型真正读到的东西：读不到数据时也要给下一步，绝不能是空。
	const emptyText = tool.output.render({}, { providers: [] })[0].text;
	assert.ok(emptyText.trim().length > 0 && emptyText.includes("全部"), "空结果也要给可执行的下一步");
	const allMissing = tool.output.render({}, { providers: [
		{ providerId: "kimi-coding", label: "Kimi", state: "no-key", windows: [], extras: [] },
		{ providerId: "chutes", label: "Chutes", state: "disabled", windows: [], extras: [] }
	] })[0].text;
	assert.ok(allMissing.includes("未配置凭据 1 条") && allMissing.includes("检测已关闭 1 条"), "一条都没读到时给汇总原因");
	// 服务还没就绪时给可读原因，而不是一句没有信息量的报错。
	const bare = [];
	const bareScope = { ...scope, tools: { register: t => { bare.push(t); return () => {}; } }, get: () => undefined };
	apply({ get: () => undefined, inject: (_names, cb) => cb(bareScope), plugin: () => {}, logger: bareScope.logger });
	await assert.rejects(() => bare[0].execute({}, {}), /服务尚未就绪.*重启/s, "未就绪要说明下一步");
	console.log("PASS subusage_quota 工具：契约、参数映射、schema 元素级形状与 render 兜底");
}

console.log("\n额度查询 API 测试全部通过 ✅");
