// 积分包展示归一化：只处理单个账号内的包，按单位与用途聚合，不跨账号/单位换算。
// 调用方必须把已知到期时间换成毫秒时间戳；单位不明的上游时间不得传入。

const DAY = 24 * 60 * 60 * 1000;
const number = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const text = value => typeof value === "string" ? value.trim() : "";
const round = value => Math.round(value * 100) / 100;
const sameDay = (a, b) => {
	const left = new Date(a), right = new Date(b);
	return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
};
const permanent = name => /永久|充值|permanent|top[\s-]?up/i.test(name);
const recurring = name => /每日|每周|每月|月度|套餐|会员|daily|weekly|monthly|subscription/i.test(name);

const LABELS = {
	today: "今天到期",
	soon: "3 天内到期",
	temporary: "临时额度合计",
	recurring: "周期 / 套餐额度",
	permanent: "永久额度",
};

/**
 * 返回仍有效的规范包，以及可直接放进 entry.extras 的聚合说明。
 * 已用尽（remaining <= 0）与能确认已过期的包都不再进入窗口或说明。
 * urgentOnly 用于已经有额度窗口的包：只补紧急到期提醒，不重复列余量。
 */
export function summarizeCreditPackages(packages, now = Date.now(), { urgentOnly = false } = {}) {
	const usable = [], groups = new Map();
	for (const source of Array.isArray(packages) ? packages : []) {
		const remaining = number(source?.remaining);
		if (remaining === undefined || remaining <= 0) continue;
		const expiresAt = number(source?.expiresAt);
		if (expiresAt !== undefined && expiresAt <= now) continue;
		const name = text(source?.name) || "积分包", unit = text(source?.unit);
		const kind = expiresAt !== undefined && sameDay(expiresAt, now) ? "today"
			: expiresAt !== undefined && expiresAt <= now + 3 * DAY ? "soon"
			: permanent(name) ? "permanent"
			: recurring(name) || source?.recurring === true ? "recurring" : "temporary";
		const normalized = { ...source, name, remaining, unit, ...(expiresAt !== undefined ? { expiresAt } : {}) };
		usable.push(normalized);
		const key = `${kind}\0${unit}`;
		const group = groups.get(key) ?? { kind, unit, total: 0, earliest: undefined };
		group.total += remaining;
		if (expiresAt !== undefined && (group.earliest === undefined || expiresAt < group.earliest)) group.earliest = expiresAt;
		groups.set(key, group);
	}
	const order = ["today", "soon", "temporary", "recurring", "permanent"];
	const extras = [...groups.values()]
		.filter(group => !urgentOnly || group.kind === "today" || group.kind === "soon")
		.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.unit.localeCompare(b.unit))
		.map(group => {
			const amount = `${round(group.total)}${group.unit ? ` ${group.unit}` : ""}`;
			const earliest = group.earliest !== undefined && (group.kind === "today" || group.kind === "soon") ? `（最早 ${new Date(group.earliest).toISOString()}）` : "";
			return { kind: "note", value: `${LABELS[group.kind]}：${amount}${earliest}` };
		});
	return { packages: usable, extras };
}
