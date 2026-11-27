// 点选映射器（零代码接入）回归：探测响应树点选 → 语义菜单 → 自动生成 JSON Pointer → 保存。
// 用有状态 React 桩执行真实 InstanceEditor：Hook 顺序、keepProbe 语义与指针编码都走真实代码路径。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
const loadClient = reactStub => {
	let spec;
	const ctx = { window: { __ModuleLoader__: { load: value => { spec = value; } } }, console };
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { pointerJoin, MAPPING_POINTER_FIELDS, InstanceEditor, ConnectionsBlock, RouteBindingsBlock, emptyInstanceDraft }; exports.apply = apply;"), ctx);
	return { factory: require => spec.factory(require), exports: spec };
};
const walk = (node, visit) => {
	if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
	if (!node || typeof node !== "object") return;
	visit(node);
	const kids = node.children;
	for (const child of Array.isArray(kids) ? kids : kids ? [kids] : []) walk(child, visit);
};
const flattenText = node => {
	const parts = [];
	walk(node, n => { const c = n.children; for (const x of Array.isArray(c) ? c : c ? [c] : []) if (typeof x === "string") parts.push(x); });
	return parts.join("");
};
const findButton = (root, label) => {
	let hit = null;
	walk(root, n => { if (!hit && n.type === "button" && flattenText(n).includes(label)) hit = n; });
	return hit;
};

// ── [1] 纯函数：RFC 6901 指针编码与字段表 ────────────────────────────────────
{
	const statelessReact = {
		createElement: (type, props, ...children) => typeof type === "function" ? type({ ...(props || {}) }) : ({ type, props: props || {}, children }),
		Fragment: "fragment",
		useState: init => [typeof init === "function" ? init() : init, () => {}],
		useRef: value => ({ current: value }),
		useMemo: factory => factory(),
		useEffect: () => {},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
	};
	const { factory } = loadClient(statelessReact);
	const { pointerJoin, MAPPING_POINTER_FIELDS } = factory(() => statelessReact).__test;
	assert.equal(pointerJoin(["data", "balances", 0, "remain"]), "/data/balances/0/remain");
	assert.equal(pointerJoin(["a~b", "c/d"]), "/a~0b/c~1d");
	assert.equal(pointerJoin([]), "/");
	assert.equal(MAPPING_POINTER_FIELDS.length, 14);
	assert.ok(MAPPING_POINTER_FIELDS.some(([field]) => field === "balancePointer"));
	assert.ok(MAPPING_POINTER_FIELDS.some(([field]) => field === "windowsArrayPointer"));
}

// ── [2] 端到端：探测 → 建议映射 → 点选 → 语义 → 保存 ─────────────────────────
{
	// 有状态 React 桩：setState 同步触发重放（Hook 按序复位下标）。
	const states = [];
	let hookIndex = 0;
	let current = null;
	let render = null;
	const rerender = () => { hookIndex = 0; current = render(); };
	const react = {
		createElement: (type, props, ...children) => typeof type === "function" ? type({ ...(props || {}) }) : ({ type, props: props || {}, children }),
		Fragment: "fragment",
		useState(init) {
			const i = hookIndex++;
			if (states.length <= i) states.push(typeof init === "function" ? init() : init);
			return [states[i], update => { states[i] = typeof update === "function" ? update(states[i]) : update; rerender(); }];
		},
		useRef: value => ({ current: value }),
		useMemo: factory => factory(),
		useEffect: () => {},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
	};
	const { factory } = loadClient(react);
	const { InstanceEditor } = factory(() => react).__test;

	const RECIPE = { adapterId: "custom-http", label: "自定义 HTTP 接口", defaultUsagePath: "/v1/usage", defaultAuthKind: "bearer", supportedAuthKinds: ["bearer", "none"] };
	let saved = null;
	const props = {
		inst: null, profile: null, catalog: { recipes: [RECIPE] }, revision: "rev-1",
		call: async (method, args) => {
			assert.equal(method, "detectInstance");
			assert.equal(args.baseUrl, "https://relay.example.com");
			return { status: "needs-review", matched: true, confidence: "high", usagePath: "/v1/usage", suggestedMapping: { balancePointer: "/data/total_balance" }, conflicts: [], explanations: ["已生成候选映射"], rawPreview: { data: { total_balance: 12.5, percent: 42, granted: 30 } }, attempts: [] };
		},
		usageStore: { save: async patch => { saved = patch; return "rev-2"; }, refresh: async () => {} },
		onDone: () => {}, text: cn => cn, setNotice: () => {}
	};
	render = () => InstanceEditor(props);
	hookIndex = 0; rerender();

	// 0. 填表单：实例 ID 与 Base URL（真实 UI 里为空时按钮禁用）
	const findInput = (root, placeholder) => { let hit = null; walk(root, n => { if (!hit && n.type === "input" && typeof n.props?.placeholder === "string" && n.props.placeholder.includes(placeholder)) hit = n; }); return hit; };
	findInput(current, "my-relay").props.onChange({ target: { value: "my-relay" } });
	findInput(current, "https://relay.example.com").props.onChange({ target: { value: "https://relay.example.com" } });
	// 1. 探测：结果与「采用建议映射」都要渲染出来
	await findButton(current, "测试连接").props.onClick();
	assert.ok(flattenText(current).includes("已生成候选映射"), "探测结果要渲染出来");
	assert.ok(findButton(current, "采用建议映射"), "探测成功要给一键套用");
	// 2. 打开映射编辑器：点选树在场，响应字段是可点按钮
	findButton(current, "映射编辑器").props.onClick();
	assert.ok(flattenText(current).includes("点选映射"), "rawPreview 在场时要点选树");
	assert.ok(findButton(current, "/data/percent"), "响应字段要渲染成可点按钮");
	// 3. 套用建议映射，再点响应里的 percent 字段 → 语义菜单出现
	findButton(current, "采用建议映射").props.onClick();
	findButton(current, "/data/percent").props.onClick();
	assert.ok(flattenText(current).includes("选中的字段"), "点选后要出现语义菜单");
	// 4. 选「百分比指针」语义 → 映射写入且探测保留（keepProbe）
	findButton(current, "百分比指针").props.onClick();
	assert.ok(flattenText(current).includes("点选映射"), "keepProbe：选完语义树不能消失");
	assert.ok(!flattenText(current).includes("选中的字段"), "选完语义菜单要收起");
	// 5. 保存 → mapping 里同时有建议映射与点选生成的指针
	await findButton(current, "保存连接").props.onClick();
	assert.ok(saved, "保存要发生");
	assert.equal(saved.instance.mapping.balancePointer, "/data/total_balance");
	assert.equal(saved.instance.mapping.percentPointer, "/data/percent");
	assert.equal(saved.displayProfile, undefined);

	// 已保存的锁是规范化对象；清空后不把旧对象重新带入探测或保存。
	states.length = 0;
	props.inst = { id: "my-relay", adapterId: "custom-http", baseUrl: "https://relay.example.com", hasSecret: true,
		mapping: { balancePointer: "/data/total_balance", mappingLock: { lockedFields: ["balancePointer"] } } };
	props.profile = { primaryMetric: "element:balance" };
	props.call = async (_method, args) => {
		assert.equal(args.mappingLock.length, 0);
		assert.equal(args.currentMapping.mappingLock, undefined);
		assert.equal(args.secretAction, "clear");
		assert.equal(args.secret, undefined);
		return { status: "auth-required", matched: false, reason: "fixture authentication required" };
	};
	rerender();
	findButton(current, "映射编辑器").props.onClick();
	assert.ok(findButton(current, "🔒"), "已保存锁定在编辑器中可见");
	findButton(current, "🔒").props.onClick();
	findInput(current, "element:balance").props.onChange({ target: { value: "" } });
	findButton(current, "清除秘密").props.onClick();
	await findButton(current, "测试连接").props.onClick();
	assert.match(flattenText(current), /需要鉴权/);
	assert.match(flattenText(current), /fixture authentication required/);
	assert.equal(findButton(current, "采用建议映射"), null);
	await findButton(current, "保存连接").props.onClick();
	assert.equal(saved.instance.mapping.mappingLock, undefined);
	assert.equal(Object.keys(saved.displayProfile.profile).length, 0, "通过空对象清除最后一个显示字段");
	assert.equal(saved.secretUpdate.action, "clear");

	const { RouteBindingsBlock } = factory(() => react).__test;
	states.length = 0;
	let saveBindingSuccess = false;
	render = () => RouteBindingsBlock({ result: { settings: { instances: [props.inst] }, availableProviders: ["mock-route"] }, text: cn => cn, busy: false, getLocale: () => "zh-CN", saveRouteBindings: async () => saveBindingSuccess });
	rerender();
	const select = label => { let hit; walk(current, node => { if (node.type === "select" && node.props["aria-label"] === label) hit = node; }); return hit; };
	select("选择路由").props.onChange({ target: { value: "mock-route" } });
	select("选择目标").props.onChange({ target: { value: "my-relay" } });
	await findButton(current, "绑定").props.onClick();
	assert.equal(select("选择路由").props.value, "mock-route");
	assert.equal(select("选择目标").props.value, "my-relay");
	saveBindingSuccess = true;
	await findButton(current, "绑定").props.onClick();
	assert.equal(select("选择路由").props.value, "");
	assert.equal(select("选择目标").props.value, "");
}
console.log("PASS 点选映射器：指针编码、探测树点选、语义写入与 keepProbe 全流程");
