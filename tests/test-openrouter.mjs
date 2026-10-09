// OpenRouter：key 限额与日/周/月用量走 /key（任意 key），账户余额走 /credits（只对
// management / provisioning key 开放）。余额拿不到时必须静默降级，不能把条目判失败。
// 不访问真实接口，使用虚构 Key 与桩网络。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeOpenRouter } = await loadHostModule();
const ID = "openrouter";

// ── [1] 归一化 ───────────────────────────────────────────────────────────
{
	// 有 key 限额：按 limit - limit_remaining 算已用比例，窗口名跟随 limit_reset。
	const out = normalizeOpenRouter({ data: { limit: 100, limit_remaining: 25, limit_reset: "monthly", usage: 75, usage_monthly: 75, is_free_tier: false } }, { data: { total_credits: 100.5, total_usage: 25.75 } });
	assert.deepEqual(out.windows.map(w => w.kind), ["month"]);
	assert.equal(out.windows[0].percent, 75);
	assert.equal(JSON.stringify(out.windows[0].detail), JSON.stringify({ used: 75, limit: 100, unit: "credits" }));
	assert.equal(out.extras[0].value, "74.75 USD", "余额 = total_credits - total_usage");
	assert.equal(out.coverage, "complete");
	// 限额不能当 reset 字段用：OpenRouter 的 limit_reset 只是周期名，没有具体重置时间。
	assert.equal(out.windows[0].resetsAt, undefined, "不编造重置时间");
	assert.equal(normalizeOpenRouter({ data: { limit: 10, limit_remaining: 5, limit_reset: "daily" } }).windows[0].kind, "day");
	assert.equal(normalizeOpenRouter({ data: { limit: 10, limit_remaining: 5, limit_reset: "weekly" } }).windows[0].kind, "week");
	assert.equal(normalizeOpenRouter({ data: { limit: 10, limit_remaining: 5 } }).windows[0].kind, "period", "未知周期归通用限额");
	// 免费档没有 key 限额，但免费模型每日请求上限是真实窗口。
	const free = normalizeOpenRouter({ data: { is_free_tier: true, free_model_daily_requests: { limit: 50, remaining: 20, used: 30 } } }, undefined);
	assert.deepEqual(free.windows.map(w => w.kind), ["day"]);
	assert.equal(free.windows[0].percent, 60);
	assert.equal(free.windows[0].detail.unit, "requests");
	assert.equal(free.extras[0].value, "Free tier");
	// 余额端点 403（普通推理 key）：静默降级为只显示限额，不抛错。
	const noCredits = normalizeOpenRouter({ data: { limit: 20, limit_remaining: 20 } }, undefined);
	assert.equal(noCredits.windows.length, 1);
	assert.deepEqual(noCredits.extras, [], "拿不到余额就不显示余额，也不显示 0");
	// 没有任何可用信息才报错。
	assert.throws(() => normalizeOpenRouter({ data: { is_free_tier: false } }, undefined));
	assert.throws(() => normalizeOpenRouter({}, undefined));
	assert.throws(() => normalizeOpenRouter({ data: "nope" }, undefined));
	// limit_remaining 越界（服务端异常）不产生负用量。
	assert.equal(normalizeOpenRouter({ data: { limit: 10, limit_remaining: 99 } }).windows[0].percent, 0);
	console.log("PASS OpenRouter 归一化：限额窗口、周期名映射、免费档日窗口、余额降级与非法值报错");
}

// ── [2] Host 端到端 ──────────────────────────────────────────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const key = "sk-or-fixture";
	let creditsStatus = 200;
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => id === ID ? { value: key } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			if (url.endsWith("/credits") && creditsStatus !== 200) return { ok: false, status: creditsStatus, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: "Only management keys can perform this operation" } }) };
			const body = url.endsWith("/credits") ? { data: { total_credits: 30, total_usage: 12.5 } } : { data: { limit: 40, limit_remaining: 30, limit_reset: "monthly", is_free_tier: false } };
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
		}
	});
	let result = await service.read();
	assert.equal(result.settings.visibility.providers[ID], false, "新增聚合商默认关闭");
	assert.equal(calls.length, 0, "默认关闭不访问网络");
	result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	result = await service.refresh({ providerIds: [ID], force: true });
	let entry = result.entries[0];
	assert.equal(entry.state, "ok");
	assert.deepEqual(calls.map(c => c.url), ["https://openrouter.ai/api/v1/key", "https://openrouter.ai/api/v1/credits"]);
	assert.equal(calls[0].options.headers.authorization, `Bearer ${key}`);
	assert.equal(entry.windows[0].percent, 25);
	assert.equal(entry.extras[0].value, "17.5 USD");
	assert.ok(!JSON.stringify(result).includes(key), "响应不回显 Key");
	// 普通推理 key：/credits 返回 403，条目仍必须是 ok（只少了余额）。
	creditsStatus = 403; calls.length = 0;
	result = await service.refresh({ providerIds: [ID], force: true });
	entry = result.entries[0];
	assert.equal(entry.state, "ok", "余额端点被拒不影响限额展示");
	assert.equal(entry.windows[0].percent, 25);
	assert.deepEqual(entry.extras, [], "没有余额就不显示余额");
	assert.equal(calls.length, 2, "仍然两个端点都试过");
	service.dispose();
	console.log("PASS OpenRouter Host：默认关闭、限额+余额、403 静默降级与密钥不回显");
}

// ── [3] Client 注册 ──────────────────────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	assert.ok(client.__test.PROVIDER_ORDER.includes(ID), "openrouter 在提供商顺序中");
	// 新 provider 一律追加在既有条目之后（不动既有索引）：用相对顺序断言，避免被后续新增打脆。
	assert.ok(client.__test.PROVIDER_ORDER.indexOf("openrouter") > client.__test.PROVIDER_ORDER.indexOf("siliconflow"), "追加在既有条目之后");
	assert.equal(client.__test.PROVIDER_META[ID].defaultEnabled, false);
	assert.equal(client.__test.PROVIDER_META[ID].envName, "OPENROUTER_API_KEY");
	console.log("PASS OpenRouter Client：注册、默认关闭与顺序约定");
}

console.log("\nOpenRouter 适配测试全部通过 ✅");
