// DeepSeek 官方余额：余额型（不是订阅窗口），与推理同一把 API Key。
// 官方契约：GET https://api.deepseek.com/user/balance（Bearer），
// 响应 { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }，
// 金额是字符串十进制。不访问真实接口，使用虚构 Key 与桩网络。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeDeepseekBalance } = await loadHostModule();
const ID = "deepseek";

// ── [1] 归一化 ───────────────────────────────────────────────────────────
{
	const out = normalizeDeepseekBalance({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] });
	assert.deepEqual(out.windows, [], "余额型不产出额度窗口");
	assert.equal(out.coverage, "complete");
	assert.equal(JSON.stringify(out.extras), JSON.stringify([{ kind: "balance", value: "110.00 CNY" }]));
	// 余额不可用是行动项（去充值），不是 0 元余额的展示问题。
	const empty = normalizeDeepseekBalance({ is_available: false, balance_infos: [{ currency: "CNY", total_balance: "0.00" }] });
	assert.equal(empty.extras.length, 2);
	assert.equal(empty.extras[1].value, "余额不足，请充值");
	assert.equal(empty.extras[0].value, "0.00 CNY", "零余额照实显示，不隐去");
	// 多币种取第一条可解析的；货币码不合规时只显示金额而不编造单位。
	assert.equal(normalizeDeepseekBalance({ is_available: true, balance_infos: [{ currency: "usd", total_balance: "5" }] }).extras[0].value, "5");
	// 非法或缺失一律报错，不当作 0。
	for (const body of [{}, { is_available: true }, { is_available: true, balance_infos: [] }, { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "abc" }] }, { is_available: "yes", balance_infos: [{ currency: "CNY", total_balance: "1" }] }]) {
		assert.throws(() => normalizeDeepseekBalance(body), `非法响应必须报错：${JSON.stringify(body)}`);
	}
	console.log("PASS DeepSeek 余额归一化：不产窗口、字符串金额、余额不足提示与非法值报错");
}

// ── [2] Host 端到端 ──────────────────────────────────────────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const key = "sk-fixture-deepseek";
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [{ id: ID }] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => id === ID ? { value: key } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "42.50" }] }) };
		}
	});
	let result = await service.read();
	assert.equal(result.settings.visibility.providers[ID], true, "主线 provider 默认开启");
	assert.equal(calls.length, 1);
	result = await service.refresh({ providerIds: [ID], force: true });
	const entry = result.entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(entry.coverage, "complete");
	assert.equal(calls[0].url, "https://api.deepseek.com/user/balance");
	assert.equal(calls[0].options.headers.authorization, `Bearer ${key}`, "与推理同一把 Key");
	assert.deepEqual(entry.windows, []);
	assert.equal(JSON.stringify(entry.extras), JSON.stringify([{ kind: "balance", value: "42.50 CNY" }]));
	assert.ok(!JSON.stringify(result).includes(key), "响应不回显 Key");
	service.dispose();
	console.log("PASS DeepSeek Host：默认开启、Bearer 同 Key、余额 extras 与密钥不回显");
}

// ── [3] Client：注册与余额兜底文案 ───────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, balanceText }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	assert.ok(client.__test.PROVIDER_ORDER.includes(ID), "deepseek 在提供商顺序中");
	assert.equal(client.__test.PROVIDER_META[ID].envName, "DEEPSEEK_API_KEY");
	assert.equal(client.__test.PROVIDER_META[ID].defaultEnabled, undefined, "默认开启");
	assert.equal(client.__test.balanceText({ extras: [{ kind: "balance", value: "42.50 CNY" }] }, (k) => k), "balanceLabel 42.50 CNY", "余额型药丸显示余额");
	console.log("PASS DeepSeek Client：注册、默认开启与余额兜底文案");
}

console.log("\nDeepSeek 余额测试全部通过 ✅");
