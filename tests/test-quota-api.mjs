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
	assert.equal(deepseek.label, "DeepSeek API");
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
	assert.equal((await h.service.quota({ providerIds: ["ark"] })).providers.length, 4, "ark 命中全部 4 条路由");
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
	assert.equal(tool.output.schema.properties.providers.items.properties.availability.type, "string");
	assert.equal(tool.output.schema.properties.providers.items.properties.availabilityReason.type, "string");
	for (const [availability, fragment] of [["paygo", "按量续用"], ["included", "订阅续用"], ["unknown", "待确认"], ["blocked", "受限"]]) {
		const advice = tool.output.render({}, { providers: [{ providerId: "fixture", state: "ok", windows: [{ kind: "week", percent: 100, status: "rate-limited" }], extras: [], availability }] })[0].text;
		assert.ok(advice.includes(fragment), `工具文本不能丢失${availability}续用结论`);
	}
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
	// 明确受限但无窗口的企业条目不应在无参工具查询中消失。
	const scopeText = tool.output.render({}, { providers: [{ providerId: "fixture", state: "ok", windows: [
		{ kind: "period", budgetScope: "key", percent: 100, status: "rate-limited" },
		{ kind: "period", budgetScope: "team", percent: 1, status: "ok" },
		{ kind: "period", budgetScope: "user", percent: 20, status: "ok" },
		{ kind: "week", percent: 100, status: "rate-limited", detail: { scope: "text" } },
		{ kind: "day", percent: 1, status: "ok", detail: { scope: "daily-capabilities" } },
		{ kind: "month", percent: 1, status: "ok", detail: { scope: "all" } }
	], extras: [] }] })[0].text;
	for (const scope of ["key 预算", "team 预算", "user 预算", "文本/向量", "日额度适用能力", "全部能力共享"]) assert.ok(scopeText.includes(scope), `工具文本必须保留${scope}`);
	const originalQuota = service.quota;
	service.quota = async () => ({ updatedAt: "x", providers: [{ providerId: "openai-codex", state: "ok", windows: [], extras: [{ kind: "plan", value: "enterprise" }], availability: "blocked", availabilityReason: "spend-control" }] });
	assert.equal((await tool.execute({}, {})).providers.length, 1, "独立可用性证据属于真实用量状态，不能被省略");
	service.quota = originalQuota;
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
	// 同一额度池的多个窗口并成一段（Antigravity 三个池各带周窗 + 5 小时窗、ARK 的「文本/向量」同此）：
	// 池名只写一次、窗口顺序不变，跨池仍分开；只合并**相邻**同池窗口。
	const merged = tool.output.render({}, { providers: [{
		providerId: "antigravity", label: "Antigravity", state: "ok", freshness: "fresh",
		windows: [
			{ kind: "week", percent: 4.2, status: "ok", groupLabel: "Gemini Models" },
			{ kind: "5h", percent: 3.4, status: "ok", groupLabel: "Gemini Models" },
			{ kind: "week", percent: 97.9, status: "ok", groupLabel: "Claude and GPT models" },
			{ kind: "week", percent: 61.4, status: "ok", groupLabel: "Gemini 4 Argon" }
		],
		extras: [{ kind: "balance", value: "0 credits" }]
	}] })[0].text;
	assert.equal((merged.match(/Gemini Models ·/g) ?? []).length, 1, "池名只写一次");
	assert.ok(merged.includes("Gemini Models · week 95.8% 剩余 / 5h 96.6% 剩余"), "同池窗口用 / 顺序并列");
	assert.ok(merged.includes("；Claude and GPT models · week 2.1% 剩余"), "跨池仍分开");
	assert.ok(merged.includes("；Gemini 4 Argon · week 38.6% 剩余"), "单窗池不带多余的 /");
	// 交错下发时不合并（只并相邻）：order 由上游决定，不能为了省字重排。
	const interleaved = tool.output.render({}, { providers: [{
		providerId: "fixture", label: "Fixture", state: "ok",
		windows: [
			{ kind: "5h", percent: 0, status: "ok", groupLabel: "A" },
			{ kind: "5h", percent: 0, status: "ok", groupLabel: "B" },
			{ kind: "5h", percent: 0, status: "ok", groupLabel: "A" }
		],
		extras: []
	}] })[0].text;
	assert.equal((interleaved.match(/A ·/g) ?? []).length, 2, "非相邻同池不合并");
	// 全是联动项且都没读到时：不能说成「读取失败」，也不该把用户指去本插件的凭据文档。
	const linkedOnly = tool.output.render({}, { providers: [
		{ providerId: "trae-global", label: "Trae Global", state: "error", windows: [], extras: [], error: "这个区域还没有登录 Trae" },
		{ providerId: "trae-enterprise", label: "Trae 企业版", state: "error", windows: [], extras: [], error: "本机没有 Trae 企业版账号" }
	] })[0].text;
	assert.ok(linkedOnly.includes("联动项 2 条"), "联动项单独计数");
	assert.ok(linkedOnly.includes("兄弟插件"), "下一步指向兄弟插件，而不是本插件凭据文档");
	assert.ok(!linkedOnly.includes("其余 2 条为读取失败"), "未登录/插件没跑不是读取失败");
	assert.ok(!linkedOnly.includes("docs/credentials.md"));
	const mixedMissing = tool.output.render({}, { providers: [
		{ providerId: "kimi-coding", label: "Kimi", state: "no-key", windows: [], extras: [] },
		{ providerId: "trae", label: "Trae", state: "error", windows: [], extras: [], error: "x" },
		{ providerId: "novita", label: "Novita", state: "error", windows: [], extras: [], error: "HTTP 500" }
	] })[0].text;
	assert.ok(mixedMissing.includes("联动项 1 条") && mixedMissing.includes("其余 1 条为读取失败"), "混合时分别计数");
	assert.ok(mixedMissing.includes("docs/credentials.md"), "有本插件条目时仍给凭据文档");
	assert.ok(!interleaved.includes("A · 5h 100% 剩余 / "), "不跨池拼一段");
	// 无标注窗口各成一段、不加前缀（与改动前逐字一致）：没有池名可依时不能凭空造一个。
	const unlabeled = tool.output.render({}, { providers: [{
		providerId: "fixture", label: "Fixture", state: "ok",
		windows: [{ kind: "5h", percent: 0, status: "ok" }, { kind: "week", percent: 50, status: "ok" }],
		extras: []
	}] })[0].text;
	assert.ok(unlabeled.includes("：5h 100% 剩余；week 50% 剩余"), "无标注时逐窗平铺、不加前缀");
	assert.ok(!unlabeled.includes(" · 5h"), "无标注窗口不得被套上池名");
	// 服务还没就绪时给可读原因，而不是一句没有信息量的报错。
	const bare = [];
	const bareScope = { ...scope, tools: { register: t => { bare.push(t); return () => {}; } }, get: () => undefined };
	apply({ get: () => undefined, inject: (_names, cb) => cb(bareScope), plugin: () => {}, logger: bareScope.logger });
	await assert.rejects(() => bare[0].execute({}, {}), /服务尚未就绪.*重启/s, "未就绪要说明下一步");
	console.log("PASS subusage_quota 工具：契约、参数映射、schema 元素级形状与 render 兜底");
}

console.log("\n额度查询 API 测试全部通过 ✅");
