// 输入净化回归：六个输入框的值从网页/控制台复制时，常带上换行、制表或零宽字符，
// 而这些字段本身都不含空白，因此应当**自动剔除**而不是拒绝保存。
//
// 背景：用户曾遇到「填了 AK/SK、点保存、界面显示已保存，但值根本没落盘」。
// 复查时发现多个输入框用控制字符校验把正常的粘贴值挡在保存之前，而报错又不总能
// 让人看懂是哪一步断了。这里把「粘贴脏值也能存上」钉成回归。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

let spec;
const react = {
	Fragment: Symbol("Fragment"),
	createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	useState: initial => [(typeof initial === "function" ? initial() : initial), () => {}],
	useRef: value => ({ current: value }),
	useEffect() {},
	useCallback: value => value,
	useMemo: fn => fn()
};
const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { draftFor, settingsPatch }; exports.apply = apply;"), {
	window: { __ModuleLoader__: { load: value => { spec = value; } } }, console
});
const api = spec.factory(name => { assert.equal(name, "react"); return react; }).__test;
// vm 上下文里造出来的对象原型与本 realm 不同，跨 realm 一律用 JSON 比较。
const flat = value => JSON.stringify(value);

// ① 火山 AK/SK：从控制台复制常带零宽字符或尾随换行。
{
	const draft = api.draftFor({ keyModes: {} }, "arkcli-agent-plan");
	const patch = api.settingsPatch("arkcli-agent-plan", { ...draft, volc: { accessKey: "AKLTab\u200bcd", secret: "SKefg\n", clear: false } }, "rev");
	assert.equal(patch.volc.accessKeyId.value, "AKLTabcd", "AK 里的零宽字符被剔除");
	assert.equal(patch.volc.secretAccessKey.value, "SKefg", "SK 的尾随换行被剔除");
	// 只填一半仍然只发一半，不能顺手把已存的另一半抹掉。
	const onlyAk = api.settingsPatch("arkcli-agent-plan", { ...draft, volc: { accessKey: "AKLTx", secret: "", clear: false } }, "rev");
	assert.equal(onlyAk.volc.secretAccessKey, undefined, "只填 AK 时不触碰 SK");
}

// ② 普通 API Key：以前这里会抛「不能包含控制字符」，粘贴一个带换行的 Key 就存不上。
{
	const draft = api.draftFor({}, "siliconflow");
	const patch = api.settingsPatch("siliconflow", { ...draft, keyAction: "replace", key: "sk-abc123\n" }, "rev");
	assert.equal(patch.keyUpdate.value, "sk-abc123", "Key 的尾随换行被剔除");
	// 只有空白仍要拒绝：否则会把「清空」当成「替换成空值」。
	assert.throws(() => api.settingsPatch("siliconflow", { ...draft, keyAction: "replace", key: " \n\t " }, "rev"), /不能为空/, "全空白仍拒绝");
}

// ③ LiteLLM 代理地址：从浏览器地址栏复制常带首尾空格，而 Host 侧有控制字符校验。
{
	const draft = api.draftFor({}, "litellm");
	const patch = api.settingsPatch("litellm", { ...draft, litellm: { baseUrl: " https://litellm.example.com/v1 \n" } }, "rev");
	assert.equal(patch.litellm.baseUrl, "https://litellm.example.com/v1", "URL 两侧空白与换行被剔除");
	// 空串是「清空地址」的既有语义，不能被当成失败。
	assert.equal(api.settingsPatch("litellm", { ...draft, litellm: { baseUrl: "   " } }, "rev").litellm.baseUrl, "", "全空白归一成空串（清空语义）");
}

// ④ Z.ai 团队档的组织 / 项目：从网页复制常带尾随换行，Host 只 trim 首尾、去不掉内部换行。
{
	const draft = api.draftFor({}, "zai-coding-cn");
	const patch = api.settingsPatch("zai-coding-cn", { ...draft, zai: { type: 2, organization: "org-1\n", project: " pro\nject-2 " } }, "rev");
	assert.equal(flat(patch.zai), flat({ type: 2, organization: "org-1", project: "project-2" }), "组织与项目里的不可见字符都被剔除");
	// 个人档不携带这两个字段。
	assert.equal(api.settingsPatch("zai-coding-cn", { ...draft, zai: { type: 1, organization: "", project: "" } }, "rev").zai.type, 1);
}

// ⑤ 回归护栏：draft 的初值不含任何秘密，且 volc 的清除必须显式。
{
	const draft = api.draftFor({ keyModes: {} }, "arkcli-agent-plan");
	assert.equal(flat(draft.volc), flat({ accessKey: "", secret: "", clear: false }), "草稿默认不带任何秘密");
	assert.equal(api.settingsPatch("arkcli-agent-plan", draft, "rev").volc, undefined, "什么都没填就不发 volc 补丁");
	assert.equal(flat(api.settingsPatch("arkcli-agent-plan", { ...draft, volc: { accessKey: "", secret: "", clear: true } }, "rev").volc), flat({ accessKeyId: { action: "clear" }, secretAccessKey: { action: "clear" } }), "清除是显式动作");
}

console.log("输入净化测试全部通过 ✅");
