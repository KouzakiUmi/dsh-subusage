// 自动探测状态机（4 态）、结构化推断、歧义检测、预览脱敏与 mappingLock 隔离回归测试
import assert from "node:assert/strict";
import { probeConnectionEndpoint } from "../lib/detection/detector.js";
import { inferGenericResponse } from "../lib/detection/inference.js";
import { sanitizePreview } from "../lib/detection/sanitize-preview.js";
import { mergeMappingWithLock } from "../lib/adapters/declarative/custom-http.js";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService } = await loadHostModule();

// 1. 预览脱敏（sanitizePreview）：彻底遮蔽敏感键名、JWT、sk-/ak-、URL userinfo 与当前请求密钥值
const rawWithSecrets = {
	api_key: "sk-live-secret-value-1234567890",
	access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
	nested: {
		cookie: "session_id=abcdef",
		echoedSecret: "my-custom-header-secret-xyz",
		endpoint: "https://user:pass123@api.example.com/v1/usage",
		inlineToken: "Bearer sk-abcdef1234567890abcdef"
	},
	quota: {
		used: 120,
		limit: 500,
		remaining: 380,
		unit: "USD"
	}
};
const sanitized = sanitizePreview(rawWithSecrets, { secretHints: ["my-custom-header-secret-xyz"] });
const serializedPreview = JSON.stringify(sanitized);
assert(!serializedPreview.includes("sk-live-secret-value-1234567890"), "遮蔽 api_key");
assert(!serializedPreview.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), "遮蔽 JWT");
assert(!serializedPreview.includes("session_id=abcdef"), "遮蔽 cookie");
assert(!serializedPreview.includes("my-custom-header-secret-xyz"), "遮蔽请求 secret 原始值回显");
assert(!serializedPreview.includes("pass123"), "遮蔽 URL userinfo 密码");
assert(!serializedPreview.includes("sk-abcdef1234567890abcdef"), "遮蔽内联 sk- token");
assert.equal(sanitized.quota.used, 120, "保留非敏感配额数字");

// 2. 结构化推断与五大语义歧义检测（inferGenericResponse）
// 2a. 满足数值守恒 used + remaining ≈ limit
const conserved = inferGenericResponse({
	data: {
		plan_name: "Team Pro",
		used: 120,
		remaining: 380,
		limit: 500,
		unit: "USD",
		reset_at: "2026-10-15T00:00:00Z"
	}
});
assert.equal(conserved.matched, true);
assert.equal(conserved.requiresConfirmation, true, "启发式推断结果必须标记 requiresConfirmation: true");
assert.equal(conserved.suggestedMapping.usedPointer, "/data/used");
assert.equal(conserved.suggestedMapping.remainingPointer, "/data/remaining");
assert.equal(conserved.suggestedMapping.limitPointer, "/data/limit");
assert.equal(conserved.suggestedMapping.resetAtPointer, "/data/reset_at");
assert.equal(conserved.suggestedMapping.unit, "USD");
assert.equal(conserved.conflicts.length, 0, "无语义冲突时 conflicts 为空");

// 2b. 三元组不守恒（120 + 100 != 500）报告 triple-inconsistent 冲突
const inconsistent = inferGenericResponse({
	used: 120,
	remaining: 100,
	limit: 500,
	unit: "credits"
});
assert(inconsistent.conflicts.some(c => c.kind === "triple-inconsistent"), "检测出三元组不守恒冲突");

// 2c. 双余额作用域冲突（balance + remaining）+ 套餐到期时间（expires_at 不得填进 resetAtPointer）
const scopeAndExpiry = inferGenericResponse({
	balance: 50,
	quota: {
		used: 20,
		remaining: 80,
		limit: 100,
		expires_at: "2026-12-31T00:00:00Z"
	}
});
assert(scopeAndExpiry.conflicts.some(c => c.kind === "scope-conflict"), "检测出 balance 与 remaining 作用域冲突");
assert(scopeAndExpiry.conflicts.some(c => c.kind === "timestamp-semantics"), "检测出 expires_at 时间语义冲突");
assert.equal(scopeAndExpiry.suggestedMapping.resetAtPointer, undefined, "expires_at 严禁填入 resetAtPointer");
assert.equal(scopeAndExpiry.suggestedMapping.expiresAtPointer, "/quota/expires_at", "expires_at 填入 expiresAtPointer");
assert.equal(scopeAndExpiry.suggestedMapping.balanceAggregation, "forbid", "冲突时默认禁止跨 Key 累加共享余额");

// 2d. 0~1 小数比率（ratio: 0.39）+ 未知单位（绝不盲猜 USD）
const ratioUnknownUnit = inferGenericResponse({
	usage_ratio: 0.39,
	balance: 100
});
assert(ratioUnknownUnit.conflicts.some(c => c.kind === "percent-semantics"), "检测出 0.39 小数比率歧义");
assert(ratioUnknownUnit.conflicts.some(c => c.kind === "unit-unknown"), "无单位线索时报告 unit-unknown");
assert.equal(ratioUnknownUnit.suggestedMapping.unit, undefined, "无单位证据时严禁默认填 USD");

// 3. mappingLock 保护：用户锁定的字段在重新探测合并时绝不被覆盖
const autoSuggested = {
	usedPointer: "/data/used",
	limitPointer: "/data/limit",
	unit: "USD",
	balancePointer: "/data/balance"
};
const userExisting = {
	usedPointer: "/custom/my_used",
	limitPointer: "/data/limit",
	unit: "CNY",
	mappingLock: ["usedPointer", "unit"]
};
const merged = mergeMappingWithLock(autoSuggested, userExisting);
assert.equal(merged.usedPointer, "/custom/my_used", "锁定字段 usedPointer 不被自动探测覆盖");
assert.equal(merged.unit, "CNY", "锁定字段 unit 不被自动探测覆盖");
assert.equal(merged.balancePointer, "/data/balance", "未锁定字段正常更新");

// 4. 自动探测状态机（4 态：identified / needs-review / auth-required / unsupported）
// 4a. 命中已知 sub2api Recipe → identified
const identifiedRes = await probeConnectionEndpoint(
	{
		baseUrl: "https://sub2api.example.com",
		credential: { key: "sk-test", source: "manual" }
	},
	{
		fetch: async url => ({
			ok: true,
			status: 200,
			url,
			headers: { get: () => null },
			text: async () => JSON.stringify({
				planName: "Pro",
				subscription: { daily_usage_usd: 2, daily_limit_usd: 10 },
				balance: 30
			})
		})
	}
);
assert.equal(identifiedRes.status, "identified");
assert.equal(identifiedRes.adapterId, "sub2api");
assert.equal(identifiedRes.requiresConfirmation, false);

// 4b. 首个候选返回 401，后续候选返回 404 → 必须保留为 auth-required，严禁被 404 掩盖为 unsupported
let authProbeCalls = 0;
const authRequiredRes = await probeConnectionEndpoint(
	{
		baseUrl: "https://relay.example.com",
		credential: { key: "sk-expired", source: "manual" }
	},
	{
		fetch: async url => {
			authProbeCalls++;
			if (url.endsWith("/v1/usage")) {
				return { ok: false, status: 401, url, headers: { get: () => null }, text: async () => '{"error":"Unauthorized"}' };
			}
			return { ok: false, status: 404, url, headers: { get: () => null }, text: async () => "Not Found" };
		}
	}
);
assert.equal(authRequiredRes.status, "auth-required", "401 绝不被后续 404 掩盖");
assert.equal(authProbeCalls, 1, "遇到 401 立即停止后续候选探测");

// 4c. 遇到 429 立即停止探测并解析 Retry-After
let rateLimitCalls = 0;
const rateLimitedRes = await probeConnectionEndpoint(
	{
		baseUrl: "https://relay.example.com",
		credential: { key: "sk-valid", source: "manual" }
	},
	{
		fetch: async url => {
			rateLimitCalls++;
			return {
				ok: false,
				status: 429,
				url,
				headers: { get: h => (h.toLowerCase() === "retry-after" ? "12" : null) },
				text: async () => '{"error":"Too Many Requests"}'
			};
		}
	}
);
assert.equal(rateLimitCalls, 1, "429 立即停止后续候选探测");
assert.equal(rateLimitedRes.errorCode, "subusage/rate-limit");
assert.equal(rateLimitedRes.retryAfterMs, 12000, "解析 Retry-After 秒数");

// 4d. 通用 JSON 结构化推断命中 → needs-review，且不污染 SubUsageService 正式额度缓存
const files = new Map();
const io = {
	readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files.get(p); },
	mkdirSync() {},
	writeFileSync(p, v) { files.set(p, v); },
	chmodSync() {},
	renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
};
const service = new SubUsageService(
	{ get() {}, llm: { listProviders: () => [] }, effect() {} },
	{
		io,
		configPath: "memory/config.json",
		fetch: async url => ({
			ok: true,
			status: 200,
			url,
			headers: { get: () => null },
			text: async () => JSON.stringify({
				secret_token: "sk-must-not-leak-999999999",
				quota: { used: 25, remaining: 75, limit: 100, unit: "USD" }
			})
		})
	}
);

const detectViaService = await service.detectInstance({
	baseUrl: "https://custom.example.com",
	secret: "sk-must-not-leak-999999999"
});
assert.equal(detectViaService.status, "needs-review");
assert.equal(detectViaService.adapterId, "custom-http");
assert.equal(detectViaService.requiresConfirmation, true);
assert(!JSON.stringify(detectViaService).includes("sk-must-not-leak-999999999"), "detectInstance 预览已脱敏");
assert.equal(service.cache.size, 0, "探测请求绝不写入正式额度缓存");

service.dispose();
console.log("PASS 自动探测与结构化推断：4 态状态机、401 防掩盖、429 退避、数值守恒与五大歧义检测、mappingLock 保护、预览脱敏及零缓存污染");
