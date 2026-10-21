// OpenDesign：认证失效不是「某个额度池暂时读不到」。全部 IO/HTTP 为内存桩。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";
import { OPEN_DESIGN_CURRENT_URL, OPEN_DESIGN_SUMMARY_URL, openDesignUsageUrl } from "../lib/opendesign-login.js";

const { SubUsageService } = await loadHostModule();
const ID = "opendesign", PATH = "memory/opendesign-auth";
const COOKIE = "session=fixture-opendesign-auth";
const CURRENT = { workspaceId: "ws_auth", workspaceType: "personal" };
const USAGE = { eligible: true, tier: "plus", windows: [{ durationSeconds: 604800, usedCredits: "10", limitCredits: "100" }] };
const SUMMARY = { balanceUsd: "5", creditsPerUsd: 10000, balances: { subscriptionCredits: "40000" } };

function harness(workspaceType = "personal") {
	let expectedCookie = COOKIE;
	const files = new Map([[PATH, JSON.stringify({ keys: { [ID]: COOKIE }, keyModes: { [ID]: "manual" }, visibility: { providers: { [ID]: true } } })]]);
	const responses = {
		workspace: { status: 200, body: { ...CURRENT, workspaceType } },
		usage: { status: 200, body: USAGE },
		summary: { status: 200, body: SUMMARY }
	};
	const calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, chmodSync() {}, writeFileSync(path, value) { files.set(path, value); },
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: PATH, resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		fetch: async (url, init) => {
			assert.equal(init.headers.cookie, expectedCookie);
			const endpoint = url === OPEN_DESIGN_CURRENT_URL ? "workspace" : url === OPEN_DESIGN_SUMMARY_URL ? "summary" : url === openDesignUsageUrl(CURRENT.workspaceId) ? "usage" : null;
			assert.ok(endpoint, "只允许桩端点，不访问真实网络"); calls.push(endpoint);
			const response = responses[endpoint];
			if (response.network) throw new Error("fixture network outage");
			return { status: response.status, ok: response.status === 200, headers: { get: () => null }, text: async () => JSON.stringify(response.body) };
		}
	});
	return { service, responses, calls, setExpectedCookie(value) { expectedCookie = value; } };
}
const refresh = async (h, force = true) => (await h.service.refresh({ providerIds: [ID], force })).entries[0];
const authCases = [
	["工作区 401", { workspace: { status: 401 } }],
	["额度 401、钱包成功", { usage: { status: 401 } }],
	["钱包 401、额度成功", { summary: { status: 401 } }],
	["两端均 401", { usage: { status: 401 }, summary: { status: 401 } }],
	["额度 503、钱包 401", { usage: { status: 503 }, summary: { status: 401 } }],
	["额度 401、钱包 503", { usage: { status: 401 }, summary: { status: 503 } }],
	["额度 403、钱包成功", { usage: { status: 403 } }],
	["钱包 403、额度成功", { summary: { status: 403 } }],
	["额度业务认证错误", { usage: { status: 200, body: { code: 401 } } }],
	["钱包业务认证错误", { summary: { status: 200, body: { code: "403" } } }]
];
let authEntry;
for (const [label, changed] of authCases) {
	const h = harness();
	try {
		const before = await refresh(h);
		assert.equal(before.state, "ok"); assert.equal(before.coverage, "complete");
		assert.equal(before.windows.length, 1); assert.ok(before.extras.some(x => x.kind === "balance"));
		for (const [endpoint, response] of Object.entries(changed)) Object.assign(h.responses[endpoint], response);
		const entry = await refresh(h);
		assert.equal(entry.state, "error", `${label}：认证失败不能降级成部分成功`);
		assert.equal(entry.errorCode, "subusage/auth", label);
		assert.equal(entry.retryable, false, label);
		assert.equal(entry.retainPrevious, false, "认证失效不得保留上一身份的额度/余额");
		assert.notEqual(entry.freshness, "stale");
		assert.deepEqual(entry.windows ?? [], []); assert.deepEqual(entry.extras ?? [], []);
		const view = await h.service.quota({ providerIds: [ID] });
		assert.equal(view.providers[0].state, "error");
		assert.deepEqual(view.providers[0].windows, []); assert.deepEqual(view.providers[0].extras, []);
		assert.ok(!JSON.stringify(view).includes(COOKIE));
		authEntry = entry;
	} finally { h.service.dispose(); }
}

// 普通故障仍独立降级，不因修认证错误而把 429/5xx/坏响应当作 Cookie 失效。
for (const [endpoint, failure] of [
	["usage", { status: 503 }], ["summary", { status: 503 }],
	["usage", { status: 429 }], ["summary", { network: true }],
	["usage", { status: 200, body: {} }]
]) {
	const h = harness();
	try {
		Object.assign(h.responses[endpoint], failure);
		const entry = await refresh(h);
		assert.equal(entry.state, "ok"); assert.equal(entry.coverage, "partial");
		assert.notEqual(entry.errorCode, "subusage/auth");
		if (endpoint === "usage") {
			assert.equal(entry.windows.length, 0); assert.ok(entry.extras.some(x => x.kind === "balance"));
		} else {
			assert.equal(entry.windows.length, 1); assert.ok(!entry.extras.some(x => x.kind === "balance"));
		}
	} finally { h.service.dispose(); }
}

// 团队工作区不查钱包；额度认证错误仍是整条认证失败。
{
	const h = harness("team");
	try {
		h.responses.usage.status = 401;
		const entry = await refresh(h);
		assert.equal(entry.errorCode, "subusage/auth");
		assert.ok(!h.calls.includes("summary"));
	} finally { h.service.dispose(); }
}

// 换新 Cookie 后，错误缓存必须立即失效；无需等 60 秒或强制刷新。
{
	const h = harness();
	try {
		h.responses.summary.status = 401;
		assert.equal((await refresh(h)).errorCode, "subusage/auth");
		const next = "session=fixture-renewed-opendesign";
		await h.service.save({ providerId: ID, keyUpdate: { action: "replace", value: next }, keyMode: "manual" });
		h.setExpectedCookie(next); h.responses.summary.status = 200;
		const entry = await refresh(h, false);
		assert.equal(entry.state, "ok"); assert.equal(entry.coverage, "complete");
		assert.equal(entry.windows.length, 1); assert.ok(entry.extras.some(x => x.kind === "balance"));
		assert.equal(h.calls.length, 6);
	} finally { h.service.dispose(); }
}

// 使用实际 Host 认证错误验证 Client 的业务状态函数：不再显示「部分数据」。
let spec;
vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8").replace(
	"exports.apply = apply;", "exports.__test = { computeStatus, usageActionKind, canShowUsage, zh }; exports.apply = apply;"
), { window: { __ModuleLoader__: { load: value => { spec = value; } } }, console });
const api = spec.factory(() => ({ createElement() {}, Fragment: "fragment" })).__test;
const status = api.computeStatus(authEntry, { providerId: ID, t: key => api.zh[key] ?? key, getLocale: () => "zh-CN" });
assert.equal(status.key, "error"); assert.equal(status.sub, api.zh.errAuth);
assert.equal(api.canShowUsage(authEntry), false);
assert.equal(api.usageActionKind(authEntry, ID, key => key), "credentials", "出现凭据修复入口");
console.log("PASS OpenDesign 认证失效不降级、错误优先级、缓存隔离、普通故障双池降级与 Client 状态");
