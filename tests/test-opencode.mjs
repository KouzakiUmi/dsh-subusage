// normalizeOpencodeGo 单测：真实 /usage 响应（外层 usage 包裹）+ 兼容形态 + 连坐。
// 另含凭据引用变体：GO 专属名 OPENCODE_GO_API_KEY 优先、通用名 OPENCODE_API_KEY 回退。
import { loadHostModule, makeAssert } from "./helpers.mjs";

const { normalizeOpencodeGo, SubUsageService } = await loadHostModule();
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

// ── 凭据引用变体 ─────────────────────────────────────────────────────────────
// OpenCode Go 的同一把订阅 Key 有两种引用名写法：单列 Go 套餐时路由 apiKeyEnv 是
// OPENCODE_GO_API_KEY（本机 desktop profile 即如此），pi-ai 内置路由的默认名是与 Zen 余额
// 共用的 OPENCODE_API_KEY。只认后者会出现「路由能正常调用、额度却报无凭据」。
const GO_REF = "OPENCODE_GO_API_KEY", GENERIC_REF = "OPENCODE_API_KEY";
const goKey = "sk-go-fixture", genericKey = "sk-generic-fixture";
const usageBody = { usage: {
	rolling: { status: "ok", percent: 3, resetsAt: "2026-10-25T00:00:00.000Z" },
	weekly: { status: "ok", percent: 12, resetsAt: "2026-10-27T00:00:00.000Z" },
	monthly: { status: "ok", percent: 41, resetsAt: "2026-11-01T00:00:00.000Z" }
} };
function harness({ credentials = {}, environment = {}, respond = () => usageBody } = {}) {
	const calls = [];
	const service = new SubUsageService({ get() {}, effect() {}, llm: { listProviders: () => [{ id: "opencode-go" }] } }, {
		io: { readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } },
		configPath: "memory/opencode",
		resolveCredentials: async (id, refName) => credentials[refName],
		resolveEnvironment: (id, refName) => environment[refName],
		fetch: async (url, options) => { calls.push({ url, headers: options.headers }); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(respond()) }; }
	});
	return { service, calls };
}
const identityOf = (credentials, environment) => harness({ credentials, environment }).service;
const base = identityOf({}, {});
const none = await base.identity("opencode-go", base.load());
assert(none.key === undefined && none.source === "none", "两个引用名都没有 → source none");
const primary = await identityOf({ [GO_REF]: { value: goKey } }, {}).identity("opencode-go", base.load());
assert(primary.key === goKey, "GO 专属引用名优先");
assert(primary.source === "credentials", "专属名来自凭据服务");
const fallback = await identityOf({ [GENERIC_REF]: { value: genericKey } }, {}).identity("opencode-go", base.load());
assert(fallback.key === genericKey, "只有通用名时回退 OPENCODE_API_KEY");
assert(fallback.source === "credentials", "回退名同样来自凭据服务");
const envPrimary = await identityOf({}, { [GO_REF]: { value: "env-go-fixture" } }).identity("opencode-go", base.load());
assert(envPrimary.source === "env", "专属名也认启动环境");
assert(envPrimary.key === "env-go-fixture", "专属名的环境变量被读到");
// 名字优先级高于来源优先级：通用名在凭据服务里、专属名只在环境里时，仍用专属名。
const nameFirst = await identityOf({ [GENERIC_REF]: { value: genericKey } }, { [GO_REF]: { value: "env-go-fixture" } }).identity("opencode-go", base.load());
assert(nameFirst.key === "env-go-fixture", "专属名（环境）压过通用名（凭据服务）");
assert(nameFirst.source === "env", "来源如实标为 env");
// 端到端：额度请求确实带的是专属引用的 Key。
const live = harness({ credentials: { [GO_REF]: { value: goKey }, [GENERIC_REF]: { value: genericKey } } });
const result = await live.service.refresh({ providerIds: ["opencode-go"], force: true });
assert(live.calls.length === 1, "只发一次额度请求");
assert(live.calls[0].url === "https://opencode.ai/zen/go/v1/usage", "请求打到 Go 额度接口");
assert(live.calls[0].headers.authorization === `Bearer ${goKey}`, "Authorization 用 GO 专属引用的 Key");
assert(result.entries[0].state === "ok", "opencode-go 读到额度");
assert(result.entries[0].envName === GO_REF, "条目对外的主引用名是 GO 专属名");
assert(result.entries[0].windows.length === 3, "三个窗口原样透出");

// 默认真实解析器（不注入 resolveCredentials / resolveEnvironment）：证明 refName 真的被传给了
// credentialRef 与 launchEnvironmentOf。否则把所有测试都换成注入式，「默认实现忽略 refName、
// 永远用主名」这种回归会静默通过。
function defaultHarness({ credentials = {}, env = {} } = {}) {
	const credentialRefs = [], envRefs = [];
	const service = new SubUsageService({
		get(name) {
			return name === "credentials" ? { resolve: async ref => { credentialRefs.push(ref.name); return credentials[ref.name]; } } : undefined;
		},
		effect() {},
		llm: { listProviders: () => [{ id: "opencode-go" }] },
		// 键访问被记录下来，才能断言「哪个名字先被问」；值用真实进程环境的字符串形态，
		// 由 helpers 的 launchEnvironmentOf 桩包成 { value, source }。
		__env: new Proxy({}, { get: (_, key) => { envRefs.push(String(key)); return env[key]; } })
	}, {
		io: { readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } },
		configPath: "memory/opencode-default"
	});
	return { service, credentialRefs, envRefs };
}
const goOnly = defaultHarness({ credentials: { [GO_REF]: { value: goKey } } });
const goIdentity = await goOnly.service.identity("opencode-go", goOnly.service.load());
assert(goIdentity.key === goKey && goIdentity.source === "credentials", "默认解析器：主名命中凭据服务");
assert(goOnly.credentialRefs.join(",") === GO_REF, "默认解析器按主名查凭据服务，命中后不再试回退名");
assert(goOnly.envRefs.length === 0, "默认解析器命中凭据后不碰启动环境");
const envOnly = defaultHarness({ env: { [GENERIC_REF]: "env-generic-fixture" } });
const envIdentity = await envOnly.service.identity("opencode-go", envOnly.service.load());
assert(envIdentity.key === "env-generic-fixture" && envIdentity.source === "env", "默认解析器：回退名从启动环境取到值");
assert(envOnly.credentialRefs.join(",") === `${GO_REF},${GENERIC_REF}`, "默认解析器按顺序把两个名字都交给凭据服务");
assert(envOnly.envRefs.join(",") === `${GO_REF},${GENERIC_REF}`, "默认解析器按同样的顺序问启动环境");
const singleName = defaultHarness({ credentials: { KIMI_CODING_API_KEY: { value: "kimi-fixture" } } });
assert((await singleName.service.identity("kimi-coding", singleName.service.load())).key === "kimi-fixture", "无 envAliases 的 provider 仍用单名解析");
assert(singleName.credentialRefs.join(",") === "KIMI_CODING_API_KEY", "无 envAliases 的 provider 只问一个引用名");
assert.summary();
