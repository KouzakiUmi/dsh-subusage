// EAC 三渠道（dsh-eac-router）回退联动：Loomy / Raccoon / Qoder 中国版 的第三个来源。
//
// 该插件不是本仓库的，它把三个渠道的余额挂在本机 web 服务器的 `/api/eac-router`（JSON-RPC 风格）。
// 本仓库的口径是「**现有来源优先**」：独立 connect 插件 → Our Free Model → 最后才问 EAC，
// 且只在会回落药丸的请求（readLinked / 显式点名）里问，全量报告不点名时不额外放大请求量。
// 这里钉四件事：
//  1. credits.balances 投影 → 本插件条目：余额、积分包说明行、多账号聚合；
//  2. 回退顺序与请求形状（POST 体里的 method / provider）；
//  3. 缺席（404）与后端未就绪（eac-router/not-ready）都不算失败；
//  4. 60 秒缓存与 force 绕过。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { normalizeEac } from "../lib/eac-usage.js";

const { SubUsageService } = await loadHostModule();
const BASE = "http://127.0.0.1:4321";

// ── [1] 归一化：单账号余额 + 积分包说明行 ───────────────────────────────────
{
	const entry = normalizeEac({ accounts: [{ accountId: "a1", nickname: "me@example.com", balance: { total: 1500, packages: [{ name: "月度积分", remaining: 1200, unit: "积分" }] } }] }, "raccoon", "小浣熊");
	assert.equal(entry.providerId, "raccoon");
	assert.equal(entry.label, "小浣熊");
	assert.equal(entry.state, "ok");
	assert.equal(entry.accountId, "a1");
	assert.equal(entry.account, "me@example.com");
	assert.deepEqual(entry.windows, [], "EAC 只报余额，不画窗口");
	assert.equal(entry.extras.find(x => x.kind === "balance").value, "1500 积分", "单位照抄包上报的原始 unit");
	assert.equal(entry.extras.find(x => x.kind === "note").value, "周期 / 套餐额度：1200 积分", "积分包按性质聚合，不逐包罗列");
	assert.equal(entry.linkedAccounts.length, 1, "单账号也带 linkedAccounts，药丸可切换");
	assert.equal(entry.coverage, "complete");
}

// ── [2] 归一化：多账号聚合、包无单位、失败账号与空列表 ──────────────────────
{
	const multi = normalizeEac({ accounts: [
		{ accountId: "a1", nickname: "one", balance: { total: 10, packages: [] } },
		{ accountId: "a2", nickname: "two", balance: null, error: "boom" },
	] }, "loomy", "Loomy");
	assert.equal(multi.state, "ok", "有一个账号可读就算成功");
	assert.equal(multi.linkedAccounts.length, 2);
	assert.equal(multi.linkedAccounts[0].extras[0].value, "10 credits", "没有包单位时不替它编造换算");
	assert.equal(multi.linkedAccounts[1].state, "error");
	assert.equal(normalizeEac({ accounts: [{ accountId: "a", balance: null }] }, "loomy", "Loomy").state, "error");
	assert.equal(normalizeEac({ accounts: [] }, "loomy", "Loomy"), null, "没有账号 = 这条通道这轮不存在");
	assert.equal(normalizeEac(undefined, "loomy", "Loomy"), null);
}

// ── [3] 回退顺序：桌面通道 404 → OFM 缺席 → EAC ────────────────────────────
function jsonResponse(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}
function rpcReply(rpcId, result) { return { type: "server-response", rpcId, result }; }
const EAC_VALUE = { accounts: [{ accountId: "acc-1", nickname: "r1", balance: { total: 42, packages: [{ name: "包A", remaining: 40, unit: "积分" }] } }] };

function harness({ eac = () => rpcReply(null, { ok: true, value: EAC_VALUE }), desktopStatus = 404, now, noConnection = false } = {}) {
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const calls = [], eacCalls = [];
	const ctx = { get: name => {
		if (name === "webServer") return { getOrigin: () => BASE };
		// EAC 的 `/api/eac-router` 必须走进程内分发：裸 HTTP 打 `/api/*` 会被网关回 401。
		if (name === "connection" && !noConnection) return {
			createPeer: () => ({ dispose() {} }),
			createSharedFetchHandler: () => ({
				async fetch(request) {
					// 同一条共享 handler 也会收到 OFM 的 /api/channel-pack；本用例里 OFM 缺席，回 404 让它安静退出。
					if (!String(request.url).includes("/api/eac-router")) return jsonResponse({ error: "not found" }, 404);
					const body = JSON.parse(await request.text());
					eacCalls.push({ url: String(request.url), method: request.method, body, signal: request.signal });
					const reply = eac(body);
					// 允许用例直接给整段信封（返回体）或伪 Response（404/异常场景）。
					return typeof reply?.text === "function" ? reply : jsonResponse(reply);
				}
			})
		};
		return undefined;
	} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		linkedTimeoutMs: 50,
		...(now ? { now } : {}),
		// 只有独立 connect 插件走本机回环 HTTP；EAC 不得出现在这里。
		fetch: async (url, init) => {
			calls.push({ url: String(url), method: init?.method, body: init?.body, signal: init?.signal });
			if (desktopStatus === 404) return jsonResponse({ error: "not found" }, 404);
			return desktopStatus();
		}
	});
	return { service, calls, eacCalls };
}
{
	const { service, calls, eacCalls } = harness({ eac: request => rpcReply(request.rpcId, { ok: true, value: EAC_VALUE }) });
	// 回退只在药丸通道（readLinked）里发生：全量报告与工具查询不额外放大请求量。
	const { entries } = await service.readLinked({ providerIds: ["raccoon"], force: true });
	const row = entries.find(p => p.providerId === "raccoon");
	assert.equal(row.state, "ok", "独立插件与 OFM 都缺席时由 EAC 补上");
	assert.equal(row.extras.find(x => x.kind === "balance").value, "42 积分");
	const rpc = eacCalls[0];
	assert.ok(rpc, "回退确实走了 EAC 的进程内路由");
	assert.equal(rpc.url, "http://dsh.internal/api/eac-router", "走 Connection 进程内分发，不是本机回环 HTTP");
	assert.equal(calls.filter(c => c.url.includes("/api/eac-router")).length, 0, "不得用裸 HTTP 打 /api/*（会被网关回 401）");
	assert.equal(rpc.method, "POST");
	assert.equal(rpc.body.type, "client-request");
	assert.equal(rpc.body.method, "eac-router");
	assert.deepEqual(rpc.body.payload, { method: "credits.balances", payload: { provider: "raccoon" } });
	assert.ok(rpc.signal instanceof AbortSignal || typeof rpc.signal?.aborted === "boolean", "请求必须可取消");
	// 缓存：60 秒内不重复打上游。
	const before = eacCalls.length;
	await service.readLinked({ providerIds: ["raccoon"], force: false });
	assert.equal(eacCalls.length, before, "缓存期内不重复请求");
	service.dispose();
}
// Qoder 中国版只经 OFM 报告，EAC 是它的回退。
{
	const { service, eacCalls } = harness({ eac: request => rpcReply(request.rpcId, { ok: true, value: EAC_VALUE }) });
	const { entries } = await service.readLinked({ providerIds: ["ofm-qodercn"], force: true });
	assert.equal(entries.find(p => p.providerId === "ofm-qodercn")?.state, "ok", "OFM 缺席时 Qoder 中国版回落 EAC");
	assert.equal(eacCalls[0].body.payload.payload.provider, "qodercn");
	service.dispose();
}
// 全量报告（不点名）不回落：现有来源缺席时保持安静，不额外放大请求量。
{
	const { service, eacCalls } = harness({ eac: request => rpcReply(request.rpcId, { ok: true, value: EAC_VALUE }) });
	const all = await service.quota();
	assert.ok(!all.providers.some(p => p.providerId === "raccoon"), "不点名的全量报告不出现 EAC 回退条目");
	assert.equal(eacCalls.length, 0);
	service.dispose();
}

// ── [4] 缺席与未就绪：都不算失败 ───────────────────────────────────────────
{
	const { service } = harness({ eac: () => jsonResponse({ error: "not found" }, 404) });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true })).entries.find(p => p.providerId === "raccoon");
	assert.equal(row.state, "error", "点名而没有可用来源时给可读说明");
	assert.ok(row.error.includes("dsh-raccoon-connect"), "缺席要写清先装哪个插件");
	service.dispose();
}
{
	let rpcId;
	const { service } = harness({ eac: request => { rpcId = request.rpcId; return rpcReply(rpcId, { ok: false, error: { code: "eac-router/not-ready", message: "渠道后端未就绪" } }); } });
	const row = (await service.readLinked({ providerIds: ["loomy"], force: true })).entries.find(p => p.providerId === "loomy");
	assert.equal(row.state, "error", "后端未就绪按「这轮没有这条通道」处理，但仍如实说明");
	assert.ok(row.error.includes("dsh-loomy-connect"));
	service.dispose();
}
// 真实失败（非 not-ready）要带着上游语义报出来，而不是静默。
{
	const { service } = harness({ eac: request => rpcReply(request.rpcId, { ok: false, error: { code: "eac-router/operation-failed", message: "操作未完成，请刷新并检查登录状态后重试。" } }) });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true })).entries.find(p => p.providerId === "raccoon");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("dsh-raccoon-connect") || row.error.includes("操作未完成"), "失败要说清来源或上游原因");
	service.dispose();
}

console.log("EAC 三渠道回退联动：归一化、回退顺序、缺席语义与缓存 —— 全部通过 ✅");
