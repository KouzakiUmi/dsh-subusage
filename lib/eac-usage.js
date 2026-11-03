// EAC 三渠道（dsh-eac-router）只读额度：消费它对外的 `/api/eac-router` JSON-RPC。
//
// 三条渠道 Loomy / Raccoon / Qoder 中国版 与 dsh-connect-* 独立插件、Our Free Model 读的是
// 同一批账号，因此本模块只负责「把 EAC 的 credits.balances 结果折算成插件统一的额度条目」，
// 由 Host 决定什么时候用它（现有来源缺席时才回退到这里）。
//
// EAC's `publicResult('credits.balances')` projection（lib/web-host.js）：
//   { accounts: [{ accountId, nickname, balance: { total, packages: [{ name, remaining, unit, expiresAt }] } | null, error? }] }
// `expiresAt` 的数字时间单位在 EAC 侧未公开；仅明确可解析的日期字符串参与到期分组。

import { summarizeCreditPackages } from "./credit-packages.js";

export const EAC_CHANNELS = Object.freeze({ loomy: "Loomy", raccoon: "Raccoon", qodercn: "Qoder 中国版" });

const text = value => typeof value === "string" ? value : "";
const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const object = value => value && typeof value === "object" && !Array.isArray(value);
const FAILURE = "余额查询失败，请检查登录状态后重试。";

/**
 * 把 EAC 的余额快照折算成联动条目；没有可读账号时返回 null（与"读取失败"区分）。
 * 单账号直接返回该账号（并带 `linkedAccounts`），多账号返回聚合行——与 WorkBuddy / OFM 同口径。
 */
export function normalizeEac(value, providerId, label, now = Date.now()) {
	const rows = Array.isArray(value?.accounts) ? value.accounts : [];
	if (!rows.length) return null;
	const accounts = rows.map(row => {
		const accountId = text(row?.accountId);
		const base = {
			providerId, label, windows: [], extras: [], coverage: "partial", freshness: "unknown",
			...(accountId ? { accountId } : {}),
			...(text(row?.nickname).trim() ? { account: text(row.nickname).trim() } : {}),
		};
		const balance = object(row?.balance) ? row.balance : undefined;
		const total = num(balance?.total);
		if (total === undefined) return { ...base, state: "error", error: text(row?.error) || FAILURE };
		const packages = Array.isArray(balance.packages) ? balance.packages : [];
		// 单位只照抄包上报的原始 unit；total 自身不带单位时不替它编造换算。
		const unit = text(packages.find(pkg => text(pkg?.unit))?.unit).trim();
		const prepared = packages.map(pkg => ({
			...pkg,
			expiresAt: typeof pkg?.expiresAt === "string" && Number.isFinite(Date.parse(pkg.expiresAt)) ? Date.parse(pkg.expiresAt) : undefined,
		}));
		const normalized = summarizeCreditPackages(prepared, now);
		const extras = [{ kind: "balance", value: unit ? `${total} ${unit}` : `${total} credits` }, ...normalized.extras];
		return { ...base, state: "ok", extras, coverage: packages.length ? "complete" : "partial", freshness: "fresh", lastSuccessAt: new Date(now).toISOString() };
	});
	if (accounts.length === 1) return { ...accounts[0], linkedAccounts: accounts };
	const successful = accounts.filter(row => row.state === "ok");
	return {
		providerId, label, state: successful.length ? "ok" : "error", windows: [], extras: [], coverage: accounts.every(row => row.state === "ok" && row.coverage === "complete") ? "complete" : "partial",
		freshness: successful.length ? "fresh" : "unknown",
		...(successful.length ? { lastSuccessAt: new Date(now).toISOString() } : {}),
		linkedAccounts: accounts,
		...(!successful.length ? { error: FAILURE } : {}),
	};
}

/**
 * 额度读取器：EAC 每次调用都会真去上游取数，所以 60 秒内复用同一份快照；
 * `force` 绕过缓存。通道缺席（EAC 没装 / 后端未就绪）返回 `undefined`，与真实失败分开。
 */
export class EacUsageReader {
	constructor({ call, now = Date.now } = {}) {
		if (typeof call !== "function" || typeof now !== "function") throw new TypeError("EacUsageReader 需要 call 与 now 函数");
		this.call = call; this.now = now; this.cache = new Map(); this.pending = new Map(); this.versions = new Map(); this.disposed = false;
	}
	read(channel, force = false) {
		if (this.disposed) throw new Error("EAC 读取器已卸载");
		if (!Object.hasOwn(EAC_CHANNELS, channel)) throw new Error("未知 EAC 渠道");
		const cached = this.cache.get(channel), time = this.now();
		if (!force && this.pending.has(channel)) return this.pending.get(channel);
		if (!force && cached && time >= cached.at && time - cached.at < 60000) return structuredClone(cached.value);
		const version = (this.versions.get(channel) ?? 0) + 1; this.versions.set(channel, version);
		const task = Promise.resolve().then(() => this.call(channel)).then(value => {
			if (!this.disposed && this.versions.get(channel) === version) {
				if (value === undefined) this.cache.delete(channel);
				else this.cache.set(channel, { at: this.now(), value: structuredClone(value) });
			}
			return value;
		}).finally(() => { if (this.pending.get(channel) === task) this.pending.delete(channel); });
		this.pending.set(channel, task);
		return task;
	}
	dispose() { this.disposed = true; this.cache.clear(); this.pending.clear(); this.versions.clear(); }
}
