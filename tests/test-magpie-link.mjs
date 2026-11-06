// Magpie 本地聚合网关联动：一张上游订阅卡 = 一条账号行，路由上下文进 routeContext 端口。
//
// 钉四件事：
//  1. /v1/magpie/quotas 的卡片 → linkedAccounts（provider 分组、窗口归一、last → accountActive）；
//  2. usage/requests + concurrency → magpieRouteContext（auto 组的实际上游），DSH 不发 session 头；
//  3. 网关不在场 = 通道缺席（静默 / 点名给安装指引）；在场但 0 卡 = 错误条目；
//  4. quota() 展开按账号行去重，路由字段不丢失。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { normalizeMagpie, magpieRouteContext, magpieWindowKind, MagpieUsageReader } from "../lib/magpie-usage.js";

const { SubUsageService } = await loadHostModule();

// ── [1] 窗口名归一 ────────────────────────────────────────────────────────
{
	assert.equal(magpieWindowKind("5 hours", undefined, undefined), "5h");
	assert.equal(magpieWindowKind("Weekly", undefined, undefined), "week");
	assert.equal(magpieWindowKind("Monthly", undefined, undefined), "month");
	assert.equal(magpieWindowKind("Daily", undefined, undefined), "day");
	assert.equal(magpieWindowKind("", undefined, undefined), "period");
	// 认不出的名字按重置时间倒推；不猜名字里的数字含义。
	assert.equal(magpieWindowKind("rolling", "2026-11-06T10:00:00Z", "2026-11-06T06:00:00Z"), "5h");
	assert.equal(magpieWindowKind("rolling", "2026-11-13T00:00:00Z", "2026-11-06T06:00:00Z"), "week");
	assert.equal(magpieWindowKind("rolling", undefined, undefined), "period");
}

// ── [2] 归一化：卡片 → 账号行 ─────────────────────────────────────────────
const CARDS = {
	data: [
		{ provider: "cursor", name: "Cursor", kind: "subscription", plan: "Pro", user: "a@x.dev",
			windows: [
				{ name: "5 hours", used: 40, remaining: 60, resetsAt: "2026-11-06T10:00:00Z" },
				{ name: "Monthly", used: 82, remaining: 18, resetsAt: "2026-12-01T00:00:00Z" }
			],
			readAt: "2026-11-06T05:00:00Z", lastServedAt: "2026-11-06T04:59:00Z", last: true },
		{ provider: "codex", name: "Codex", kind: "subscription", plan: "Plus", user: "b@y.dev",
			windows: [{ name: "Weekly", used: 10, remaining: 90, resetsAt: "2026-11-13T00:00:00Z" }],
			readAt: "2026-11-06T05:00:00Z" },
		// 同 provider 第二张卡：同一分组的行要连续，组内顺序照抄上游。
		{ provider: "codex", name: "Codex", kind: "subscription", plan: "Team", user: "c@z.dev",
			windows: [{ name: "Weekly", used: 0, remaining: 100, resetsAt: "2026-11-13T00:00:00Z" }],
			readAt: "2026-11-06T05:00:00Z" },
		// 读取失败的卡：留在行里带 error，不伪装成健康。
		{ provider: "grok", name: "Grok", kind: "subscription", user: "", windows: [], error: "上游 401" },
		// 没有窗口也没有错误 = 信息不足的行，coverage partial。
		{ provider: "mimo-app", name: "MiMo", kind: "subscription", user: "138****1234", windows: [] }
	]
};
{
	const entry = normalizeMagpie(CARDS, "magpie", "Magpie", Date.parse("2026-11-06T05:00:00Z"));
	assert.equal(entry.providerId, "magpie");
	assert.equal(entry.state, "ok");
	assert.equal(entry.linkedAccounts.length, 5);
	// 分组排序：provider 相同的行连续，不拆散。
	const groups = entry.linkedAccounts.map(row => row.providerGroup);
	assert.deepEqual(groups, ["cursor", "codex", "codex", "grok", "mimo-app"], "按 provider 分组排序");
	const cursor = entry.linkedAccounts[0];
	assert.equal(cursor.accountActive, true, "last:true 的卡标记为当前服务卡");
	assert.equal(cursor.accountMode, "auto");
	assert.equal(cursor.account, "Cursor · a@x.dev");
	assert.equal(cursor.windows.length, 2);
	assert.equal(cursor.windows[0].kind, "5h");
	assert.equal(cursor.windows[0].percent, 40, "percent 是已用口径");
	assert.equal(cursor.windows[0].resetsAt, "2026-11-06T10:00:00.000Z");
	assert.equal(cursor.windows[1].kind, "month");
	assert.equal(cursor.extras.find(x => x.kind === "plan").value, "Pro");
	const grok = entry.linkedAccounts[3];
	assert.equal(grok.state, "error");
	assert.equal(grok.error, "上游 401");
	const mimo = entry.linkedAccounts[4];
	assert.equal(mimo.state, "ok", "有账号但没窗口仍是一行可读条目");
	assert.equal(mimo.coverage, "partial", "没有窗口不能算完整读数");
	assert.equal(entry.coverage, "partial", "有失败/无窗卡时整体覆盖为 partial");
	assert.equal(normalizeMagpie({ data: [] }, "magpie", "Magpie"), null, "0 张卡 = 没东西可读");
	assert.equal(normalizeMagpie(undefined, "magpie", "Magpie"), null);
	// remaining:0 的卡整窗限额。
	const limited = normalizeMagpie({ data: [{ provider: "p", name: "P", user: "u", windows: [{ name: "5h", used: 100, remaining: 0 }] }] }, "magpie", "Magpie");
	assert.equal(limited.linkedAccounts[0].windows[0].status, "rate-limited");
	// 读数超过一天 → stale。
	const stale = normalizeMagpie({ data: [{ provider: "p", name: "P", user: "u", windows: [{ name: "5h", used: 1, remaining: 99 }], readAt: "2026-11-01T00:00:00Z" }] }, "magpie", "Magpie", Date.parse("2026-11-06T00:00:00Z"));
	assert.equal(stale.freshness, "stale");
	assert.equal(stale.linkedAccounts[0].freshness, "stale");
}

// Antigravity 去重不能把不同周期或互不认识的新池并掉；未知池名保留为池身份。
{
	const entry = normalizeMagpie({ data: [{ provider: "antigravity", name: "Antigravity", windows: [
		{ name: "Gemini · 5 hours", used: 20, remaining: 80 },
		{ name: "Gemini · 7 days", used: 20, remaining: 80 },
		{ name: "New Pool · 5 hours", used: 10, remaining: 90 },
		{ name: "Other Pool · 5 hours", used: 10, remaining: 90 }
	] }] }, "magpie", "Magpie");
	const windows = entry.linkedAccounts[0].windows;
	assert.equal(windows.length, 4, "同池同比例也要按周期分开；未知池不能因同比例同重置合并");
	assert.deepEqual(windows.map(w => w.groupLabel), ["gemini", "gemini", "New Pool", "Other Pool"]);
	assert.deepEqual(windows.slice(0, 2).map(w => w.kind), ["5h", "week"]);
}
// 非数值剩余文本必须同时留在 legacy 与权威 quotas，不能经契约边界后丢回百分比。
{
	const entry = normalizeMagpie({ data: [{ provider: "copilot", name: "Copilot", windows: [
		{ name: "Chat requests", used: 0, remaining: 100, display: "Unlimited" }
	] }] }, "magpie", "Magpie");
	const account = entry.linkedAccounts[0];
	assert.equal(account.windows[0].detail.leftText, "Unlimited");
	assert.equal(account.quotas[0].leftText, "Unlimited", "quotas 是权威端口，leftText 不得只在旧 windows 上");
}

// ── [3] 路由上下文：agent=dsh 的最近请求回指命中卡 ─────────────────────────
{
	const entry = normalizeMagpie(CARDS, "magpie", "Magpie", Date.parse("2026-11-06T05:00:00Z"));
	const route = magpieRouteContext({ rows: [
		// 其他 agent 的请求不算数。
		{ agent: "ccswitch", req: "auto/x", provider: "ignored", providerAccount: "nobody", t: "2026-11-06T05:01:00Z" },
		{ agent: "dsh", req: "auto/auto-claude-opus-5-5", provider: "codex", providerAccount: "b@y.dev", served: "codex/swe-2", status: 200, t: "2026-11-06T04:59:00Z" }
	] }, entry.linkedAccounts);
	assert.equal(route.provider, "codex");
	assert.equal(route.group, true, "auto/* 是路由组");
	assert.equal(route.model, "codex/swe-2");
	const codexB = entry.linkedAccounts[1];
	assert.equal(route.cardId, codexB.accountId, "providerAccount 要回指到命中卡");
	// 没有任何 dsh 行时返回 null，不编路由。
	assert.equal(magpieRouteContext({ rows: [{ agent: "other", provider: "x" }] }, entry.linkedAccounts), null);
	assert.equal(magpieRouteContext(undefined, entry.linkedAccounts), null);
}

// ── [4] Host 集成：readLinked / quota() / 缺席 / 缓存 ─────────────────────
function harness({ snapshot, fetch, now } = {}) {
	const io = {
		readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
		mkdirSync() {}, writeFileSync() {}, chmodSync() {}, renameSync() {}
	};
	return new SubUsageService({ get: () => undefined }, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		linkedTimeoutMs: 2000,
		...(now ? { now } : {}),
		resolveMagpieUsage: fetch
	});
}
const SNAPSHOT = {
	cards: CARDS,
	usage: { rows: [{ agent: "dsh", req: "auto/auto-claude-opus-5-5", provider: "codex", providerAccount: "b@y.dev", served: "codex/swe-2", status: 200, t: "2026-11-06T04:59:00Z" }] },
	concurrency: { active: [] },
	models: { data: [{ id: "auto/kimi-k3.1-pro", owned_by: "kimi", display_name: "不下发" }] }
};
{
	const calls = [];
	const service = harness({ fetch: async force => { calls.push(force); return SNAPSHOT; } });
	const { entries } = await service.readLinked({ providerIds: ["magpie"], force: true });
	const entry = entries.find(e => e.providerId === "magpie");
	assert.equal(entry.state, "ok");
	assert.equal(entry.linkedAccounts.length, 5);
	assert.equal(entry.routeContext.provider, "codex");
	assert.equal(entry.routeContext.group, true);
	assert.equal(entry.routeContext.model, "codex/swe-2");
	assert.equal(entry.routeContext.live, undefined, "没有在途请求时不标 live");
	assert.equal(entry.routeContext.cardId, entry.linkedAccounts[1].accountId);
	assert.deepEqual(entry.models, [{ id: "auto/kimi-k3.1-pro", owned_by: "kimi" }], "模型目录只下发归组必需字段");
	// 在途请求压过日志行：live 标志 + 直接来自 concurrency 的 provider。
	service.dispose();
}
{
	const service = harness({ fetch: async () => ({ ...SNAPSHOT, concurrency: { active: [{ agent: "dsh", model: "auto/auto-claude-opus-5-5", provider: "devin", phase: "streaming" }] } }) });
	const { entries } = await service.readLinked({ providerIds: ["magpie"], force: true });
	const route = entries[0].routeContext;
	assert.equal(route.live, true, "在途请求如实标 live");
	assert.equal(route.provider, "devin", "live 的 provider 来自 concurrency");
	service.dispose();
}
// 在途 provider 与上次路由不同：不得把上一张卡的账号、模型、cardId、时间拼进 live 上下文。
{
	const service = harness({ fetch: async () => ({
		...SNAPSHOT,
		usage: { rows: [{ agent: "dsh", req: "cursor/composer", provider: "cursor", providerAccount: "a@x.dev", served: "cursor/composer", status: 200, t: "2026-11-06T04:59:00Z" }] },
		concurrency: { active: [{ agent: "dsh", model: "auto/gpt-6-luna", provider: "codex", phase: "streaming" }] }
	}) });
	const { entries } = await service.readLinked({ providerIds: ["magpie"], force: true });
	const route = entries[0].routeContext;
	assert.equal(route.live, true);
	assert.equal(route.provider, "codex");
	assert.equal(route.providerName, "Codex");
	assert.equal(route.req, "auto/gpt-6-luna");
	assert.equal(route.cardId, undefined, "同组多卡且 live 未给账号时不能沿用 cursor 的旧 cardId");
	assert.equal(route.account, undefined);
	assert.equal(route.model, undefined, "请求组名不是实际 served 模型");
	assert.equal(route.at, undefined, "上次完成时间不能标成正在服务时间");
	assert.equal(route.status, undefined, "上次请求状态不能当成在途状态");
	service.dispose();
}
// 缺席：fetch 抛错 = 网关不在场，静默不点名、点名给安装指引。
{
	const service = harness({ fetch: async () => { throw new Error("ECONNREFUSED"); } });
	const quiet = await service.readLinked({ providerIds: ["magpie"], force: true });
	// readLinked 始终按点名处理：缺席回一条带指引的条目。
	const row = quiet.entries.find(e => e.providerId === "magpie");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("Magpie") && row.error.includes("3425"), "缺席指引要点名网关与默认地址");
	service.dispose();
}
// 在场但 0 张卡 = 网关起来了但没东西可读，不是「没装」。
{
	const service = harness({ fetch: async () => ({ cards: { data: [] }, usage: { rows: [] }, concurrency: { active: [] } }) });
	const row = (await service.readLinked({ providerIds: ["magpie"], force: true })).entries.find(e => e.providerId === "magpie");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("没有可读的额度卡片") || row.error.includes("登录"), "0 卡要给可读原因，不是装插件指引");
	service.dispose();
}
// quota() 展开：一张卡一行，按 accountId 去重。
{
	const service = harness({ fetch: async () => SNAPSHOT });
	const result = await service.quota({ providerIds: ["magpie"] });
	const rows = result.providers.filter(p => p.providerId === "magpie");
	assert.equal(rows.length, 5, "一张卡一行");
	assert.equal(rows[0].account, "Cursor · a@x.dev");
	assert.equal(rows[0].accountActive, true);
	service.dispose();
}
// 注入路径按调用计数（60 秒缓存在内置 reader 里，注入只负责给快照）：
{
	const calls = [];
	const service = harness({ fetch: async () => { calls.push(1); return SNAPSHOT; } });
	await service.readLinked({ providerIds: ["magpie"], force: false });
	await service.readLinked({ providerIds: ["magpie"], force: false });
	assert.equal(calls.length, 2, "注入快照随调用计次；真实 reader 的 60 秒复用见下面的 reader 断言");
	service.dispose();
}
// 内置 reader 的缓存与请求形状：kept=1、合并 pending、60 秒复用。
{
	const requests = [];
	const fetcher = async (url, init) => {
		requests.push({ url: String(url), signal: init?.signal });
		const path = new URL(String(url)).pathname;
		if (path === "/v1/magpie/quotas") return { ok: true, status: 200, json: async () => CARDS };
		if (path === "/v1/magpie/usage/requests") return { ok: true, status: 200, json: async () => ({ rows: [] }) };
		if (path === "/v1/magpie/concurrency") return { ok: true, status: 200, json: async () => ({ active: [] }) };
		if (path === "/v1/models") return { ok: true, status: 200, json: async () => ({ data: [{ id: "kimi/k3.1-pro", owned_by: "kimi" }] }) };
		return { ok: false, status: 404, json: async () => ({}) };
	};
	let clock = 1_000_000;
	const reader = new MagpieUsageReader({ fetcher, origin: "http://127.0.0.1:3425", now: () => clock });
	const first = await reader.read(false);
	assert.equal(first.cards.data.length, 5);
	assert.equal(requests.filter(r => r.url.includes("kept=1")).length, 1, "默认读缓存快照（kept=1）");
	const second = await reader.read(false);
	// 一次快照 = quotas + usage + concurrency + models 四个 GET；60 秒内复用不重复。
	assert.equal(requests.length, 4, "60 秒内复用快照，不重复请求");
	assert.notStrictEqual(first, second, "返回的是结构化克隆，不是缓存引用");
	clock += 61_000;
	await reader.read(false);
	assert.equal(requests.length, 8, "超过 60 秒重新取数");
	reader.dispose();
}

console.log("Magpie 联动：归一化、路由上下文、缺席语义与缓存 —— 全部通过 ✅");
