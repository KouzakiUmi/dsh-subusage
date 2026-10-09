// SiliconFlow（硅基流动）：余额型 provider —— GET /v1/user/info，Bearer 与推理同一把 Key。
// 余额没有上限也就没有百分比，因此不产出额度窗口，只产出 extras，由客户端的余额兜底文案显示。
// 不访问真实接口，使用虚构 Key 与桩网络。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeSiliconFlow } = await loadHostModule();
const ID = "siliconflow";

// ── [1] 归一化 ───────────────────────────────────────────────────────────
{
	const out = normalizeSiliconFlow({ data: { balance: 12.34, chargeBalance: 10, totalBalance: 12.34, status: "ok" } });
	assert.deepEqual(out.windows, [], "余额型不产出额度窗口");
	assert.equal(out.coverage, "complete", "余额本身就是完整信息，不标 partial");
	assert.equal(JSON.stringify(out.extras), JSON.stringify([{ kind: "balance", value: "12.34 CNY" }]), "余额带货币");
	// 缺 totalBalance 时回落到 balance。
	assert.equal(normalizeSiliconFlow({ data: { balance: 5 } }).extras[0].value, "5 CNY");
	assert.equal(normalizeSiliconFlow({ data: { totalBalance: 0 } }).extras[0].value, "0 CNY", "0 余额是合法值");
	assert.equal(normalizeSiliconFlow({ data: { totalBalance: 12.345 } }).extras[0].value, "12.35 CNY", "收敛到两位小数");
	// 非法或缺失余额一律报错，不当作 0。
	for (const data of [undefined, null, {}, { balance: "12" }, { balance: -1 }, { totalBalance: Number.NaN }, []]) {
		assert.throws(() => normalizeSiliconFlow({ data }), `非法响应必须报错：${JSON.stringify(data)}`);
	}
	console.log("PASS SiliconFlow 归一化：不产窗口、balance 兜底、两位小数、非法值报错");
}

// ── [2] Host 端到端 ──────────────────────────────────────────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const key = "sk-fixture-siliconflow";
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => id === ID ? { value: key } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { balance: 20.5, totalBalance: 20.5, chargeBalance: 20.5, status: "ok" } }) };
		}
	});
	let result = await service.read();
	assert.equal(result.settings.visibility.providers[ID], false, "新增厂商默认关闭");
	assert.equal(calls.length, 0, "默认关闭时即使继承到 Key 也不访问网络");
	result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	result = await service.refresh({ providerIds: [ID], force: true });
	const entry = result.entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(entry.apiDetected, true);
	assert.equal(entry.coverage, "complete");
	assert.equal(calls[0].url, "https://api.siliconflow.cn/v1/user/info");
	assert.equal(calls[0].options.headers.authorization, `Bearer ${key}`, "与推理同一把 Key，直接 Bearer");
	assert.deepEqual(entry.windows, [], "余额型没有额度窗口");
	assert.equal(JSON.stringify(entry.extras), JSON.stringify([{ kind: "balance", value: "20.5 CNY" }]));
	assert.ok(!JSON.stringify(result).includes(key), "响应不回显 Key");
	// 认证类错误按统一映射处理，不把余额缺失当作 0。
	assert.equal(service.dispose(), undefined);
	console.log("PASS SiliconFlow Host：默认关闭、Bearer 直连、余额 extras 与密钥不回显");
}

// ── [3] Client：注册与余额兜底文案 ───────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, balanceText }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	assert.ok(client.__test.PROVIDER_ORDER.includes(ID), "siliconflow 在提供商顺序中");
	assert.equal(client.__test.PROVIDER_META[ID].defaultEnabled, false, "默认关闭");
	assert.equal(client.__test.PROVIDER_META[ID].envName, "SILICONFLOW_API_KEY");
	const t = (key) => key;
	assert.equal(client.__test.balanceText({ extras: [{ kind: "balance", value: "20.5 CNY" }] }, t), "balanceLabel 20.5 CNY", "无窗口时药丸显示余额");
	assert.equal(client.__test.balanceText({ extras: [{ kind: "plan", value: "pro" }] }, t), null, "只有套餐名时仍回落到「暂无额度数据」");
	assert.equal(client.__test.balanceText({}, t), null);
	assert.equal(client.__test.balanceText(null, t), null);
	console.log("PASS SiliconFlow Client：注册、默认关闭与余额兜底文案");
}

console.log("\nSiliconFlow 适配测试全部通过 ✅");
