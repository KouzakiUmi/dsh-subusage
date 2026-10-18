// OpenDesign（open-design.ai / Powerformer）Design Plan 额度归一化与登记。
// 契约取自线上控制台 bundle 里 amr-api 的 Zod schema（schemaVersion 1）；本文件只用虚构数值。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadHostModule } from "./helpers.mjs";

const { normalizeOpenDesign } = await loadHostModule();

/** 一份完整的编码计划用量响应：Pro 档，7 天窗 + 5 小时窗。 */
const body = (over = {}) => ({
	schemaVersion: 1,
	workspaceId: "ws_fixture",
	workspaceMemberId: "wm_fixture",
	modelId: null,
	generatedAt: "2026-10-18T08:00:00.000Z",
	balanceUsd: "12.34",
	codingPlan: {
		workspaceId: "ws_fixture",
		generatedAt: "2026-10-18T08:00:00.000Z",
		eligible: true,
		tier: "pro",
		windows: [
			{ policyId: "p5h", durationSeconds: 18000, resetMode: "activity_triggered", usedCredits: "1500", limitCredits: "6000", remainingCredits: "4500", windowStart: "2026-10-18T07:00:00.000Z", resetsAt: "2026-10-18T12:00:00.000Z" },
			{ policyId: "p7d", durationSeconds: 604800, resetMode: "anchored_recurring", usedCredits: "24000", limitCredits: "48000", remainingCredits: "24000", windowStart: "2026-10-14T10:00:00.000Z", resetsAt: "2026-10-21T10:00:00.000Z" }
		]
	},
	modelCovered: true,
	funding: "coding_plan",
	fundingCheck: "available",
	...over
});

// 1. 两个窗口：秒数映射到既有档位，百分比只能由 usedCredits / limitCredits 算出（接口不下发百分比）。
const pro = normalizeOpenDesign(body());
assert.deepEqual(pro.windows.map(w => w.kind), ["5h", "week"]);
assert.deepEqual(pro.windows.map(w => w.percent), [25, 50]);
assert.equal(pro.windows[1].resetsAt, "2026-10-21T10:00:00.000Z");
assert.deepEqual(pro.windows[1].detail, { used: 24000, remaining: 24000, limit: 48000, unit: "credits" });
assert.equal(pro.coverage, "complete");
assert.deepEqual(pro.extras, [{ kind: "plan", value: "Pro" }, { kind: "balance", value: "12.34 USD" }]);

// 2. 官方语义里 5 小时窗不是所有套餐都有（Plus / Pro / Max 只有 7 天窗）：少了它不算缺数据。
const weeklyOnly = body();
weeklyOnly.codingPlan.tier = "plus";
weeklyOnly.codingPlan.windows = [body().codingPlan.windows[1]];
const plus = normalizeOpenDesign(weeklyOnly);
assert.deepEqual(plus.windows.map(w => w.kind), ["week"]);
assert.equal(plus.coverage, "complete", "只有一个周窗仍是完整读数");
assert.equal(plus.extras[0].value, "Plus");

// 3. 额度读不到 / 上限为 0 / 秒数缺失都要**跳过该窗口**，绝不画成 0% 用量。
const broken = body();
broken.codingPlan.windows = [
	{ policyId: "bad-credits", durationSeconds: 18000, usedCredits: "abc", limitCredits: "6000" },
	{ policyId: "zero-limit", durationSeconds: 18000, usedCredits: "10", limitCredits: "0" },
	{ policyId: "no-limit", durationSeconds: 18000, usedCredits: "10" },
	{ policyId: "no-duration", usedCredits: "10", limitCredits: "100" },
	{ policyId: "ok", durationSeconds: 18000, usedCredits: "10", limitCredits: "100" }
];
const partial = normalizeOpenDesign(broken);
assert.equal(partial.windows.length, 1, "只有合法那条被采纳");
assert.equal(partial.windows[0].percent, 10);
assert.equal(partial.windows[0].detail.remaining, undefined, "接口没给剩余量就不编一个");

// 4. 耗尽：短窗用尽不连坐长窗，长窗用尽才级联到短窗。
const exhausted = body();
exhausted.codingPlan.windows = [
	{ policyId: "5h", durationSeconds: 18000, usedCredits: "10", limitCredits: "100" },
	{ policyId: "7d", durationSeconds: 604800, usedCredits: "100", limitCredits: "100" }
];
const spent = normalizeOpenDesign(exhausted);
assert.equal(spent.windows[1].status, "rate-limited");
assert.equal(spent.windows[0].status, "rate-limited", "周窗耗尽级联到 5 小时窗");
assert.equal(spent.windows[0].cascade, true);

// 5. 未订阅：没有窗口也没有档位——如实说明并让前端收起额度区，余额与扣费来源照常显示。
const none = normalizeOpenDesign({
	schemaVersion: 1, workspaceId: "ws", workspaceMemberId: "wm", modelId: null,
	generatedAt: "2026-10-18T08:00:00.000Z", balanceUsd: "3.5", modelCovered: null,
	codingPlan: { workspaceId: "ws", generatedAt: "2026-10-18T08:00:00.000Z", eligible: false, tier: null, windows: [] },
	funding: "wallet"
});
assert.deepEqual(none.windows, []);
assert.equal(none.subscribed, false);
assert.equal(none.coverage, "complete");
assert.ok(none.extras[0].value.includes("没有 Design Plan 订阅"));
assert.ok(none.extras.some(e => e.kind === "balance" && e.value === "3.5 USD"), "未订阅也照常显示钱包余额");
// 没有额度线时不能再补「Design Plan 额度已用尽，当前按量从钱包扣费」：那两句会自相矛盾。
assert.ok(!none.extras.some(e => e.kind === "note"), "没有额度信息时不补「额度已用尽」解释");

// 6. 有档位却读不到窗口：标 partial，不能看起来像完整读数。
const tierOnly = normalizeOpenDesign({ codingPlan: { tier: "go", eligible: true, windows: [] } });
assert.deepEqual(tierOnly.extras, [{ kind: "plan", value: "Go" }]);
assert.equal(tierOnly.coverage, "partial");

// 7. 其它时长各有档位：按接口下发的秒数判断，不从套餐名或模型名反推。
const kinds = body();
kinds.codingPlan.windows = [
	{ policyId: "d", durationSeconds: 86400, usedCredits: "1", limitCredits: "100" },
	{ policyId: "m", durationSeconds: 2592000, usedCredits: "1", limitCredits: "100" },
	{ policyId: "x", durationSeconds: 7776000, usedCredits: "1", limitCredits: "100" }
];
assert.deepEqual(normalizeOpenDesign(kinds).windows.map(w => w.kind), ["day", "month", "period"]);

// 8. 非对象响应直接报错，不静默返回空额度。
assert.throws(() => normalizeOpenDesign(null), /OpenDesign 响应不是 JSON 对象/);
assert.throws(() => normalizeOpenDesign("nope"), /OpenDesign 响应不是 JSON 对象/);

// 9. 认不出任何预期字段的 200 响应（字段改名、外面套了信封、直接回错误壳）：报「无法解析」。
//    这个端点是未公开的私有接口，契约变化正是最可能的失效形态；此时若说成「该账号没有订阅」，
//    用户看到的是一个确定的负面结论，比「读不出来」更误导人。
for (const [label, value] of [
	["空对象", {}],
	["错误信封", { code: 0, message: "ok", data: null }],
	["复合字段整体改名", { coding_plan: null, balance_usd: "3.5", funding: "wallet" }],
	["字段在但值为 null", { balanceUsd: null, funding: "wallet" }]
]) assert.throws(() => normalizeOpenDesign(value), /OpenDesign 响应没有可用的配额或余额/, label);
// 反过来，真的读到了额度就走未订阅分支，不能被上面的门槛误伤。
assert.equal(normalizeOpenDesign({ codingPlan: null }).subscribed, false, "codingPlan 明确为 null 是读到了答案");
assert.equal(normalizeOpenDesign({ balanceUsd: "3.5" }).subscribed, false, "读到余额同样算读到了答案");

// 10. 登记契约：id、默认关闭、Cookie 型继承变量、控制台端点，以及用 Cookie 头鉴权。
const hostSrc = readFileSync(join(ROOT, "lib", "index.js"), "utf8");
const clientSrc = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
assert.ok(/"opendesign": \{ label: "OpenDesign", envName: "OPEN_DESIGN_COOKIE", defaultEnabled: false \}/.test(hostSrc), "Host 清单登记 OpenDesign 且默认关闭");
const loginSrc = readFileSync(join(ROOT, "lib", "opendesign-login.js"), "utf8");
assert.ok(loginSrc.includes("https://amr-api.open-design.ai/api/v1/workspaces/current/billing/coding-plan-usage"), "额度端点固定为控制台接口");
assert.ok(hostSrc.includes('import { OpenDesignLogin, OPEN_DESIGN_USAGE_URL } from "./opendesign-login.js"'), "Host 与登录器共用同一个额度 URL 常量");
assert.ok(hostSrc.includes("get(OPEN_DESIGN_USAGE_URL, { cookie })"), "用 Cookie 头鉴权，不套通用 Bearer");
assert.ok(/"opendesign": \{ label: "OpenDesign", short: "OpenDesign", envName: "OPEN_DESIGN_COOKIE", defaultEnabled: false \}/.test(clientSrc), "Client 元数据与 Host 同默认值");
assert.ok(/"zenmux", "litellm", "opendesign"/.test(clientSrc), "Client 展示顺序包含 OpenDesign");

console.log("test-opendesign 全部通过 ✅");
