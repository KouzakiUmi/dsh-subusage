// dsh-go 手机引擎适配：环境检测、自动登录降级、原生登录页入口。
// 所有浏览器 / Cookie / IO / fetch 都是 dummy；绝不启动真实 Chrome。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { DSH_GO_RUNTIME_FILE, MOBILE_NO_BROWSER_MESSAGE, detectHostRuntime } from "../lib/host-env.js";

const { SubUsageService, subUsageRemote } = await loadHostModule();
const M = "xiaomi-token-plan-cn", OD = "opendesign";

// ── 1. 检测：只认 dsh-go 的标记文件，读不到就是桌面 ─────────────────────────
const RUNTIME = JSON.stringify({ dshGoBridge: "0.4.0", runtimeVersion: "r12-dsh0.2.1-rc.4-node24.22.1-ubuntu24.04.5", abi: "arm64-v8a" });
assert.deepEqual(detectHostRuntime({ readFileSync: () => RUNTIME }), { mobile: true, runtimeVersion: "r12-dsh0.2.1-rc.4-node24.22.1-ubuntu24.04.5", bridge: "0.4.0" });
assert.deepEqual(detectHostRuntime({ readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), { mobile: false }, "没有标记文件 = 桌面/服务器");
assert.deepEqual(detectHostRuntime({ readFileSync: () => "not json" }), { mobile: false }, "坏文件不能让整个插件起不来");
assert.deepEqual(detectHostRuntime({ readFileSync: () => "[]" }), { mobile: false }, "数组不是有效运行时描述");
assert.deepEqual(detectHostRuntime({ readFileSync: () => JSON.stringify({ dshGoBridge: "0.4.0" }) }), { mobile: true, bridge: "0.4.0" }, "缺版本号也算 dsh-go，只是没有版本可报");
// 标记路径是常量：改路径等于改判据，测试钉住它。
assert.equal(DSH_GO_RUNTIME_FILE, "/etc/dsh-app/runtime.json");

// ── 2. Host：没有浏览器时 start() 立刻给出可读失败，不排队、不启动 ─────────
function harness(options = {}) {
	let content = null, writes = 0, launches = 0, closes = 0;
	const events = {};
	const cookies = [
		{ name: "api-platform_serviceToken", value: "dummy-token", domain: ".xiaomimimo.com", path: "/", expires: -1 },
		{ name: "userId", value: "dummy-user", domain: "platform.xiaomimimo.com", path: "/api/v1", expires: -1 }
	];
	const browser = { on(event, cb) { events[event] = cb; }, async close() { closes++; }, async newContext() { return { cookies: async () => cookies, newPage: async () => ({ on(event, cb) { events[`page:${event}`] = cb; }, goto: async () => {} }) }; } };
	const io = { readFileSync(path) { if (path === DSH_GO_RUNTIME_FILE) { if (options.mobile) return RUNTIME; throw Object.assign(new Error("missing"), { code: "ENOENT" }); } if (content === null) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return content; }, mkdirSync() {}, writeFileSync(_, value) { writes++; content = value; }, chmodSync() {}, renameSync() {} };
	const service = new SubUsageService({ effect() {}, get() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "dummy/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		fetch: async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ data: { balance: "0", currency: "CNY" } }) }),
		mimoLogin: { pollMs: 1, timeoutMs: 1000, launch: async () => { launches++; return browser; } }
	});
	return { service, get launches() { return launches; }, get closes() { return closes; }, get writes() { return writes; }, revision: () => service.result(service.load(), []).settings.revision };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const desktop = harness({ mobile: false });
assert.equal(desktop.service.result(desktop.service.load(), []).host.browserLogin, true, "桌面主机照旧可以自动登录");
assert.equal(desktop.service.result(desktop.service.load(), []).host.mobile, false);
desktop.service.dispose();

const phone = harness({ mobile: true });
const phoneResult = phone.service.result(phone.service.load(), []);
assert.equal(phoneResult.host.mobile, true);
assert.equal(phoneResult.host.browserLogin, false, "手机引擎要明确告诉 UI 不能自动登录");
assert.equal(phoneResult.host.bridge, "0.4.0");
assert.throws(() => phone.service.startMimoLogin({ expectedRevision: phone.revision() }), e => e.code === "subusage/no-browser", "没有浏览器时 start 直接给出 no-browser，而不是排队后超时");
assert.throws(() => phone.service.startOpenDesignLogin({ expectedRevision: phone.revision() }), e => e.code === "subusage/no-browser", "OpenDesign 走同一套 CookieLogin 骨架，同样降级");
assert.equal(phone.launches, 0, "降级路径绝不调用 chromium.launch");
assert.equal(phone.service.getMimoLoginStatus().state, "idle", "失败不留下假的任务状态");
assert.equal(phone.writes, 0);
// 手动导入仍然可用：Cookie 补丁不走浏览器。
const savedCookie = await phone.service.save({ providerId: M, cookieUpdate: { action: "replace", value: "api-platform_serviceToken=dummy-token; userId=dummy-user" } });
assert.equal(savedCookie.settings.xiaomi.hasCookie, true, "手机引擎仍能手动保存 Cookie");
phone.service.dispose();

// 桌面主机继续按原流程启动（这条守住「适配不能把桌面一起关掉」）。
const desktopRun = harness({ mobile: false });
const start = desktopRun.service.startMimoLogin({ expectedRevision: desktopRun.revision() });
assert.equal(start.state, "launching");
for (let i = 0; i < 200; i++) { if (["success", "error", "cancelled"].includes(desktopRun.service.getMimoLoginStatus().state)) break; await delay(2); }
assert.equal(desktopRun.service.getMimoLoginStatus().state, "success", "桌面主机自动登录行为不变");
assert.equal(desktopRun.launches, 1);
desktopRun.service.dispose();

// ── 3. 错误码与公开字段的契约 ───────────────────────────────────────────────
assert.ok(subUsageRemote.descriptors.length > 0);
assert.equal(MOBILE_NO_BROWSER_MESSAGE.includes("Chrome"), true, "兜底原文要说清原因");
console.log("PASS dsh-go 环境检测：标记文件判定、桌面行为不变、手机引擎降级为 no-browser、手动导入仍可用");
