// 一体化额度查询与药丸显示平台：ConnectionInstance、CredentialProfile 解析链、安全边界、Recipe 脱敏与多端联动回归测试
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { normalizeBaseUrl, validateNonSecretHeaders } from "../lib/http/request-plan.js";
import { executeReadOnlyRequest } from "../lib/http/executor.js";
import { resolveCredentialChain } from "../lib/credentials/resolver-chain.js";
import { goPanelUsageId, goPanelProviderName, goPanelData } from "../lib/go-panel.js";

const { SubUsageService } = await loadHostModule();

// 1. 网络与协议安全边界：拒绝公网明文 HTTP、默认拒绝局域网 HTTP（除非 allowInsecureHttp=true）、放行本机回环 HTTP
assert.throws(
	() => normalizeBaseUrl("http://api.example.com/v1"),
	/禁止向公网明文 HTTP 地址发送凭据/,
	"严禁向公网明文 HTTP 发送携带密钥的请求"
);
assert.throws(
	() => normalizeBaseUrl("http://192.168.1.25:8080"),
	/非本机回环的私网 HTTP 地址默认拦截/,
	"默认拒绝局域网明文 HTTP"
);
assert.equal(
	normalizeBaseUrl("http://192.168.1.25:8080", { allowInsecureHttp: true }),
	"http://192.168.1.25:8080",
	"显式开启 allowInsecureHttp 时允许私有局域网 HTTP"
);
assert.equal(
	normalizeBaseUrl("http://127.0.0.1:4000/v1/"),
	"http://127.0.0.1:4000/v1",
	"本机回环地址默认允许 HTTP"
);
assert.equal(
	normalizeBaseUrl("http://localhost:3425"),
	"http://localhost:3425",
	"localhost 默认允许 HTTP"
);

// 2. 非秘密 Header 白名单：严禁在公开 headers 中夹带鉴权头
for (const secretHeader of ["Authorization", "Cookie", "X-API-Key", "X-Auth-Token", "Proxy-Authorization", "Api-Key"]) {
	assert.throws(
		() => validateNonSecretHeaders({ [secretHeader]: "secret-val" }),
		/属于敏感凭据头/,
		`应当拒绝在 headers 中配置 ${secretHeader}`
	);
}
assert.deepEqual(
	validateNonSecretHeaders({ "X-Custom-Client": "dsh-team" }),
	{ "X-Custom-Client": "dsh-team" }
);

// 3. 跨域 3xx 重定向阻断：绝不跟随跨域重定向泄露 Authorization 头
await assert.rejects(
	() => executeReadOnlyRequest(
		{
			method: "GET",
			url: "https://sub2api.example.com/v1/usage",
			headers: { Authorization: "Bearer sk-secret" }
		},
		{
			fetch: async () => ({
				ok: false,
				status: 302,
				headers: {
					get: name => (name.toLowerCase() === "location" ? "https://evil.attacker.com/collect" : null)
				},
				text: async () => ""
			})
		}
	),
	err => err.code === "subusage/redirect-blocked" && /重定向/.test(err.message),
	"必须阻断 3xx 重定向"
);

// 4. CredentialProfile 统一解析链优先级：
//    manual 模式下优先 manualSecret，缺席时回退继承链；
//    inherit 模式下按 routeEnvs → credentialRefs → builtinEnvs 顺序，每项内部先查凭据服务、后查启动环境。
const credStore = new Map([
	["ROUTE_SPECIFIC_KEY", "sk-from-route-cred"],
	["EXTRA_REF_KEY", "sk-from-extra-ref"]
]);
const envStore = new Map([
	["BUILTIN_ENV_KEY", "sk-from-builtin-env"]
]);
const resolvers = {
	resolveCredentialByName: async name => credStore.get(name),
	resolveEnvironment: async name => envStore.get(name)
};

// 4a. inherit 模式优先命中 routeEnvs
const hitRoute = await resolveCredentialChain(
	{
		authKind: "bearer",
		mode: "inherit",
		manualSecret: "sk-manual",
		routeEnvs: ["ROUTE_SPECIFIC_KEY"],
		credentialRefs: ["EXTRA_REF_KEY"],
		builtinEnvs: ["BUILTIN_ENV_KEY"]
	},
	resolvers
);
assert.equal(hitRoute.key, "sk-from-route-cred");
assert.equal(hitRoute.source, "credentials");
assert.equal(hitRoute.ref, "ROUTE_SPECIFIC_KEY");

// 4b. 指定 targetRef（多 Key 监控）时仅解析该引用名
const hitTargetRef = await resolveCredentialChain(
	{
		authKind: "bearer",
		mode: "inherit",
		routeEnvs: ["ROUTE_SPECIFIC_KEY"],
		credentialRefs: ["EXTRA_REF_KEY"],
		builtinEnvs: ["BUILTIN_ENV_KEY"],
		targetRef: "EXTRA_REF_KEY"
	},
	resolvers
);
assert.equal(hitTargetRef.key, "sk-from-extra-ref");
assert.equal(hitTargetRef.ref, "EXTRA_REF_KEY");

// 4c. manual 模式已保存手动密钥时优先使用 manualSecret；手动密钥清空后自动回退继承链
const hitManual = await resolveCredentialChain(
	{
		authKind: "bearer",
		mode: "manual",
		manualSecret: "sk-manual-override",
		routeEnvs: ["ROUTE_SPECIFIC_KEY"]
	},
	resolvers
);
assert.equal(hitManual.key, "sk-manual-override");
assert.equal(hitManual.source, "manual");

const hitFallbackAfterClear = await resolveCredentialChain(
	{
		authKind: "bearer",
		mode: "manual",
		manualSecret: "",
		routeEnvs: [],
		credentialRefs: [],
		builtinEnvs: ["BUILTIN_ENV_KEY"]
	},
	resolvers
);
assert.equal(hitFallbackAfterClear.key, "sk-from-builtin-env");
assert.equal(hitFallbackAfterClear.source, "env");

// 5. SubUsageService 自定义实例全生命周期（创建、多 Key 监控、quota() 查询、Recipe 导出导入脱敏、删除清理）
const files = new Map();
const io = {
	readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files.get(p); },
	mkdirSync() {},
	writeFileSync(p, v) { files.set(p, v); },
	chmodSync() {},
	renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
};

const serviceCreds = new Map([
	["SUB2API_KEY_A", "sk-key-a-secret"],
	["SUB2API_KEY_B", "sk-key-b-secret"]
]);

const service = new SubUsageService(
	{
		get(name) {
			if (name === "credentials") {
				return {
					async resolve(ref) {
						const k = ref?.key ?? ref;
						return serviceCreds.has(k) ? { value: serviceCreds.get(k) } : undefined;
					}
				};
			}
			return undefined;
		},
		llm: {
			listProviders: () => [{ id: "team-openai-route", type: "openai" }]
		},
		effect() {}
	},
	{
		io,
		configPath: "memory/config.json",
		resolveCredentialByName: async name => serviceCreds.has(name) ? { value: serviceCreds.get(name) } : undefined,
		resolveEnvironmentByName: async () => undefined,
		fetch: async (url, init) => {
			const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? "";
			if (url.startsWith("https://sub2api.team.internal/v1/usage")) {
				const isKeyB = auth.includes("sk-key-b-secret");
				return {
					ok: true,
					status: 200,
					url,
					headers: { get: () => null },
					text: async () => JSON.stringify({
						planName: "Team Pro",
						quota: {
							used: isKeyB ? 40 : 15,
							limit: 100,
							remaining: isKeyB ? 60 : 85,
							unit: "USD"
						},
						balance: 200
					})
				};
			}
			if (url.startsWith("https://relay.custom.internal/api/quota")) {
				return {
					ok: true,
					status: 200,
					url,
					headers: { get: () => null },
					text: async () => JSON.stringify({
						data: {
							tier: "Enterprise",
							credits_used: 300,
							credits_limit: 1000,
							reset_time: "2026-05-01T00:00:00Z"
						}
					})
				};
			}
			throw new Error(`Unexpected URL: ${url}`);
		}
	}
);

// 5a. 保存多 Key sub2api 实例 + 自定义 custom-http 实例
await service.save({
	instance: {
		id: "sub2api-team",
		adapterId: "sub2api",
		label: "Team Sub2API",
		baseUrl: "https://sub2api.team.internal/v1",
		credentialRefs: ["SUB2API_KEY_A", "SUB2API_KEY_B"],
		routeIds: ["team-openai-route"]
	}
});

await service.save({
	instance: {
		id: "custom-relay",
		adapterId: "custom-http",
		label: "Custom Relay",
		baseUrl: "https://relay.custom.internal",
		usagePath: "/api/quota",
		mapping: {
			planPointer: "/data/tier",
			usedPointer: "/data/credits_used",
			limitPointer: "/data/credits_limit",
			resetAtPointer: "/data/reset_time",
			unit: "credits",
			windowPeriod: "month"
		}
	},
	secretUpdate: {
		action: "replace",
		value: "sk-custom-relay-secret-999"
	}
});

// 公开设置严禁泄露任何手动密钥原文
const readSnap = await service.read();
const rawPublicJson = JSON.stringify(readSnap.settings);
assert(!rawPublicJson.includes("sk-custom-relay-secret-999"), "publicSettings 绝不暴露 instanceSecrets");
assert(!rawPublicJson.includes("sk-key-a-secret"), "publicSettings 绝不暴露凭据库密钥");

const sub2Entry = readSnap.entries.find(e => e.providerId === "sub2api-team");
assert(sub2Entry, "read() 包含 sub2api-team 条目");
assert.equal(sub2Entry.state, "ok");
assert.equal(sub2Entry.windows[0].percent, 15, "主条目使用第一把命中 Key (SUB2API_KEY_A)");
assert.equal(sub2Entry.keyAccounts?.length, 1, "第二把 Key (SUB2API_KEY_B) 挂载到 keyAccounts");
assert.equal(sub2Entry.keyAccounts[0].ref, "SUB2API_KEY_B");
assert.equal(sub2Entry.keyAccounts[0].windows[0].percent, 40);

const customEntry = readSnap.entries.find(e => e.providerId === "custom-relay");
assert(customEntry, "read() 包含 custom-relay 条目");
assert.equal(customEntry.state, "ok");
assert.equal(customEntry.windows[0].percent, 30);
assert.equal(customEntry.windows[0].kind, "month");

// 5b. quota() 支持按实例 ID 或适配器类型名点名查询
const quotaByInst = await service.quota({ providerIds: ["sub2api-team"] });
assert.equal(quotaByInst.providers.length, 1);
assert.equal(quotaByInst.providers[0].providerId, "sub2api-team");
assert.equal(quotaByInst.providers[0].state, "ok");

const quotaByAdapter = await service.quota({ providerIds: ["custom-http"] });
assert.equal(quotaByAdapter.providers.length, 1);
assert.equal(quotaByAdapter.providers[0].providerId, "custom-relay");

// 5c. Recipe 导出与导入：导出结果严禁包含秘密、credentialRefs、私有 baseUrl 或 routeIds
const exportedRecipe = service.exportRecipe("custom-relay");
const exportedStr = JSON.stringify(exportedRecipe);
assert(!exportedStr.includes("sk-custom-relay-secret-999"), "Recipe 导出严禁包含密钥");
assert(!exportedStr.includes("relay.custom.internal"), "Recipe 导出剥离私有 Base URL");
assert.equal(exportedRecipe.adapterId, "custom-http");
assert.equal(exportedRecipe.usagePath, "/api/quota");
assert.equal(exportedRecipe.mapping.unit, "credits");

const imported = service.importRecipe(exportedRecipe, {
	id: "custom-relay-copy",
	label: "Imported Relay",
	baseUrl: "https://relay2.custom.internal"
});
assert.equal(imported.instance.id, "custom-relay-copy");
assert.equal(imported.instance.usagePath, "/api/quota");
assert.equal(imported.instance.mapping.unit, "credits");

// 5d. DSH Go 原生面板与路由绑定联动
const storedSettings = service.load();
assert.equal(
	goPanelUsageId("team-openai-route", storedSettings.visibility, storedSettings),
	"sub2api-team",
	"Go 面板通过实例 routeIds 自动将模型路由归并到自定义实例 ID"
);
assert.equal(
	goPanelProviderName("sub2api-team", {}, "zh-CN", storedSettings),
	"Team Sub2API",
	"Go 面板正确读取自定义实例显示名称"
);
const panelData = goPanelData(
	{ usageId: "sub2api-team", name: "Team Sub2API", model: "gpt-5" },
	quotaByInst.providers[0],
	{ locale: "zh-CN" }
);
assert.equal(panelData.provider, "Team Sub2API");
assert.equal(panelData.headline, "余 85%");
assert.equal(panelData.windows.length >= 1, true);

// 5e. 删除实例时同步清理缓存、秘密、DisplayProfile 与关联的 RouteBinding
await service.save({
	routeBindings: { "team-openai-route": "custom-relay" }
});
await service.save({
	removeInstanceId: "custom-relay"
});
const afterRemove = service.load();
assert.equal(afterRemove.instances.some(i => i.id === "custom-relay"), false, "实例已移除");
assert.equal(afterRemove.instanceSecrets?.["custom-relay"], undefined, "实例秘密已同步清除");
assert.equal(afterRemove.routeBindings?.["team-openai-route"], undefined, "指向已删除实例的路由绑定已同步清理");

service.dispose();
console.log("PASS 平台运行时：安全边界、CredentialProfile 解析链、多 Key 监控、quota() 查询、Recipe 脱敏导出导入、Go 面板联动与实例清理");
