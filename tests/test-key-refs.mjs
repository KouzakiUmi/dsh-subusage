// 多 Key 监控：每个 provider 可配置多个凭据引用名；主条目始终跟随 DSH 路由实际 apiKeyEnv，
// 额外引用名只用于查看额度（keyAccounts），不参与药丸选择。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService } = await loadHostModule();
const K = "kimi-coding";
const A = "deepseek-account";

function setup({ routeRef = "KIMI_API_KEY", hasRoute = true } = {}) {
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {},
		writeFileSync(path, value) { files.set(path, value); },
		chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const credentials = {}, environment = {}, calls = [];
	const ctx = { get() {}, llm: { listProviders: () => [{ id: K }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => 1_000_000,
		resolveCredentials: async (id, ref) => credentials[ref],
		resolveEnvironment: (id, ref) => environment[ref],
		resolveAccountCredentials: async ref => credentials[ref],
		resolveAccountEnvironment: ref => environment[ref],
		fetch: async (url, options) => {
			calls.push({ url, options });
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ usages: { limit_5h: { used_ratio: 0.1 } } }) };
		},
		settingsService: { describe: () => [{ ns: "llm-pi-ai", value: { providers: { [K]: { apiKeyEnv: routeRef } } } }] }
	});
	ctx.llm.listConfigurableProviders = () => hasRoute ? [{ provider: K, settingsNs: "llm-pi-ai", settingsPath: ["providers", K] }] : [];
	return { service, credentials, environment, calls, files };
}

// 1) 保存与读回：合法引用名去重后落盘，公开快照按 provider 给出数组。
{
	const { service } = setup();
	const saved = await service.save({ providerId: K, keyRefs: ["KIMI_BACKUP_KEY", "KIMI_BACKUP_KEY", "KIMI_SECOND_KEY"] });
	assert.deepEqual(saved.settings.keyRefs[K], ["KIMI_BACKUP_KEY", "KIMI_SECOND_KEY"]);
	assert.deepEqual((await service.read({ providerIds: [K], force: false })).settings.keyRefs[K], ["KIMI_BACKUP_KEY", "KIMI_SECOND_KEY"]);
	// 非法引用名、超过上限、由提供方管理的凭据，都不接受自定义监控。
	assert.rejects(service.save({ providerId: K, keyRefs: ["bad name"] }), e => e.code === "subusage/invalid-request");
	assert.rejects(service.save({ providerId: K, keyRefs: Array.from({ length: 9 }, (_, i) => `KIMI_EXTRA_${i}`) }), e => e.code === "subusage/invalid-request");
	assert.rejects(service.save({ providerId: A, keyRefs: ["ACCOUNT_KEY"] }), e => e.code === "subusage/invalid-request");
	service.dispose();
}

// 2) 药丸跟随 DSH 实际调用的 Key：路由 apiKeyEnv 优先于额外引用名与内置名。
{
	const { service, credentials, environment, calls } = setup();
	credentials.KIMI_API_KEY = { value: "dsh-current" };
	environment.KIMI_BACKUP_KEY = { value: "backup-key" };
	await service.save({ providerId: K, keyRefs: ["KIMI_BACKUP_KEY"] });
	const out = await service.refresh({ providerIds: [K], force: true });
	const entry = out.entries.find(item => item.providerId === K);
	assert.equal(entry.keyRef, "KIMI_API_KEY", "主条目必须记下 DSH 路由实际使用的引用名");
	const primaryCall = calls.find(call => call.options.headers.authorization === "Bearer dsh-current");
	assert.ok(primaryCall, "主条目使用路由 apiKeyEnv 对应的 Key，而不是额外监控项");
	assert.equal(entry.keyAccounts.length, 1);
	assert.equal(entry.keyAccounts[0].ref, "KIMI_BACKUP_KEY");
	assert.equal(entry.keyAccounts[0].state, "ok");
	assert.equal(entry.keyAccounts[0].keySource, "env");
	assert.ok(entry.keyAccounts[0].windows.length > 0, "额外 Key 也要带自己的额度窗口");
	assert.equal(entry.keyAccounts[0].active, false);
	assert.notEqual(entry.account, "KIMI_BACKUP_KEY", "主条目不能被当成额外账户行");

	// DSH 侧换 Key：主条跟着换，额外监控项不顶掉它。
	credentials.KIMI_API_KEY = { value: "dsh-new" };
	const next = await service.refresh({ providerIds: [K], force: true });
	assert.equal(next.entries.find(item => item.providerId === K).keyRef, "KIMI_API_KEY");
	assert.ok(calls.some(call => call.options.headers.authorization === "Bearer dsh-new"));
	assert.ok(!calls.slice(-1).some(call => call.options.headers.authorization === "Bearer dsh-new"), "最后一次请求属于额外监控项");

	// 清空监控列表后不再产生额外账户。
	await service.save({ providerId: K, keyRefs: [] });
	const cleared = await service.refresh({ providerIds: [K], force: true });
	assert.equal(cleared.entries.find(item => item.providerId === K).keyAccounts, undefined);
	service.dispose();
}

// 3) 读不到路由 apiKeyEnv 时（未配置 / 旧 Core）：按额外引用名顺序回退，主条仍是第一把命中的 Key。
{
	const { service, environment } = setup({ routeRef: undefined, hasRoute: false });
	environment.KIMI_BACKUP_KEY = { value: "backup-only" };
	await service.save({ providerId: K, keyRefs: ["KIMI_BACKUP_KEY"] });
	const out = await service.refresh({ providerIds: [K], force: true });
	const entry = out.entries.find(item => item.providerId === K);
	assert.equal(entry.keyRef, "KIMI_BACKUP_KEY");
	assert.equal(entry.keySource, "env");
	assert.equal(entry.keyAccounts, undefined, "主条命中的引用名不重复列成额外账户");
	service.dispose();
}

console.log("PASS 多 Key 监控：引用名持久化、路由 Key 优先、额外额度与清空");
