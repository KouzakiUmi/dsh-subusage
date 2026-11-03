// MiMo 控制台 Cookie 静默续期：扫码登录留下的 passToken 在 Cookie 临近到期 / 被拒绝时换新会话，
// 失败时才提示重新扫码。全部用注入的 fetch 与虚构凭据，不触碰真实小米账号。
import assert from "node:assert/strict";
import { mergeCookieHeaders, renewMimoSession } from "../lib/mimo-qr.js";
import { loadHostModule } from "./helpers.mjs";

const M = "xiaomi-token-plan-cn";
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const T0 = Date.parse("2026-03-01T00:00:00Z");
const COOKIE0 = "api-platform_serviceToken=OLD_TOKEN; userId=900000001";
const RENEWAL = { userId: "900000001", passToken: "V1:PASS_A", deviceId: "wb_dev-1", expiresAt: T0 + 30 * DAY };
const NONCE = "1582322695214275584";

// ── 1. renewMimoSession：协议、Cookie 合并、轮换与错误分类 ─────────────────────
const res = (body, { status = 200, cookies = [] } = {}) => ({ status, ok: status < 400, headers: { get: () => null, getSetCookie: () => cookies }, text: async () => body, arrayBuffer: async () => new Uint8Array() });
const ticket = (extra = "") => `&&&START&&&{"code":0,"userId":900000001,"nonce":${NONCE},"ssecurity":"SSEC","location":"https://platform.xiaomimimo.com/sts?t=1"${extra}}`;

assert.equal(mergeCookieHeaders("a=1; b=2", "b=3; c=4"), "a=1; b=3; c=4", "同名 Cookie 后者覆盖前者");

{
	const seen = [];
	const out = await renewMimoSession({
		userId: "900000001", passToken: "V1:PASS_A", deviceId: "wb_dev-1", now: () => T0,
		fetch: async (url, init) => {
			seen.push({ url, cookie: init.headers.Cookie });
			if (url.includes("/pass/serviceLogin")) return res(ticket(), { cookies: ["passToken=V1:PASS_B; Max-Age=2592000", "extra=1; Path=/"] });
			if (url.includes("/sts?")) return res("", { cookies: ["api-platform_serviceToken=NEW_TOKEN; Path=/"] });
			throw new Error("unexpected " + url);
		}
	});
	assert.equal(out.cookie, "api-platform_serviceToken=NEW_TOKEN; userId=900000001", "新会话沿用 userId");
	assert.equal(out.passToken, "V1:PASS_B", "服务端轮换 passToken 时返回新值");
	assert.equal(out.passTokenExpiresAt, T0 + 2592000 * 1000);
	assert.match(seen[0].cookie, /userId=900000001/); assert.match(seen[0].cookie, /passToken=V1:PASS_A/); assert.match(seen[0].cookie, /deviceId=wb_dev-1/);
	assert.match(seen[1].cookie, /passToken=V1:PASS_B/, "换票带上服务端刚轮换的 passToken，且覆盖旧值");
	assert.equal((seen[1].cookie.match(/passToken=/g) || []).length, 1, "换票 Cookie 不得重复同名项");
	assert.match(seen[1].url, /clientSign=/);
}
const renewError = async (label, fetch, code) => {
	await assert.rejects(renewMimoSession({ userId: "1", passToken: "P", deviceId: "d", fetch, now: () => T0 }), error => { assert.equal(error.code, code, label); for (const secret of ["passToken", "PASS", "ssecurity", "SSEC", "OLD_TOKEN"]) assert.equal(String(error.message).includes(secret), false, `${label} 的错误消息不得含凭据`); return true; });
};
await renewError("passToken 被拒（无 location）", async () => res(`&&&START&&&{"code":70016,"_sign":"S","qs":"q"}`), "subusage/auth");
await renewError("缺换票参数", async () => res(`&&&START&&&{"code":0,"location":"https://platform.xiaomimimo.com/sts?t=1"}`), "subusage/login-protocol");
await renewError("应答不是 JSON", async () => res("<html>"), "subusage/login-protocol");
await renewError("换票地址不可信", async () => res(`&&&START&&&{"code":0,"nonce":1,"ssecurity":"S","location":"https://evil.example/sts?t=1"}`), "subusage/login-protocol");
await renewError("未下发 serviceToken", async url => url.includes("/sts?") ? res("", { cookies: ["userId=1"] }) : res(ticket()), "subusage/auth");
await renewError("网络失败", async () => { throw new TypeError("fetch failed"); }, "subusage/login-network");
await renewError("5xx", async () => res("", { status: 503 }), "subusage/login-network");

// ── 2. Host：到期前静默续期、被拒时续期、失败提示与重试节奏 ────────────────────
const { SubUsageService } = await loadHostModule();
function harness({ renewal = RENEWAL, expiresAt = T0 + DAY, cookie = COOKIE0, renewHandler, apiHandler } = {}) {
	const initial = { xiaomi: { cookie, loginAt: T0, expiresAt, ...(renewal ? { renewal } : {}) } };
	const files = new Map([["memory/config", JSON.stringify(initial)]]);
	let now = T0;
	const io = {
		readFileSync: path => { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync: (path, value) => files.set(path, value), chmodSync() {},
		renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); }
	};
	const calls = { api: [], renew: [] };
	const ctx = { get() {}, llm: { listProviders: () => [{ id: M }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => now,
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		fetch: async (url, init) => {
			const cookieHeader = init.headers.cookie;
			calls.api.push({ url, cookie: cookieHeader });
			const handled = apiHandler?.(url, cookieHeader);
			if (handled) return handled;
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(url.endsWith("/balance") ? { data: { balance: "1", currency: "CNY" } } : { data: {} }) };
		},
		mimoRenewFetch: async (url, init) => { calls.renew.push(url); return renewHandler(url, init); }
	});
	return { service, calls, tick: ms => { now += ms; return now; }, stored: () => JSON.parse(files.get("memory/config")), raw: () => files.get("memory/config") };
}
const okRenew = (token = "NEW_TOKEN", extra = []) => async url => url.includes("/pass/serviceLogin") ? res(ticket(), { cookies: extra }) : res("", { cookies: [`api-platform_serviceToken=${token}; Path=/`] });
const read = async h => (await h.service.refresh({ providerIds: [M], force: true })).entries[0];

// 2a. 未临近到期：不请求小米登录服务，沿用现有 Cookie。
{
	const h = harness({ renewHandler: okRenew() });
	const entry = await read(h);
	assert.equal(entry.state, "ok");
	assert.equal(h.calls.renew.length, 0, "距到期还早，不得续期");
	assert.equal(entry.cookieRenewable, true, "有续期材料时下发 cookieRenewable");
	assert(h.calls.api.every(call => call.cookie === COOKIE0));
}

// 2b. 临近到期：取数前静默续期，新 Cookie 落盘、重新计时，且不触发「读取期间配置已改变」。
{
	const h = harness({ renewHandler: okRenew("NEW_TOKEN", ["passToken=V1:PASS_B; Max-Age=2592000"]) });
	h.tick(DAY - 5 * MIN);
	const result = await h.service.refresh({ providerIds: [M], force: true });
	const entry = result.entries[0];
	assert.equal(entry.state, "ok", "续期成功后正常读到额度");
	assert.notEqual(entry.errorCode, "subusage/config-changed", "续期引起的设置变化不能被当成读取期间配置被改");
	assert.equal(h.calls.renew.filter(url => url.includes("/pass/serviceLogin")).length, 1);
	assert(h.calls.api.length > 0 && h.calls.api.every(call => call.cookie.includes("NEW_TOKEN")), "额度请求必须用新 Cookie");
	const stored = h.stored();
	assert.match(stored.xiaomi.cookie, /NEW_TOKEN/);
	assert.equal(stored.xiaomi.loginAt, T0 + DAY - 5 * MIN, "续期重新计时");
	assert.equal(stored.xiaomi.expiresAt, T0 + DAY - 5 * MIN + DAY);
	assert.equal(stored.xiaomi.renewal.passToken, "V1:PASS_B", "轮换后的 passToken 落盘");
	assert.equal(entry.cookieExpiresAt, new Date(stored.xiaomi.expiresAt).toISOString());
	// 公开面：只有「已开启 / 有效期」，没有任何凭据。
	assert.equal(result.settings.xiaomi.autoRenew, true);
	assert.equal(result.settings.xiaomi.renewExpiresAt, new Date(stored.xiaomi.renewal.expiresAt).toISOString());
	for (const secret of ["PASS_A", "PASS_B", "NEW_TOKEN", "OLD_TOKEN", "wb_dev-1"]) assert.equal(JSON.stringify(result).includes(secret), false, `公开结果不得含 ${secret}`);
	// 续期后到期还远：再读不再续期。
	await read(h);
	assert.equal(h.calls.renew.filter(url => url.includes("/pass/serviceLogin")).length, 1);
}

// 2c. 已过期同样先续再读，不拿过期 Cookie 请求上游。
{
	const h = harness({ renewHandler: okRenew() });
	h.tick(DAY + 3 * 60 * MIN);
	const entry = await read(h);
	assert.equal(entry.state, "ok");
	assert(h.calls.api.every(call => !call.cookie.includes("OLD_TOKEN")), "过期 Cookie 不得再发往上游");
}

// 2d. 上游提前拒绝 Cookie（本地计时没到）：换新会话重试一次。
{
	const h = harness({ renewHandler: okRenew(), apiHandler: (url, cookie) => cookie.includes("OLD_TOKEN") ? { ok: false, status: 401, headers: { get: () => null }, text: async () => "{}" } : undefined });
	h.tick(60 * MIN);
	const entry = await read(h);
	assert.equal(entry.state, "ok", "被拒后续期并重试，用户无感");
	assert.equal(h.calls.renew.filter(url => url.includes("/pass/serviceLogin")).length, 1);
	assert.match(h.stored().xiaomi.cookie, /NEW_TOKEN/);
	assert.equal(entry.cookieRenewable, true);
}

// 2e. passToken 被拒：Cookie 过期后给出「续期失败，请重新扫码」，且不重复请求已失效的登录态。
{
	const h = harness({ renewHandler: async () => res(`&&&START&&&{"code":70016,"_sign":"S"}`) });
	h.tick(DAY + MIN);
	const entry = await read(h);
	assert.equal(entry.state, "error");
	assert.equal(entry.errorCode, "subusage/mimo-renew-failed");
	assert.equal(entry.renewFailed, true);
	assert.match(entry.error, /重新扫码/);
	assert.equal(h.calls.api.length, 0, "续期失败且 Cookie 已过期时不再请求上游");
	for (let i = 0; i < 3; i++) { h.tick(5 * MIN); await read(h); }
	assert.equal(h.calls.renew.length, 1, "passToken 已被拒，不得反复请求小米登录服务");
	// 用户重新扫码（换了续期材料）后立即恢复，且新材料可以再次续期。
	const material = h.service.mimoMaterial(h.service.load());
	h.service.commitMimoLogin("api-platform_serviceToken=FRESH; userId=900000001", material, { balanceOk: true, coverage: "complete", windows: [] }, 0, { userId: "900000001", passToken: "V1:PASS_C", deviceId: "wb_dev-2", expiresAt: h.tick(0) + 30 * DAY });
	const recovered = await read(h);
	assert.equal(recovered.state, "ok");
	assert.equal(recovered.cookieRenewable, true);
	assert.equal(h.stored().xiaomi.renewal.passToken, "V1:PASS_C");
}

// 2f. 临近到期但未过期时续期失败：继续用现有 Cookie，不抢先报错。
{
	const h = harness({ renewHandler: async () => res(`&&&START&&&{"code":70016}`) });
	h.tick(DAY - 5 * MIN);
	const entry = await read(h);
	assert.equal(entry.state, "ok", "Cookie 还没过期，续期失败不影响读取");
	assert(h.calls.api.some(call => call.cookie.includes("OLD_TOKEN")));
}

// 2g. 网络失败：不提示重新扫码，按间隔自动重试，恢复后自愈。
{
	let online = false;
	const h = harness({ renewHandler: async (url, init) => { if (!online) throw new TypeError("fetch failed"); return okRenew()(url, init); } });
	h.tick(DAY + MIN);
	const entry = await read(h);
	assert.equal(entry.state, "error");
	assert.equal(entry.errorCode, "subusage/mimo-renew-network");
	assert.equal(entry.renewFailed, undefined, "网络失败不是「需要重新扫码」");
	assert.equal(entry.retryable, true);
	const attempts = h.calls.renew.length;
	h.tick(10 * 1000); await read(h);
	assert.equal(h.calls.renew.length, attempts, "重试间隔内不重复请求");
	online = true; h.tick(61 * 1000);
	const healed = await read(h);
	assert.equal(healed.state, "ok", "网络恢复后自动续上");
}

// 2h. 没有续期材料（手动 / 浏览器登录）：行为与改动前完全一致。
{
	const h = harness({ renewal: null, renewHandler: async () => { throw new Error("不应请求"); } });
	h.tick(DAY - 5 * MIN);
	const entry = await read(h);
	assert.equal(entry.state, "ok");
	assert.equal(entry.cookieRenewable, undefined);
	assert.equal(h.calls.renew.length, 0);
	const rejected = harness({ renewal: null, renewHandler: async () => { throw new Error("不应请求"); }, apiHandler: () => ({ ok: false, status: 401, headers: { get: () => null }, text: async () => "{}" }) });
	const denied = await read(rejected);
	assert.equal(denied.state, "error"); assert.match(denied.errorCode, /auth/);
}

// 2i. 续期材料只跟着它换出来的 Cookie 走：手动粘贴 / 清除都会丢弃，避免把别的账号续成旧账号。
{
	const h = harness({ renewHandler: okRenew() });
	assert.equal(h.service.load().xiaomi.renewal.passToken, "V1:PASS_A");
	const pasted = await h.service.save({ providerId: M, cookieUpdate: { action: "replace", value: "api-platform_serviceToken=OTHER; userId=2" } });
	assert.equal(pasted.settings.xiaomi.autoRenew, false, "手动粘贴的 Cookie 没有续期材料");
	assert.equal(h.stored().xiaomi.renewal, undefined);
	const again = harness({ renewHandler: okRenew() });
	const cleared = await again.service.save({ providerId: M, cookieUpdate: { action: "clear" } });
	assert.equal(cleared.settings.xiaomi.autoRenew, false);
	assert.equal(again.stored().xiaomi.renewal, undefined);
	// 半份 / 非法材料读回时丢弃。
	const bad = harness({ renewal: { userId: "1", passToken: "has space" }, renewHandler: okRenew() });
	assert.equal(bad.service.load().xiaomi.renewal, undefined);
}

// 2j. 扫码任务进行中不续期（避免续期改写 Cookie 让扫码提交撞上「设置已被修改」）；开始一种登录会取消另一种。
{
	const h = harness({ renewHandler: okRenew() });
	h.tick(DAY - 5 * MIN);
	h.service.mimoQr.current = { public: { state: "waiting", jobId: "job-1" }, controller: new AbortController() };
	const entry = await read(h);
	assert.equal(entry.state, "ok");
	assert.equal(h.calls.renew.length, 0, "扫码进行中不续期");
	h.service.mimoQr.current = null;
	let cancelled = null;
	h.service.mimoQr.current = { public: { state: "waiting", jobId: "job-2" }, controller: new AbortController(), timer: null };
	h.service.mimoQr.cancel = request => { cancelled = request; return {}; };
	h.service.login.start = () => ({ jobId: "b", state: "launching" });
	h.service.startMimoLogin({ expectedRevision: h.service.result(h.service.load(), []).settings.revision });
	assert.deepEqual(cancelled, { jobId: "job-2" }, "开始浏览器登录时取消进行中的扫码任务");
}

// 2k. 接口形状异常按网络类处理（自动重试，不要求重新扫码）；passToken 到期后设置页不再宣称自动续期。
{
	const h = harness({ renewHandler: async () => res(`&&&START&&&{"code":0,"location":"https://platform.xiaomimimo.com/sts?t=1"}`) });
	h.tick(DAY + MIN);
	const entry = await read(h);
	assert.equal(entry.state, "error");
	assert.equal(entry.errorCode, "subusage/mimo-renew-network");
	assert.equal(entry.renewFailed, undefined, "形状异常会自动重试，不能提示重新扫码");
	assert.equal(entry.retryable, true);
	const expired = harness({ renewal: { ...RENEWAL, expiresAt: T0 + DAY / 2 }, renewHandler: okRenew() });
	expired.tick(DAY - 5 * MIN);
	const view = await expired.service.refresh({ providerIds: [M], force: true });
	assert.equal(view.settings.xiaomi.autoRenew, false, "passToken 已到期时不宣称自动续期");
	assert.equal(view.entries[0].cookieRenewable, undefined);
}

console.log("PASS MiMo 静默续期：协议与错误分类、到期前续期、被拒重试、失败提示与重试节奏、材料随 Cookie 走、登录互斥");
