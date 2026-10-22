// GitHub Copilot 额度：私有接口 GET /copilot_internal/user + dsh-copilot-auth 写入凭据库的 OAuth 记录。
// 只用虚构 token 与桩网络；不读真实凭据库，不访问真实接口。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, subUsageRemote, normalizeCopilotUsage, copilotCredentials } = await loadHostModule();
const ID = "github-copilot";
const KEY = "llm-pi-ai/github-copilot";
const fail = (fn, code) => assert.throws(fn, e => e.code === code, `应抛出 ${code}`);

// ── [1] 凭据：只读 refresh（长期 GitHub OAuth token），access（Copilot 会话令牌）不用 ─────────────
{
	const writes = () => { throw new Error("must not write credentials"); };
	const seen = [];
	const credentials = { readRecord: async key => { seen.push(key); return { kind: "grant", payload: { access: "tid=session;exp=1", refresh: "ghu_fixture", enterpriseUrl: undefined } }; }, set: writes, unset: writes, modifyRecord: writes, deleteRecord: writes };
	const cred = await copilotCredentials(credentials);
	assert.deepEqual(seen, [KEY], "读的是 pi-ai 内置 github-copilot 的凭据记录");
	assert.equal(cred.key, "ghu_fixture", "额度接口要长期 GitHub token，而不是 Copilot 会话令牌");
	assert.equal(cred.apiHost, "api.github.com");
	assert.equal(cred.source, "copilot-oauth");
	// 企业版（GHE.com）：API 主机换成 api.<域名>，带协议/路径的写法也认。
	assert.equal((await copilotCredentials({ readRecord: async () => ({ payload: { refresh: "r", enterpriseUrl: "https://octo.ghe.com/" } }) })).apiHost, "api.octo.ghe.com");
	assert.equal((await copilotCredentials({ readRecord: async () => ({ payload: { refresh: "r", enterpriseUrl: "octo.ghe.com" } }) })).apiHost, "api.octo.ghe.com");
	// 没有记录 / 没有 refresh = 未登录，不是错误。
	assert.equal(await copilotCredentials({ readRecord: async () => undefined }), undefined);
	assert.equal(await copilotCredentials({ readRecord: async () => ({ payload: { access: "only-access" } }) }), undefined, "只有短命会话令牌：宁可判未登录，也不拿它去冒充");
	assert.equal(await copilotCredentials({ readRecord: async () => ({ payload: { refresh: "   " } }) }), undefined);
	assert.equal(await copilotCredentials(undefined), undefined, "凭据服务不在就按未登录");
	assert.equal(await copilotCredentials({}), undefined);
	// 坏记录与可疑域名：报格式异常，且不回显任何 token。
	// 端口 / 路径 / 内嵌账号只取主机名（与提供方插件同一换算），不会被拼进请求地址。
	assert.equal((await copilotCredentials({ readRecord: async () => ({ payload: { refresh: "r", enterpriseUrl: "octo.ghe.com:8443/path" } }) })).apiHost, "api.octo.ghe.com");
	assert.equal((await copilotCredentials({ readRecord: async () => ({ payload: { refresh: "r", enterpriseUrl: "user:pw@octo.ghe.com" } }) })).apiHost, "api.octo.ghe.com");
	for (const payload of [null, "text", [], { refresh: "ghu_leak", enterpriseUrl: "localhost" }, { refresh: "ghu_leak", enterpriseUrl: "-bad-.com" }, { refresh: "ghu_leak", enterpriseUrl: "http://[::1]/" }, { refresh: "ghu_leak", enterpriseUrl: "a b.com" }]) {
		await assert.rejects(copilotCredentials({ readRecord: async () => ({ payload }) }), e => e.code === "subusage/credential" && !e.message.includes("ghu_leak"));
	}
	console.log("PASS Copilot 凭据：只读 refresh、企业域名换算、缺失按未登录、坏记录不回显 token");
}

// ── [2] 归一化：付费档 ────────────────────────────────────────────────────
{
	const out = normalizeCopilotUsage({
		copilot_plan: "individual_pro", quota_reset_date: "2026-11-01",
		quota_snapshots: {
			premium_interactions: { quota_id: "premium_interactions", entitlement: 300, remaining: 75, percent_remaining: 25, unlimited: false, overage_permitted: false, overage_count: 0 },
			chat: { unlimited: true, entitlement: -1, remaining: -1, percent_remaining: 100 },
			completions: { unlimited: true, entitlement: -1, remaining: -1, percent_remaining: 100 }
		}
	});
	assert.equal(out.windows.length, 1, "付费档的 chat / completions 是不设限哨兵，不画成 0%");
	const w = out.windows[0];
	assert.equal(w.kind, "month");
	assert.equal(w.percent, 75, "接口给的是剩余百分比，对外输出已用");
	assert.equal(w.resetsAt, "2026-11-01T00:00:00.000Z");
	assert.deepEqual(w.detail, { used: 225, limit: 300, unit: "requests" });
	assert.equal(w.groupLabel, "Premium requests");
	assert.deepEqual(out.extras, [{ kind: "plan", value: "individual_pro" }]);
	assert.equal(out.coverage, "complete");
	assert.equal(out.availability, undefined);
	// 真机形态（2026-10-23 实测）：remaining 取整、quota_remaining 浮点、credits_used 与账面一致；明细用 credits_used，百分比仍用 percent_remaining。
	const live = normalizeCopilotUsage({ copilot_plan: "individual", quota_reset_date: "2026-11-01", token_based_billing: true, quota_snapshots: {
		chat: { unlimited: true, entitlement: 0, remaining: 0, quota_remaining: 0, percent_remaining: 100, credits_used: 0 },
		completions: { unlimited: true, entitlement: 0, remaining: 0, quota_remaining: 0, percent_remaining: 100, credits_used: 0 },
		premium_interactions: { unlimited: false, entitlement: 1500, remaining: 755, quota_remaining: 755.6, percent_remaining: 50.3, credits_used: 744, overage_permitted: false, overage_count: 0 } } });
	assert.equal(live.windows.length, 1, "token_based_billing 在个人档也为 true：有真实窗口时不能被当成组织席位");
	assert.equal(live.windows[0].percent, 49.7);
	assert.deepEqual(live.windows[0].detail, { used: 744, limit: 1500, unit: "requests" });
	assert.deepEqual(live.extras, [{ kind: "plan", value: "individual" }]);
	// 缺 percent_remaining 时由 entitlement / remaining 推算；两者都缺则不画。
	assert.equal(normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 50 } } }).windows[0].percent, 75);
	assert.equal(normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 200 } } }).windows.length, 0);
	// quota_remaining（浮点）作 remaining 的兜底。
	assert.equal(normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 100, quota_remaining: 40.5 } } }).windows[0].percent, 59.5);
	// 用尽 = 100% 已用且限流态；没启用额外计费就没有续用建议。
	const spent = normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 0, percent_remaining: 0, overage_permitted: false } } });
	assert.equal(spent.windows[0].percent, 100);
	assert.equal(spent.windows[0].status, "rate-limited");
	assert.equal(spent.availability, undefined);
	// 启用额外计费：用尽后仍可按量续用，并如实标出超额次数。
	const over = normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 0, percent_remaining: 0, overage_permitted: true, overage_count: 12 } } });
	assert.equal(over.availability, "paygo");
	assert.equal(over.availabilityReason, "overage-permitted");
	assert.ok(over.extras.some(e => e.kind === "note" && e.value.includes("12")));
	// 超额记录不凭空增长窗口，也不在未启用额外计费时出现。
	assert.ok(!normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 10, percent_remaining: 3.3, overage_permitted: false, overage_count: 5 } } }).extras.some(e => e.kind === "note"));
	// 百分比被夹在 0..100：服务端异常值不让界面出现负数或 120%。
	assert.equal(normalizeCopilotUsage({ quota_snapshots: { premium_interactions: { entitlement: 10, percent_remaining: 130 } } }).windows[0].percent, 0);
	// 主池明确不设限：不画窗口，单独说明状态，coverage 仍完整。
	const unlimited = normalizeCopilotUsage({ copilot_plan: "enterprise", quota_snapshots: { premium_interactions: { unlimited: true, entitlement: -1 } } });
	assert.deepEqual(unlimited.windows, []);
	assert.deepEqual(unlimited.extras, [{ kind: "plan", value: "enterprise" }, { kind: "quota-status", value: "unlimited" }], "client 的「不设限」药丸只认 quota-status");
	assert.equal(unlimited.coverage, "complete");
	console.log("PASS Copilot 付费档：已用百分比换算、哨兵不画 0%、用尽与超额计费、不设限");
}

// ── [3] 归一化：免费档、组织席位、空体 ────────────────────────────────────
{
	// 免费档新形态：chat / completions 是真实计数。
	const free = normalizeCopilotUsage({ copilot_plan: "free", quota_reset_date: "2026-11-15", quota_snapshots: {
		chat: { entitlement: 50, remaining: 10, percent_remaining: 20 },
		completions: { entitlement: 2000, remaining: 500, percent_remaining: 25 },
		premium_interactions: { entitlement: 0, remaining: 0, percent_remaining: 100 } } });
	assert.deepEqual(free.windows.map(w => [w.groupLabel, w.percent]), [["Chat", 80], ["Completions", 75]], "零额度的占位主池不画");
	// 免费档旧形态：limited_user_quotas 是**剩余**，monthly_quotas 是总量。
	const legacy = normalizeCopilotUsage({ copilot_plan: "free", limited_user_reset_date: "2026-11-15", limited_user_quotas: { chat: 10, completions: 500 }, monthly_quotas: { chat: 50, completions: 2000 } });
	assert.deepEqual(legacy.windows.map(w => [w.groupLabel, w.percent, w.resetsAt]), [["Chat", 80, "2026-11-15T00:00:00.000Z"], ["Completions", 75, "2026-11-15T00:00:00.000Z"]]);
	assert.deepEqual(legacy.windows[0].detail, { used: 40, limit: 50, unit: "requests" });
	// 付费档残留 limited_* 字段不能冒出免费档窗口（主池已画时旧形态不读）。
	const paid = normalizeCopilotUsage({ limited_user_quotas: { chat: 1 }, monthly_quotas: { chat: 50 }, quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 300, percent_remaining: 100 } } });
	assert.deepEqual(paid.windows.map(w => w.groupLabel), ["Premium requests"]);
	assert.equal(paid.windows[0].percent, 0);
	// 没有分母就没有诚实的百分比。
	assert.equal(normalizeCopilotUsage({ limited_user_quotas: { chat: 10 }, monthly_quotas: { chat: 0 } }).windows.length, 0);
	assert.equal(normalizeCopilotUsage({ limited_user_quotas: { chat: 10 } }).windows.length, 0);
	// 组织席位：GitHub 不回个人额度，是合法空状态——说明原因，不画 0%，不报错。
	const org = normalizeCopilotUsage({ copilot_plan: "business", token_based_billing: true, quota_snapshots: { premium_interactions: { entitlement: 0, remaining: 0, percent_remaining: 100, overage_permitted: true } } });
	assert.deepEqual(org.windows, []);
	assert.equal(org.coverage, "partial");
	assert.ok(org.extras.some(e => e.kind === "note" && e.value.includes("组织")), "说明是组织计费");
	assert.ok(!org.extras.some(e => e.value.includes("超额")), "占位桶不能冒出超额提示");
	assert.equal(org.availability, undefined);
	// 个人档即使 token_based_billing=true 且没有任何窗口，也不能被说成组织席位（真机该字段个人档为 true）。
	const solo = normalizeCopilotUsage({ copilot_plan: "individual", token_based_billing: true, quota_snapshots: { premium_interactions: { entitlement: 0, remaining: 0 } } });
	assert.ok(!solo.extras.some(e => e.value.includes("组织")));
	// 什么都没有：如实说没检测到，而不是 0%。
	const empty = normalizeCopilotUsage({});
	assert.deepEqual(empty.windows, []);
	assert.deepEqual(empty.extras, [{ kind: "note", value: "未检测到 Copilot 额度窗口" }]);
	assert.equal(empty.coverage, "partial");
	// 空白套餐名不显示；非对象响应是格式错误。
	assert.deepEqual(normalizeCopilotUsage({ copilot_plan: "  ", quota_snapshots: { premium_interactions: { entitlement: 10, remaining: 5 } } }).extras, []);
	for (const body of [null, "x", []]) fail(() => normalizeCopilotUsage(body), "subusage/response");
	console.log("PASS Copilot 免费档新旧形态、组织席位空状态、残留字段隔离、坏响应");
}

// ── [4] Host 端到端：默认解析链、请求形状、缓存隔离、令牌不外泄 ──────────────────────
{
	let refresh = "ghu_first";
	const requests = [];
	const credentials = { readRecord: async key => (key === KEY ? { kind: "grant", payload: { access: "tid=short;exp=1", refresh, enterpriseUrl: undefined } } : undefined) };
	const files = new Map([["memory/subscription", JSON.stringify({ visibility: { providers: { [ID]: true } } })]]);
	const io = { readFileSync: path => { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); } };
	let status = 200;
	const body = { copilot_plan: "individual_pro", quota_reset_date: "2026-11-01", quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 150, percent_remaining: 50 } } };
	const service = new SubUsageService({ effect() {}, get: name => name === "credentials" ? credentials : undefined, llm: { listProviders: () => [{ id: ID }] } }, {
		io, configPath: "memory/subscription", resolveEnvironment: () => undefined,
		fetch: async (url, options) => { requests.push({ url, headers: options.headers, method: options.method }); return { ok: status === 200, status, headers: { get: () => null }, text: async () => JSON.stringify(body) }; }
	});
	const first = await service.refresh({ providerIds: [ID], force: false });
	const entry = first.entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(entry.keySource, "copilot-oauth");
	assert.equal(entry.apiDetected, true);
	assert.equal(entry.windows[0].percent, 50);
	assert.equal(entry.coverage, "complete");
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, "https://api.github.com/copilot_internal/user");
	assert.equal(requests[0].method, "GET");
	assert.equal(requests[0].headers.authorization, "token ghu_first", "scheme 是 token，不是 Bearer");
	assert.ok(requests[0].headers["editor-version"], "带官方客户端同源的头");
	assert.ok(!JSON.stringify(first).includes("ghu_first") && !JSON.stringify(first).includes("tid=short"), "结果里没有任何 token");
	// 同一登录 TTL 内命中缓存；换登录（refresh 变了）缓存指纹随之失效，不串账号。
	await service.refresh({ providerIds: [ID], force: false });
	assert.equal(requests.length, 1);
	refresh = "ghu_second";
	await service.refresh({ providerIds: [ID], force: false });
	assert.equal(requests.length, 2);
	assert.equal(requests[1].headers.authorization, "token ghu_second");
	// 401：登录或凭据已失效（subusage/auth），并且不沿用旧额度。
	refresh = "ghu_third"; status = 401;
	const rejected = (await service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(rejected.state, "error");
	assert.equal(rejected.errorCode, "subusage/auth");
	assert.ok(!JSON.stringify(rejected).includes("ghu_third"));
	service.dispose();
	console.log("PASS Copilot Host：默认解析链、token scheme、缓存按登录隔离、401 映射、结果不含 token");
}

// ── [5] 未登录 / 默认关闭 / 公共视图 ─────────────────────────────────────
{
	const make = (credentials, settings) => {
		const files = new Map([["memory/subscription", JSON.stringify(settings)]]);
		const io = { readFileSync: path => { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); } };
		let calls = 0;
		const service = new SubUsageService({ effect() {}, get: name => name === "credentials" ? credentials : undefined, llm: { listProviders: () => [{ id: ID }] } }, {
			io, configPath: "memory/subscription", resolveEnvironment: () => undefined,
			fetch: async () => { calls += 1; throw new Error("must not call network"); }
		});
		return { service, calls: () => calls };
	};
	// 没有登录：no-key + 去哪里登录，不发网络请求。
	const absent = make({ readRecord: async () => undefined }, { visibility: { providers: { [ID]: true } } });
	const entry = (await absent.service.refresh({ providerIds: [ID], force: false })).entries[0];
	assert.equal(entry.state, "no-key");
	assert.equal(entry.apiDetected, false);
	assert.ok(entry.error.includes("dsh-copilot-auth"));
	assert.equal(absent.calls(), 0);
	absent.service.dispose();
	// 默认关闭：不发任何网络请求（凭据解析是本地读取，与 Codex 同序）。
	const off = make({ readRecord: async () => ({ payload: { refresh: "ghu_x" } }) }, {});
	const disabled = (await off.service.refresh({ providerIds: [ID], force: false })).entries[0];
	assert.equal(disabled.state, "disabled");
	assert.equal(off.calls(), 0);
	off.service.dispose();
	// 不接受本地 Key：凭据归 Copilot 提供方，任何凭据补丁都被边界拒绝。
	const save = subUsageRemote.descriptors.find(d => d.method === "save");
	for (const patch of [{ keyUpdate: { action: "keep" } }, { keyMode: "manual" }, { cookieUpdate: { action: "keep" } }]) assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: ID, ...patch }), /managed by the provider plugin/);
	// 名字解析：厂商名、缩写与路由 id 都能点到这一条。
	const named = make({ readRecord: async () => undefined }, { visibility: { providers: { [ID]: true } } });
	for (const name of ["copilot", "GitHub Copilot", "github-copilot", "ghc", "dsh-copilot-auth"]) assert.deepEqual((await named.service.quota({ providerIds: [name] })).providers.map(p => p.providerId), [ID], `${name} → ${ID}`);
	named.service.dispose();
	console.log("PASS Copilot 未登录不发请求、默认关闭、拒绝本地 Key、别名解析");
}
