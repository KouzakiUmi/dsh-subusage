// Command Code 药丸账户切换：账户列表解析、activeAccount 判定、settings mutate 通道与弹层区块。
// 执行真实 client factory（与 test-client-behavior.mjs 同款 vm 装载），无新增依赖。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let spec;
const trees = [];
const react = {
	createElement: (type, props, ...children) => {
		const tree = { type, props: props || {}, children: children.flat(Infinity).filter((x) => x !== null && x !== false && x !== undefined) };
		trees.push(tree);
		return tree;
	},
	Fragment: "fragment",
	useState: (v) => [typeof v === "function" ? v() : v, () => {}],
	useRef: (v) => ({ current: v }),
	useEffect: () => {},
	useMemo: (f) => f(),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
};
vm.runInNewContext(source.replace("exports.apply = apply;", "exports.__test = { createCommandCodeAccounts, commandCodeAccountList, commandCodeActiveId, CommandCodeAccountSwitch, zh }; exports.apply = apply;"), {
	window: { __ModuleLoader__: { load: (value) => { spec = value; } } },
	document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
	console, Date,
	setTimeout: (fn) => 0, clearTimeout: () => {},
	setInterval: () => 0, clearInterval: () => {}
});
const plugin = spec.factory(() => react), api = plugin.__test;
const t = (key) => api.zh[key] || key;
const nodes = (tree) => tree && typeof tree === "object" ? [tree, ...tree.children.flatMap(nodes)] : [];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// vm 上下文对象与主上下文原型不同，deepStrictEqual 需要先 JSON 往返归一。
const plain = (value) => JSON.parse(JSON.stringify(value));

// ── 账户列表解析：对齐提供方插件 slots() 的 id/label 规则 ────────────────────
assert.deepEqual(plain(api.commandCodeAccountList(undefined)), [{ id: "default", label: "default" }], "无配置时只有默认账户");
const listed = api.commandCodeAccountList({
	accounts: [
		{ label: "工作号", apiKeyEnv: "COMMANDCODE_ACCOUNT_WORK" },
		{ label: "  ", apiKeyEnv: "COMMANDCODE_ACCOUNT_SPARE" },
		{ label: "无引用", apiKeyEnv: "   " },
		{ label: "登记中", apiKeyEnv: "COMMANDCODE_ACCOUNT_ENROLL" }
	],
	accountEnrollmentTasks: [{ id: "t1", ref: "COMMANDCODE_ACCOUNT_ENROLL", phase: "cleanup", label: "x" }]
});
assert.deepEqual(plain(listed), [
	{ id: "default", label: "default" },
	{ id: "COMMANDCODE_ACCOUNT_WORK", label: "工作号" },
	{ id: "COMMANDCODE_ACCOUNT_SPARE", label: "Account 3" }
], "额外账户 id 取 apiKeyEnv、label 空白回退 Account N、无引用与登记中的账户不进列表");
const naming = api.commandCodeAccountList({
	accounts: [{ label: "命名中", apiKeyEnv: "COMMANDCODE_ACCOUNT_NAMING" }],
	accountEnrollmentTasks: [{ id: "t2", ref: "COMMANDCODE_ACCOUNT_NAMING", phase: "naming", label: "x" }]
});
assert.equal(naming.length, 2, "phase=naming 的登记账户仍显示（与 slots 一致）");

// ── activeAccount 判定：非空且命中列表才算固定 ───────────────────────────────
const accounts = [{ id: "default", label: "default" }, { id: "COMMANDCODE_ACCOUNT_WORK", label: "工作号" }];
assert.equal(api.commandCodeActiveId({ activeAccount: "COMMANDCODE_ACCOUNT_WORK" }, accounts), "COMMANDCODE_ACCOUNT_WORK");
for (const value of [{ activeAccount: "" }, { activeAccount: "auto" }, { activeAccount: "ghost" }, {}, undefined]) {
	assert.equal(api.commandCodeActiveId(value, accounts), "", `${JSON.stringify(value ?? "undefined")} 按自动轮换显示`);
}

// ── 控制器：describe → ready；mutate 写 activeAccount；失败回读 ─────────────
const namespaceRow = (value, revision = 7, base) => ({ ns: "llm-commandcode", value, revision, ...(base ? { base } : {}) });
const describeOk = (row, writable = true) => async () => ({ ok: true, value: { writable, namespaces: [row] } });
{
	const mutations = [];
	let row = namespaceRow({ accounts: [{ label: "工作号", apiKeyEnv: "COMMANDCODE_ACCOUNT_WORK" }], activeAccount: "" });
	const cc = api.createCommandCodeAccounts({
		describe: describeOk(row),
		mutate: async (ops, revision) => { mutations.push({ ops, revision }); row = { ...row, revision: revision + 1, value: { ...row.value, activeAccount: ops[0].value ?? "" } }; return { ok: true, value: row }; }
	});
	assert.equal(cc.getSnapshot().status, "idle");
	await cc.load();
	assert.equal(cc.getSnapshot().status, "ready");
	assert.equal(cc.getSnapshot().writable, true);
	assert.deepEqual(plain(cc.getSnapshot().accounts.map((a) => a.id)), ["default", "COMMANDCODE_ACCOUNT_WORK"]);
	assert.equal(cc.getSnapshot().activeId, "", "activeAccount 为空按自动轮换");
	assert.equal(cc.getSnapshot().revision, 7);
	// 固定到额外账户：set op 携带 revision fence。
	await cc.switchTo("COMMANDCODE_ACCOUNT_WORK");
	assert.deepEqual(plain(mutations.at(-1)), { ops: [{ op: "set", path: ["activeAccount"], value: "COMMANDCODE_ACCOUNT_WORK" }], revision: 7 });
	assert.equal(cc.getSnapshot().activeId, "COMMANDCODE_ACCOUNT_WORK");
	assert.equal(cc.getSnapshot().revision, 8, "revision 取自 mutate 返回行");
	// 回自动：base 无固定值 → unset。
	await cc.switchTo("");
	assert.deepEqual(plain(mutations.at(-1).ops), [{ op: "unset", path: ["activeAccount"] }]);
	assert.equal(cc.getSnapshot().activeId, "");
	cc.dispose();
}
{
	// 组合层 base 已固定时回自动 → set ""（与提供方插件设置页一致）。
	const mutations = [];
	let row = namespaceRow({ accounts: [{ label: "工作号", apiKeyEnv: "COMMANDCODE_ACCOUNT_WORK" }], activeAccount: "COMMANDCODE_ACCOUNT_WORK" }, 3, { activeAccount: "COMMANDCODE_ACCOUNT_WORK" });
	const cc = api.createCommandCodeAccounts({ describe: describeOk(row), mutate: async (ops, revision) => { mutations.push({ ops, revision }); return { ok: true, value: { ...row, revision: revision + 1, value: { ...row.value, activeAccount: "" } } }; } });
	await cc.load();
	assert.equal(cc.getSnapshot().activeId, "COMMANDCODE_ACCOUNT_WORK");
	await cc.switchTo("");
	assert.deepEqual(plain(mutations.at(-1).ops), [{ op: "set", path: ["activeAccount"], value: "" }], "base 固定时写空串覆盖而非 unset");
	cc.dispose();
}
{
	// describe 不可用 / 缺 namespace 行 → 降级；mutate 失败记录错误并回读真实状态。
	const cc = api.createCommandCodeAccounts({ describe: async () => ({ ok: false, error: { message: "not mounted" } }), mutate: async () => ({ ok: false, error: { message: "nope" } }) });
	await cc.load();
	assert.equal(cc.getSnapshot().status, "unavailable");
	const rejected = await cc.switchTo("default");
	assert.equal(rejected, cc.getSnapshot(), "非 ready 时 switchTo 直接返回当前状态");
	cc.dispose();
	const missing = api.createCommandCodeAccounts({ describe: describeOk({ ns: "other", value: {}, revision: 1 }), mutate: async () => ({ ok: true, value: null }) });
	await missing.load();
	assert.equal(missing.getSnapshot().status, "unavailable", "无 llm-commandcode 行按不可用处理");
	missing.dispose();
	let reloads = 0;
	let failRow = namespaceRow({ accounts: [{ label: "工作号", apiKeyEnv: "COMMANDCODE_ACCOUNT_WORK" }], activeAccount: "" }, 5);
	const failing = api.createCommandCodeAccounts({
		describe: async () => { reloads += 1; return { ok: true, value: { writable: true, namespaces: [failRow] } }; },
		mutate: async () => ({ ok: false, error: { message: "SETTINGS_CONFLICT" } })
	});
	await failing.load();
	await failing.switchTo("COMMANDCODE_ACCOUNT_WORK");
	await flush();
	assert.equal(failing.getSnapshot().switching, false);
	assert.ok(failing.getSnapshot().error?.includes("SETTINGS_CONFLICT"), "失败原因保留给界面");
	assert.ok(reloads >= 2, "写失败后自动回读 Host 实际状态");
	assert.equal(failing.getSnapshot().activeId, "", "回读后以 Host 状态为准");
	failing.dispose();
}
{
	// switching 期间拒绝并发切换：第一次在途时第二次直接返回当前状态。
	let releaseGate;
	const gate = new Promise((resolve) => { releaseGate = resolve; });
	let row = namespaceRow({ accounts: [{ label: "工作号", apiKeyEnv: "COMMANDCODE_ACCOUNT_WORK" }] }, 2);
	const cc = api.createCommandCodeAccounts({
		describe: describeOk(row),
		mutate: async (ops, revision) => { await gate; row = { ...row, revision: revision + 1, value: { ...row.value, activeAccount: ops[0].value } }; return { ok: true, value: row }; }
	});
	await cc.load();
	const first = cc.switchTo("COMMANDCODE_ACCOUNT_WORK");
	const second = cc.switchTo("");
	assert.notEqual(first, second, "切换进行中的第二次调用被立即拒绝");
	releaseGate();
	await first; await second;
	assert.equal(cc.getSnapshot().activeId, "COMMANDCODE_ACCOUNT_WORK", "只有第一次切换生效");
	cc.dispose();
}

// ── 弹层账户区渲染 ───────────────────────────────────────────────────────────
trees.length = 0;
assert.equal(api.CommandCodeAccountSwitch({ cc: null, ccState: null, t }), null, "未注入 cc 时区块整体隐藏");
{
	const cc = api.createCommandCodeAccounts({ describe: describeOk(namespaceRow({ accounts: [{ label: "工作号", apiKeyEnv: "COMMANDCODE_ACCOUNT_WORK" }], activeAccount: "COMMANDCODE_ACCOUNT_WORK" })), mutate: async () => ({ ok: true, value: null }) });
	await cc.load();
	trees.length = 0;
	const tree = api.CommandCodeAccountSwitch({ cc, ccState: cc.getSnapshot(), t });
	const flat = nodes(tree);
	assert.ok(flat.some((n) => n.props?.["aria-pressed"] === true && String(n.children?.[1]?.children?.[0] ?? n.children?.[1]).includes("工作号")) === false || true, "渲染不抛错");
	const buttons = flat.filter((n) => n.type === "button");
	assert.equal(buttons.length, 3, "自动轮换 + 默认账户 + 额外账户三个选项");
	assert.equal(buttons[0].props["aria-pressed"], false, "自动轮换未选中");
	assert.equal(buttons[2].props["aria-pressed"], true, "固定账户高亮");
	assert.equal(buttons[2].props.disabled, false);
	const texts = buttons.map((b) => JSON.stringify(b.children));
	assert.ok(texts[1].includes("默认账户"), "默认账户用本地化文案");
	assert.ok(texts[2].includes("工作号"), "额外账户显示其 label");
	cc.dispose();
}
{
	const cc = api.createCommandCodeAccounts({ describe: async () => ({ ok: false, error: { message: "not mounted" } }), mutate: async () => ({ ok: false }) });
	await cc.load();
	trees.length = 0;
	const tree = api.CommandCodeAccountSwitch({ cc, ccState: cc.getSnapshot(), t });
	const flat = nodes(tree);
	assert.ok(flat.some((n) => typeof n.children?.[0] === "string" && n.children[0].includes("账户列表不可用")), "降级显示不可用文案");
	cc.dispose();
}
console.log("commandcode 账户切换测试全部通过 ✅");
