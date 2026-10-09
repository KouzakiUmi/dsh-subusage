// OpenAI Codex / ChatGPT 订阅用量：私有后端接口 + Codex CLI 的 OAuth 登录文件。
// 凭据与 OPENAI_API_KEY 是两套：auth_mode 不是 chatgpt 时按未配置处理，不拿 API Key 冒充订阅凭据。
// 不访问真实接口，使用虚构 token 与桩网络；不读本机真实 ~/.codex/auth.json。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, subUsageRemote, normalizeCodexUsage, codexAuthFileCredentials } = await loadHostModule();
const ID = "openai-codex";
const RESET_5H = "2026-10-09T12:00:00.000Z", RESET_7D = "2026-10-15T00:00:00.000Z";

// ── [1] 登录文件解析 ─────────────────────────────────────────────────────
{
	const auth = (value) => ({ readFileSync: () => JSON.stringify(value) });
	assert.equal(JSON.stringify(codexAuthFileCredentials(auth({ auth_mode: "chatgpt", tokens: { access_token: "tok", account_id: "acc" } }), {})), JSON.stringify({ key: "tok", accountId: "acc" }));
	assert.equal(codexAuthFileCredentials(auth({ auth_mode: "chatgpt", tokens: { access_token: "tok" } }), {}).accountId, undefined, "缺 account_id 也接受");
	// API Key 模式取不到订阅额度：宁可判未配置，也不拿 API Key 去冒充订阅凭据。
	assert.equal(codexAuthFileCredentials(auth({ auth_mode: "apikey", tokens: { access_token: "tok" } }), {}), undefined, "auth_mode 不是 chatgpt 时拒绝");
	assert.equal(codexAuthFileCredentials(auth({ OPENAI_API_KEY: "sk-x" }), {}), undefined, "只有 API Key 的文件拒绝");
	assert.equal(codexAuthFileCredentials(auth({ auth_mode: "chatgpt", tokens: {} }), {}), undefined);
	assert.equal(codexAuthFileCredentials(auth({ auth_mode: "chatgpt", tokens: { access_token: "   " } }), {}), undefined, "空白 token 拒绝");
	assert.equal(codexAuthFileCredentials({ readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }, {}), undefined, "文件不存在不抛错");
	assert.equal(codexAuthFileCredentials(auth("not an object"), {}), undefined);
	// CODEX_HOME 决定去哪找；默认是 ~/.codex。
	let seen;
	const spy = { readFileSync(path) { seen = path; return "{}"; } };
	codexAuthFileCredentials(spy, { CODEX_HOME: "D:/codex-home" });
	assert.ok(seen.includes("codex-home") && seen.endsWith("auth.json"), `CODEX_HOME 生效：${seen}`);
	codexAuthFileCredentials(spy, {});
	assert.ok(seen.includes(".codex"), `默认目录回落到 ~/.codex：${seen}`);
	console.log("PASS Codex 登录文件：auth_mode 门禁、account_id 可选、缺失/损坏不抛错、CODEX_HOME 覆盖");
}

// ── [2] 归一化 ───────────────────────────────────────────────────────────
{
	const out = normalizeCodexUsage({ rate_limit: {
		primary_window: { used_percent: 42.5, resets_at: RESET_5H },
		secondary_window: { used_percent: 71, resets_at: RESET_7D } } });
	assert.deepEqual(out.windows.map(w => w.kind), ["5h", "7d"], "主/次窗口按位置回退命名");
	assert.equal(out.windows[0].percent, 42.5);
	assert.equal(out.windows[0].resetsAt, new Date(RESET_5H).toISOString());
	assert.equal(out.coverage, "complete");
	assert.equal(out.windows[0].status, "ok");
	// 免费档的次窗口是 30 天：有 window_seconds 时按它判窗口名。
	assert.equal(normalizeCodexUsage({ rate_limit: { secondary_window: { used_percent: 10, window_seconds: 2592000 } } }).windows[0].kind, "month");
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 10, window_seconds: 604800 } } }).windows[0].kind, "week");
	// 实测（2026-10-09 真机）：resets_at 是 Unix **秒数**；ISO 串也要认，两种都不能丢。
	const epoch = 1791552890;
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 54, resets_at: epoch, window_seconds: 18000 } } }).windows[0].resetsAt, new Date(epoch * 1000).toISOString(), "秒级时间戳要转成 ISO");
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 54, resets_at: RESET_5H } } }).windows[0].resetsAt, new Date(RESET_5H).toISOString(), "ISO 串照常");
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 54, reset_at: epoch } } }).windows[0].resetsAt, new Date(epoch * 1000).toISOString(), "reset_at 同样处理");
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 54, resets_at: 0 } } }).windows[0].resetsAt, undefined, "哨兵 0 不输出");
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 100, resets_at: RESET_5H } } }).windows[0].status, "rate-limited", "100% 即限流");
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 10, window_seconds: 604800 } } }).coverage, "partial", "单窗口算部分");
	// 200 但没有窗口 = 该账号没有可读的订阅额度，不是 0%。
	const none = normalizeCodexUsage({});
	assert.deepEqual(none.windows, []);
	assert.equal(JSON.stringify(none.extras), JSON.stringify([{ kind: "plan", value: "未检测到订阅额度窗口" }]));
	// credits：只有真正报告了可用余额才显示，不把「无额度」画成 0。
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 1 } }, credits: { has_credits: true, unlimited: false, balance: "62500" } }).extras[0].value, "62500");
	// plan_type 给套餐档位（真机实测值 "plus"）。
	assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 1 } }, plan_type: "plus" }).extras[0].value, "plus");
	assert.deepEqual(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 1 } }, plan_type: "  " }).extras, [], "空白档位不显示");
	// 真机形态：plan_type + has_credits=false 的 credits。
	const live = normalizeCodexUsage({ plan_type: "plus", credits: { has_credits: false, unlimited: false, balance: "0" }, rate_limit: { primary_window: { used_percent: 54, resets_at: 1791552890, window_seconds: 18000 }, secondary_window: { used_percent: 40, resets_at: 1792061126, window_seconds: 604800 } } });
	assert.deepEqual(live.windows.map(w => w.kind), ["5h", "week"]);
	assert.equal(live.extras.length, 1, "has_credits=false 不显示余额");
	assert.equal(live.extras[0].value, "plus");
	for (const credits of [{ has_credits: false, balance: "62500" }, { has_credits: true, unlimited: true, balance: "62500" }, { has_credits: true, balance: "0" }, { has_credits: true }]) {
		assert.equal(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 1 } }, credits }).extras.length, 0, `不该显示余额：${JSON.stringify(credits)}`);
	}
	assert.throws(() => normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: "x" } } }), "非法百分比报错");
	console.log("PASS Codex 归一化：窗口命名、限流、单窗口 partial、credits 门禁与非法值报错");
}

// ── [3] Host 端到端 ──────────────────────────────────────────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const token = "fixture-codex-access-token";
	const codexAuth = async () => ({ key: token, accountId: "acct-fixture" });
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [{ id: ID }] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		resolveCodexAuth: codexAuth,
		fetch: async (url, options) => {
			calls.push({ url, options });
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ rate_limit: { primary_window: { used_percent: 30, resets_at: RESET_5H }, secondary_window: { used_percent: 60, resets_at: RESET_7D } } }) };
		}
	});
	let result = await service.read();
	// Codex 默认关闭：它的提供方插件自带用量药丸，两个并排只是重复信息（用户仍可手动开启）。
	assert.equal(result.settings.visibility.providers[ID], false, "默认关闭，避免与提供方插件的药丸重复");
	assert.equal(result.configured[ID], true);
	assert.equal(calls.length, 0, "默认关闭时不为它发请求");
	assert.equal(result.entries.find(e => e.providerId === ID).state, "disabled", "关闭状态如实报告");
	// 默认关闭只是「不打扰」，不是「不能用」：下面要验证读取路径，这里显式开启它。
	// 注意 visibility 补丁按设计不带 providerId（那是逐条凭据补丁的字段）。
	await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	result = await service.refresh({ providerIds: [ID], force: true });
	const entry = result.entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(entry.keySource, "auth-file");
	assert.deepEqual(entry.windows.map(w => w.kind), ["5h", "7d"]);
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/usage");
	assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`, "Bearer 是 OAuth access token");
	assert.ok(!JSON.stringify(result).includes(token), "响应不回显 token");
	// 不接受本地凭据编辑（凭据归 Codex CLI）。
	const saveSchema = subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema;
	assert.throws(() => saveSchema.parse({ providerId: ID, expectedRevision: "r", keyUpdate: { action: "replace", value: "x" } }));
	// 没有登录文件时不拿 API Key 冒充：走 no-key 且文案点名 codex login。
	const bare = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config2", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		resolveCodexAuth: async () => undefined, fetch: async () => { throw new Error("不该发请求"); }
	});
	// 先开启：Codex 现在默认关闭（提供方插件自带药丸），不开启只会拿到 disabled，测不到 no-key 指引。
	await bare.save({ expectedRevision: (await bare.read()).settings.revision, visibility: { providers: { [ID]: true } } });
	const bareResult = await bare.refresh({ providerIds: [ID], force: true });
	assert.equal(bareResult.entries[0].state, "no-key");
	assert.ok(bareResult.entries[0].error.includes("codex login"), "指明用 codex login");
	assert.ok(bareResult.entries[0].error.includes("auth_mode"), "说明 API Key 模式取不到额度");
	service.dispose(); bare.dispose();
	console.log("PASS Codex Host：只读登录文件、Bearer 请求、窗口解析、拒写凭据与 no-key 指引");
}

// ── [4] Client 注册 ──────────────────────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	assert.ok(client.__test.PROVIDER_ORDER.includes(ID), "openai-codex 在提供商顺序中");
	assert.equal(client.__test.PROVIDER_META[ID].managedByPlugin, true, "凭据由 CLI 管理，不渲染本地凭据编辑");
	assert.equal(client.__test.PROVIDER_META[ID].short, "Codex");
	console.log("PASS Codex Client：注册、凭据来源只读与标签");
}

console.log("\nCodex 订阅用量测试全部通过 ✅");
