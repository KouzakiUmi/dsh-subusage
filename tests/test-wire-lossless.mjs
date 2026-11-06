// wire lossless-JSON 回归：quota() / readLinked() 的输出必须能通过 DSH typert 的
// isRemoteJsonValue 校验——嵌套 undefined、NaN/Infinity/-0、非普通对象、带洞数组都会被拒，
// 整条 subusage_quota 工具输出作废（实际事故：火山窗口的 `resetsAt: undefined`）。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

// ── 与 DSH asar 内 visitJsonValue 同口径的扫描器 ─────────────────────────
// 规则对照：原始值有限即可；number 必须 finite 且非 -0；非普通对象原型判违规；
// 数组不得有洞/额外键；对象不得有 undefined 属性值或符号键；循环引用判违规。
function* badPaths(value, path = "$", ancestors = new Set()) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0)) yield `${path} = ${Object.is(value, -0) ? "-0" : String(value)}`;
		return;
	}
	if (typeof value !== "object") { yield `${path} = ${String(value)} (非对象非原始值)`; return; }
	if (ancestors.has(value)) { yield `${path} (循环引用)`; return; }
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.getPrototypeOf(value) !== Array.prototype) yield `${path} (数组原型被改)`;
			if (Reflect.ownKeys(value).length !== value.length + 1) yield `${path} (数组带额外键/洞)`;
			for (let i = 0; i < value.length; i++) {
				if (!Object.hasOwn(value, i)) { yield `${path}[${i}] (洞)`; continue; }
				yield* badPaths(value[i], `${path}[${i}]`, ancestors);
			}
		} else {
			if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
				yield `${path} (非普通对象: ${value.constructor?.name})`;
			for (const key of Object.keys(value)) {
				const v = value[key];
				if (v === undefined) yield `${path}.${key} = undefined (属性值)`;
				else yield* badPaths(v, `${path}.${key}`, ancestors);
			}
			for (const sym of Object.getOwnPropertySymbols(value)) yield `${path}[Symbol] (符号键)`;
		}
	} finally { ancestors.delete(value); }
}
const assertLossless = (value, label) => {
	const bad = [...badPaths(value)];
	assert.deepEqual(bad, [], `${label} 输出必须全量 lossless：${bad.slice(0, 5).join("；")}`);
};

// ── 工具 schema 必填字段核对：lossless 只是能过编解码，subusage_quota 还要过 output
// schema。label 曾只在展开账号行上缺席（wire 合法但 schema 必填，整条工具输出仍被判错）。
const TOOL_REQUIRED = ["providerId", "label", "state", "windows", "extras"];
const WINDOW_REQUIRED = ["kind", "percent", "status"];
const EXTRA_REQUIRED = ["kind", "value"];
const assertToolShape = (value, label) => {
	const bad = [];
	(value.providers ?? []).forEach((e, i) => {
		for (const k of TOOL_REQUIRED) if (e?.[k] === undefined) bad.push(`providers[${i}].${k}`);
		(e?.windows ?? []).forEach((w, j) => { for (const k of WINDOW_REQUIRED) if (w?.[k] === undefined) bad.push(`providers[${i}].windows[${j}].${k}`); });
		(e?.extras ?? []).forEach((x, j) => { for (const k of EXTRA_REQUIRED) if (x?.[k] === undefined) bad.push(`providers[${i}].extras[${j}].${k}`); });
		(e?.quotas ?? []).forEach((q, j) => { if (q?.type === undefined) bad.push(`providers[${i}].quotas[${j}].type`); });
	});
	assert.deepEqual(bad, [], `${label} 输出必须符合工具 schema 必填字段：${bad.slice(0, 8).join("、")} 缺席`);
};

const { SubUsageService } = await loadHostModule();
const io = {
	readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
	mkdirSync() {}, writeFileSync() {}, chmodSync() {}, renameSync() {}
};

// ── [1] Magpie 聚合卡：linkedAccounts 展开 + quotas/windows/extras ───────
{
	const snapshot = {
		cards: { data: [
			{ provider: "kimi", name: "Kimi", user: "k@x.dev", windows: [{ name: "5 hours", used: 40 }], last: true },
			{ provider: "devin", name: "Devin", user: "d@x.dev", windows: [{ name: "day", used: 12 }], error: "upstream 500" }
		] },
		usage: { rows: [{ agent: "dsh", req: "auto/auto-k", provider: "kimi", served: "kimi/k3", status: 200, t: "2026-11-06T04:59:00Z" }] },
		concurrency: { active: [{ agent: "dsh", model: "auto/auto-k", provider: "kimi", phase: "streaming" }] },
		models: { data: [{ id: "auto/auto-k", owned_by: "kimi" }, { id: "auto/no-owner" }] }
	};
	const service = new SubUsageService({ get: () => undefined }, {
		io, configPath: "memory/config", resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined, linkedTimeoutMs: 2000,
		resolveMagpieUsage: async () => snapshot
	});
	assertLossless(await service.readLinked({ providerIds: ["magpie"], force: true }), "readLinked(magpie)");
	const quotaMagpie = await service.quota({ providerIds: ["magpie"] });
	assertLossless(quotaMagpie, "quota(magpie)");
	assertToolShape(quotaMagpie, "quota(magpie)");
	service.dispose();
	console.log("PASS wire-lossless：Magpie 聚合卡 quota()/readLinked() 全量 lossless");
}

// ── [2] 火山哨兵重置时间：resetsAt 缺席而非 undefined 属性 ────────────────
{
	const credentials = new Map();
	credentials.set("VOLC_ACCESSKEY", { value: "AKLTTestKey" });
	credentials.set("VOLC_SECRETKEY", { value: "TestSecret" });
	const io2 = { ...io };
	const files = new Map();
	io2.readFileSync = p => { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); };
	io2.writeFileSync = (p, v) => files.set(p, v);
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io: io2, configPath: "memory/config",
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		resolveCredentialByName: async name => credentials.get(name),
		fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ Result: { QuotaUsage: [
			{ Level: "session", Percent: 0, ResetTimestamp: -1 },
			{ Level: "weekly", Percent: 10, ResetTimestamp: 1791734400 }
		] } }) })
	});
	files.set("memory/config", JSON.stringify({ visibility: { ark: true, providers: { "arkcli-coding-plan": true } } }));
	const result = await service.quota({ providerIds: ["arkcli-coding-plan"], force: true });
	const entry = result.providers.find(e => e.providerId === "arkcli-coding-plan");
	assert.ok(entry && entry.state === "ok", "哨兵路径下条目仍可读");
	assert.ok(!Object.hasOwn(entry.windows[0], "resetsAt"), "哨兵 -1 不产 resetsAt 属性");
	assertLossless(result, "quota(arkcli-coding-plan)");
	assertToolShape(result, "quota(arkcli-coding-plan)");
	service.dispose();
	console.log("PASS wire-lossless：火山哨兵重置时间不破坏 quota() lossless");
}

// ── [3] 全量扫描兜底：任何 provider 的 quota() 输出都过谓词 ───────────────
{
	const service = new SubUsageService({ get: () => undefined }, {
		io, configPath: "memory/config", resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined, linkedTimeoutMs: 2000,
		resolveMagpieUsage: async () => { throw new Error("off"); }
	});
	const result = await service.quota({ providerIds: [] });
	assertLossless(result, "quota(全量缺凭据)");
	assertToolShape(result, "quota(全量缺凭据)");
	service.dispose();
	console.log("PASS wire-lossless：全量 quota()（缺凭据/缺席形态）lossless");
}
