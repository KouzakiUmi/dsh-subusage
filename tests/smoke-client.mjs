// client 冒烟：物化工厂 + mock ctx 调 apply，断言两个 slot 注册成功。
import { loadClientFactory, makeAssert } from "./helpers.mjs";

const assert = makeAssert();
const { id, exportsObj } = await loadClientFactory();
assert(id === "dsh-subusage", "module id = dsh-subusage");
assert(typeof exportsObj.apply === "function" && Array.isArray(exportsObj.inject), "导出契约 {apply, inject, name}");

const records = [];
const mockCtx = {
	effect(fn) { try { const r = fn(); return typeof r === "function" ? r : () => {}; } catch { return () => {}; } },
	locale: {
		register: (ns) => { records.push({ locale: ns }); return () => {}; },
		bind: (ns) => (key) => `${ns}.${key}`,
		getLocale: () => ({ active: "zh" })
	},
	remote: { $mount: () => { records.push({ mount: true }); return Promise.resolve(() => {}); } },
	slots: {
		inject: (slotName, factory) => { records.push({ slotInject: slotName }); const d = factory(); return typeof d === "function" ? d : () => {}; },
		register: (options, component) => { records.push({ register: options, component: component && component.name }); return () => {}; }
	},
	inject(names, cb) { records.push({ inject: names }); return cb(mockCtx); }
};

try {
	exportsObj.apply(mockCtx);
	assert(true, "apply(mockCtx) 不抛错");
} catch (e) {
	assert(false, `apply(mockCtx) 抛错: ${e.message}`);
}
assert(records.some((r) => r.register && r.register.id === "subusage" && r.register.name === "settings.section"), "settings.section 已注册");
assert(records.some((r) => r.register && r.register.id === "subusage-usage" && r.register.name === "conversation.input.right"), "conversation.input.right 已注册");
assert.summary();
