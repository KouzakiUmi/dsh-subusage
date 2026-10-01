// host 冒烟：mock ctx 调 apply，断言导出契约、服务注册、typert 描述符。
import { loadHostModule, makeAssert } from "./helpers.mjs";

const mod = await loadHostModule();
const assert = makeAssert();

assert(typeof mod.apply === "function" && typeof mod.name === "string" && Array.isArray(mod.inject), "导出契约 {name, inject, apply}");
assert(mod.name === "dsh-subusage", "name = dsh-subusage");

const calls = { plugins: [], typert: [] };
const scope = {
	effect(fn) { const r = fn(); return typeof r === "function" ? r : () => {}; },
	typert: { register(desc) { calls.typert.push(desc); return () => {}; } },
	get() { return undefined; },
	inject(names, cb) { return cb(scope); },
	logger: { info() {}, warn() {}, error() {} }
};
const ctx = {
	get(n) { return n === "llm" ? { listProviders: () => [{ id: "zai-coding-cn" }] } : undefined; },
	inject(names, cb) { return cb(scope); },
	plugin(cls, config) { calls.plugins.push(cls.name); return new cls(ctx, config); },
	logger: scope.logger,
	__env: {}
};

try {
	mod.apply(ctx);
	assert(true, "apply(mockCtx) 不抛错");
} catch (e) {
	assert(false, `apply(mockCtx) 抛错: ${e.message}`);
}
assert(calls.plugins.includes("SubUsageService"), "SubUsageService 已注册");
assert(calls.typert.length === 1 && calls.typert[0].package === "dsh-subusage", "typert 描述符已注册");
const ids = (calls.typert[0].invocations || []).map((d) => d.id).sort();
assert(ids.join(",") === ["read", "refresh", "save", "startMimoLogin", "getMimoLoginStatus", "cancelMimoLogin"].map(method => `dsh-subusage#subUsage/${method}`).sort().join(","), "invocations = read/refresh/save + 三个登录 RPC");
assert.summary();
