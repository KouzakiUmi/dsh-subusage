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
import { parseVolcAgentPlan, parseVolcCodingPlan, parseVolcSeatAfp, parseVolcSeatCoding, parseVolcSeatIds, volcEscape, volcSignature } from "../lib/volcengine.js";

const { SubUsageService, subUsageRemote } = await loadHostModule();
const CODING = "arkcli-coding-plan", AGENT = "arkcli-agent-plan";
const TEAM = "arkcli-agent-plan-team";
const TEAM_CODING = "arkcli-coding-plan-team";
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
	assert.deepEqual(parsed.windows.map(w => w.kind), ["5h", "week", "month", "day"], "文本 / 向量模型三条在前，日限额单独成组在后");
	// 官方口径：日限额只在视觉模型、语音模型与 Harness 上生效，与文本模型的三条不是同一条额度线，
	// 因此两组各自标注影响范围——否则把两条线的配额并排放在一起会被当成一组来比（"日比周还高"）。
	assert.deepEqual(parsed.windows.map(w => w.groupLabel), ["文本 / 向量模型", "文本 / 向量模型", "文本 / 向量模型", "视觉 / 语音模型与 Harness"], "两条额度线各自成组标注");
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
	// enable() 里的 read() 会把**默认开启**的其它 volc provider（arkcli 两家）一并带上，
	// 所以这里断言「两种 Action 都出现过」，而不是精确的调用条数。
	const actions = h.calls.map(c => c.url.match(/Action=(\w+)/)[1]);
	assert.ok(actions.includes("GetCodingPlanUsage"), "Coding Plan 走 GetCodingPlanUsage");
	assert.ok(actions.includes("GetAFPUsage"), "Agent Plan 走 GetAFPUsage");
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
	h.setRespond(() => json({ ResponseMetadata: { Error: { Code: "AccessDenied", Message: "no permission" } } }));
	entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
	assert.equal(entry.errorCode, "subusage/auth");
	assert.ok(entry.error.includes("读权限"), "提示权限与订阅");
	// 但 `OperationDenied.NotSubscribed` 与 `NotFound.BillingType` 是**明确的「没有这个套餐」**，不是故障：
	// 实测没有 BytePlus Coding Plan 的账号返回 HTTP 404 NotFound.BillingType（coding plan config is not exist）。
	// 把它们当错误抛出去，界面上就多一张红色卡片；正确做法是回报 subscribed:false 让前端收起。
	for (const code of ["OperationDenied.NotSubscribed", "NotFound.BillingType"]) {
		h.setRespond(() => json({ ResponseMetadata: { Error: { Code: code, Message: "coding plan config is not exist" } } }));
		entry = (await h.service.refresh({ providerIds: [CODING], force: true })).entries[0];
		assert.equal(entry.state, "ok", `${code} 是答案不是故障`);
		assert.equal(entry.subscribed, false, `${code} 要回报未订阅`);
		assert.equal(JSON.stringify(entry.windows), "[]", "未订阅不画窗口");
		assert.ok(entry.extras[0].value.includes("没有订阅"), "如实说明");
	}
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
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, draftFor, settingsPatch }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	const order = client.__test.PROVIDER_ORDER, meta = client.__test.PROVIDER_META;
	for (const id of [CODING, AGENT]) {
		assert.ok(order.includes(id), `${id} 在提供商顺序中`);
		assert.equal(meta[id].volc, true, `${id} 标记为 AK/SK 凭据`);
	}
	// Ark 现在只剩官方 CLI 写的那 4 条路由；个人版两条默认开启。
	assert.notEqual(meta[CODING].defaultEnabled, false, "官方 CLI 的 Coding Plan 默认开启");
	assert.notEqual(meta[AGENT].defaultEnabled, false, "官方 CLI 的 Agent Plan 默认开启");
	// provider id 必须与写入方注册的路由逐字一致，否则选中方舟模型时药丸不会出现。
	assert.deepEqual([CODING, AGENT], ["arkcli-coding-plan", "arkcli-agent-plan"]);
	assert.equal(meta[CODING].envName, "ARKCLI_CODING_PLAN_API_KEY", "推理环境变量名与 arkcli helper 一致");
	// 旧插件的两个国内路由 id 已从提供商列表移除（与 arkcli 查同一份订阅），但必须仍能归并到 arkcli 路由——
	// 否则装了旧插件的用户，模型路由还是那两个 id，会突然失去整个用量面板。
	for (const [legacy, target] of [["ark-agent-plan-cn", "arkcli-agent-plan"], ["ark-coding-plan-cn", "arkcli-coding-plan"]]) {
		assert.ok(!order.includes(legacy), `${legacy} 已从提供商列表移除`);
		assert.equal(client.__test.ROUTE_PROVIDER_ALIAS[legacy], target, `${legacy} 归并到 ${target}`);
	}
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

// ── [10] 企业版/团队版席位：先 ListSeatInfos 取 SeatID，再查该席位 ────────
{
	assert.deepEqual(parseVolcSeatIds({ Result: { Data: [{ SeatID: "seat-a" }, { SeatID: " seat-b " }] } }), ["seat-a", "seat-b"], "取 SeatID 并 trim");
	assert.deepEqual(parseVolcSeatIds({ Result: { Data: [{ SeatName: "无 ID" }, null, { SeatID: "   " }] } }), [], "无 ID 的行被忽略");
	assert.deepEqual(parseVolcSeatIds({ Result: { Data: [] } }), []);
	assert.deepEqual(parseVolcSeatIds({}), []);
	assert.deepEqual(parseVolcSeatIds({ Result: { Data: "nope" } }), []);

	// Agent Plan 企业版：四窗口，Quota=0 的不产出行。
	const afp = parseVolcSeatAfp({ Result: { SeatAFPUsages: [{ SeatID: "seat-a", PlanType: "Large",
		AFPFiveHour: { Quota: "50.0", Used: "12.5", ResetTime: 1778806800000 },
		AFPDaily: { Quota: "0", Used: "0" },
		AFPWeekly: { Quota: "500.0", Used: "150.0", ResetTime: 1779062400000 } }] } });
	assert.deepEqual(afp.windows.map(w => w.kind), ["5h", "week"], "Quota=0 的窗口不产出");
	// 席位版与个人版共用同一组 AFP 窗口，两条额度线的分组标注也要一起带上。
	assert.deepEqual(afp.windows.map(w => w.groupLabel), ["文本 / 向量模型", "文本 / 向量模型"], "席位版同样带额度线分组");
	const seatWithDaily = parseVolcSeatAfp({ Result: { SeatAFPUsages: [{ SeatID: "seat-b",
		AFPFiveHour: { Quota: "10", Used: "1" }, AFPWeekly: { Quota: "20", Used: "2" }, AFPDaily: { Quota: "99", Used: "9" } }] } });
	assert.deepEqual(seatWithDaily.windows.map(w => w.kind), ["5h", "week", "day"], "席位版的日限额同样排到最后");
	assert.equal(seatWithDaily.windows.at(-1).groupLabel, "视觉 / 语音模型与 Harness");
	assert.equal(afp.windows[0].percent, 25);
	assert.equal(afp.windows[0].resetsAt, new Date(1778806800000).toISOString(), "ResetTime 是毫秒");
	assert.equal(afp.plan, "Large");
	assert.equal(afp.seatId, "seat-a");
	assert.equal(parseVolcSeatAfp({ Result: { SeatAFPUsages: [] } }).subscribed, false);
	assert.equal(parseVolcSeatAfp({}).subscribed, false);
	assert.throws(() => parseVolcSeatAfp({ Result: { SeatAFPUsages: [{ AFPWeekly: { Quota: "x", Used: "1" } }] } }), "非法额度报错");

	// Coding Plan 企业版：三个已用百分比字段，各带一个同族的重置时刻（毫秒）。
	const coding = parseVolcSeatCoding({ Result: { SeatInfoUsage: { SeatID: "seat-c", ShortTermUsage: "12.5", WeeklyUsage: "120.8", MonthlyUsage: "460.4", ShortTermResetMilestone: 1785492000000, WeeklyResetMilestone: 1785686400000, MonthlyResetMilestone: -1 } } });
	assert.deepEqual(coding.windows.map(w => w.kind), ["5h", "week", "month"]);
	assert.equal(coding.windows[0].percent, 12.5);
	assert.equal(coding.windows[1].percent, 100, "超过 100 收敛到 100");
	assert.equal(coding.windows[0].resetsAt, new Date(1785492000000).toISOString(), "重置时刻是毫秒");
	assert.equal(coding.windows[1].resetsAt, new Date(1785686400000).toISOString());
	assert.equal(coding.windows[2].resetsAt, undefined, "哨兵 -1 不输出");
	assert.equal(coding.seatId, "seat-c");
	assert.deepEqual(parseVolcSeatCoding({ Result: { SeatInfoUsage: { SeatID: "s", WeeklyUsage: "10" } } }).windows.map(w => w.kind), ["week"], "缺字段不产出行、不当作 0");
	// 站点间结构不同：国际站是 Result.SeatInfoUsage.*，中国站契约是 Result.* 直挂——两条都要认。
	const flatResult = parseVolcSeatCoding({ Result: { SeatID: "seat-d", ShortTermUsage: 42.5, WeeklyUsage: 18.3, MonthlyUsage: 66.7 } });
	assert.deepEqual(flatResult.windows.map(w => w.kind), ["5h", "week", "month"], "中国站：Result 直挂");
	assert.equal(flatResult.windows[0].percent, 42.5, "数值型（契约 number）也要认");
	assert.equal(flatResult.seatId, "seat-d");
	assert.equal(parseVolcSeatCoding({ Result: {} }).subscribed, false);
	assert.equal(parseVolcSeatCoding({}).subscribed, false);
	console.log("PASS 席位解析：SeatID 列表、AFP 四窗口与零配额跳过、Coding 三字段与缺字段跳过");
}

// ── [11] 席位类 provider 的 Host 流程 ───────────────────────────────────
{
	const h = harness();
	h.credentials.set("VOLC_ACCESSKEY", { value: AK });
	h.credentials.set("VOLC_SECRETKEY", { value: SK });
	h.setRespond(url => {
		if (url.includes("ListSeatInfos")) return json({ Result: { Data: [{ SeatID: "seat-x" }] } });
		if (url.includes("GetSeatAFPUsage")) return json({ Result: { SeatAFPUsages: [{ SeatID: "seat-x", PlanType: "Medium", AFPWeekly: { Quota: "500", Used: "125", ResetTime: 1779062400000 } }] } });
		return json({ Result: {} });
	});
	await enable(h, [TEAM]);
	const result = await h.service.refresh({ providerIds: [TEAM], force: true });
	const entry = result.entries[0];
	assert.equal(entry.state, "ok");
	const actions = h.calls.map(c => c.url.match(/Action=(\w+)/)[1]);
	assert.ok(actions.includes("ListSeatInfos"), "先取席位列表");
	assert.ok(actions.includes("GetSeatAFPUsage"), "再查该席位额度");
	assert.equal(entry.windows[0].percent, 25);
	assert.equal(entry.extras[0].value, "Medium", "显示档位");
	assert.ok(entry.extras[1].value.includes("seat-x"), "标注席位 ID");
	assert.ok(!JSON.stringify(result).includes(SK), "响应不回显 SK");
	// 两处请求体都要钉住：Scene 随产品而变（改错会静默返回空 SeatID），SeatIDs 必须是数组。
	const agentListBody = JSON.parse(h.calls.find(c => c.url.includes("ListSeatInfos")).init.body);
	assert.equal(agentListBody.Scene, "agent_plan_enterprise", "Agent Plan 团队版用 agent_plan_enterprise");
	const agentSeatBody = JSON.parse(h.calls.find(c => c.url.includes("GetSeatAFPUsage")).init.body);
	assert.equal(JSON.stringify(agentSeatBody.SeatIDs), JSON.stringify(["seat-x"]), "GetSeatAFPUsage 传 SeatIDs 数组");
	// 账号下没有可读席位：明确说明，而不是报错或画 0%。
	h.setRespond(url => url.includes("ListSeatInfos") ? json({ Result: { Data: [] } }) : json({ Result: {} }));
	const empty = (await h.service.refresh({ providerIds: [TEAM], force: true })).entries[0];
	assert.equal(empty.state, "ok");
	assert.deepEqual(empty.windows, []);
	assert.ok(empty.extras[0].value.includes("没有可读的席位"), "说明情况");
	h.service.dispose();

	// Coding Plan 团队版：GetSeatInfoUsage **必须带 Scene**——传错值（如 "coding_plan"）会静默返回空 SeatID。
	const hc = harness();
	hc.credentials.set("VOLC_ACCESSKEY", { value: AK });
	hc.credentials.set("VOLC_SECRETKEY", { value: SK });
	hc.setRespond(url => {
		if (url.includes("ListSeatInfos")) return json({ Result: { Data: [{ SeatID: "seat-c" }] } });
		if (url.includes("GetSeatInfoUsage")) return json({ Result: { SeatID: "seat-c", ShortTermUsage: "12.5", WeeklyUsage: "18.3", MonthlyUsage: "66.7" } });
		return json({ Result: {} });
	});
	await enable(hc, [TEAM_CODING]);
	const codingEntry = (await hc.service.refresh({ providerIds: [TEAM_CODING], force: true })).entries[0];
	assert.equal(codingEntry.state, "ok");
	assert.deepEqual(codingEntry.windows.map(w => w.kind), ["5h", "week", "month"]);
	assert.equal(codingEntry.windows[0].percent, 12.5);
	const infoCall = hc.calls.find(c => c.url.includes("GetSeatInfoUsage"));
	const infoBody = JSON.parse(infoCall.init.body);
	assert.equal(infoBody.Scene, "", "GetSeatInfoUsage 带 Scene（Coding Plan 企业版=空串）");
	assert.equal(infoBody.SeatID, "seat-c", "带单个 SeatID");
	// 组开关是 Ark 的唯一真源，所以 `read()` 那一遍会把整组（含团队版）都查一遍：这里取属于
	// Coding Plan 团队版的那次调用（登记顺序在 Agent Plan 团队版之后，故为最后一次）。
	const listBody = JSON.parse(hc.calls.filter(c => c.url.includes("ListSeatInfos")).at(-1).init.body);
	assert.equal(listBody.Scene, "coding_plan_enterprise", "ListSeatInfos 用 coding_plan_enterprise");
	assert.deepEqual(listBody.Filter, {}, "Filter 必填，即便为空对象");
	hc.service.dispose();
	console.log("PASS 席位类 Host：两步调用、档位与席位标注、无席位时的说明、Scene 取值正确");
}

// ── [12] 分组标注必须活到 wire：前端只有拿到 groupLabel 才能插分组标题 ────
{
	const h = harness();
	h.credentials.set("VOLC_ACCESSKEY", { value: AK });
	h.credentials.set("VOLC_SECRETKEY", { value: SK });
	// 个人版 Agent Plan 的四个 AFP 窗口。日配额（50.0K）比 5 小时（10.0K）和周（35.0K）都高是
	// 官方口径而不是算错：日限额只覆盖视觉 / 语音模型与 Harness，跟文本模型那条线不可比。
	h.setRespond(() => json({ ResponseMetadata: {}, Result: {
		PlanType: "Medium",
		AFPFiveHour: { Quota: "10.0", Used: "0.2587", ResetTime: 1790000000000 },
		AFPWeekly: { Quota: "35.0", Used: "0.2587", ResetTime: 1790000000000 },
		AFPMonthly: { Quota: "100.0", Used: "0.2587", ResetTime: 1790000000000 },
		AFPDaily: { Quota: "50.0", Used: "0", ResetTime: 1790000000000 }
	} }));
	await enable(h, [AGENT]);
	const entry = (await h.service.refresh({ providerIds: [AGENT], force: true })).entries.find(e => e.providerId === AGENT);
	assert.equal(entry.state, "ok");
	assert.deepEqual(entry.windows.map(w => w.kind), ["5h", "week", "month", "day"], "日限额排在最后");
	// toWindows 会用 windowRow 重新构造窗口对象，最容易在这里丢掉解析器产出的字段；
	// 丢了不报错，只是分组标题静默消失，所以必须在这一层钉住。
	assert.deepEqual(entry.windows.map(w => w.groupLabel),
		["文本 / 向量模型", "文本 / 向量模型", "文本 / 向量模型", "视觉 / 语音模型与 Harness"],
		"分组标注经过 Host 装配后仍在（按 provider id 逐条比对）");
	h.service.dispose();
	console.log("PASS Host：AFP 两条额度线的分组标注活到 wire");
}

// ── [13] Ark 组开关是唯一真源：逐条残留不得让 Coding Plan 查不到 ──────────
{
	const h = harness();
	h.credentials.set("VOLC_ACCESSKEY", { value: AK });
	h.credentials.set("VOLC_SECRETKEY", { value: SK });
	// 存储按 0.10.3 之前的「逐条开关」形态写入：组开关开着，但 Coding Plan 那条是 false。
	// 迁移会用「任一条开着」把组开关合并成 true，却把逐条值原样留下——两端口径就此分叉：
	// 界面按组开关显示这条路由，Host 却按逐条值回 disabled，用户拿到的是一张「订阅检测已关闭」的空卡片。
	h.files.set("memory/config", JSON.stringify({ visibility: { ark: true, providers: { [CODING]: false, [AGENT]: true } } }));
	// 桩用 2026-10-10 实测到的真实 GetCodingPlanUsage 响应形态：除 Level/Percent/ResetTimestamp 外
	// 还带 Cap / RewardTotalPercent / HasReward，且 session 窗口的 ResetTimestamp 是 -1 哨兵。
	h.setRespond(() => json({ ResponseMetadata: { RequestId: "r" }, Result: { Status: "Running", UpdateTimestamp: 1791566793, QuotaUsage: [
		{ Level: "session", Percent: 0, ResetTimestamp: -1, Cap: 100, RewardTotalPercent: 0 },
		{ Level: "weekly", Percent: 0, ResetTimestamp: 1791734400, Cap: 100, RewardTotalPercent: 0 },
		{ Level: "monthly", Percent: 0, ResetTimestamp: 1794326399, Cap: 100, RewardTotalPercent: 0 }
	], HasReward: false } }));
	const refreshed = await h.service.refresh({ providerIds: [CODING], force: true });
	const entry = refreshed.entries.find(e => e.providerId === CODING);
	assert.notEqual(entry.state, "disabled", "组开关开着就不能因逐条值是 false 而跳过查询");
	assert.equal(entry.state, "ok");
	assert.deepEqual(entry.windows.map(w => w.kind), ["5h", "week", "month"], "session/weekly/monthly 映射到 5h/week/month");
	assert.equal(entry.windows[0].percent, 0, "0% 是真实读数，不是「无数据」");
	assert.equal(entry.windows[0].resetsAt, undefined, "ResetTimestamp=-1 是哨兵，不输出重置时间");
	assert.equal(entry.windows[1].resetsAt, new Date(1791734400 * 1000).toISOString(), "秒级时间戳转 ISO");
	assert.equal(entry.windows[0].detail, undefined, "接口不给绝对量，也不拿语义未证的 Cap 编造 detail");
	// 归一化：公开设置里的逐条值必须跟随组开关（注入的 CODING=false 属于迁移残留，不该留在口径里）。
	assert.equal(refreshed.settings.visibility.providers[CODING], true, "读回后逐条值跟随组开关");
	assert.equal(refreshed.settings.visibility.providers[AGENT], true);
	// 反向也要成立：关掉组开关后整组都真的跳过，而不是只跳过显式关过的那条。
	await h.service.save({ expectedRevision: refreshed.settings.revision, visibility: { ark: false } });
	const off = (await h.service.refresh({ providerIds: [CODING, AGENT], force: true })).entries;
	assert.equal(JSON.stringify(off.map(e => e.state)), JSON.stringify(["disabled", "disabled"]), "组开关关掉后整组跳过");
	h.service.dispose();
	console.log("PASS Host：Ark 组开关是唯一真源，逐条残留不会让 Coding Plan 查不到");
}

console.log("\n火山方舟适配测试全部通过 ✅");
