// LiteLLM（自建网关）：用户自己的 proxy 地址 + 虚拟 Key。
// 两个要点：①管理端点在 proxy 根（末尾 /v1 必须去掉）；②没有预算上限时不编造百分比。
// 不访问真实接口，使用虚构 Key 与桩网络。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, subUsageRemote, litellmRoot, normalizeLitellm } = await loadHostModule();
const ID = "litellm";
const RESET = "2026-11-01T00:00:00.000Z";

// ── [1] 代理地址规范化 ───────────────────────────────────────────────────
{
	assert.equal(litellmRoot("https://litellm.example.com"), "https://litellm.example.com");
	assert.equal(litellmRoot("https://litellm.example.com/"), "https://litellm.example.com", "去掉尾部斜杠");
	assert.equal(litellmRoot("https://litellm.example.com/v1"), "https://litellm.example.com", "去掉 /v1 后缀（管理端点在根）");
	assert.equal(litellmRoot("https://litellm.example.com/v1/"), "https://litellm.example.com");
	assert.equal(litellmRoot("  https://gw.corp/litellm/v1  "), "https://gw.corp/litellm", "保留自建子路径，只去掉 /v1");
	assert.equal(litellmRoot("http://127.0.0.1:4000"), "http://127.0.0.1:4000", "自建常跑在本地端口");
	for (const bad of ["", "   ", "not a url", "ftp://x.com", "file:///etc/passwd", undefined, null, 42]) {
		assert.equal(litellmRoot(bad), "", `非法地址视为未配置：${String(bad)}`);
	}
	console.log("PASS LiteLLM 地址规范化：去尾斜杠与 /v1、保留子路径、非 http(s) 一律视为未配置");
}

// ── [2] 归一化 ───────────────────────────────────────────────────────────
{
	const withBudget = normalizeLitellm({ key: "sk-xxx", info: { spend: 25, max_budget: 100, budget_reset_at: RESET } });
	assert.deepEqual(withBudget.windows.map(w => w.kind), ["period"]);
	assert.equal(withBudget.windows[0].percent, 25);
	assert.equal(withBudget.windows[0].resetsAt, new Date(RESET).toISOString(), "有预算重置字段才输出");
	assert.equal(JSON.stringify(withBudget.windows[0].detail), JSON.stringify({ used: 25, limit: 100, unit: "USD" }));
	assert.equal(withBudget.coverage, "complete");
	// user/team 的预算视图优先于 key 自身的 info。
	const scoped = normalizeLitellm({ info: { spend: 5, max_budget: 10 } }, { spend: 80, max_budget: 100, budget_reset_at: RESET });
	assert.equal(scoped.windows[0].percent, 80, "优先用 user/team 视图");
	// 没有预算上限：没有百分比可算，只如实给已用金额，不编造进度。
	const noBudget = normalizeLitellm({ info: { spend: 12.345 } });
	assert.deepEqual(noBudget.windows, [], "无上限不产窗口");
	assert.equal(noBudget.extras[0].kind, "spend");
	assert.equal(noBudget.extras[0].value, "12.35 USD", "金额收敛到两位小数");
	assert.equal(noBudget.coverage, "complete");
	// 也接受把字段放在顶层（不同版本的响应形态）。
	assert.equal(normalizeLitellm({ spend: 1, max_budget: 4 }).windows[0].percent, 25);
	// 没有重置字段时不显示重置，也不把金额渲染成倒计时。
	assert.equal(normalizeLitellm({ info: { spend: 1, max_budget: 4 } }).windows[0].resetsAt, undefined);
	// 预算上限为 0 = 不限，按无上限处理。
	assert.deepEqual(normalizeLitellm({ info: { spend: 3, max_budget: 0 } }).windows, []);
	for (const bad of [{}, { key: "sk" }, null, "nope"]) assert.throws(() => normalizeLitellm(bad), `非法响应必须报错：${JSON.stringify(bad)}`);
	console.log("PASS LiteLLM 归一化：预算窗口、user/team 优先、无上限只给金额、非法值报错");
}

// ── [3] Host 端到端 ──────────────────────────────────────────────────────
{
	function harness(fetchImpl) {
		const files = new Map(), calls = [];
		const io = {
			readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
			mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
			renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
		};
		const key = "sk-litellm-fixture";
		const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
			io, configPath: "memory/config",
			resolveCredentials: async id => id === ID ? { value: key } : undefined,
			resolveEnvironment: () => undefined,
			fetch: fetchImpl(calls)
		});
		return { service, files, calls, key };
	}
	// 缺代理地址：按「凭据不完整」处理，给出可行动指引而不是静默失败。
	{
		const h = harness(() => async () => { throw new Error("不该发请求"); });
		let result = await h.service.read();
		result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
		result = await h.service.refresh({ providerIds: [ID], force: true });
		const entry = result.entries[0];
		assert.equal(entry.state, "error");
		assert.equal(entry.errorCode, "subusage/credentials", "归到凭据类，客户端才会给「配置凭据」入口");
		assert.ok(entry.error.includes("代理地址"), "点名缺什么");
		assert.equal(h.calls.length, 0, "缺地址不发请求");
		h.service.dispose();
	}
	// 配好地址：key/info → user/info，端点落在 proxy 根。
	{
		const h = harness(calls => async (url, options) => {
			calls.push({ url, options });
			if (url.endsWith("/key/info")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ key: "sk-litellm-fixture", info: { user_id: "u-1", spend: 25, max_budget: 100, budget_reset_at: RESET } }) };
			if (url.includes("/user/info")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ user_id: "u-1", spend: 40, max_budget: 200 }) };
			return { ok: false, status: 404, headers: { get: () => null }, text: async () => "{}" };
		});
		let result = await h.service.read();
		result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, litellm: { baseUrl: "https://gw.corp/litellm/v1" } });
		assert.equal(result.settings.litellm.baseUrl, "https://gw.corp/litellm/v1", "设置里原样保留用户输入");
		assert.throws(() => subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema.parse({ providerId: "deepseek", litellm: { baseUrl: "https://x" } }), "别的 provider 不接受 litellm 补丁");
		result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
		result = await h.service.refresh({ providerIds: [ID], force: true });
		const entry = result.entries[0];
		assert.equal(entry.state, "ok");
		assert.equal(JSON.stringify(h.calls.map(c => c.url)), JSON.stringify(["https://gw.corp/litellm/key/info", "https://gw.corp/litellm/user/info?user_id=u-1"]), "端点落在 proxy 根，不带 /v1");
		assert.equal(h.calls[0].options.headers.authorization, `Bearer ${h.key}`, "虚拟 Key 与推理同一把");
		assert.equal(entry.windows[0].percent, 20, "用 user/info 的 40/200");
		assert.ok(!JSON.stringify(result).includes(h.key), "响应不回显 Key");
		h.service.dispose();
	}
	// team 优先于 user，且 scoped 视图拿不到时退回 key 自身的 info。
	{
		const h = harness(calls => async (url, options) => {
			calls.push({ url, options });
			if (url.endsWith("/key/info")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ info: { team_id: "t-9", spend: 5, max_budget: 10 } }) };
			return { ok: false, status: 403, headers: { get: () => null }, text: async () => "{}" };
		});
		let result = await h.service.read();
		result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, litellm: { baseUrl: "https://gw.corp" } });
		result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
		result = await h.service.refresh({ providerIds: [ID], force: true });
		const entry = result.entries[0];
		assert.equal(h.calls[1].url, "https://gw.corp/team/info?team_id=t-9", "有 team_id 就走 team 视图");
		assert.equal(entry.state, "ok", "scoped 视图被拒不影响整体");
		assert.equal(entry.windows[0].percent, 50, "退回 key 自身的 5/10");
		h.service.dispose();
	}
	console.log("PASS LiteLLM Host：缺地址给凭据指引、端点落在 proxy 根、team 优先与 scoped 降级");
}

// ── [4] Client：注册、草稿与补丁 ─────────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, draftFor, settingsPatch }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const api = spec.factory((name) => { assert.equal(name, "react"); return react; }).__test;
	const flat = (v) => JSON.stringify(v);
	assert.ok(api.PROVIDER_ORDER.includes(ID), "litellm 在提供商顺序中");
	// 追加在既有条目之后即可；用相对顺序断言，避免后续新增把这条打脆。
	assert.ok(api.PROVIDER_ORDER.indexOf(ID) > api.PROVIDER_ORDER.indexOf("zenmux"), "追加在既有条目之后");
	assert.equal(api.PROVIDER_META[ID].defaultEnabled, false);
	// 代理地址不是秘密：草稿回填已存值。
	const draft = api.draftFor({ keyModes: {}, litellm: { baseUrl: "https://gw.corp" } }, ID);
	assert.equal(draft.litellm.baseUrl, "https://gw.corp", "地址回填");
	assert.equal(flat(api.settingsPatch(ID, draft, "rev").litellm), flat({ baseUrl: "https://gw.corp" }));
	assert.equal(flat(api.settingsPatch(ID, { ...draft, litellm: { baseUrl: "  https://x/  " } }, "rev").litellm), flat({ baseUrl: "https://x/" }), "提交前 trim");
	console.log("PASS LiteLLM Client：注册、地址回填与补丁提交");
}

console.log("\nLiteLLM 适配测试全部通过 ✅");
