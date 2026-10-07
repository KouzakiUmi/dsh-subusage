// MiMo Cookie 24 小时有效期：Host 计时与下发、Client 到期提醒（虚构时间，不触碰真实配置）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const M = "xiaomi-token-plan-cn";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-03-01T00:00:00Z");
const COOKIE = 'api-platform_serviceToken="dummy-token"; userId=1';
const iso = (ms) => new Date(ms).toISOString();

// ── Host：落盘计时、公开暴露、entry 下发 ────────────────────────────────────
const { SubUsageService } = await loadHostModule();
function harness(initial) {
	const files = new Map(initial ? [["memory/config", JSON.stringify(initial)]] : []);
	let now = T0;
	const io = {
		readFileSync: (path) => { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync: () => {}, writeFileSync: (path, value) => files.set(path, value), chmodSync: () => {},
		renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); }
	};
	const ctx = { get() {}, llm: { listProviders: () => [{ id: M }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => now,
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		fetch: async (url) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(url.endsWith("/balance") ? { data: { balance: "1", currency: "CNY" } } : { data: {} }) })
	});
	return { service, files, tick: (ms) => { now += ms; return now; }, stored: () => JSON.parse(files.get("memory/config")) };
}

// 旧配置没有计时字段：升级后必须照常读取，不能因为缺字段崩溃。
const legacy = harness({ xiaomi: { cookie: COOKIE } });
const legacyRead = await legacy.service.refresh({ providerIds: [M], force: true });
assert.equal(legacyRead.entries[0].state, "ok");
assert.equal(legacyRead.settings.xiaomi.hasCookie, true);
assert.equal(legacyRead.settings.xiaomi.loginAt, null, "旧 Cookie 没有登录时间");
assert.equal(legacyRead.settings.xiaomi.expiresAt, null);
assert.equal(legacyRead.entries[0].cookieExpiresAt, undefined, "无记录时不得编造到期时间");

// 登录 / 手动导入都从写入时刻起计 24 小时，并随 settings 与 entry 一起下发。
const fresh = harness();
const saved = await fresh.service.save({ providerId: M, cookieUpdate: { action: "replace", value: COOKIE } });
assert.equal(saved.settings.xiaomi.loginAt, iso(T0));
assert.equal(saved.settings.xiaomi.expiresAt, iso(T0 + DAY));
assert.equal(fresh.stored().xiaomi.loginAt, T0, "登录时间必须落盘");
assert.equal(fresh.stored().xiaomi.expiresAt, T0 + DAY);
const fetched = await fresh.service.refresh({ providerIds: [M], force: true });
assert.equal(fetched.entries[0].cookieExpiresAt, iso(T0 + DAY), "entry 必须下发到期时刻");
assert(!JSON.stringify(fetched).includes("dummy-token"), "到期元数据不得回显 Cookie");

// 重新登录重新计时，而不是在旧到期时间上累加。
fresh.tick(60 * 60 * 1000);
const relogin = await fresh.service.save({ providerId: M, cookieUpdate: { action: "replace", value: COOKIE } });
assert.equal(relogin.settings.xiaomi.expiresAt, iso(T0 + 60 * 60 * 1000 + DAY));

// keep 表示“本次保存未改动凭据”：既不写入新 Cookie，也不得重置 24 小时倒计时，
// 否则用户在设置页点一次保存就能把临近过期的提醒续满，令到期监控失效。
const beforeKeep = fresh.stored().xiaomi;
fresh.tick(60 * 60 * 1000);
const kept = await fresh.service.save({ providerId: M, cookieUpdate: { action: "keep" } });
assert.equal(kept.settings.xiaomi.loginAt, iso(beforeKeep.loginAt), "keep 不得改动登录时间");
assert.equal(kept.settings.xiaomi.expiresAt, iso(beforeKeep.expiresAt), "keep 不得续满倒计时");
assert.equal(fresh.stored().xiaomi.expiresAt, beforeKeep.expiresAt, "keep 时计时必须原样落盘");
assert.equal(kept.settings.xiaomi.hasCookie, true, "keep 保留已保存 Cookie");

// 平台报告的过期时间更早时以更早者为准；更晚或非法时不放大 24 小时上限。
const capped = harness();
await capped.service.save({ providerId: M, cookieUpdate: { action: "replace", value: COOKIE } });
const verified = await capped.service.fetchProvider(M, { key: COOKIE, source: "cookie" }, capped.service.load());
const commit = (observed) => capped.service.commitMimoLogin(COOKIE, capped.service.mimoMaterial(capped.service.load()), verified, observed);
assert.equal(commit(T0 + 3 * 60 * 60 * 1000).settings.xiaomi.expiresAt, iso(T0 + 3 * 60 * 60 * 1000), "更早的平台过期时间优先");
capped.tick(1000);
assert.equal(commit(T0 + 30 * DAY).settings.xiaomi.expiresAt, iso(T0 + 1000 + DAY), "晚于 24 小时的平台过期时间不放大上限");
assert.equal(commit(Number.NaN).settings.xiaomi.expiresAt, iso(T0 + 1000 + DAY), "非法观测时间退回 24 小时上限");

// 必须经 MimoLogin → callbacks.commit 的真实装配透传观测时间：
// 回调若少声明一个形参，浏览器观测到的过期时间会被静默丢弃，线上永远退化成 24 小时上限。
const wired = harness();
await wired.service.save({ providerId: M, cookieUpdate: { action: "replace", value: COOKIE } });
const wiredVerified = await wired.service.fetchProvider(M, { key: COOKIE, source: "cookie" }, wired.service.load());
const wiredCap = T0 + 5 * 60 * 60 * 1000;
const wiredResult = wired.service.login.callbacks.commit(COOKIE, wired.service.mimoMaterial(wired.service.load()), wiredVerified, wiredCap);
assert.equal(wiredResult.settings.xiaomi.expiresAt, iso(wiredCap), "回调装配必须把浏览器观测的过期时间透传到落盘计时");

// 清除凭据同时清除计时，避免留下无主倒计时。
const cleared = await capped.service.save({ providerId: M, cookieUpdate: { action: "clear" } });
assert.equal(cleared.settings.xiaomi.hasCookie, false);
assert.equal(cleared.settings.xiaomi.loginAt, null);
assert.equal(cleared.settings.xiaomi.expiresAt, null);
const clearedEntry = (await capped.service.refresh({ providerIds: [M], force: true })).entries[0];
assert.equal(clearedEntry.state, "no-cookie");
assert.equal(clearedEntry.cookieExpiresAt, undefined, "凭据清除后不得残留到期时间");

// 被手改坏的计时字段按未记录处理，既不崩溃也不进入倒计时。
for (const broken of ["soon", -1, 1.5, null, Number.NaN]) {
	const bad = harness({ xiaomi: { cookie: COOKIE, loginAt: broken, expiresAt: broken } });
	const result = await bad.service.refresh({ providerIds: [M], force: true });
	assert.equal(result.entries[0].state, "ok", `计时字段 ${String(broken)} 不影响凭据读取`);
	assert.equal(result.settings.xiaomi.expiresAt, null, `计时字段 ${String(broken)} 按未记录处理`);
}

// ── Client：到期档位、药丸与设置页渲染 ──────────────────────────────────────
const DICT = {
	restMins: "{n} min", restHours: "{n} h", restDays: "{n} d",
	pillCookieSoon: "Cookie expires in {rest}", mimoCookieExpired: "Cookie expired",
	mimoLoginAt: "Signed in {time}", mimoCookieExpiresAt: "Expires {time}",
	mimoCookieUntracked: "Login time not recorded", mimoCookieTtl: "24h session cookie",
	pillRemaining: "{p}% left", pillLimited: "Limit reached", statusNoCookie: "Login required"
};
let states = [], index = 0;
const react = {
	createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
	Fragment: "fragment",
	useSyncExternalStore: (_s, get) => get(),
	useState: (initial) => [index < states.length ? states[index++] : (index++, typeof initial === "function" ? initial() : initial), () => {}],
	useRef: (value) => ({ current: value }),
	useEffect: () => {},
	useCallback: (v) => v,
	useMemo: (fn) => fn()
};
let spec;
const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { SubusageSection, UsagePill, cookieExpiry, durationText, createUsageStore }; exports.apply = apply;"), {
	window: { __ModuleLoader__: { load: (value) => { spec = value; } }, localStorage: { getItem: () => M } },
	document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
	console
});
const plugin = spec.factory((name) => { assert.equal(name, "react"); return react; });
const { cookieExpiry, durationText, UsagePill, SubusageSection, createUsageStore } = plugin.__test;
const t = (key) => DICT[key] ?? key;
const getLocale = () => "zh";
const text = (node) => {
	if (node == null || typeof node === "boolean") return "";
	if (typeof node !== "object") return String(node);
	if (Array.isArray(node)) return node.map(text).join(" ");
	return (node.children || []).map(text).join(" ");
};
const inMs = (ms) => ({ cookieExpiresAt: new Date(Date.now() + ms).toISOString() });

// 档位：>2h 正常、≤2h 提醒、≤30min 紧急、已过期；无记录一律不提醒。
assert.equal(cookieExpiry(null, t), null, "没有到期记录就不提醒");
assert.equal(cookieExpiry({ cookieExpiresAt: "not-a-date" }, t), null);
assert.equal(cookieExpiry(inMs(5 * 60 * 60 * 1000), t).rank, 1);
assert.equal(cookieExpiry(inMs(90 * 60 * 1000), t).rank, 2);
assert.equal(cookieExpiry(inMs(10 * 60 * 1000), t).rank, 3);
assert.equal(cookieExpiry(inMs(-1000), t).rank, 4);
assert.equal(cookieExpiry(inMs(-1000), t).expired, true);
assert.equal(cookieExpiry(inMs(10 * 60 * 1000), t).label, "Cookie expires in 10 min", "剩余时间用与重置行同一档位");
assert.equal(durationText(-5, t), "1 min", "已过期的时长不得显示负数");

const quota = { state: "ok", coverage: "complete", freshness: "fresh", windows: [{ kind: "sub", percent: 25, status: "ok" }], extras: [] };
const renderPill = (entry, open = false) => { states = [entry ? { entry, updatedAt: 0 } : null, null, undefined, false, open]; index = 0; return UsagePill({ providerId: M, label: "MiMo", readEntry: () => {}, t, getLocale }); };
const json = (node) => JSON.stringify(node);

assert.ok(text(renderPill(quota)).includes("75% left"), "距离到期远时保持原余量文案");
assert.ok(!json(renderPill({ ...quota, ...inMs(5 * 60 * 60 * 1000) })).includes("Cookie expires in"), "未到提醒窗口不打扰用户");
const soon = renderPill({ ...quota, ...inMs(90 * 60 * 1000) });
assert.ok(text(soon).includes("Cookie expires in 2 h"), "即将到期时药丸改显到期提醒");
assert.ok(json(soon).includes("rgba(234,179,8,.10)"), "临近到期使用黄色提示底色");
assert.ok(json(soon).includes("#eab308"), "临近到期文字随档位着色");
const urgent = renderPill({ ...quota, ...inMs(10 * 60 * 1000) });
assert.ok(text(urgent).includes("Cookie expires in 10 min") && json(urgent).includes("rgba(249,115,22,.10)"), "30 分钟内升级为橙色紧急提示");
const expired = renderPill({ ...quota, ...inMs(-60 * 1000) });
assert.ok(text(expired).includes("Cookie expired"), "已过期直接提示重新登录");
assert.ok(json(expired).includes("rgba(239,68,68,.10)"), "已过期使用红色提示底色");
const blocked = renderPill({ ...quota, ...inMs(10 * 60 * 1000), windows: [{ kind: "sub", percent: 100, status: "rate-limited" }] });
assert.ok(text(blocked).includes("Limit reached") && !text(blocked).includes("Cookie expires in"), "额度已用尽优先于 Cookie 到期提醒");
const popup = renderPill({ ...quota, ...inMs(90 * 60 * 1000) }, true);
assert.ok(text(popup).includes("Cookie expires in 2 h") && text(popup).includes("Expires "), "弹层常驻显示剩余时间与到期时刻");
assert.ok(!text(renderPill(quota, true)).includes("Expires "), "无计时记录时弹层不编造到期时间");

// 倒计时只用于展示：官方接口已判定凭据失效时，主文案必须仍是失败原因，
// 不能让“还有 2 小时到期”掩盖需要立刻重新登录的信号。
const rejected = { state: "error", errorCode: "subusage/auth", error: "登录或凭据已失效", coverage: "partial", freshness: "unknown", windows: [], extras: [] };
// 未登记的键会原样回显键名，故此处以 "statusError" 判定失败态文案已回归。
assert.ok(text(renderPill({ ...rejected, ...inMs(90 * 60 * 1000) })).includes("statusError"), "凭据已被拒绝时主文案不得被倒计时覆盖");
assert.ok(!json(renderPill({ ...rejected, ...inMs(90 * 60 * 1000) })).includes("rgba(234,179,8,.10)"), "凭据已被拒绝时不得再用黄色倒计时底色");
assert.ok(!text(renderPill({ ...rejected, ...inMs(90 * 60 * 1000) })).includes("Cookie expires in"), "凭据已被拒绝时主文案不显示剩余时间");
// 已过期本身即是需要重新登录的行动项，即使同时伴随拉取失败也应直说。
assert.ok(text(renderPill({ ...rejected, ...inMs(-60 * 1000) })).includes("Cookie expired"), "已过期时直接提示重新登录");

// 设置页：登录时间 + 剩余生效时间常驻在 MiMo 凭据区。
const sectionText = (xiaomi) => {
	const settings = { revision: "r1", zai: { type: 1 }, hasKeys: {}, keyModes: {}, xiaomi };
	const usageStore = { subscribe: () => () => {}, getSnapshot: () => ({ settings, configured: {}, entries: [] }) };
	states = [M]; index = 0;
	return text(SubusageSection({ usageStore, t, getLocale }));
};
const soonSection = sectionText({ hasCookie: true, loginAt: iso(T0), expiresAt: inMs(90 * 60 * 1000).cookieExpiresAt });
assert.ok(soonSection.includes("Signed in "), "设置页显示登录时间");
assert.ok(soonSection.includes("Cookie expires in 2 h"), "设置页显示剩余生效时间");
assert.ok(soonSection.includes("24h session cookie"), "设置页说明 24 小时有效期");
assert.ok(!sectionText({ hasCookie: false }).includes("Signed in "), "没有 Cookie 时不显示计时");
assert.ok(sectionText({ hasCookie: true }).includes("Login time not recorded"), "旧版本保存的 Cookie 明确说明未记录登录时间");

// store 的 save → invalidate 路径：凭据被清除/替换后不得沿用旧 cookieExpiresAt，
// 否则已删除的 Cookie 仍渲染过期倒计时；keep 表示“未改动”，必须保留计时。
const staleExpiry = new Date(Date.now() - 60 * 1000).toISOString();
const makeStore = () => {
	const store = createUsageStore(async () => ({ updatedAt: iso(Date.now()), settings: { revision: "r1" }, configured: {}, entries: [] }));
	store.readAll();
	return store;
};
const entryAfter = async (cookieUpdate) => {
	const store = makeStore();
	await store.refresh([M], true);
	store.getSnapshot().entries.push({ providerId: M, state: "ok", cookieExpiresAt: staleExpiry, coverage: "complete", freshness: "fresh", windows: [], extras: [] });
	// 触发一次 emit 以重建快照条目，再走真实的 save 路径。
	store.subscribe(() => {})();
	await store.save({ providerId: M, expectedRevision: "r1", cookieUpdate });
	return store.getSnapshot().entries.find((e) => e.providerId === M);
};
const storeCleared = await entryAfter({ action: "clear" });
assert.equal(storeCleared.cookieExpiresAt, undefined, "清除凭据后不得残留旧倒计时");
const storeReplaced = await entryAfter({ action: "replace", value: COOKIE });
assert.equal(storeReplaced.cookieExpiresAt, undefined, "替换凭据后不得沿用旧倒计时");
const storeKept = await entryAfter({ action: "keep" });
assert.equal(storeKept.cookieExpiresAt, staleExpiry, "keep 表示未改动，必须保留倒计时");

console.log("PASS MiMo Cookie 24 小时计时、entry 下发、药丸到期提醒与设置页有效期说明");
