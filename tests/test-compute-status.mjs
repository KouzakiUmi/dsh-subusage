// computeStatus 分支矩阵单测：药丸 / 弹层横幅 / 设置页横幅共用的状态判定。
// 覆盖优先级（额度用尽 > Cookie 到期 > 需配置 > 读取失败 > 缓存/不完整 > 档位 > 仅余额）
// 与各分支的 key/color/icon/tinted/short，防止三处 UI 结论漂移。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

let spec;
const react = {
	createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
	Fragment: "fragment",
	useSyncExternalStore: (_s, get) => get(),
	useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
	useRef: (value) => ({ current: value }),
	useEffect: () => {},
	useMemo: (fn) => fn()
};
const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { computeStatus }; exports.apply = apply;"), {
	window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console
});
const { computeStatus } = spec.factory(() => react).__test;
// t 为键名回显：断言里出现的都是 locale 键名，不依赖具体语言。
const t = (key) => key;
const getLocale = () => "zh";
const args = (over = {}) => ({ failed: null, failState: undefined, providerId: "zai-coding-cn", t, getLocale, ...over });
const w = (kind, percent, extra = {}) => ({ kind, percent, status: percent >= 100 ? "rate-limited" : "ok", ...extra });
const entry = (over = {}) => ({ state: "ok", coverage: "complete", freshness: "fresh", windows: [], extras: [], ...over });
const inMs = (ms) => new Date(Date.now() + ms).toISOString();

// ── 加载 / 关闭 ──────────────────────────────────────────────────────────────
assert.equal(computeStatus(null, args()).key, "loading");
assert.equal(computeStatus(null, args()).icon, "…");
assert.equal(computeStatus(entry({ state: "loading" }), args()).key, "loading");
assert.equal(computeStatus(entry({ state: "disabled" }), args()).key, "disabled");

// ── 额度用尽（rank 4）：最高优先级 ───────────────────────────────────────────
{
	const st = computeStatus(entry({ windows: [w("sub", 100)] }), args());
	assert.equal(st.key, "blocked");
	assert.equal(st.color, "#ef4444");
	assert.equal(st.icon, "✕");
	assert.equal(st.tinted, true);
	assert.ok(st.short.includes("pillLimited"), "直达限额的 short 用「已用尽」");
	assert.ok(st.title.includes("statusExhausted"));
}
{
	// 连坐窗口是唯一 rank4（week 未用尽），worstWindow 才会选中它。
	const st = computeStatus(entry({ windows: [w("sub", 10, { status: "rate-limited", cascade: true, detail: { blockedBy: ["week"] } }), w("week", 62)] }), args());
	assert.equal(st.key, "blocked");
	assert.ok(st.title.includes("statusBlocked"), "连坐标题是「暂不可用」");
	assert.ok(st.short.includes("pillBlocked"), "连坐 short 用「受连累」");
}

// ── Cookie 到期：优先于需配置 / 读取失败；已过期例外于失败 ───────────────────
{
	const st = computeStatus(entry({ cookieExpiresAt: inMs(90 * 60 * 1000), windows: [w("sub", 25)] }), args());
	assert.equal(st.key, "cookie");
	assert.equal(st.color, "#eab308");
	assert.equal(st.tinted, true);
}
assert.equal(computeStatus(entry({ cookieExpiresAt: inMs(10 * 60 * 1000) }), args()).color, "#f97316", "30 分钟内橙色");
assert.equal(computeStatus(entry({ cookieExpiresAt: inMs(-60 * 1000) }), args()).color, "#ef4444", "已过期红色");
assert.equal(computeStatus(entry({ cookieExpiresAt: inMs(5 * 60 * 60 * 1000) }), args()).key, "balance", "距到期远不进入 cookie 分支");
{
	// 额度用尽压过 Cookie 提醒。
	const st = computeStatus(entry({ cookieExpiresAt: inMs(90 * 60 * 1000), windows: [w("sub", 100)] }), args());
	assert.equal(st.key, "blocked");
}
{
	// 已过期本身是行动项：即使凭据同时被拒也直说过期。
	const st = computeStatus(entry({ state: "error", errorCode: "subusage/auth", coverage: "partial", freshness: "unknown", cookieExpiresAt: inMs(-60 * 1000) }), args({ failed: "auth failed", failState: "error" }));
	assert.equal(st.key, "cookie");
}
{
	// 凭据已被拒时倒计时不盖过失败原因。
	const st = computeStatus(entry({ state: "error", errorCode: "subusage/auth", coverage: "partial", freshness: "unknown", cookieExpiresAt: inMs(90 * 60 * 1000) }), args({ failed: "auth failed", failState: "error" }));
	assert.equal(st.key, "error");
}

// ── 需配置：蓝色 ⚙，不是红色失败 ────────────────────────────────────────────
{
	const st = computeStatus(entry({ state: "no-key", coverage: "partial", freshness: "unknown" }), args({ failState: "no-key" }));
	assert.equal(st.key, "config");
	assert.equal(st.color, "#3b82f6");
	assert.equal(st.icon, "⚙");
	assert.ok(st.sub.includes("pillNeedKey"));
}
assert.ok(computeStatus(entry({ state: "no-cookie", coverage: "partial", freshness: "unknown" }), args({ failState: "no-cookie" })).title.includes("statusNoCookie"));
assert.ok(computeStatus(entry({ state: "no-key", coverage: "partial", freshness: "unknown" }), args({ failState: "no-key", providerId: "commandcode" })).sub.includes("pillNeedCommandcode"), "Command Code 给专属指引");

// ── 读取失败 / 降级 ─────────────────────────────────────────────────────────
{
	const st = computeStatus(entry({ state: "error", error: "boom", coverage: "partial", freshness: "unknown" }), args({ failed: "boom", failState: "error" }));
	assert.equal(st.key, "error");
	assert.equal(st.color, "#ef4444");
	assert.equal(st.icon, "!");
	assert.equal(st.sub, "boom", "失败原因进横幅依据行");
}
{
	const st = computeStatus(entry({ state: "error", retainPrevious: true, freshness: "stale", lastSuccessAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(), windows: [w("sub", 30)] }), args({ failed: "network", failState: "error" }));
	assert.equal(st.key, "degraded");
	assert.ok(st.title.includes("statusCache"), "过期缓存即使 state=error 也叫「缓存数据」");
	assert.ok(st.sub.includes("cacheAge"), "缓存年龄进依据行");
}
assert.equal(computeStatus(entry({ coverage: "partial", windows: [w("sub", 30)] }), args()).key, "degraded", "部分数据是降级态");
assert.ok(computeStatus(entry({ coverage: "partial" }), args()).title.includes("statusPartial"));

// ── 档位：只描述还剩多少 ────────────────────────────────────────────────────
{
	const st = computeStatus(entry({ windows: [w("5h", 40), w("week", 95)] }), args());
	assert.equal(st.key, "tight");
	assert.equal(st.color, "#f97316");
	assert.ok(st.short.includes("badgeTight"), "short 带窗口短名 + 档位词");
	assert.ok(st.sub.includes("statusWorst"), "多窗口依据行标出最紧张窗口");
}
assert.equal(computeStatus(entry({ windows: [w("sub", 80)] }), args()).key, "low");
assert.equal(computeStatus(entry({ windows: [w("sub", 80)] }), args()).color, "#eab308");
{
	const st = computeStatus(entry({ windows: [w("sub", 20)] }), args());
	assert.equal(st.key, "ok");
	assert.equal(st.color, "#22c55e");
	assert.equal(st.icon, "✓");
	assert.equal(st.tinted, false, "充足不染色");
	assert.equal(st.short, "", "充足时药丸不写字");
}

// ── 仅余额 / 无数据 ─────────────────────────────────────────────────────────
{
	const st = computeStatus(entry({ extras: [{ kind: "balance", value: "¥128.50" }] }), args());
	assert.equal(st.key, "balance");
	assert.ok(st.title.includes("balanceLabel"), "余额就是唯一信息，不画成充足");
	assert.equal(st.tinted, false);
}
assert.ok(computeStatus(entry(), args()).title.includes("noUsageData"), "既无窗口也无余额才回落占位");

// ── 新套餐：包含额度、支付路径与实际可用性分开 ───────────────────────────
for (const availability of ["paygo", "included", "unknown"]) {
	const st = computeStatus(entry({ availability, windows: [w("week", 100)] }), args());
	assert.equal(st.key, availability);
	assert.notEqual(st.color, "#ef4444", "续用建议或未知不能硬判整体不可用");
}
assert.equal(computeStatus(entry({ availability: "blocked", availabilityReason: "spend-control" }), args()).key, "restricted");
assert.equal(computeStatus(entry({ availability: "unknown", windows: [w("week", 10)] }), args()).key, "unknown", "明确续用未知不能被健康百分比盖过");
assert.equal(computeStatus(entry({ availability: "paygo", extras: [{ kind: "balance", value: "10 USD" }] }), args()).key, "paygo", "无订阅窗口仍保留PAYG路由结论");
assert.equal(computeStatus(entry({ availability: "paygo", freshness: "stale", retainPrevious: true, windows: [w("week", 100)] }), args()).key, "blocked", "缓存建议不当作当前续用保证");
const pool = { mode: "auto", total: 2, available: 1, blockedCount: 1, unusableCount: 0, exhausted: false, accounts: [] };
for (const state of ["ok", "no-key", "error"]) {
	const st = computeStatus(entry({ state, windows: [w("5h", 100)], accountPool: pool }), args({ providerId: "commandcode" }));
	assert.equal(st.key, "pool", "默认账户异常但备用可用，整体状态来自池");
	assert.notEqual(st.color, "#ef4444");
}
assert.equal(computeStatus(entry({ accountPool: { ...pool, available: 0, exhausted: false, accounts: [{ state: "error" }] } }), args()).key, "pool-unknown");
assert.equal(computeStatus(entry({ accountPool: { ...pool, available: 0, exhausted: false, accounts: [{ state: "ok", availability: "unknown" }] } }), args()).key, "pool-unknown");
assert.equal(computeStatus(entry({ extras: [{ kind: "quota-status", value: "unlimited" }] }), args()).key, "unlimited", "已报告无上限不冒充没数据");
const scoped = [w("day", 100, { detail: { scope: "daily-capabilities" } }), w("5h", 10, { detail: { scope: "text" } }), w("month", 20, { detail: { scope: "all" } })];
assert.equal(computeStatus(entry({ windows: scoped }), args()).key, "scope", "部分能力日池耗尽不能写成全套餐耗尽");
assert.equal(computeStatus(entry({ windows: [...scoped, w("month", 100, { detail: { scope: "all" } })] }), args()).key, "blocked", "共享月池耗尽仍约束全能力");
assert.ok(computeStatus(entry({ extras: [{ kind: "spend", value: "1 USD" }] }), args()).title.includes("spendLabel"), "已花费不得标为余额");
console.log("PASS computeStatus：旧分支与支付续用、企业限制、轮换池、能力范围新矩阵");
