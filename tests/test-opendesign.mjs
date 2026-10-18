// OpenDesign（open-design.ai / Powerformer）Coding Plan 额度归一化与登记。
// 契约是 2026-10-18 用真实账号实测的：响应是**扁平**结构，没有嵌套 codingPlan，也没有钱包余额。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadHostModule } from "./helpers.mjs";

const { normalizeOpenDesign } = await loadHostModule();

/** 一份完整的编码计划用量响应：Pro 档，7 天窗 + 5 小时窗。数值全为虚构。 */
const body = (over = {}) => ({
	workspaceId: "ws_fixture",
	generatedAt: "2026-10-18T08:00:00.000Z",
	eligible: true,
	tier: "pro",
	windows: [
		{ policyId: "p5h", durationSeconds: 18000, resetMode: "activity_triggered", usedCredits: "1500", limitCredits: "6000", remainingCredits: "4500", windowStart: "2026-10-18T07:00:00.000Z", resetsAt: "2026-10-18T12:00:00.000Z" },
		{ policyId: "p7d", durationSeconds: 604800, resetMode: "anchored_recurring", usedCredits: "24000", limitCredits: "48000", remainingCredits: "24000", windowStart: "2026-10-14T10:00:00.000Z", resetsAt: "2026-10-21T10:00:00.000Z" }
	],
	...over
});

// 1. 两个窗口：秒数映射到既有档位，百分比只能由 usedCredits / limitCredits 算出（接口不下发百分比）。
const pro = normalizeOpenDesign(body());
assert.deepEqual(pro.windows.map(w => w.kind), ["5h", "week"]);
assert.deepEqual(pro.windows.map(w => w.percent), [25, 50]);
assert.equal(pro.windows[1].resetsAt, "2026-10-21T10:00:00.000Z");
assert.deepEqual(pro.windows[1].detail, { used: 24000, remaining: 24000, limit: 48000, unit: "credits" });
assert.equal(pro.coverage, "complete");
assert.deepEqual(pro.extras, [{ kind: "plan", value: "Pro" }], "真实契约没有余额字段，extras 只放档位");

// 2. 官方语义里 5 小时窗不是所有套餐都有（Plus / Pro / Max 只有 7 天窗）：少了它不算缺数据。
const plus = normalizeOpenDesign(body({ tier: "plus", windows: [body().windows[1]] }));
assert.deepEqual(plus.windows.map(w => w.kind), ["week"]);
assert.equal(plus.coverage, "complete", "只有一个周窗仍是完整读数");
assert.equal(plus.extras[0].value, "Plus");

// 3. 额度读不到 / 上限为 0 / 秒数缺失都要**跳过该窗口**，绝不画成 0% 用量。
const partial = normalizeOpenDesign(body({
	windows: [
		{ policyId: "bad-credits", durationSeconds: 18000, usedCredits: "abc", limitCredits: "6000" },
		{ policyId: "zero-limit", durationSeconds: 18000, usedCredits: "10", limitCredits: "0" },
		{ policyId: "no-limit", durationSeconds: 18000, usedCredits: "10" },
		{ policyId: "no-duration", usedCredits: "10", limitCredits: "100" },
		{ policyId: "ok", durationSeconds: 18000, usedCredits: "10", limitCredits: "100" }
	]
}));
assert.equal(partial.windows.length, 1, "只有合法那条被采纳");
assert.equal(partial.windows[0].percent, 10);
assert.equal(partial.windows[0].detail.remaining, undefined, "接口没给剩余量就不编一个");

// 4. 耗尽：短窗用尽不连坐长窗，长窗用尽才级联到短窗。
const spent = normalizeOpenDesign(body({
	windows: [
		{ policyId: "5h", durationSeconds: 18000, usedCredits: "10", limitCredits: "100" },
		{ policyId: "7d", durationSeconds: 604800, usedCredits: "100", limitCredits: "100" }
	]
}));
assert.equal(spent.windows[1].status, "rate-limited");
assert.equal(spent.windows[0].status, "rate-limited", "周窗耗尽级联到 5 小时窗");
assert.equal(spent.windows[0].cascade, true);

// 5. 未订阅：eligible:false、tier:null、没有窗口——如实说明并让前端收起额度区。
const none = normalizeOpenDesign({ workspaceId: "ws", generatedAt: "2026-10-18T08:00:00.000Z", eligible: false, tier: null, windows: [] });
assert.deepEqual(none.windows, []);
assert.equal(none.subscribed, false);
assert.equal(none.coverage, "complete");
assert.ok(none.extras[0].value.includes("没有 Design Plan 订阅"));

// 6. 有档位却读不到窗口：标 partial，不能看起来像完整读数。
const tierOnly = normalizeOpenDesign({ workspaceId: "ws", eligible: true, tier: "go", windows: [] });
assert.deepEqual(tierOnly.extras, [{ kind: "plan", value: "Go" }]);
assert.equal(tierOnly.coverage, "partial");

// 7. 其它时长各有档位：按接口下发的秒数判断，不从套餐名或模型名反推。
const kinds = normalizeOpenDesign(body({
	windows: [
		{ policyId: "d", durationSeconds: 86400, usedCredits: "1", limitCredits: "100" },
		{ policyId: "m", durationSeconds: 2592000, usedCredits: "1", limitCredits: "100" },
		{ policyId: "x", durationSeconds: 7776000, usedCredits: "1", limitCredits: "100" }
	]
}));
assert.deepEqual(kinds.windows.map(w => w.kind), ["day", "month", "period"]);

// 8. 非对象响应直接报错，不静默返回空额度。
assert.throws(() => normalizeOpenDesign(null), /OpenDesign 响应不是 JSON 对象/);
assert.throws(() => normalizeOpenDesign("nope"), /OpenDesign 响应不是 JSON 对象/);

// 9. 认不出任何预期字段的 200 响应（字段改名、外面套了信封、回错误壳）：报「无法解析」。
//    这个端点是未公开的私有接口，契约变化正是最可能的失效形态；此时若说成「没有订阅」，
//    用户看到的是一个确定的负面结论，比「读不出来」更误导人。
for (const [label, value] of [
	["空对象", {}],
	["错误信封", { code: 0, message: "ok", data: null }],
	["只有通用时间戳", { generatedAt: "2026-10-18T08:00:00.000Z" }]
]) assert.throws(() => normalizeOpenDesign(value), /OpenDesign 响应没有可用的配额或余额/, label);
// 反过来，认得出扁平契约就走未订阅分支，不能被上面的门槛误伤。
assert.equal(normalizeOpenDesign({ eligible: false }).subscribed, false, "eligible 是布尔就算读到了答案");
assert.equal(normalizeOpenDesign({ tier: null }).subscribed, false, "tier 明确为 null 也算读到了答案");

// 10. 登记契约：id、默认关闭、Cookie 型继承变量、两步端点，以及用 Cookie 头鉴权。
const hostSrc = readFileSync(join(ROOT, "lib", "index.js"), "utf8");
const clientSrc = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
assert.ok(/"opendesign": \{ label: "OpenDesign", envName: "OPEN_DESIGN_COOKIE", defaultEnabled: false \}/.test(hostSrc), "Host 清单登记 OpenDesign 且默认关闭");
const loginSrc = readFileSync(join(ROOT, "lib", "opendesign-login.js"), "utf8");
assert.ok(loginSrc.includes("https://amr-api.open-design.ai/api"), "控制面 API 基址固定");
assert.ok(loginSrc.includes("/v1/workspaces/current"), "先读当前工作区拿 workspaceId");
assert.ok(loginSrc.includes("openDesignUsageUrl"), "额度 URL 由 workspaceId 拼出");
assert.ok(hostSrc.includes("openDesignUsageUrl(await openDesignWorkspaceId(get, cookie))"), "Host 走两步：先取 workspaceId 再读额度");
assert.ok(hostSrc.includes("get(OPEN_DESIGN_CURRENT_URL, { cookie })"), "取工作区同样用 Cookie 头，不套通用 Bearer");
assert.ok(/"opendesign": \{ label: "OpenDesign", short: "OpenDesign", envName: "OPEN_DESIGN_COOKIE", defaultEnabled: false \}/.test(clientSrc), "Client 元数据与 Host 同默认值");
assert.ok(/"zenmux", "litellm", "opendesign"/.test(clientSrc), "Client 展示顺序包含 OpenDesign");

console.log("test-opendesign 全部通过 ✅");
