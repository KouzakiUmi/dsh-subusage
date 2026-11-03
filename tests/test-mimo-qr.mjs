// 小米扫码登录：nonce 精度、签名、Cookie 解析、状态机与降级。
// 全部用注入的 fetch 桩，绝不发起真实请求、不触碰真实小米账号。
import assert from "node:assert/strict";
import { clientSign, cookieHeader, MimoQrLogin, parsePollResponse, parseSetCookies } from "../lib/mimo-qr.js";

// ── 1. nonce 精度：这是整条链路最容易出错的一处 ─────────────────────────────
// 19 位整数超出 Number.MAX_SAFE_INTEGER，JSON.parse 会把末几位改写，签名随之算错（服务端 401）。
const RAW = `&&&START&&&{"code":0,"userId":900000001,"nonce":1582322695214275584,"ssecurity":"TEST_S_SECURITY_abc123","location":"https://platform.xiaomimimo.com/sts?ticket=1","passToken":"V1:pwRO"}`;
const parsed = parsePollResponse(RAW);
assert.equal(parsed.nonce, "1582322695214275584", "nonce 必须保留原始字面量，不能被 JSON.parse 改写");
// 直接 JSON.parse 的确会丢精度——这条断言钉住"为什么需要 parsePollResponse"。
assert.notEqual(String(JSON.parse(RAW.replace("&&&START&&&", "")).nonce), "1582322695214275584");
assert.equal(parsed.userId, 900000001);
assert.equal(parsed.ssecurity, "TEST_S_SECURITY_abc123");
// 小整数不该被改成字符串（避免无谓的类型漂移）。
assert.equal(parsePollResponse(`&&&START&&&{"nonce":42}`).nonce, 42);

// ── 2. clientSign：与小米 STS 的算法一致 ────────────────────────────────────
// 已知向量：nonce + ssecurity 拼成 `nonce=<nonce>&<ssecurity>`，SHA1 后 base64。
const sign = clientSign("1582322695214275584", "TEST_S_SECURITY_abc123");
// 固定答案向量（KAT）：算法被改动（换哈希、换拼接顺序、漏 & 分隔符）都会立刻失败。
// 该值由 `base64(sha1("nonce=1582322695214275584&TEST_S_SECURITY_abc123"))` 独立算出并钉死。
assert.equal(sign, "uS4A2bXzou2vpL22CxKvcwjGUGE=", "clientSign 必须等于已知向量");
assert.match(sign, /^[A-Za-z0-9+/]+=*$/, "clientSign 是 base64");
// 用同一份输入必须稳定；换 nonce 必须变（说明它真的参与计算）。
assert.equal(sign, clientSign("1582322695214275584", "TEST_S_SECURITY_abc123"));
assert.notEqual(sign, clientSign("1582322695214276000", "TEST_S_SECURITY_abc123"), "精度被改写的 nonce 会算出不同签名");

// ── 3. Cookie 解析 ─────────────────────────────────────────────────────────
assert.equal(cookieHeader(["a=1; Path=/", "b=2; Max-Age=100"]), "a=1; b=2");
assert.equal(cookieHeader(["novalue"]), "", "没有 = 的项不参与拼接");
const pairs = parseSetCookies(["api-platform_serviceToken=tok; Path=/", "userId=42; Path=/"]);
assert.deepEqual(pairs.find(item => item.name === "api-platform_serviceToken"), { name: "api-platform_serviceToken", value: "tok" });

// ── 4. 状态机：出码 → 等待 → 验证 → 成功，凭据不外泄 ─────────────────────────
const NOW = 1793552400000;
function harness({ mobile = true } = {}) {
	let committed = null;
	const calls = [];
	const errors = [];
	const fakeFetch = async (url, init) => {
		calls.push(String(url));
		const ok = (body, headers = {}) => ({
			ok: true,
			headers: { get: name => headers[name.toLowerCase()] ?? null, getSetCookie: () => headers["set-cookie"] ?? [] },
			text: async () => body,
			arrayBuffer: async () => new Uint8Array([1, 2, 3])
		});
		if (url.includes("/pass/serviceLogin")) {
			return ok(`&&&START&&&{"_sign":"SIGN","qs":"?sid=api-platform"}`, { "set-cookie": ["deviceId=dev1; Path=/"] });
		}
		if (url.includes("/longPolling/loginUrl")) {
			return ok(`&&&START&&&{"code":0,"qr":"https://account.xiaomi.com/qr.png","qrTips":"用小米手机扫码","lp":"https://ak.lp.account.xiaomi.com/lp/s?k=ticket1","timeout":300}`, { "set-cookie": ["uLocale=zh; Path=/"] });
		}
		if (url.includes("qr.png")) return ok("", { "content-type": "image/png" });
		if (url.startsWith("https://ak.lp.account.xiaomi.com/lp/s")) {
			return ok(RAW, { "set-cookie": ["passToken=V1:pwRO; Max-Age=2592000", "userId=900000001; Path=/"] });
		}
		if (url.includes("/sts?")) {
			return ok("", { "set-cookie": ["api-platform_serviceToken=TOK; Path=/", "userId=900000001; Path=/"] });
		}
		throw new Error("unexpected url " + url);
	};
	const login = new MimoQrLogin({
		error: (code, message) => Object.assign(new Error(message), { code }),
		capture: () => "captured-material",
		verify: async cookie => {
			assert.match(cookie, /api-platform_serviceToken=TOK/);
			assert.match(cookie, /userId=900000001/);
			return { balanceOk: true, usageError: null, coverage: "complete", windows: [{ kind: "month" }] };
		},
		commit: (cookie, captured, verified, expiresAt, renewal) => {
			committed = { cookie, captured, verified, expiresAt, renewal };
			return { revision: "rev-1", settings: {}, entries: [] };
		},
		reconcileResult: result => result
	}, { now: () => NOW, fetch: fakeFetch, timeoutMs: 300000, mobile });
	return { login, calls, errors, get committed() { return committed; } };
}

const run = harness();
const started = run.login.start({ expectedRevision: "rev-1" });
assert.equal(started.state, "starting", "start 立即返回，不等网络");
assert.equal(started.jobId.length > 0, true);

// 等状态机跑完（出码 + 长轮询 + 换票 + 验证 + 保存都是注入的即时响应）。
for (let i = 0; i < 200 && !["success", "error", "cancelled"].includes(run.login.status().state); i++) {
	await new Promise(resolve => setTimeout(resolve, 5));
}
const done = run.login.status();
assert.equal(done.state, "success", "完整链路应走到 success");
assert.equal(done.message.includes("扫码登录成功"), true);
assert.equal(run.committed.captured, "captured-material", "commit 收到的是 start 时捕获的 revision 材料");
assert.equal(run.committed.expiresAt, NOW + 2592000 * 1000, "passToken 一个月有效期来自 Max-Age");
// 续期材料：userId + passToken + deviceId（第 1 步下发）+ passToken 有效期，随 commit 交给 Host 保存。
assert.deepEqual(run.committed.renewal, { userId: "900000001", passToken: "V1:pwRO", deviceId: "dev1", expiresAt: NOW + 2592000 * 1000 }, "扫码成功必须把续期材料交给 Host");
// 凭据绝不进公开状态。
assert.equal(JSON.stringify(done).includes("passToken"), false, "公开状态不得包含 passToken");
assert.equal(JSON.stringify(done).includes("TOK"), false, "公开状态不得包含 serviceToken");

// 关键步骤都被真实调用过，顺序也符合协议。
const sequence = ["/pass/serviceLogin", "/longPolling/loginUrl", "qr.png", "https://ak.lp.account.xiaomi.com/lp/s", "/sts?"];
let cursor = 0;
for (const part of sequence) {
	const found = run.calls.findIndex((url, index) => index >= cursor && url.includes(part));
	assert.notEqual(found, -1, `应按顺序请求 ${part}`);
	cursor = found;
}
run.login.dispose();

// ── 5. 取消与超时 ───────────────────────────────────────────────────────────
// 让长轮询一直挂着，模拟"用户还没扫码"。fetch 必须在构造时注入（实例会捕获它）。
const slowLogin = new MimoQrLogin({
	error: (code, message) => Object.assign(new Error(message), { code }),
	capture: () => "captured",
	verify: async () => ({ balanceOk: true, coverage: "complete", windows: [] }),
	commit: () => ({}),
	reconcileResult: () => null
}, {
	now: () => NOW,
	timeoutMs: 300000,
	fetch: async (url, init) => {
		const ok = (body, headers = {}) => ({ headers: { get: () => headers["content-type"] ?? null, getSetCookie: () => headers["set-cookie"] ?? [] }, text: async () => body, arrayBuffer: async () => new Uint8Array([1]) });
		if (url.includes("/pass/serviceLogin")) return ok(`&&&START&&&{"_sign":"S","qs":"q"}`, { "set-cookie": ["deviceId=d"] });
		if (url.includes("/longPolling/loginUrl")) return ok(`&&&START&&&{"code":0,"qr":"https://account.xiaomi.com/qr.png","lp":"https://ak.lp.account.xiaomi.com/lp/s?k=ticket2","timeout":300}`, { "set-cookie": [] });
		if (url.includes("qr.png")) return ok("", { "content-type": "image/png" });
		if (url.startsWith("https://ak.lp.account.xiaomi.com/lp/s")) return new Promise((_, reject) => {
			init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
		});
		throw new Error("unexpected " + url);
	}
});
const startedSlow = slowLogin.start({ expectedRevision: "rev-1" });
for (let i = 0; i < 100 && slowLogin.status().state !== "waiting"; i++) await new Promise(r => setTimeout(r, 5));
const waiting = slowLogin.status();
assert.equal(waiting.state, "waiting", "出码后进入等待扫码");
assert.match(waiting.qr, /^data:image\/png;base64,/, "二维码以 data URL 交给 UI");
assert.equal(waiting.expiresInSec, 300, "有效期来自服务端 timeout");
const cancelled = slowLogin.cancel({ jobId: startedSlow.jobId });
assert.equal(cancelled.state, "cancelled");
assert.equal(slowLogin.status().state, "cancelled");
// 取消后再次 start 应能重新出码（上一次的终态不阻塞新任务）。
const again = slowLogin.start({ expectedRevision: "rev-1" });
assert.notEqual(again.jobId, startedSlow.jobId, "重新开始是一个新任务");
slowLogin.dispose();

// ── 6. 错误路径：每一类协议异常都必须给出明确错误码，且不泄漏凭据 ─────────────
// 这些分支此前完全没有覆盖，而 M3/M4/M5 三个缺陷恰好都落在这片空白里。
async function expectError(label, fakeFetch, expectedCode) {
	const login = new MimoQrLogin({
		error: (code, message) => Object.assign(new Error(message), { code }),
		capture: () => "cap", verify: async () => ({ balanceOk: true, coverage: "complete", windows: [] }),
		commit: () => ({}), reconcileResult: () => null
	}, { now: () => NOW, fetch: fakeFetch, timeoutMs: 300000 });
	login.start({ expectedRevision: "rev-1" });
	for (let i = 0; i < 300 && !["success", "error", "cancelled"].includes(login.status().state); i++) await new Promise(r => setTimeout(r, 5));
	const state = login.status();
	assert.equal(state.state, "error", `${label} 应为 error`);
	assert.equal(state.errorCode, expectedCode, `${label} 错误码应为 ${expectedCode}`);
	// 错误消息里不允许出现任何凭据字样。
	for (const secret of ["passToken", "serviceToken", "ssecurity", "nonce=", "api-platform_serviceToken"]) {
		assert.equal(String(state.message).includes(secret), false, `${label} 的错误消息不得含 ${secret}`);
	}
	login.dispose();
}
const mkOk = (body, headers = {}) => ({ headers: { get: () => headers.ct ?? null, getSetCookie: () => headers.sc ?? [] }, text: async () => body, arrayBuffer: async () => new Uint8Array([1]) });
const STAGE1 = `&&&START&&&{"_sign":"S","qs":"q"}`;
const STAGE2 = `&&&START&&&{"code":0,"qr":"https://account.xiaomi.com/qr.png","lp":"https://ak.lp.account.xiaomi.com/lp/s?k=t","timeout":300}`;

await expectError("缺 _sign", async url => mkOk(url.includes("/pass/serviceLogin") ? `&&&START&&&{}` : STAGE2), "subusage/login-protocol");
await expectError("缺 qr", async url => mkOk(url.includes("/pass/serviceLogin") ? STAGE1 : `&&&START&&&{"code":0}`), "subusage/login-protocol");
await expectError("二维码域名不可信", async url => {
	if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1, { sc: ["deviceId=d"] });
	if (url.includes("/longPolling")) return mkOk(`&&&START&&&{"code":0,"qr":"https://evil.example/qr.png","lp":"https://ak.lp.account.xiaomi.com/lp/s?k=t","timeout":300}`);
	return mkOk("");
}, "subusage/login-protocol");
await expectError("扫码未完成", async url => {
	if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1, { sc: ["deviceId=d"] });
	if (url.includes("/longPolling")) return mkOk(STAGE2);
	if (url.includes("qr.png")) return mkOk("", { ct: "image/png" });
	return mkOk(`&&&START&&&{"code":1,"description":"未扫码"}`);
}, "subusage/auth");
await expectError("缺 nonce/ssecurity", async url => {
	if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1, { sc: ["deviceId=d"] });
	if (url.includes("/longPolling")) return mkOk(STAGE2);
	if (url.includes("qr.png")) return mkOk("", { ct: "image/png" });
	return mkOk(`&&&START&&&{"code":0,"userId":1,"location":"https://platform.xiaomimimo.com/sts?t=1","passToken":"PT"}`);
}, "subusage/login-protocol");
await expectError("换票地址不可信", async url => {
	if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1, { sc: ["deviceId=d"] });
	if (url.includes("/longPolling")) return mkOk(STAGE2);
	if (url.includes("qr.png")) return mkOk("", { ct: "image/png" });
	return mkOk(`&&&START&&&{"code":0,"userId":1,"nonce":1234567890123456789,"ssecurity":"SS","location":"https://evil.example/sts?t=1","passToken":"PT"}`);
}, "subusage/login-protocol");
await expectError("未下发 serviceToken", async url => {
	if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1, { sc: ["deviceId=d"] });
	if (url.includes("/longPolling")) return mkOk(STAGE2);
	if (url.includes("qr.png")) return mkOk("", { ct: "image/png" });
	if (url.includes("lp/s")) return mkOk(`&&&START&&&{"code":0,"userId":1,"nonce":1234567890123456789,"ssecurity":"SS","location":"https://platform.xiaomimimo.com/sts?t=1","passToken":"PT"}`);
	return mkOk("", { sc: ["userId=1; Path=/"] });
}, "subusage/auth");
await expectError("网络失败", async () => { throw new TypeError("fetch failed"); }, "subusage/login-network");

// M5 回归：换票 Cookie 必须同时含第 1 步的 deviceId 与长轮询下发的 passToken。
{
	// 第 1 步没下发 deviceId：不保存续期材料（自造设备号小米不认），但登录本身照常成功。
	let seen;
	const login = new MimoQrLogin({
		error: (code, message) => Object.assign(new Error(message), { code }),
		capture: () => "cap", verify: async () => ({ balanceOk: true, coverage: "complete", windows: [] }),
		commit: (cookie, captured, verified, expiresAt, renewal) => { seen = { renewal }; return { revision: "r" }; }, reconcileResult: result => result
	}, {
		now: () => NOW, timeoutMs: 300000,
		fetch: async (url) => {
			if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1);
			if (url.includes("/longPolling")) return mkOk(STAGE2);
			if (url.includes("qr.png")) return mkOk("", { ct: "image/png" });
			if (url.includes("lp/s")) return mkOk(`&&&START&&&{"code":0,"userId":1,"nonce":1234567890123456789,"ssecurity":"SS","location":"https://platform.xiaomimimo.com/sts?t=1","passToken":"PT"}`);
			return mkOk("", { sc: ["api-platform_serviceToken=TOK; Path=/", "userId=1; Path=/"] });
		}
	});
	login.start({ expectedRevision: "rev-1" });
	for (let i = 0; i < 300 && !["success", "error"].includes(login.status().state); i++) await new Promise(r => setTimeout(r, 5));
	assert.equal(login.status().state, "success");
	assert.equal(seen.renewal, undefined, "没有 deviceId 时不保存续期材料");
	login.dispose();
}

// M5 回归：换票 Cookie 必须同时含第 1 步的 deviceId 与长轮询下发的 passToken。
{
	let seenCookie = "";
	const login = new MimoQrLogin({
		error: (code, message) => Object.assign(new Error(message), { code }),
		capture: () => "cap", verify: async () => ({ balanceOk: true, coverage: "complete", windows: [] }),
		commit: () => ({ revision: "r" }), reconcileResult: result => result
	}, {
		now: () => NOW, timeoutMs: 300000,
		fetch: async (url, init) => {
			if (url.includes("/pass/serviceLogin")) return mkOk(STAGE1, { sc: ["deviceId=DEV1; Path=/"] });
			if (url.includes("/longPolling")) return mkOk(STAGE2);
			if (url.includes("qr.png")) return mkOk("", { ct: "image/png" });
			if (url.includes("lp/s")) return mkOk(`&&&START&&&{"code":0,"userId":1,"nonce":1234567890123456789,"ssecurity":"SS","location":"https://platform.xiaomimimo.com/sts?t=1","passToken":"PT"}`, { sc: ["passToken=PT; Max-Age=2592000"] });
			if (url.includes("/sts")) { seenCookie = init.headers.Cookie; return mkOk("", { sc: ["api-platform_serviceToken=TOK; Path=/", "userId=1; Path=/"] }); }
			throw new Error("unexpected " + url);
		}
	});
	login.start({ expectedRevision: "rev-1" });
	for (let i = 0; i < 300 && !["success", "error"].includes(login.status().state); i++) await new Promise(r => setTimeout(r, 5));
	assert.equal(login.status().state, "success");
	assert.match(seenCookie, /deviceId=DEV1/, "换票必须带上第 1 步下发的 deviceId");
	assert.match(seenCookie, /passToken=PT/, "换票也必须带上扫码得到的 passToken");
	login.dispose();
}

console.log("PASS 小米扫码登录：nonce 精度、clientSign、Cookie 解析、完整状态机与凭据不外泄");
