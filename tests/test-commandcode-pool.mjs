// Command Code 自动轮换池健康摘要（accountPool）：
// auto 模式下默认账户 entry 上挂逐账户分类（usable/blocked/unusable）与 exhausted；
// 固定模式、设置服务缺失时不挂；逐账户读取命中各自缓存，不重复打计费接口。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService } = await loadHostModule();
const C = "commandcode";
const WORK = "COMMANDCODE_ACCOUNT_WORK", SPARE = "COMMANDCODE_ACCOUNT_SPARE", NOKEY = "COMMANDCODE_ACCOUNT_NOKEY";
const RESET = "2026-01-01T05:00:00Z";
// fiveHour used/cap：used>=cap（cap>0）即 rate-limited。
const body = (used, cap) => ({ credits: { planId: "individual-goat", monthlyCredits: 55.86 }, windowLimits: { fiveHour: { used, cap, exceeded: false, resetAt: RESET } } });

function harness({ accounts, activeAccount = "", accountCredential = {}, topUsed = 1, respondExtra, topCredential = { value: "top-key" } } = {}) {
	const files = new Map();
	const calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync() {}, chmodSync() {}, renameSync() {}
	};
	const settingsService = { describe: () => [{ ns: "llm-commandcode", value: { accounts, activeAccount, accountEnrollmentTasks: [] }, revision: 1 }] };
	const ctx = { get() {}, llm: { listProviders: () => [{ id: C }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => Date.parse("2026-01-01T00:00:00Z"), settingsService,
		resolveCredentials: async () => topCredential,
		resolveEnvironment: () => undefined,
		resolveAccountCredentials: async ref => accountCredential[ref],
		resolveAccountEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push(url);
			const key = String(options?.headers?.authorization ?? "").replace("Bearer ", "");
			let used = topUsed;
			if (respondExtra) used = respondExtra(key) ?? topUsed;
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body(used, 4)) };
		}
	});
	return { service, calls, refresh: () => service.refresh({ providerIds: [C], force: false }) };
}
const THREE = [{ label: "工作号", apiKeyEnv: WORK }, { label: "备用号", apiKeyEnv: SPARE }, { label: "无凭据号", apiKeyEnv: NOKEY }];
const KEYS = { [WORK]: { value: "work-key" }, [SPARE]: { value: "spare-key" } };
const byKey = (map) => (key) => map[key];
const findPool = async (h) => (await h.refresh()).entries.find(e => e.providerId === C).accountPool;

// 部分受限：顶层与工作号健康、备用号限额、无凭据号不可用 → 池存在但不耗尽。
{
	const h = harness({
		accounts: THREE, accountCredential: KEYS,
		// top/work=1（健康），spare=4（限额）；NOKEY 拿不到凭据不会发请求。
		respondExtra: byKey({ "top-key": 1, "work-key": 1, "spare-key": 4 })
	});
	const pool = await findPool(h);
	assert.ok(pool, "auto 模式默认账户 entry 挂 accountPool");
	assert.equal(pool.mode, "auto");
	assert.equal(pool.total, 4, "默认 + 3 个额外账户（含无凭据）");
	assert.equal(pool.available, 2, "顶层 + 工作号可用");
	assert.equal(pool.blockedCount, 1, "备用号已限额");
	assert.equal(pool.unusableCount, 1, "无凭据号不可用");
	assert.equal(pool.exhausted, false, "仍有可用账户，池不算耗尽（不能误染红）");
	assert.equal(pool.accounts.find(a => a.id === "default").usable, true);
	assert.equal(pool.accounts.find(a => a.id === SPARE).blocked, true);
	assert.equal(pool.accounts.find(a => a.id === NOKEY).usable, false);
	assert.equal(pool.accounts.find(a => a.id === NOKEY).blocked, false);
	console.log("PASS 轮换池部分受限：分类正确且不误报耗尽");
}

// 全部有凭据账户都限额 → exhausted=true（这才是该染红的信号）。
{
	const h = harness({
		accounts: [{ label: "工作号", apiKeyEnv: WORK }, { label: "备用号", apiKeyEnv: SPARE }],
		accountCredential: KEYS, respondExtra: () => 4
	});
	const pool = await findPool(h);
	assert.equal(pool.available, 0);
	assert.equal(pool.blockedCount, 3, "顶层 + 2 额外全限额");
	assert.equal(pool.unusableCount, 0);
	assert.equal(pool.exhausted, true, "有凭据账户全部限额 = 池耗尽");
	console.log("PASS 轮换池耗尽：全部限额时 exhausted=true");
}

// 额外账户没凭据（不可用）但顶层健康：不算耗尽，无凭据账户计入 unusableCount。
// 注：顶层凭据还可能从 ~/.commandcode/auth.json 兜底（本机登录态），测试不假设它为空；
// 因此这里断言的是「无凭据额外账户被正确分类且不会触发池耗尽」，不强行制造顶层 no-key。
{
	const h = harness({
		accounts: [{ label: "无凭据号", apiKeyEnv: NOKEY }],
		respondExtra: byKey({ "top-key": 1 })
	});
	const pool = await findPool(h);
	const noKey = pool.accounts.find(a => a.id === NOKEY);
	assert.equal(noKey.state, "no-key", "无凭据引用的账户判为 no-key");
	assert.equal(noKey.usable, false);
	assert.equal(noKey.blocked, false);
	assert.equal(pool.unusableCount >= 1, true, "至少 1 个不可用账户");
	assert.equal(pool.exhausted, false, "仍有健康账户时不算池耗尽");
	console.log("PASS 无凭据额外账户计入不可用且不误报池耗尽");
}

// 固定账户模式：默认账户 entry 不挂池（用户已明确固定，看的就是那一个账户）。
{
	const h = harness({ accounts: THREE, activeAccount: WORK, accountCredential: KEYS, respondExtra: byKey({ "work-key": 1 }) });
	const pool = await findPool(h);
	assert.equal(pool, undefined, "固定模式不挂 accountPool");
	console.log("PASS 固定账户模式不挂池摘要");
}

// 点名单个额外账户刷新时不挂池（那条 entry 代表被点名账户本身，不是默认账户）。
{
	const h = harness({ accounts: THREE, accountCredential: KEYS, respondExtra: byKey({ "work-key": 1, "spare-key": 4 }) });
	const res = await h.service.refresh({ providerIds: [C], force: false, commandCodeAccount: WORK });
	assert.equal(res.entries.find(e => e.providerId === C).accountPool, undefined, "额外账户 entry 不挂池");
	console.log("PASS 点名单个账户时不挂池摘要");
}

// 缓存：auto 模式第二次刷新（TTL 内）不重复打额外账户的计费接口。
{
	const h = harness({ accounts: THREE, accountCredential: KEYS, respondExtra: byKey({ "top-key": 1, "work-key": 1, "spare-key": 1 }) });
	await findPool(h);
	const callsAfterFirst = h.calls.length;
	await findPool(h);
	assert.equal(h.calls.length, callsAfterFirst, "TTL 内第二次刷新复用各账户缓存，零新增计费请求");
	console.log("PASS 池逐账户读取命中缓存，不重复打接口");
}

console.log("Command Code 轮换池聚合测试全部通过 ✅");
