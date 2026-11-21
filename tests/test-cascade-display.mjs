// 连坐的**显示**口径：读数不被改写，且各处（窗口卡片 / go-panel 行 / 工具文本）说法一致。
//
// 上一轮只断言了「连坐来源用窗口名」的文案，没断言读数，于是「连坐窗口被压成 0% 剩余
// （= 100% 已用）」一路漏到用户面前。这里把三处显示各钉一条。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const host = await loadHostModule();

// ── [1] 工具文本：连坐窗口保留剩余百分比，并写明受连累 ──────────────────────
{
	const value = {
		providers: [{
			providerId: "kimi-coding", label: "Kimi", state: "ok", coverage: "complete", freshness: "fresh",
			windows: [
				{ kind: "week", percent: 100, status: "rate-limited" },
				{ kind: "5h", percent: 40, status: "rate-limited", cascade: true, detail: { blockedBy: ["week"] } }
			],
			extras: []
		}]
	};
	const text = host.formatQuotaText(value);
	assert.ok(text.includes("week 已达限额"), `自身用尽仍是「已达限额」，实际：${text}`);
	assert.ok(text.includes("5h 受连累（60% 剩余）"), `连坐窗口要保留剩余读数，实际：${text}`);
	assert.ok(!text.includes("5h 已达限额"), "连坐窗口不能被写成已达限额");
	console.log("PASS 工具文本：自身用尽 = 已达限额；连坐 = 受连累（60% 剩余）");
}

// ── [2] go-panel：连坐行带剩余，且只有连坐时标题不说「还剩多少」 ──────────────
{
	const code = readFileSync(new URL("../lib/go-panel.js", import.meta.url), "utf8");
	const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
	const { goPanelData } = mod;
	const words = mod.goPanelWords ? mod.goPanelWords("zh") : { left: "剩余", blocked: "连带限流", limited: "已限流" };
	const cascadeEntry = {
		providerId: "devin", label: "Devin", state: "ok", coverage: "complete", freshness: "fresh",
		windows: [
			{ kind: "week", percent: 100, status: "rate-limited" },
			{ kind: "day", percent: 40, status: "rate-limited", cascade: true, detail: { blockedBy: ["week"] } }
		],
		extras: []
	};
	const data = goPanelData({ usageId: "devin", name: "Devin", model: "m" }, cascadeEntry, { locale: "zh", now: Date.parse("2026-11-20T12:00:00+08:00") });
	const week = data.windows.find(w => w.title.includes("每周") || w.title.includes("周"));
	const day = data.windows.find(w => w.title.includes("每日") || w.title.includes("日"));
	assert.ok(day, "每日窗口要渲染出来");
	assert.ok(day.trailing.includes("60%"), `连坐行要带自己的剩余，实际：${day.trailing}`);
	assert.ok(day.trailing.includes("连带限流") || day.trailing.includes("限流"), "同时说明是连坐");
	assert.equal(day.tone, "bad", "连坐仍是红色档");
	assert.ok(week.trailing.includes("已限流") || week.trailing.includes("限流"), "自身用尽行不报剩余");

	// 只有连坐、没有自身用尽：额度实际不可用，标题不能退回去报剩余百分比。
	const onlyCascade = {
		...cascadeEntry,
		windows: [{ kind: "day", percent: 40, status: "rate-limited", cascade: true, detail: { blockedBy: ["week"] } }]
	};
	const only = goPanelData({ usageId: "devin", name: "Devin", model: "m" }, onlyCascade, { locale: "zh", now: Date.parse("2026-11-20T12:00:00+08:00") });
	assert.ok(!/剩余\s*\d+%/.test(only.headline || ""), `只有连坐时标题不得报剩余，实际：${only.headline}`);
	assert.ok((only.headline || "").includes("连"), `只有连坐时标题要说清不可用，实际：${only.headline}`);
	console.log("PASS go-panel：连坐行保留剩余 + 只有连坐时标题不误报剩余");
}

// ── [3] Client 窗口卡片：进度条与大数字按自己的读数 ──────────────────────────
{
	const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	let spec;
	const react = {
		createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) }),
		Fragment: "fragment", useState: v => [typeof v === "function" ? v() : v, () => {}], useRef: v => ({ current: v }),
		useEffect() {}, useMemo: f => f(), useSyncExternalStore: () => null, useCallback: f => f
	};
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { UsageWindowRow, zh, pickPoolLimitedWindow }; exports.apply = apply;"), {
		window: { __ModuleLoader__: { load: v => { spec = v; } } },
		document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
		console, setTimeout, clearTimeout, setInterval, clearInterval
	});
	const api = spec.factory(() => react).__test;
	const t = k => api.zh[k] || k;
	// 节点自身也要留在结果里（progressbar 是元素而不是子节点），文字类单独筛。
	const flat = n => n == null || typeof n === "boolean" ? [] : Array.isArray(n) ? n.flatMap(flat) : typeof n === "string" ? [n] : [n, ...flat(n.children)];
	const textOf = n => flat(n).filter(x => typeof x === "string").join(" ");
	for (const [w, expectLeft, why] of [
		[{ kind: "week", percent: 100, status: "rate-limited" }, 0, "自身用尽"],
		[{ kind: "day", percent: 40, status: "rate-limited", cascade: true, detail: { blockedBy: ["week"] } }, 60, "连坐"]
	]) {
		const tree = api.UsageWindowRow({ w, t, getLocale: () => "zh" });
		const bar = flat(tree).find(n => n?.props?.role === "progressbar");
		assert.equal(bar.props["aria-valuenow"], expectLeft, `${why}：进度条按自己的剩余填充`);
		assert.ok(flat(tree).join(" ").includes(`${expectLeft}%`), `${why}：大数字报自己的剩余`);
	}
	// 池耗尽的代表窗口：根因优先，别拿被连坐的那条去染色（否则横幅说「受连累」掩盖真正用完的窗口）。
	const pool = { exhausted: true, accounts: [
		{ windows: [{ kind: "5h", percent: 40, status: "rate-limited", cascade: true }] },
		{ windows: [{ kind: "week", percent: 100, status: "rate-limited" }] }
	] };
	assert.equal(api.pickPoolLimitedWindow(pool).kind, "week", "池代表窗口取自身用尽的那条");
	assert.equal(api.pickPoolLimitedWindow({ exhausted: true, accounts: [{ windows: [{ kind: "5h", percent: 40, status: "rate-limited", cascade: true }] }] }).kind, "5h", "全是被连坐的才退回第一条");
	assert.equal(api.pickPoolLimitedWindow({ exhausted: false, accounts: [] }), null, "未耗尽不染色");
	console.log("PASS Client 窗口卡片：自身用尽 0% 剩余 / 连坐保留自己的剩余");
}
