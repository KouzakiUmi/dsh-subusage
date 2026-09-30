// normalizeOpencodeGo 单测：真实 /usage 响应（外层 usage 包裹）+ 兼容形态 + 连坐。
import { loadHostModule, makeAssert } from "./helpers.mjs";

const { normalizeOpencodeGo } = await loadHostModule();
const assert = makeAssert();

// 真实响应（2026-09-30 实测）
const real = { usage: {
	rolling: { status: "ok", percent: 0, resetsAt: "2026-09-30T07:06:39.932Z" },
	weekly: { status: "ok", percent: 14, resetsAt: "2026-10-05T00:00:00.000Z" },
	monthly: { status: "ok", percent: 69, resetsAt: "2026-10-13T06:53:20.000Z" }
} };
const out = normalizeOpencodeGo(real);
assert(out.windows.length === 3, "三个窗口（原 bug：外层 usage 包裹导致 0 窗）");
const rolling = out.windows.find((w) => w.kind === "rolling");
const week = out.windows.find((w) => w.kind === "week");
const month = out.windows.find((w) => w.kind === "month");
assert(rolling && rolling.percent === 0 && rolling.status === "ok", "rolling 0%");
assert(week && week.percent === 14 && week.resetsAt === "2026-10-05T00:00:00.000Z", "weekly 14% + 重置时间");
assert(month && month.percent === 69 && month.resetsAt === "2026-10-13T06:53:20.000Z", "monthly 69% + 重置时间");

// 兼容三窗在顶层的形态
const flat = normalizeOpencodeGo({ monthly: { status: "ok", percent: 5, resetsAt: "2026-11-01T00:00:00Z" } });
assert(flat.windows.length === 1 && flat.windows[0].kind === "month", "兼容顶层形态");

// 周窗用尽 → rolling 连坐
const limited = normalizeOpencodeGo({ usage: {
	rolling: { status: "ok", percent: 0, resetsAt: "2026-09-30T07:06:39.932Z" },
	weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-05T00:00:00.000Z" },
	monthly: { status: "ok", percent: 69, resetsAt: "2026-10-13T06:53:20.000Z" }
} });
assert(limited.windows.find((w) => w.kind === "rolling").cascade === true, "周窗用尽 → rolling 连坐");
assert.summary();
