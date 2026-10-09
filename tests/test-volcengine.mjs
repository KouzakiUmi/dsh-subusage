// 火山方舟（Volcengine Ark）额度适配：AK/SK 签名、两种套餐的窗口解析、Host 错误映射与共享凭据。
// 不访问真实接口，全部用虚构 AK/SK 与桩网络。
//
// 关于签名断言：官方 demo（volc-openapi-demos/signature/nodejs/sign.js）里 AK/SK 是占位符，
// 官方**没有**提供固定测试向量，因此这里的期望值是本仓库按官方算法自算并钉住的回归基线。
// 它的形状已与官方文档 cURL 示例的签名集合（content-type;host;x-content-sha256;x-date）逐字节核对：
// CanonicalHeaders 块尾换行后与 SignedHeaders 行之间存在一个空行；Credential 用 8 位日期而非完整 X-Date。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";
import { parseVolcAgentPlan, parseVolcCodingPlan, volcEscape, volcSignature } from "../lib/volcengine.js";

const { SubUsageService, subUsageRemote } = await loadHostModule();
const CODING = "ark-coding-plan-cn", AGENT = "ark-agent-plan-cn", BYTEPLUS = "ark-coding-plan-byteplus";
const AK = "AKLTTestAccessKeyId0000", SK = "TestSecretAccessKey0000000000000000";

// ── [1] 签名 ─────────────────────────────────────────────────────────────
{
	const signed = volcSignature({ accessKeyId: AK, secretAccessKey: SK, action: "GetCodingPlanUsage", version: "2024-01-01", body: "{}", date: Date.parse("2026-10-09T09:30:00Z"), host: "open.volcengineapi.com", region: "cn-beijing" });
	assert.equal(signed.url, "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01", "Action/Version 在 query 串且按名升序");
	assert.equal(signed.headers["x-date"], "20261009T093000Z", "X-Date 为 UTC 紧凑格式");
	assert.equal(signed.headers["x-content-sha256"], "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", "body {} 的 SHA256");
	assert.match(signed.headers.authorization, /^HMAC-SHA256 Credential=AKLTTestAccessKeyId0000\/20261009\/cn-beijing\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/, "Authorization 模板");
	// 高频坑：Credential 首段是 8 位日期，不是 15 位的 X-Date。
	assert.ok(signed.headers.authorization.includes(`Credential=${AK}/20261009/`), "Credential 用 8 位日期");
	assert.ok(!signed.headers.authorization.includes("20261009T093000Z"), "Credential 不得出现完整 X-Date");
	assert.ok(signed.headers.authorization.endsWith("Signature=10958414d9ef40bd91ff9ed749bda1d7c60abf912bf7140938b452439490fff7"), "固定签名向量");
	// 签名输入与 host 绑定：换 host 必须换签名（混用两个接入域名是 401 的常见来源）。
	const other = volcSignature({ accessKeyId: AK, secretAccessKey: SK, action: "GetCodingPlanUsage", body: "{}", date: Date.parse("2026-10-09T09:30:00Z"), host: "ark.cn-beijing.volcengineapi.com", region: "cn-beijing" });
	assert.notEqual(other.headers.authorization, signed.headers.authorization, "host 参与签名");
	// 换 SK / 换 Action 都必须产生不同签名。
	assert.notEqual(volcSignature({ accessKeyId: AK, secretAccessKey: "x", action: "GetCodingPlanUsage", body: "{}", date: 1, host: "open.volcengineapi.com" }).headers.authorization, volcSignature({ accessKeyId: AK, secretAccessKey: SK, action: "GetCodingPlanUsage", body: "{}", date: 1, host: "open.volcengineapi.com" }).headers.authorization, "SK 参与签名");
	assert.equal(volcEscape("a b"), "a%20b");
	assert.equal(volcEscape("a*b"), "a%2Ab", "RFC3986 要求转义 *");
	assert.equal(volcEscape("a'b(c)!"), "a%27b%28c%29%21", "RFC3986 要求转义 ' ( ) !");
	assert.equal(volcEscape("a-b_c.d~e"), "a-b_c.d~e", "- _ . ~ 不转义");
	console.log("PASS 火山方舟签名：固定向量、Authorization 模板、host/SK/Action 绑定与严格转义");
}

// ── [2] Coding Plan 解析 ─────────────────────────────────────────────────
{
	const body = { ResponseMetadata: { RequestId: "r" }, Result: { Status: "Running", UpdateTimestamp: 1786639101000, QuotaUsage: [
		{ Level: "session", Percent: 0.39, ResetTimestamp: 1789000000 },
		{ Level: "weekly", Percent: 27.08, ResetTimestamp: 1789100000 },
		{ Level: "monthly", Percent: 100, ResetTimestamp: 1789200000 }
	] } };
	const parsed = parseVolcCodingPlan(body);
	assert.deepEqual(parsed.windows.map(w => w.kind), ["5h", "week", "month"], "Level 映射到窗口名");
	// 后端 Percent 已是 0–100 的百分数：0.39 必须保持 0.39%，不能按「≤1 视为小数」放大成 39%。
	assert.equal(parsed.windows[0].percent, 0.39, "小百分比不放大");
	assert.equal(parsed.windows[2].percent, 100, "100% 原样保留");
	assert.equal(parsed.windows[0].resetsAt, new Date(1789000000 * 1000).toISOString(), "ResetTimestamp 是秒");
	assert.equal(parsed.windows[0].detail, undefined, "接口不给绝对量，不编造 detail（Cap 未证实存在）");
	assert.equal(parsed.subscribed, true);
	// 未订阅：HTTP 200 + 空数组，是「未订阅」不是 0% 用量。
	const empty = parseVolcCodingPlan({ ResponseMetadata: {}, Result: { QuotaUsage: [] } });
	assert.equal(empty.subscribed, false);
	assert.deepEqual(empty.windows, []);
	assert.equal(parseVolcCodingPlan({}).subscribed, false, "Result 缺失也判未订阅，不抛错");
	// 顶层形态兼容（个别抓包不带 Result 信封）。
	assert.equal(parseVolcCodingPlan({ QuotaUsage: [{ Level: "session", Percent: 3, ResetTimestamp: 0 }] }).windows.length, 1, "兼容顶层形态");
	assert.equal(parseVolcCodingPlan({ Result: { QuotaUsage: [{ Level: "daily", Percent: 5 }] } }).windows.length, 0, "未登记的 Level 不产出窗口");
	assert.throws(() => parseVolcCodingPlan({ Result: { QuotaUsage: [{ Level: "session", Percent: "abc" }] } }), "非法百分比报错而不是当作 0%");
	assert.equal(parseVolcCodingPlan({ Result: { QuotaUsage: [{ Level: "session", Percent: 1, ResetTimestamp: 0 }] } }).windows[0].resetsAt, undefined, "哨兵重置时间不输出");
	console.log("PASS Coding Plan：窗口映射、百分比不放大、秒级重置、未订阅与容错");
}

// ── [3] Agent Plan 解析 ──────────────────────────────────────────────────
{
	const parsed = parseVolcAgentPlan({ Result: { PlanType: "Large",
		AFPFiveHour: { Quota: "50.0", Used: "12.5", SubscribeTime: 1778788800000, ResetTime: 1778806800000 },
		AFPDaily: { Quota: "100.0", Used: "22.5", SubscribeTime: 1778716800000, ResetTime: 1778803200000 },
		AFPWeekly: { Quota: "500.0", Used: "150.0", SubscribeTime: 1778457600000, ResetTime: 1779062400000 },
		AFPMonthly: { Quota: "2000.0", Used: "850.5", SubscribeTime: 1777939200000, ResetTime: 1780531200000 } } });
	assert.deepEqual(parsed.windows.map(w => w.kind), ["5h", "day", "week", "month"], "四个滚动窗口");
	assert.equal(parsed.windows[0].percent, 25, "字符串额度算成比例");
	assert.deepEqual(parsed.windows[0].detail, { used: 12.5, limit: 50, unit: "AFP" }, "绝对值明细");
	assert.equal(parsed.windows[0].resetsAt, new Date(1778806800000).toISOString(), "ResetTime 是毫秒");
	assert.equal(parsed.plan, "Large");
	// 日额度对不适用的模型返回 0：不产出行，也就不显示 0%。
	const zero = parseVolcAgentPlan({ Result: { PlanType: "Small", AFPDaily: { Quota: "0", Used: "0" }, AFPWeekly: { Quota: "10", Used: "1" } } });
	assert.deepEqual(zero.windows.map(w => w.kind), ["week"], "Quota=0 的窗口不产出");
	assert.equal(zero.subscribed, true, "报告过窗口即视为已订阅");
	assert.equal(parseVolcAgentPlan({ Result: {} }).subscribed, false, "空 Result 是未订阅");
	assert.equal(parseVolcAgentPlan({}).subscribed, false, "缺 Result 是未订阅");
	assert.throws(() => parseVolcAgentPlan({ Result: { AFPWeekly: { Quota: "oops", Used: "1" } } }), "非法额度报错");
	console.log("PASS Agent Plan：四窗口、字符串额度、零配额跳过、毫秒重置与未订阅");
}

// ── Host 端到端 ──────────────────────────────────────────────────────────
function harness() {
	const files = new Map();
	const calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	let respond = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
	const credentials = new Map(), environment = new Map();
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		resolveCredentialByName: async name => credentials.get(name),
		resolveEnvironmentByName: name => environment.get(name),
		fetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); }
	});
	return { service, files, calls, credentials, environment, setRespond(fn) { respond = fn; } };
}
const json = (value, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(value) });
// 三个 Ark 路由都是新增厂商，按约定 defaultEnabled:false：断言用量前必须先显式开启。
async function enable(h, ids) {
	const result = await h.service.read();
	return h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: Object.fromEntries(ids.map(id => [id, true])) } });
}
const codingBody = { ResponseMetadata: {}, Result: { Status: "Running", QuotaUsage: [{ Level: "session", Percent: 12.5, ResetTimestamp: 1789000000 }] } };

// ── [4] 保存 AK/SK 后签名请求并解析 ──────────────────────────────────────
{
	const h = harness();
	h.setRespond(() => json(codingBody));
	const enabled = await enable(h, [CODING]);
	let result = await h.service.save({ providerId: CODING, volc: { accessKeyId: { action: "replace", value: AK }, secretAccessKey: { action: "replace", value: SK } }, expectedRevision: enabled.settings.revision });
	assert.equal(result.settings.volc.hasAccessKeyId, true);
	assert.equal(result.settings.volc.hasSecretAccessKey, true);
	assert.ok(!JSON.stringify(result).includes(SK), "响应不回显 SK");
	result = await h.service.refresh({ providerIds: [CODING], force: true });
	const entry = result.entries.find(e => e.providerId === CODING);
	assert.equal(entry.state, "ok");
	assert.equal(entry.windows[0].kind, "5h");
	assert.equal(entry.windows[0].percent, 12.5);
	assert.equal(h.calls[0].url, "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01");
	assert.equal(h.calls[0].init.method, "POST", "管控面用 POST");
	assert.equal(h.calls[0].init.body, "{}");
	assert.match(h.calls[0].init.headers.authorization, /^HMAC-SHA256 Credential=/, "不是 Bearer");
	assert.equal(h.calls[0].init.headers["x-date"].length, 16);
	console.log("PASS Host：AK/SK 保存、签名 POST、窗口解析与密钥不回显");
}

// ── [5] Agent Plan 走另一个 Action，两个 provider 共享 AK/SK ──────────────
{
	const h = harness();
	h.credentials.set("VOLC_ACCESSKEY", { value: AK });
	h.credentials.set("VOLC_SECRETKEY", { value: SK });
	h.setRespond(url => json(url.includes("GetAFPUsage")
		? { ResponseMetadata: {}, Result: { PlanType: "Medium", AFPWeekly: { Quota: "500", Used: "125", ResetTime: 1779062400000 } } }
		: codingBody));
	await enable(h, [CODING, AGENT]);
	const result = await h.service.refresh({ providerIds: [CODING, AGENT], force: true });
	assert.deepEqual(h.calls.map(c => c.url.match(/Action=(\w+)/)[1]).sort(), ["GetAFPUsage", "GetCodingPlanUsage"], "两个 provider 各调自己的 Action");
	const agent = result.entries.find(e => e.providerId === AGENT);
	assert.equal(agent.state, "ok");
	assert.equal(agent.windows[0].percent, 25);
	assert.deepEqual(agent.extras, [{ kind: "plan", value: "Medium" }], "Agent Plan 额外显示档位");
	assert.equal(agent.keySource, "credentials", "继承凭据服务");
	console.log("PASS Host：Action 按 provider 分派、凭据服务继承与 Agent Plan 档位");
}

// ── [6] 未订阅 / 错误映射 ────────────────────────────────────────────────
{
	const h = harness();
	h.credentials.set("VOLC_ACCESSKEY", { value: AK });
	h.credentials.set("VOLC_SECRETKEY", { value: SK });
	await enable(h, [CODING]);
	// HTTP 200 + 空 QuotaUsage：未订阅，不能画成 0%。
	h.setRespond(() => json({ ResponseMetadata: {}, Result: { QuotaUsage: [] } }));
	let entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
	assert.equal(entry.state, "ok");
	assert.deepEqual(entry.windows, [], "未订阅不产出窗口");
	assert.deepEqual(entry.extras, [{ kind: "plan", value: "未检测到该套餐订阅" }], "显式说明未订阅");
	// 401 业务信封：认证失败，文案要点名 AK/SK 与推理 Key 的区别。
	h.setRespond(() => json({ ResponseMetadata: { Error: { Code: "SignatureDoesNotMatch", Message: "The request signature we calculated does not match" } } }));
	entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
	assert.equal(entry.state, "error");
	assert.equal(entry.errorCode, "subusage/auth");
	assert.ok(entry.error.includes("AK/SK"), "点名需要 AK/SK");
	assert.ok(entry.error.includes("不是推理"), "说明与推理 Key 的区别");
	// 403 授权失败：提示权限/订阅，而不是签名。
	h.setRespond(() => json({ ResponseMetadata: { Error: { Code: "OperationDenied.NotSubscribed", Message: "not subscribed" } } }));
	entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
	assert.equal(entry.errorCode, "subusage/auth");
	assert.ok(entry.error.includes("读权限"), "提示权限与订阅");
	// Action 不存在：明确指向接口变更。
	h.setRespond(() => json({ ResponseMetadata: { Error: { Code: "InvalidActionOrVersion", Message: "could not find operation" } } }));
	entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
	assert.equal(entry.errorCode, "subusage/response");
	assert.ok(entry.error.includes("可能已变更"));
	console.log("PASS Host：未订阅不画 0%、401/403/404 三类错误分别映射");
}

// ── [7] 凭据补丁语义与共享凭据失效 ───────────────────────────────────────
{
	const h = harness();
	const saveSchema = subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema;
	await enable(h, [CODING]);
	// 空串不是清空指令：只改 AK 不得抹掉已存的 SK。
	await h.service.save({ providerId: CODING, volc: { accessKeyId: { action: "replace", value: AK }, secretAccessKey: { action: "replace", value: SK } } });
	let stored = JSON.parse(h.files.get("memory/config"));
	assert.equal(stored.volc.accessKeyId, AK);
	assert.equal(stored.volc.secretAccessKey, SK);
	await h.service.save({ providerId: CODING, volc: { accessKeyId: { action: "replace", value: "AKLTNewKeyId000000000" } } });
	stored = JSON.parse(h.files.get("memory/config"));
	assert.equal(stored.volc.accessKeyId, "AKLTNewKeyId000000000", "AK 已更新");
	assert.equal(stored.volc.secretAccessKey, SK, "SK 原样保留");
	// 只清 SK：AK 保留，且该 provider 变成未配置（AK/SK 必须成对）。
	await h.service.save({ providerId: CODING, volc: { secretAccessKey: { action: "clear" } } });
	stored = JSON.parse(h.files.get("memory/config"));
	assert.equal(stored.volc.accessKeyId, "AKLTNewKeyId000000000");
	assert.equal(stored.volc.secretAccessKey, "", "clear 置空字符串而不是删除字段（publicSettings 依赖字段存在）");
	let entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
	assert.equal(entry.state, "no-key", "只有一半凭据视为未配置");
	assert.ok(entry.error.includes("VOLC_ACCESSKEY"), "指明继承变量");
	// 明确清除：两个都清。
	await h.service.save({ providerId: CODING, volc: { accessKeyId: { action: "clear" }, secretAccessKey: { action: "clear" } } });
	stored = JSON.parse(h.files.get("memory/config"));
	assert.equal(stored.volc.accessKeyId, "");
	assert.equal(stored.volc.secretAccessKey, "");
	// patch 校验：非火山 provider 不接受 volc 补丁；火山不接受单值 keyUpdate。
	assert.throws(() => saveSchema.parse({ providerId: "kimi-coding", volc: { accessKeyId: { action: "clear" } } }));
	assert.throws(() => saveSchema.parse({ providerId: CODING, keyUpdate: { action: "replace", value: "x" } }));
	assert.throws(() => saveSchema.parse({ providerId: CODING, volc: { unknownField: { action: "clear" } } }));
	assert.throws(() => saveSchema.parse({ providerId: CODING, volc: { accessKeyId: { action: "replace", value: "" } } }), "replace 不接受空串");
	console.log("PASS Host：AK/SK 独立 keep/replace/clear、半份凭据视为未配置、patch 校验");
}

// ── [8] 共享凭据变化让所有 Ark 条目失效 ──────────────────────────────────
{
	const h = harness();
	h.setRespond(url => json(url.includes("GetAFPUsage") ? { ResponseMetadata: {}, Result: { PlanType: "Medium", AFPWeekly: { Quota: "100", Used: "1", ResetTime: 1779062400000 } } } : codingBody));
	await enable(h, [CODING, AGENT]);
	await h.service.save({ providerId: CODING, volc: { accessKeyId: { action: "replace", value: AK }, secretAccessKey: { action: "replace", value: SK } } });
	await h.service.refresh({ providerIds: [CODING, AGENT], force: true });
	const before = h.calls.length;
	// 只在不含 AK/SK 的 provider 上改凭据：两个 Ark 条目的缓存都必须失效（否则 Agent 还显示旧账号的额度）。
	await h.service.save({ providerId: AGENT, volc: { secretAccessKey: { action: "replace", value: "NewSecret000000000000000000000000" } } });
	const result = await h.service.refresh({ providerIds: [CODING, AGENT], force: false });
	assert.equal(h.calls.length, before + 2, "共享凭据变化后两家都重新请求");
	assert.ok(result.entries.every(e => e.state === "ok"));
	// 同一份凭据的重复保存不越过缓存（TTL 内不重复请求）。
	const settled = h.calls.length;
	await h.service.refresh({ providerIds: [CODING, AGENT], force: false });
	assert.equal(h.calls.length, settled, "TTL 内命中缓存");
	console.log("PASS Host：共享 AK/SK 变化使全部 Ark 条目失效，TTL 内仍命中缓存");
}

// ── [9] Client：提供商的开关、标签与 AK/SK 输入界面 ──────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, draftFor, settingsPatch }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	const order = client.__test.PROVIDER_ORDER, meta = client.__test.PROVIDER_META;
	for (const id of [CODING, AGENT, BYTEPLUS]) {
		assert.ok(order.includes(id), `${id} 在提供商顺序中`);
		assert.equal(meta[id].volc, true, `${id} 标记为 AK/SK 凭据`);
		assert.equal(meta[id].defaultEnabled, false, `${id} 默认关闭`);
	}
	// provider id 必须与官方插件 @volcengine/ark-plan-api 注册的路由逐字一致，否则药丸不会出现。
	assert.deepEqual([CODING, AGENT, BYTEPLUS], ["ark-coding-plan-cn", "ark-agent-plan-cn", "ark-coding-plan-byteplus"]);
	assert.equal(meta[CODING].envName, "ARK_CODING_PLAN_CN_API_KEY", "推理环境变量名与官方插件一致");
	const draft = client.__test.draftFor({ keyModes: {} }, CODING);
	// vm 上下文里创建的对象与原 realm 的对象原型不同，跨 realm 一律用 JSON 比较。
	const flat = (v) => JSON.stringify(v);
	assert.equal(flat(draft.volc), flat({ accessKey: "", secret: "", clear: false }), "草稿默认不携带任何秘密");
	// 补丁构造：填了才发 replace；清除是显式动作；什么都不填就不携带 volc。
	const patch = client.__test.settingsPatch(CODING, { ...draft, volc: { accessKey: "AKLTx", secret: "", clear: false } }, "rev");
	assert.equal(flat(patch.volc), flat({ accessKeyId: { action: "replace", value: "AKLTx" } }), "只提交填写的字段");
	const both = client.__test.settingsPatch(CODING, { ...draft, volc: { accessKey: "AKLTx", secret: "SKy", clear: false } }, "rev");
	assert.equal(flat(both.volc), flat({ accessKeyId: { action: "replace", value: "AKLTx" }, secretAccessKey: { action: "replace", value: "SKy" } }));
	const clear = client.__test.settingsPatch(CODING, { ...draft, volc: { accessKey: "", secret: "", clear: true } }, "rev");
	assert.equal(flat(clear.volc), flat({ accessKeyId: { action: "clear" }, secretAccessKey: { action: "clear" } }), "清除两个字段");
	assert.equal(client.__test.settingsPatch(CODING, draft, "rev").volc, undefined, "什么都没填就不发 volc 补丁");
	console.log("PASS Client：Ark 三家注册、默认关闭、草稿与 AK/SK 补丁语义");
}

console.log("\n火山方舟适配测试全部通过 ✅");
