// MiMo 归一化单测：月度额度池语义（单窗 + Credits 明细 + 下月重置 + percent 小数 ×100）。
import { loadHostModule, makeAssert } from "./helpers.mjs";

const { normalizeMimo } = await loadHostModule();
const assert = makeAssert();

const bal = { code: 0, data: { balance: "-1.19", currency: "CNY" } };
const detail = { code: 0, data: { planCode: "standard", planName: "Standard", currentPeriodEnd: "2026-10-26 23:59:59" } };
const usage = { code: 0, data: {
	monthUsage: { percent: 0.4744, items: [{ name: "month_total_token", used: 5218226015, limit: 11000000000, percent: 0.4744 }] },
	usage: { percent: 0.47, items: [{ name: "plan_total_token", used: 5218226015, limit: 11000000000, percent: 0.47 }, { name: "compensation_total_token", used: 0, limit: 0, percent: 0 }] }
} };

const out = normalizeMimo(bal, detail, usage);
const sub = out.windows.find((w) => w.kind === "sub");
assert(out.windows.length === 1, "仅一个「本周期」窗口（月度额度池，周期一个月）");
assert(sub && sub.percent === 47, "percent 小数 ×100 = 47（原 0% bug）");
assert(sub && sub.detail && sub.detail.used === 5218226015 && sub.detail.limit === 11000000000, "已用/总计 Credits 明细携带");
assert(sub && typeof sub.resetsAt === "string" && sub.resetsAt.startsWith("2026-10-26"), "重置于下月（currentPeriodEnd）");
assert(out.extras.some((x) => x.kind === "plan" && x.value === "Standard"), "extras 套餐名 Standard");
const decimals = normalizeMimo(bal, detail, { data: { usage: { items: [{ name: "plan_total_token", used: 47.44, limit: 100, percent: 0.4744 }] } } });
assert(decimals.windows[0].percent === 47.4 && decimals.windows[0].status === "ok", "保留一位百分比小数47.4，不提前舍入成47");
assert.summary();
