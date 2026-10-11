// Command Code 多账户额度：账户清单与激活状态、每账户各一条额度、按账户分缓存，
// 以及 subusage_quota 工具对「未启用 / 无数据」条目的省略与账户状态文案。
// 账户清单读自提供方插件的 settings namespace（llm-commandcode），故这里注入 settingsService 桩。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, apply } = await loadHostModule();
const C = "commandcode";
const WORK = "COMMANDCODE_ACCOUNT_WORK", SPARE = "COMMANDCODE_ACCOUNT_SPARE", ENROLL = "COMMANDCODE_ACCOUNT_ENROLL";
const RESET = Date.parse("2026-01-01T05:00:00Z");
/** 用量响应：五个小时窗口的 used/cap 由调用方按 Bearer Key 决定，便于断言「哪条是哪个账户」。 */
const body = (used, cap) => ({ credits: { planId: "individual-goat", monthlyCredits: 55.86 }, windowLimits: { fiveHour: { used, cap, exceeded: false, resetAt: RESET } } });

function harness({ accounts, activeAccount = "", enrollment = [], credential = { [C]: { value: "top-key" } }, accountCredential = {}, respond, withSettings = true } = {}) {
	const files = new Map();
	let now = Date.parse("2026-01-01T00:00:00Z");
	const calls = [];
	const response = respond ?? (() => body(1, 4));
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const describeCalls = [];
	const settingsService = withSettings ? { describe: (options) => { describeCalls.push(options); return [{ ns: "llm-commandcode", value: { accounts, activeAccount, accountEnrollmentTasks: enrollment }, revision: 3 }]; } } : undefined;
	const ctx = { get() {}, llm: { listProviders: () => [{ id: C }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => now, settingsService,
		resolveCredentials: async id => credential[id],
		resolveEnvironment: () => undefined,
		resolveAccountCredentials: async ref => accountCredential[ref],
		resolveAccountEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			const value = await response(url, options);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(value) };
		}
	});
	return { service, calls, describeCalls };
}
const ACCOUNTS = [
	{ label: "工作号", apiKeyEnv: WORK },
	{ label: "  ", apiKeyEnv: SPARE },
	{ label: "无引用", apiKeyEnv: "   " },
	{ label: "登记中", apiKeyEnv: ENROLL }
];
const ENROLLMENT = [{ id: "t1", ref: ENROLL, phase: "cleanup", label: "登记中" }];
const KEYS = { [WORK]: { value: "work-key" }, [SPARE]: { value: "spare-key" } };
/** 按 Key 区分用量：顶层 Key 25%、工作号 50%、备用 100%。 */
const respondByKey = (_url, options) => {
	const key = String(options?.headers?.authorization ?? "").replace("Bearer ", "");
	if (key === "work-key") return body(2, 4);
	if (key === "spare-key") return body(4, 4);
	return body(1, 4);
};

// ── 账户清单：与提供方插件 slots() 同规则，activeAccount 判定固定/自动 ────────
{
	const h = harness({ accounts: ACCOUNTS, activeAccount: WORK, enrollment: ENROLLMENT, accountCredential: KEYS });
	const plan = h.service.commandCodeAccountPlan();
	// 只读 settings 时带 redactSecrets：提供方配置里手写的字面 apiKey 不该进本插件内存，
	// 而 apiKeyEnv 是 credential-ref 不受脱敏影响（见 Core 的 redactSecrets 实现）。
	assert.deepEqual(h.describeCalls[0], { redactSecrets: true }, "describe 带 redactSecrets 选项");
	assert.equal(plan.mode, "fixed", "activeAccount 命中账户列表 = 固定账户");
	assert.equal(plan.activeId, WORK);
	assert.equal(JSON.stringify(plan.accounts.map(a => a.id)), JSON.stringify(["default", WORK, SPARE]), "无引用与登记中的账户不进列表");
	assert.equal(JSON.stringify(plan.accounts.map(a => a.label)), JSON.stringify(["默认账户", "工作号", "Account 3"]), "label 空白回退 Account N（默认账户用人读文案）");
	assert.equal(plan.accounts[0].active, false);
	assert.equal(plan.accounts[1].active, true, "激活状态随条目下发");
	// 悬空引用与空串都按自动轮换（与提供方插件 preferredId 同义）。
	for (const activeAccount of ["", "auto", "COMMANDCODE_ACCOUNT_GONE"]) {
		const other = harness({ accounts: ACCOUNTS, activeAccount, accountCredential: KEYS });
		assert.equal(other.service.commandCodeAccountPlan().mode, "auto", `${activeAccount || "空串"} 按自动轮换`);
	}
	// settings 服务缺失（提供方插件未运行）→ null，调用方退回单账户模式。
	const bare = harness({ withSettings: false });
	assert.equal(bare.service.commandCodeAccountPlan(), null, "读不到 settings namespace 时返回 null");
	// 配置被手改出重复引用名时只列一次：否则同一账户出两行、还会多打一份计费请求。
	const dup = harness({ accounts: [{ label: "工作号", apiKeyEnv: WORK }, { label: "重复引用", apiKeyEnv: WORK }], accountCredential: KEYS });
	assert.equal(JSON.stringify(dup.service.commandCodeAccountPlan().accounts.map(a => a.id)), JSON.stringify(["default", WORK]), "同一凭据引用名只列一次");
	dup.service.dispose();
	h.service.dispose(); bare.service.dispose();
	console.log("PASS 账户清单：slots 同规则、label 回退、激活判定与降级");
}

// ── quota：每个账户一条额度，激活账户排最前，并标明「当前激活 / 自动轮换」 ────
{
	const h = harness({ accounts: ACCOUNTS, activeAccount: WORK, enrollment: ENROLLMENT, accountCredential: KEYS, respond: respondByKey });
	const view = await h.service.quota({ providerIds: [C] });
	assert.equal(view.providers.length, 3, "默认 + 两个额外账户各一条");
	assert.equal(JSON.stringify(view.providers.map(p => p.account)), JSON.stringify(["工作号", "默认账户", "Account 3"]), "激活账户排最前，其余保持登记顺序");
	assert.deepEqual(view.providers.map(p => p.accountActive), [true, false, false], "只有激活账户带 accountActive");
	assert.deepEqual(view.providers.map(p => p.accountMode), ["fixed", "fixed", "fixed"]);
	assert.equal(view.providers[0].state, "ok");
	assert.equal(Math.round(view.providers[0].windows[0].percent), 50, "工作号用自己的 Key（2/4）");
	assert.equal(Math.round(view.providers[1].windows[0].percent), 25, "默认账户走顶层 Key（1/4）");
	assert.equal(Math.round(view.providers[2].windows[0].percent), 100, "备用账户用自己的 Key（4/4）");
	for (const entry of view.providers) assert.equal(entry.extras.find(x => x.kind === "account").value, entry.account, "条目 extras 带账户名（JSON 单独看也自解释）");
	assert.equal(view.providers[0].providerId, C, "providerId 仍是路由 id（消费者按 id 分组不受影响）");
	// 缓存按账户分键：TTL 内再读一次不应再发任何请求（否则每读一遍就把前几个账户的缓存驱逐掉）。
	const before = h.calls.length;
	await h.service.quota({ providerIds: [C] });
	assert.equal(h.calls.length, before, "TTL 内命中缓存，不重复拉取（各账户缓存互不驱逐）");
	h.service.dispose();
	console.log("PASS quota 多账户：一账户一条、激活排最前、按账户分缓存");
}

// ── 自动轮换与单账户：模式标注照给，但不编造激活账户 ────────────────────────
{
	const auto = harness({ accounts: ACCOUNTS.slice(0, 1), accountCredential: KEYS, respond: respondByKey });
	const view = await auto.service.quota({ providerIds: [C] });
	assert.equal(view.providers.length, 2);
	assert.equal(JSON.stringify(view.providers.map(p => p.accountMode)), JSON.stringify(["auto", "auto"]));
	assert.deepEqual(view.providers.map(p => p.accountActive), [false, false], "自动轮换时没有激活账户");
	assert.equal(JSON.stringify(view.providers.map(p => p.account)), JSON.stringify(["默认账户", "工作号"]), "自动轮换保持登记顺序");
	auto.service.dispose();
	// 只有默认账户：仍标模式（工具要靠它说清「现在是自动轮换」），但不重复出条目。
	const single = harness({ respond: respondByKey });
	const singleView = await single.service.quota({ providerIds: [C] });
	assert.equal(singleView.providers.length, 1);
	assert.equal(singleView.providers[0].account, "默认账户");
	assert.equal(singleView.providers[0].accountMode, "auto");
	single.service.dispose();
	// settings 服务缺失：退回原样（不带账户字段），第三方消费者看到的形状不变。
	const bare = harness({ withSettings: false, respond: respondByKey });
	const bareView = await bare.service.quota({ providerIds: [C] });
	assert.equal(bareView.providers.length, 1);
	assert.equal(bareView.providers[0].account, undefined, "读不到账户清单时不带账户字段");
	bare.service.dispose();
	console.log("PASS 自动轮换 / 单账户 / 无 settings 三种形态");
}

// ── 可见性/凭据变更按 id 前缀失效：额外账户的缓存也一起丢 ───────────────────
{
	const h = harness({ accounts: ACCOUNTS.slice(0, 2), activeAccount: WORK, accountCredential: KEYS, respond: respondByKey });
	await h.service.quota({ providerIds: [C] });
	const keys = () => [...h.service.cache.keys()].filter(key => key.startsWith(C));
	assert.equal(keys().length, 3, "三个账户各占一份缓存（id 与 id@ref）");
	const revision = (await h.service.read()).settings.revision;
	const before = h.calls.length;
	await h.service.quota({ providerIds: [C] });
	assert.equal(h.calls.length, before, "先确认都在缓存里");
	await h.service.save({ expectedRevision: revision, visibility: { providers: { [C]: false } } });
	assert.equal(keys().length, 0, "同 id 的**所有**账户缓存一起失效，不只默认账户那条");
	const reopened = (await h.service.read()).settings.revision;
	await h.service.save({ expectedRevision: reopened, visibility: { providers: { [C]: true } } });
	await h.service.quota({ providerIds: [C] });
	assert.ok(h.calls.length > before, "重新打开后按各账户重拉");
	h.service.dispose();
	console.log("PASS 可见性变更按 id 前缀失效全部账户缓存");
}

// ── 工具：未点名时省略未启用与没有数据的条目，点名时原样返回 ───────────────
{
	const tools = [];
	const scope = { effect(fn) { const r = fn(); return typeof r === "function" ? r : () => {}; }, typert: { register: () => () => {} }, tools: { register: tool => { tools.push(tool); return () => {}; } }, get: name => name === "subUsage" ? service : undefined, inject: (names, cb) => cb(scope), logger: { info() {}, warn() {}, error() {} } };
	const providers = [
		{ providerId: "deepseek", label: "DeepSeek", state: "ok", windows: [], extras: [{ kind: "balance", value: "42.50 CNY" }] },
		{ providerId: "kimi-coding", label: "Kimi", state: "no-key", windows: [], extras: [] },
		{ providerId: "zai-coding", label: "Z.ai International", state: "disabled", windows: [], extras: [] },
		{ providerId: "chutes", label: "Chutes", state: "ok", windows: [{ kind: "period", percent: 100, status: "rate-limited" }], extras: [] },
		{ providerId: "novita", label: "Novita AI", state: "error", windows: [], extras: [], error: "HTTP 500" },
		// 火山方舟席位版：席位标注也是 kind "account"，但**没有**顶层 account 字段——
		// 它必须留在输出里，且文本里要能看见席位 ID（曾被账户跳过逻辑误吞）。
		{ providerId: "arkcli-coding-plan", label: "ARK Coding Plan (arkcli)", state: "ok", windows: [{ kind: "5h", percent: 10, status: "ok" }], extras: [{ kind: "plan", value: "Pro" }, { kind: "account", value: "席位 seat-123（共 3 个席位）" }] },
		// 席位版但没有可读窗口：席位身份仍算数据，不因为「没窗口」被省略。
		{ providerId: "arkcli-coding-plan-team", label: "ARK Coding Plan Team (arkcli)", state: "ok", windows: [], extras: [{ kind: "plan", value: "Coding Plan 企业版" }, { kind: "account", value: "席位 seat-9（本周期没有可读的额度窗口）" }] },
		{ providerId: "openai-codex", label: "Codex (ChatGPT)", state: "ok", windows: [], extras: [{ kind: "plan", value: "未检测到订阅额度窗口" }] },
		{ providerId: C, label: "Command Code", state: "ok", windows: [{ kind: "5h", percent: 50, status: "ok" }], extras: [{ kind: "account", value: "工作号" }], account: "工作号", accountActive: true, accountMode: "fixed" },
		{ providerId: C, label: "Command Code", state: "ok", windows: [{ kind: "5h", percent: 25, status: "ok" }], extras: [{ kind: "account", value: "默认账户" }], account: "默认账户", accountActive: false, accountMode: "fixed" }
	];
	// 真实的 quota() 只返回被点名的那些家（且会把厂商名解析成路由 id），这里按同样口径过滤，
	// 才能验证「点名保留」的语义。
	const alias = { kimi: "kimi-coding", commandcode: C };
	const service = { quota: async request => {
		const asked = Array.isArray(request?.providerIds) ? request.providerIds.filter(name => typeof name === "string" && name.trim() !== "") : [];
		if (!asked.length) return { updatedAt: "2026-10-11T00:00:00.000Z", providers };
		const resolved = new Set(asked.map(name => alias[name] ?? name));
		return { updatedAt: "2026-10-11T00:00:00.000Z", providers: providers.filter(p => resolved.has(p.providerId)) };
	} };
	const ctx = { get: name => name === "subUsage" ? service : undefined, inject: (_names, cb) => cb(scope), plugin: () => {}, logger: scope.logger };
	apply(ctx);
	const tool = tools[0];
	const value = await tool.execute({}, {});
	assert.equal(JSON.stringify(value.providers.map(p => p.providerId)), JSON.stringify(["deepseek", "chutes", "novita", "arkcli-coding-plan", "arkcli-coding-plan-team", C, C]), "未点名时省略未启用/未配置/无数据（plan-only 也算无数据）；读取失败与席位标注保留");
	assert.equal(value.omitted, 3, "省略条数随回值给出（读取失败与席位标注不计入）");
	assert.equal(tool.output.schema.properties.omitted.type, "number");
	const named = await tool.execute({ providers: [C] }, {});
	assert.equal(JSON.stringify(named.providers.map(p => p.providerId)), JSON.stringify([C, C]), "点名只返回被点名的家");
	assert.equal(named.omitted, undefined, "点名时不报省略");
	// 点名的家即使没配凭据也原样保留——用户问的正是「它为什么没数据」。
	const namedMissing = await tool.execute({ providers: ["kimi"] }, {});
	assert.equal(JSON.stringify(namedMissing.providers.map(p => p.providerId)), JSON.stringify(["kimi-coding"]), "点名的未配置家原样保留");
	assert.equal(namedMissing.omitted, undefined, "点名时不报省略");
	// 文本层：账户后缀说明激活状态、读取失败如实透出、席位标注不被吞掉，末行交代省略了多少家。
	const text = tool.output.render({}, value)[0].text;
	assert.ok(text.includes("HTTP 500"), "读取失败的原因不被省略");
	assert.ok(text.includes("席位 seat-123（共 3 个席位）"), "火山方舟席位标注留在文本里（kind account 不等于账户标注）");
	assert.ok(text.includes("席位 seat-9（本周期没有可读的额度窗口）"), "无窗口但带席位身份的成功条目同样保留");
	assert.ok(text.includes("（账户 工作号 · 当前激活）"), "激活账户标「当前激活」");
	assert.ok(text.includes("（账户 默认账户 · 轮换候选）"), "非激活账户标「轮换候选」");
	assert.ok(!text.includes("account: 工作号"), "账户名不重复出现在 extras 行");
	assert.ok(text.includes("另有 3 家未启用"), "省略条数写进文本");
	// 全部被省略时也不能是空输出。
	const emptyText = tool.output.render({}, { providers: [], omitted: 7 })[0].text;
	assert.ok(emptyText.includes("7 家") && emptyText.trim().length > 0, "全被省略时给可读说明而不是空");
	const autoText = tool.output.render({}, { providers: [
		{ providerId: C, label: "Command Code", state: "ok", windows: [{ kind: "5h", percent: 10, status: "ok" }], extras: [], account: "默认账户", accountActive: false, accountMode: "auto" },
		{ providerId: C, label: "Command Code", state: "ok", windows: [{ kind: "5h", percent: 20, status: "ok" }], extras: [], account: "Account 2", accountActive: false, accountMode: "auto" }
	] })[0].text;
	assert.ok(autoText.includes("（账户 默认账户 · 自动轮换）"), "自动轮换标在第一条上");
	assert.ok(autoText.includes("（账户 Account 2）") && !autoText.split("\n")[1].includes("自动轮换"), "后续同家行不重复模式词");
	assert.equal(tool.output.schema.properties.providers.items.properties.account.type, "string");
	assert.equal(tool.output.schema.properties.providers.items.properties.accountActive.type, "boolean");
	assert.equal(tool.output.schema.properties.providers.items.properties.accountMode.type, "string");
	assert.ok(tool.description.includes("omitted") && tool.description.includes("multi-account"), "描述写明省略规则与多账户形态");
	assert.ok(tool.description.includes("failed to fetch") && tool.description.includes("unrecognized"), "描述写明读取失败与「名字认不出」两条规则");
	// 名字一个都没认出来时：quota() 会兜底返回全量，工具**仍然**要过滤（否则拼错一个名字就换来三十条未启用）。
	{
		const fallback = { quota: async () => ({ updatedAt: "2026-10-11T00:00:00.000Z", providers: [
			{ providerId: "nope", label: "nope", state: "error", windows: [], extras: [], error: "不认识提供商名「nope」。可以传本插件的 provider id（例如 deepseek、zai-coding-cn）…" },
			...providers
		] }) };
		const tools2 = [];
		const scope2 = { ...scope, tools: { register: t => { tools2.push(t); return () => {}; } }, get: name => name === "subUsage" ? fallback : undefined };
		apply({ get: () => undefined, inject: (_names, cb) => cb(scope2), plugin: () => {}, logger: scope.logger });
		const out = await tools2[0].execute({ providers: ["nope"] }, {});
		assert.equal(out.providers[0].providerId, "nope", "认不出的名字自己那行保留（要能告诉模型怎么改）");
		assert.equal(out.providers.filter(p => p.state === "no-key" || p.state === "disabled").length, 0, "兜底全量仍然省略未启用/未配置");
		assert.equal(out.omitted, 3, "兜底全量也报省略计数");
	}
	// 省略计数按**家**去重：同一家的多个未配置账户（多账户展开）只算一家。
	{
		const ccMissing = { quota: async () => ({ updatedAt: "2026-10-11T00:00:00.000Z", providers: [1, 2, 3].map(n => ({ providerId: C, label: "Command Code", state: "no-key", windows: [], extras: [], account: n === 1 ? "默认账户" : `Account ${n}`, accountActive: false, accountMode: "auto" })) }) };
		const tools3 = [];
		const scope3 = { ...scope, tools: { register: t => { tools3.push(t); return () => {}; } }, get: name => name === "subUsage" ? ccMissing : undefined };
		apply({ get: () => undefined, inject: (_names, cb) => cb(scope3), plugin: () => {}, logger: scope.logger });
		const out = await tools3[0].execute({}, {});
		assert.equal(out.providers.length, 0, "三个账户都没配凭据 → 一条不留");
		assert.equal(out.omitted, 1, "按家计数：三个账户只算一家");
		assert.ok(tools3[0].output.render({}, out)[0].text.includes("1 家"), "文本与计数口径一致");
	}
	console.log("PASS 工具输出：未点名省略未启用/无数据（读取失败保留）、点名保留、账户状态文案");
}

console.log("\nCommand Code 多账户额度测试全部通过 ✅");
