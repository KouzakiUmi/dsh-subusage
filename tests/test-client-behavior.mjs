// 执行真实 client factory；测试共享状态、并发、生命周期与设置行为，无新增依赖。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const ids = ["zai-coding-cn", "kimi-coding", "xiaomi-token-plan-cn", "opencode-go", "commandcode", "openai-codex", "xai-oauth", "minimax-cn", "deepseek", "arkcli-agent-plan", "arkcli-coding-plan"];
// 默认关闭的厂商：在提供商管理里可见开关、但不产生 tab。新增厂商时同步这里。
const defaultOff = ["zai-coding", "synthetic", "nanogpt", "ark-coding-plan-cn", "ark-agent-plan-cn", "ark-coding-plan-byteplus", "siliconflow", "openrouter", "novita", "hyperbolic", "deepinfra", "chutes", "ollama-cloud", "vercel-ai-gateway", "minimax", "zenmux", "litellm", "arkcli-agent-plan-team", "arkcli-coding-plan-team"];
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let spec, clock = Date.parse("2026-10-01T10:00:00Z"), nextTimer = 0;
const intervals = new Map(), timeouts = new Map(), events = new Map();
const memory = new Map();
const document = {
  visibilityState: "visible",
  addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
  removeEventListener(name, fn) { events.get(name)?.delete(fn); }
};
class FakeDate extends Date { static now() { return clock; } }
let harness;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((x) => x !== null && x !== false && x !== undefined) }),
  Fragment: "fragment",
  useState: (initial) => harness.state(initial),
  useRef: (value) => harness.ref(value),
  useEffect: (fn, deps) => harness.effect(fn, deps),
  useMemo: (fn, deps) => harness.memo(fn, deps),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
};
vm.runInNewContext(source.replace("exports.apply = apply;", "exports.__test = { createUsageStore, canShowUsage, validateCookieText, settingsPatch, draftFor, SubusageSection, UsagePill, UsageWindowRow, providerIcon, providerVisible, zh }; exports.apply = apply;"), {
  window: { localStorage: { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) }, __ModuleLoader__: { load: (value) => { spec = value; } } },
  document, console, Date: FakeDate,
  setInterval: (fn, ms) => { const id = ++nextTimer; intervals.set(id, { fn, ms }); return id; }, clearInterval: (id) => intervals.delete(id),
  setTimeout: (fn, ms) => { const id = ++nextTimer; timeouts.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timeouts.delete(id)
});
const plugin = spec.factory(() => react), api = plugin.__test;
const t = (key) => api.zh[key] || key;
const publicSettings = (revision = "1") => ({ revision, zai: { type: 1, organization: "", project: "" }, xiaomi: { hasCookie: true }, hasKeys: {}, keyModes: {} });
const entry = (providerId, percent = 25, extra = {}) => ({ providerId, state: "ok", coverage: "complete", freshness: "fresh", windows: [{ kind: "sub", percent, status: percent >= 100 ? "rate-limited" : "ok" }], extras: [], lastAttemptAt: new FakeDate(clock).toISOString(), lastSuccessAt: new FakeDate(clock).toISOString(), ...extra });
const result = (entries, revision = "1") => ({ entries, settings: publicSettings(revision), configured: {}, updatedAt: new FakeDate(clock).toISOString() });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nodes = (tree) => tree && typeof tree === "object" ? [tree, ...tree.children.flatMap(nodes)] : [];
const textOf = (tree) => JSON.stringify(tree);
class Hooks {
  slots = []; index = 0; queue = [];
  state(initial) { const i = this.index++; if (!(i in this.slots)) this.slots[i] = { value: typeof initial === "function" ? initial() : initial }; return [this.slots[i].value, (value) => { this.slots[i].value = typeof value === "function" ? value(this.slots[i].value) : value; }]; }
  ref(value) { const i = this.index++; return this.slots[i] ||= { current: value }; }
  changed(a, b) { return !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i])); }
  effect(fn, deps) { const i = this.index++; const prev = this.slots[i]; if (!prev || this.changed(prev.deps, deps)) { this.slots[i] = { deps, cleanup: prev?.cleanup }; this.queue.push(() => { this.slots[i].cleanup?.(); this.slots[i].cleanup = fn(); }); } }
  memo(fn, deps) { const i = this.index++; if (!this.slots[i] || this.changed(this.slots[i].deps, deps)) this.slots[i] = { deps, value: fn() }; return this.slots[i].value; }
  render(component, props, effects = true) { harness = this; this.index = 0; const tree = component(props); if (effects) for (const fn of this.queue.splice(0)) fn(); return tree; }
  unmount() { for (const slot of this.slots) slot?.cleanup?.(); }
}
// 初始化 read 仅一次；多个药丸只请求当前 provider 并共享同一 inflight。
const calls = [];
let gate = deferred();
const store = api.createUsageStore((method, query) => { calls.push({ method, query }); if (method === "read") return result(ids.map((id) => entry(id))); return gate.promise; });
await Promise.all([store.readAll(), store.readAll()]);
assert.equal(calls.filter((c) => c.method === "read").length, 1);
assert.equal(store.reader(ids[0]), store.reader(ids[0]), "reader 稳定");
const r1 = store.reader(ids[0])(), r2 = store.reader(ids[0])();
await flush();
assert.equal(calls.filter((c) => c.method === "refresh").length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).query)), { providerIds: [ids[0]], force: false, commandCodeAccount: "" });
gate.resolve(result([entry(ids[0], 88)])); await Promise.all([r1, r2]);
assert.equal(store.getSnapshot().entries.length, ids.length, "partial merge 保留其它家");
assert.equal(store.getSnapshot().entries.find((e) => e.providerId === ids[1]).windows[0].percent, 25);
store.dispose();
// 后到 readAll 不能覆盖新 force refresh（相同 revision 也必须挡）。
const readGate = deferred(), forceGate = deferred();
const raceStore = api.createUsageStore((method) => method === "read" ? readGate.promise : forceGate.promise);
const slowRead = raceStore.readAll();
const force = raceStore.refresh([ids[0]], true);
forceGate.resolve(result([entry(ids[0], 90)])); await force;
readGate.resolve(result(ids.map((id) => entry(id, 10)))); await slowRead;
assert.equal(raceStore.getSnapshot().entries.find((e) => e.providerId === ids[0]).windows[0].percent, 90);
assert.equal(raceStore.getSnapshot().entries.length, ids.length, "read 的未冲突 provider 仍合并");
raceStore.dispose();
// 保存立即失效旧quota、更新revision；旧在途结果不能恢复quota或回退revision。
const oldGate = deferred(); let saveCalls = 0;
const saveStore = api.createUsageStore((method) => method === "read" ? result(ids.map((id) => entry(id))) : method === "save" ? (saveCalls++, result([], "2")) : oldGate.promise);
await saveStore.readAll();
let seen;
const unsub = saveStore.reader(ids[0]).subscribe((value) => { seen = value; });
const oldRequest = saveStore.refresh([ids[0]], false);
await saveStore.save({ providerId: ids[0], expectedRevision: "1", keyUpdate: { action: "clear" } });
assert.equal(saveCalls, 1); assert.equal(seen.state, "loading"); assert.equal(seen.windows.length, 0);
oldGate.resolve(result([entry(ids[0], 99)])); await oldRequest;
assert.equal(saveStore.getSnapshot().settings.revision, "2");
assert.equal(saveStore.getSnapshot().entries.find((e) => e.providerId === ids[0]).windows.length, 0);
assert.equal(saveStore.getSnapshot().entries.find((e) => e.providerId === ids[1]).windows[0].percent, 25, "保存单家凭据保留其他厂商额度");
unsub(); saveStore.dispose();
// 传输失败不擅自显示旧成功缓存；只有 Host retainPrevious + stale 能显示。
const failedStore = api.createUsageStore((method) => method === "read" ? result([entry(ids[0])]) : Promise.reject(new Error("network down")));
await failedStore.readAll(); await assert.rejects(failedStore.refresh([ids[0]]));
assert.equal(api.canShowUsage(failedStore.getSnapshot().entries[0]), false);
const cached = entry(ids[0], 25, { state: "error", freshness: "stale", retainPrevious: true });
assert.equal(api.canShowUsage(cached), true);
for (const changed of [{ retainPrevious: false }, { freshness: "unknown" }, { state: "no-key" }, { state: "no-cookie" }, { errorCode: "subusage/auth" }]) assert.equal(api.canShowUsage({ ...cached, ...changed }), false);
failedStore.dispose();
// 活跃provider共享单计时器；visibility/reset只刷新活跃项，到期force不循环。
const periodicCalls = [];
const periodic = api.createUsageStore((method, query) => { if (method === "read") return result(ids.map((id) => entry(id, 25, { windows: [{ kind: "sub", percent: 25, status: "ok", resetsAt: new FakeDate(clock - 1000).toISOString() }] }))); periodicCalls.push(JSON.parse(JSON.stringify(query))); return result(query.providerIds.map((id) => entry(id))); });
await periodic.readAll();
const deactivateA = periodic.activate(ids[0]), deactivateB = periodic.activate(ids[0]);
assert.equal(intervals.size, 1);
const timer = [...intervals.values()][0]; assert.equal(timer.ms, 60000);
timer.fn(); await flush();
assert.equal(periodicCalls.length, 1); assert.equal(periodicCalls[0].force, true);
assert.deepEqual(periodicCalls[0].providerIds, [ids[0]]);
timer.fn(); await flush(); assert.equal(periodicCalls.at(-1).force, false);
document.visibilityState = "hidden"; const before = periodicCalls.length; timer.fn(); await flush(); assert.equal(periodicCalls.length, before);
document.visibilityState = "visible"; for (const fn of events.get("visibilitychange")) fn(); await flush(); assert.equal(periodicCalls.length, before + 1);
deactivateA(); assert.equal(intervals.size, 1); deactivateB(); assert.equal(intervals.size, 0); assert.equal(events.get("visibilitychange").size, 0); periodic.dispose();
// 首次失败不再loading；药丸外部props兼容；cleanup释放共享reader。
const pillProps = { providerId: ids[0], label: "Z.ai", t, getLocale: () => "zh", readEntry: async () => { throw new Error("fetch failed"); } };
const ph = new Hooks(); ph.render(api.UsagePill, pillProps); await flush();
let tree = ph.render(api.UsagePill, pillProps);
assert.ok(textOf(tree).includes("拉取失败")); assert.ok(!textOf(tree).includes("正在读取用量")); ph.unmount();
const sharedPill = api.createUsageStore(() => result([entry(ids[0])]));
const sh = new Hooks(); sh.render(api.UsagePill, { ...pillProps, readEntry: sharedPill.reader(ids[0]) }); await flush();
assert.equal(intervals.size, 1); sh.unmount(); assert.equal(intervals.size, 0); assert.equal(events.get("visibilitychange").size, 0); sharedPill.dispose();
// 设置：7col短label、公共凭据不回填、dirty保存/取消、键盘与持久化、MiMo无Key/桥。
const uiGate = deferred(); let uiSnapshot = result(ids.map((id) => entry(id))); let savedPatch;
const uiStore = { getSnapshot: () => uiSnapshot, subscribe: () => () => {}, readAll: async () => uiSnapshot, activate: () => () => {}, save: async (patch) => { savedPatch = patch; uiSnapshot = result([], "2"); return uiSnapshot; }, refresh: async () => uiGate.promise };
const uh = new Hooks(), props = { usageStore: uiStore, t, getLocale: () => "zh" };
tree = uh.render(api.SubusageSection, props);
let tabs = nodes(tree).filter((n) => n.props.role === "tab");
assert.equal(tabs.length, ids.length); assert.deepEqual(tabs.map((n) => n.children.at(-1)), ["Z.ai", "Kimi", "MiMo", "OpenCode Go", "Command", "Codex", "SuperGrok", "MiniMax CN", "DeepSeek", "ARK Plan", "ARK Code"]);
assert.equal(nodes(tree).find((n) => n.props.role === "tablist").props.style.flexWrap, "wrap");
assert.ok(!nodes(tree).some(n => n.type === "select" || n.type === "option"));
assert.equal(nodes(tree).filter(n => n.props.role === "switch").length, ids.length + defaultOff.length + 1); assert.ok(!textOf(tree).includes("保存设置"));
let focused; tabs[0].props.onKeyDown({ key: "End", preventDefault() {}, currentTarget: { parentElement: { querySelectorAll: () => tabs.map((_, i) => ({ focus() { focused = i; } })) } } });
assert.equal(focused, ids.length - 1); tree = uh.render(api.SubusageSection, props); assert.equal(memory.get("dsh-subusage:last-provider"), ids.at(-1));
// End 键跳到最后一个 tab，其技术信息应显示该 provider 的继承变量名。
assert.ok(textOf(tree).includes(`${ids.at(-1).replace(/-/g, "_").toUpperCase()}_API_KEY`));
// MiniMax 的技术信息要说明「需要订阅 Key 而不是按量 Key」：显式点开该 tab，不依赖它是第几个/是否在末尾。
nodes(tree).find(n => n.props.role === "tab" && n.props.id === "subusage-tab-minimax-cn").props.onClick(); tree = uh.render(api.SubusageSection, props);
assert.ok(textOf(tree).includes("订阅 Key"));
tabs = nodes(tree).filter((n) => n.props.role === "tab"); tabs[4].props.onClick(); tree = uh.render(api.SubusageSection, props);
assert.ok(textOf(tree).includes("直接拉取"), "Command Code 标签展示只读说明");
assert.ok(!nodes(tree).some((n) => n.type === "input" && n.props.type === "password"), "Command Code 不提供本地 Key 输入");
tabs = nodes(tree).filter((n) => n.props.role === "tab"); tabs[3].props.onClick(); tree = uh.render(api.SubusageSection, props); assert.equal(memory.get("dsh-subusage:last-provider"), ids[3]);
nodes(tree).find((n) => n.type === "button" && n.children.includes("更换")).props.onClick();
tree = uh.render(api.SubusageSection, props);
const password = nodes(tree).find((n) => n.type === "input" && n.props.type === "password"); assert.equal(password.props.value, ""); password.props.onChange({ target: { value: "secret-new" } });
tree = uh.render(api.SubusageSection, props);
const saveButton = nodes(tree).find((n) => n.type === "button" && n.children.includes("保存设置")); const saving = saveButton.props.onClick(); await flush();
assert.equal(savedPatch.expectedRevision, "1"); assert.equal(savedPatch.providerId, ids[3]); assert.equal(savedPatch.keyUpdate.value, "secret-new");
tree = uh.render(api.SubusageSection, props); assert.ok(textOf(tree).includes("已保存")); assert.ok(!textOf(tree).includes("secret-new"));
uiGate.resolve(result([entry(ids[3], 0, { state: "error", windows: [], error: "verification failed" })], "2")); await saving;
tree = uh.render(api.SubusageSection, props); assert.ok(textOf(tree).includes("已保存；验证获取失败")); assert.ok(!textOf(tree).includes("保存设置"));
tabs = nodes(tree).filter((n) => n.props.role === "tab"); tabs[2].props.onClick(); tree = uh.render(api.SubusageSection, props);
assert.ok(!nodes(tree).some((n) => n.type === "input" && n.props.type === "password"));
const link = nodes(tree).find((n) => n.type === "a"); assert.equal(link.props.href, "https://platform.xiaomimimo.com"); assert.equal(link.props.rel, "noopener noreferrer"); assert.equal(link.props.target, "_blank");
nodes(tree).find((n) => n.type === "button" && n.children.includes("手动导入")).props.onClick(); tree = uh.render(api.SubusageSection, props);
const textarea = nodes(tree).find((n) => n.type === "textarea"); assert.equal(textarea.props.value, ""); assert.equal(textarea.props.onBlur, undefined);
textarea.props.onChange({ target: { value: "[{invalid" } }); tree = uh.render(api.SubusageSection, props);
nodes(tree).find((n) => n.type === "button" && n.children.includes("验证并规范化导入")).props.onClick(); tree = uh.render(api.SubusageSection, props);
assert.equal(nodes(tree).find((n) => n.type === "textarea").props.value, "[{invalid"); assert.ok(textOf(tree).includes("解析失败"));
nodes(tree).find((n) => n.type === "button" && n.children.includes("取消编辑")).props.onClick(); tree = uh.render(api.SubusageSection, props); assert.ok(!textOf(tree).includes("保存设置")); uh.unmount();
// 初次读取未就绪时字段禁用，而且人为触发change也不能dirty；revision缺省拒绝patch。
const emptyUi = new Hooks(); const emptyStore = { ...uiStore, getSnapshot: () => ({ entries: [], configured: {}, settings: null }), readAll: () => new Promise(() => {}), refresh: () => new Promise(() => {}) };
tree = emptyUi.render(api.SubusageSection, { ...props, usageStore: emptyStore });
assert.equal(nodes(tree).find((n) => n.type === "fieldset").props.disabled, true);
nodes(tree).find((n) => n.type === "button" && n.children.includes("手动导入")).props.onClick(); tree = emptyUi.render(api.SubusageSection, { ...props, usageStore: emptyStore }); assert.ok(!textOf(tree).includes("保存设置")); emptyUi.unmount();
assert.throws(() => api.settingsPatch(ids[0], api.draftFor(publicSettings(), ids[0]), null));
assert.deepEqual(Object.keys(api.settingsPatch(ids[4], api.draftFor(publicSettings(), ids[4]), "1")).sort(), ["expectedRevision", "providerId"], "managed 提供方不产生凭据补丁");
assert.throws(() => api.validateCookieText("userId=42")); assert.equal(api.validateCookieText("api-platform_serviceToken=abc==\nuserId=42"), "api-platform_serviceToken=abc==; userId=42");
assert.ok(!/webview|MimoBridge|executeJavaScript|persist:subusage/.test(source), "失效桥及自动创建行为全部移除");
// 所有剩余 native option 显式配对系统主题色；凭据/来源不再使用 dropdown。
memory.set("dsh-subusage:last-provider", ids[0]);
let buttonSnapshot = result(ids.map((id) => entry(id)));
buttonSnapshot.settings.hasKeys[ids[0]] = true;
let buttonPatch, buttonSaves = 0;
const buttonStore = { ...uiStore, getSnapshot: () => buttonSnapshot, refresh: async () => buttonSnapshot, save: async (patch) => { buttonPatch = patch; buttonSaves++; return buttonSnapshot = result([], "buttons-2"); } };
const bh = new Hooks(), bp = { ...props, usageStore: buttonStore };
bh.render(api.SubusageSection, bp); tree = bh.render(api.SubusageSection, bp);
assert.ok(!nodes(tree).some((n) => n.type === "select" && ["keep", "inherit", "manual", "replace", "clear"].includes(n.props.value)));
for (const option of nodes(tree).filter((n) => n.type === "option")) assert.deepEqual(JSON.parse(JSON.stringify(option.props.style)), { color: "CanvasText", backgroundColor: "Canvas" });
for (const select of nodes(tree).filter((n) => n.type === "select")) assert.equal(select.props.style.colorScheme, "light dark");
const button = (label) => nodes(tree).find((n) => n.type === "button" && n.children.includes(label));
button("更换").props.onClick(); tree = bh.render(api.SubusageSection, bp);
assert.equal(nodes(tree).find((n) => n.props["aria-pressed"] && n.children.includes("✓ 手动 Key")).props["aria-pressed"], true);
button("取消编辑").props.onClick(); tree = bh.render(api.SubusageSection, bp);
assert.ok(!nodes(tree).some((n) => n.type === "input" && n.props.type === "password"));
const manualMode = nodes(tree).find((n) => n.props["aria-pressed"] === false && n.children.includes("手动 Key")); manualMode.props.onClick(); tree = bh.render(api.SubusageSection, bp);
button("清除").props.onClick(); tree = bh.render(api.SubusageSection, bp);
assert.equal(buttonSaves, 0, "清除只进入dirty，不立即落盘"); assert.ok(textOf(tree).includes("保存设置后将删除"));
const clearedDraft = api.settingsPatch(ids[0], { ...api.draftFor(publicSettings(), ids[0]), keyMode: "manual", keyAction: "clear" }, "1");
assert.equal(clearedDraft.keyMode, "manual"); assert.equal(clearedDraft.keyUpdate.action, "clear");
await button("保存设置").props.onClick(); assert.equal(buttonPatch.keyMode, "manual"); assert.equal(buttonPatch.keyUpdate.action, "clear");
bh.unmount();
// 自动成功只合并一次，更新公开revision/sequence，旧额度不能复活旧账号。
const staleLoginQuota = deferred(); let loginStatus = { jobId: "login-A", state: "waiting" }; const loginCalls = [];
const loginStore = api.createUsageStore((method, request) => { loginCalls.push({ method, request }); if (method === "read") return result(ids.map((id) => entry(id))); if (method === "refresh") return staleLoginQuota.promise; if (method === "startMimoLogin") return { jobId: "login-A", state: "launching" }; if (method === "getMimoLoginStatus") return loginStatus; if (method === "cancelMimoLogin") return { jobId: request.jobId, state: "cancelled" }; });
await loginStore.readAll(); const staleQuota = loginStore.refresh([ids[2]]); await flush();
await loginStore.startMimoLogin({ expectedRevision: "1" });
loginStatus = { jobId: "login-A", state: "success", result: result([entry(ids[2], 3)], "login-2") };
await loginStore.getMimoLoginStatus(); const mergedSnapshot = loginStore.getSnapshot();
assert.equal(mergedSnapshot.settings.revision, "login-2"); assert.equal(mergedSnapshot.entries.find((e) => e.providerId === ids[2]).windows[0].percent, 3);
await loginStore.getMimoLoginStatus(); assert.equal(loginStore.getSnapshot(), mergedSnapshot, "同job success不重复emit/merge");
staleLoginQuota.resolve(result([entry(ids[2], 99)])); await staleQuota;
assert.equal(loginStore.getSnapshot().settings.revision, "login-2"); assert.equal(loginStore.getSnapshot().entries.find((e) => e.providerId === ids[2]).windows[0].percent, 3);
loginStore.dispose();
// 任意provider保存推进epoch后，在途login成功快照不得回放旧账号/旧公开revision。
for (const savedProvider of [ids[2], ids[0]]) {
  const delayedSuccess = deferred(); let statusReply = delayedSuccess.promise;
  const epochLoginStore = api.createUsageStore((method) => {
    if (method === "read") return result(ids.map((id) => entry(id)));
    if (method === "startMimoLogin") return { jobId: "epoch-job", state: "waiting" };
    if (method === "getMimoLoginStatus") return statusReply;
    if (method === "save") { const value = result([entry(ids[2], 0, { state: "no-cookie", windows: [] })], "after-clear"); value.settings.xiaomi.hasCookie = false; return value; }
  });
  await epochLoginStore.readAll(); await epochLoginStore.startMimoLogin({ expectedRevision: "1" });
  const lateSuccess = epochLoginStore.getMimoLoginStatus();
  await epochLoginStore.save({ providerId: savedProvider, expectedRevision: "1", ...(savedProvider === ids[2] ? { cookieUpdate: { action: "clear" } } : { keyUpdate: { action: "clear" } }) });
  delayedSuccess.resolve({ jobId: "epoch-job", state: "success", result: result([entry(ids[2], 82)], "old-login-revision") });
  assert.equal(await lateSuccess, null);
  assert.equal(epochLoginStore.getSnapshot().settings.revision, "after-clear"); assert.equal(epochLoginStore.getSnapshot().settings.xiaomi.hasCookie, false);
  assert.equal(epochLoginStore.getSnapshot().entries.find((e) => e.providerId === ids[2]).state, "no-cookie");
  statusReply = { jobId: null, state: "idle" };
  assert.equal((await epochLoginStore.getMimoLoginStatus()).state, "idle", "Host失效旧终态后idle/null必须终止pending轮询");
  epochLoginStore.dispose();
}
// 新job启动后，旧status/旧cancel响应不能取消或覆盖新job。
const oldStatusGate = deferred(), oldCancelGate = deferred(); let nextJob = "old", statusCalls = 0, cancelCalls = 0;
const jobStore = api.createUsageStore((method, request) => { if (method === "startMimoLogin") return { jobId: nextJob, state: "launching" }; if (method === "getMimoLoginStatus") { statusCalls++; return oldStatusGate.promise; } if (method === "cancelMimoLogin") { cancelCalls++; return oldCancelGate.promise; } });
await jobStore.startMimoLogin({ expectedRevision: "1" }); const lateStatus = jobStore.getMimoLoginStatus(), lateCancel = jobStore.cancelMimoLogin({ jobId: "old" });
nextJob = "new"; await jobStore.startMimoLogin({ expectedRevision: "1" });
oldStatusGate.resolve({ jobId: "old", state: "success", result: result([], "old-revision") }); oldCancelGate.resolve({ jobId: "old", state: "cancelled" });
assert.equal(await lateStatus, null); assert.equal(await lateCancel, null);
assert.equal(await jobStore.cancelMimoLogin({ jobId: "old" }), null); assert.equal(cancelCalls, 1);
assert.equal(jobStore.getSnapshot().settings, null); jobStore.dispose();
// MiMo hooks：start立即返回pendingUI，2秒串行轮询、cancel jobId、卸载不取消Host job。
memory.set("dsh-subusage:last-provider", ids[2]);
let autoSnapshot = result([entry(ids[2])]), autoState = { jobId: null, state: "idle" }, autoStartCalls = 0, autoCancelCalls = 0, autoStatusCalls = 0;
const autoStartGate = deferred();
const autoStore = { ...uiStore, getSnapshot: () => autoSnapshot, readAll: async () => autoSnapshot, refresh: async () => autoSnapshot,
  startMimoLogin: (request) => { autoStartCalls++; assert.equal(request.expectedRevision, "1"); return autoStartGate.promise; },
  getMimoLoginStatus: async () => { autoStatusCalls++; return autoState; },
  cancelMimoLogin: async (request) => { autoCancelCalls++; assert.equal(request.jobId, "UI-job"); return autoState = { jobId: "UI-job", state: "cancelled" }; }
};
const ah = new Hooks(), ap = { ...props, usageStore: autoStore };
ah.render(api.SubusageSection, ap); await flush(); tree = ah.render(api.SubusageSection, ap);
button("手动导入").props.onClick(); tree = ah.render(api.SubusageSection, ap);
nodes(tree).find((n) => n.type === "textarea").props.onChange({ target: { value: "unsaved-cookie-draft" } }); tree = ah.render(api.SubusageSection, ap);
await button("登录并自动导入").props.onClick(); assert.equal(autoStartCalls, 0); tree = ah.render(api.SubusageSection, ap); assert.ok(textOf(tree).includes("请先保存或取消"));
button("取消编辑").props.onClick(); tree = ah.render(api.SubusageSection, ap);
const starting = button("登录并自动导入").props.onClick(); tree = ah.render(api.SubusageSection, ap);
assert.equal(autoStartCalls, 1); assert.ok(textOf(tree).includes("正在启动登录浏览器")); assert.ok(nodes(tree).some((n) => n.type === "progress"));
autoState = { jobId: "UI-job", state: "waiting" }; autoStartGate.resolve(autoState); await starting; tree = ah.render(api.SubusageSection, ap);
assert.equal([...timeouts.values()].filter((timer) => timer.ms === 2000).length, 1);
const loginTimer = [...timeouts.entries()].find(([, timer]) => timer.ms === 2000); timeouts.delete(loginTimer[0]); loginTimer[1].fn(); await flush(); tree = ah.render(api.SubusageSection, ap);
assert.equal(autoStatusCalls, 2); assert.ok(textOf(tree).includes("请在浏览器中完成登录"));
assert.equal(button("手动导入").props.disabled, true, "MiMo 登录期间禁止手动导入");
assert.equal(button("清除登录凭据").props.disabled, true, "MiMo 登录期间禁止清除并产生误导提示");
for (const providerId of [ids[0], ids[1], ids[3]]) {
 nodes(tree).find((n) => n.props.role === "tab" && n.props.id === `subusage-tab-${providerId}`).props.onClick();
 tree = ah.render(api.SubusageSection, ap); tree = ah.render(api.SubusageSection, ap);
 assert.equal(button("更换").props.disabled, false, "后台 MiMo 登录不得阻止其他厂商更换 Key");
 button("更换").props.onClick(); tree = ah.render(api.SubusageSection, ap);
 assert.ok(nodes(tree).some((n) => n.type === "input" && n.props.type === "password"));
 button("取消编辑").props.onClick(); tree = ah.render(api.SubusageSection, ap);
}
nodes(tree).find((n) => n.props.role === "tab" && n.props.id === `subusage-tab-${ids[2]}`).props.onClick();
tree = ah.render(api.SubusageSection, ap); await flush(); tree = ah.render(api.SubusageSection, ap);
await button("取消登录").props.onClick(); tree = ah.render(api.SubusageSection, ap);
assert.equal(autoCancelCalls, 1); assert.equal(timeouts.size, 0); assert.ok(button("手动导入"));
// 恢复正在运行job；dirty成功结果不得覆盖用户草稿，且成功effect只处理一次。
autoState = { jobId: "recover-job", state: "waiting" }; ah.unmount(); const rh = new Hooks();
rh.render(api.SubusageSection, ap); await flush(); tree = rh.render(api.SubusageSection, ap); assert.ok(textOf(tree).includes("请在浏览器中完成登录"));
rh.unmount(); assert.equal(timeouts.size, 0); assert.equal(autoCancelCalls, 1, "unmount不擅自取消其他client/Host任务");
autoState = { jobId: null, state: "idle" }; const dh = new Hooks(); dh.render(api.SubusageSection, ap); await flush(); tree = dh.render(api.SubusageSection, ap);
button("手动导入").props.onClick(); tree = dh.render(api.SubusageSection, ap);
nodes(tree).find((n) => n.type === "textarea").props.onChange({ target: { value: "keep-my-draft" } }); tree = dh.render(api.SubusageSection, ap);
// 模拟另一client登录完成、重新激活MiMo时恢复公共状态。
const draftSlot = dh.slots.find((slot) => slot?.value?.cookie === "keep-my-draft");
const loginSlot = dh.slots.find((slot) => slot?.value?.state === "idle" && "jobId" in slot.value);
autoSnapshot = result([entry(ids[2], 5)], "auto-2"); loginSlot.value = { jobId: "recover-success", state: "success", result: autoSnapshot };
tree = dh.render(api.SubusageSection, ap); tree = dh.render(api.SubusageSection, ap);
assert.equal(draftSlot.value.cookie, "keep-my-draft"); assert.ok(textOf(tree).includes("未保存编辑已保留"));
button("取消编辑").props.onClick(); tree = dh.render(api.SubusageSection, ap); assert.ok(!textOf(tree).includes("keep-my-draft"));
loginSlot.value = { jobId: "failed-job", state: "error", message: "sanitized failure" }; tree = dh.render(api.SubusageSection, ap); assert.ok(button("手动导入")); assert.ok(textOf(tree).includes("sanitized failure")); dh.unmount();
// 本client正常成功清理secret draft并同步公开revision。
const successHooks = new Hooks(); successHooks.render(api.SubusageSection, ap); await flush(); tree = successHooks.render(api.SubusageSection, ap);
const successSlot = successHooks.slots.find((slot) => slot?.value?.state === "idle" && "jobId" in slot.value); successSlot.value = { jobId: "done-job", state: "success", result: autoSnapshot };
tree = successHooks.render(api.SubusageSection, ap); tree = successHooks.render(api.SubusageSection, ap);
assert.equal(successHooks.slots.find((slot) => slot?.value?.cookieAction === "keep").value.cookie, "");
assert.ok(successHooks.slots.some((slot) => slot?.current === "auto-2")); successHooks.unmount();
// apply scope 卸载连未完成的 remote mount deadline 也清理并拒绝等待者。
let scopedStore; const disposers = [];
const ctx = {
  effect(fn) { const value = fn(); if (typeof value === "function") disposers.push(value); else if (value?.catch) value.catch(() => {}); },
  locale: { register: () => () => {}, bind: () => t, getLocale: () => ({ active: "zh" }) },
  remote: { $mount: () => new Promise(() => {}) }, get: () => undefined,
  slots: { inject: (_name, fn) => fn(), register: (options) => { if (options.id === "subusage") scopedStore = options.inject().usageStore; return () => {}; } },
  inject: (_names, fn) => fn(ctx)
};
plugin.apply(ctx);
const waitingRead = scopedStore.readAll().then(() => null, (error) => error);
await flush(); assert.equal(timeouts.size, 1, "挂载也有20秒deadline");
for (const fn of disposers) fn();
assert.ok((await waitingRead).message.includes("卸载"));
ctx.remote.$mount = () => Promise.resolve(() => {});
ctx.get = () => ({}); // 模拟未同时更新的旧Host服务。
plugin.apply(ctx);
const mismatch = await scopedStore.refresh([ids[0]]).then(() => null, (error) => error);
assert.ok(mismatch.message.includes("契约版本不匹配")); assert.ok(mismatch.message.includes("重新加载或重启"));
for (const fn of disposers) fn();
assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0);
// 提供商开关/默认隐藏/隐藏项配置入口/无下拉；只按凭据存在性过滤，不按 API 成功过滤。
const preferences = (providers = {}, hideWithoutApi = true) => ({ hideWithoutApi, providers: { ...Object.fromEntries(ids.map(id => [id, true])), ...providers } });
const withPrefs = (data, prefs = preferences()) => ({ ...data, settings: { ...data.settings, visibility: prefs } });
assert.equal(api.providerVisible({ visibility: preferences() }, ids[0], entry(ids[0], 0, { state: "no-key", apiDetected: false })), false);
assert.equal(api.providerVisible({ visibility: preferences({}, false) }, ids[0], entry(ids[0], 0, { state: "no-key", apiDetected: false })), true);
assert.equal(api.providerVisible({ visibility: preferences({ [ids[0]]: false }, false) }, ids[0], entry(ids[0])), false);
assert.equal(api.providerVisible({ visibility: preferences() }, ids[0], entry(ids[0], 0, { state: "error", apiDetected: true, errorCode: "subusage/auth" })), true);
assert.equal(api.providerVisible({ visibility: preferences() }, ids[0], entry(ids[0], 0, { state: "error", apiDetected: null, errorCode: "subusage/credentials" })), true);
let controlSnapshot = withPrefs(result(ids.map(id => entry(id, 20, { apiDetected: id !== ids[1], ...(id === ids[1] ? { state: "no-key" } : {}) }))), preferences({ [ids[3]]: false }));
const controlPatches = [], controlRefreshes = [];
const controlStore = { ...uiStore, getSnapshot: () => controlSnapshot, readAll: async () => controlSnapshot, refresh: async (ids) => { controlRefreshes.push(ids); return controlSnapshot; }, save: async patch => {
 controlPatches.push(patch); const old = controlSnapshot.settings.visibility, v = patch.visibility;
 controlSnapshot = withPrefs(result(controlSnapshot.entries, String(controlPatches.length + 1)), { hideWithoutApi: v.hideWithoutApi ?? old.hideWithoutApi, providers: { ...old.providers, ...v.providers } });
 return controlSnapshot;
} };
memory.set("dsh-subusage:last-provider", ids[0]);
const ch = new Hooks(), cp = { ...props, usageStore: controlStore };
tree = ch.render(api.SubusageSection, cp); tree = ch.render(api.SubusageSection, cp);
const management = tree.children.at(-1);
assert.equal(management.type, "details", "管理区为设置页末尾的折叠菜单");
assert.equal(management.props.id, "subusage-provider-management"); assert.notEqual(management.props.open, true, "默认折叠");
assert.equal(management.children[0].type, "summary"); assert.equal(management.children[0].children[0], "提供商管理");
assert.equal(nodes(tree).filter(n => n.props.role === "switch").length, ids.length + defaultOff.length + 1, "所有关闭/隐藏提供商保留管理开关");
assert.deepEqual(nodes(tree).filter(n => n.props.role === "tab").map(n => n.props.id), ids.filter(id => ![ids[1], ids[3]].includes(id)).map(id => `subusage-tab-${id}`));
assert(!nodes(tree).some(n => n.type === "select" || n.type === "option"));
nodes(tree).find(n => n.props["aria-label"] === "连接与凭据 Kimi").props.onClick({ preventDefault() {} }); tree = ch.render(api.SubusageSection, cp);
const kimiEditor = nodes(tree).find(n => n.props.id === `subusage-credentials-${ids[1]}`);
assert.equal(kimiEditor.props.open, true); assert(nodes(kimiEditor).some(n => n.props.role === "group"), "自动隐藏项可在本行编辑凭据");
assert(nodes(tree).some(n => n.props.role === "tabpanel" && n.props["aria-label"] === "Z.ai Coding (CN)"), "展开隐藏厂商不会切换上方用量");
assert(!nodes(nodes(tree).find(n => n.props.role === "tabpanel")).some(n => n.type === "fieldset" || n.type === "input"), "上方详情只展示用量");
assert(!nodes(tree).some(n => n.type === "button" && n.children.includes("配置")), "移除跨区域配置跳转按钮");
await nodes(tree).find(n => n.props["aria-label"] === "启用 MiniMax CN").props.onClick(); tree = ch.render(api.SubusageSection, cp);
assert.equal(controlPatches.at(-1).visibility.providers["minimax-cn"], false); assert.equal(controlPatches.at(-1).expectedRevision, "1");
assert(!nodes(tree).some(n => n.props.role === "tab" && n.props.id === "subusage-tab-minimax-cn"));
await nodes(tree).find(n => n.props["aria-label"] === "没有检测到API的默认隐藏").props.onClick(); tree = ch.render(api.SubusageSection, cp);
assert.equal(controlPatches.at(-1).visibility.hideWithoutApi, false); assert(nodes(tree).some(n => n.props.role === "tab" && n.props.id === `subusage-tab-${ids[1]}`));
await nodes(tree).find(n => n.props["aria-label"] === "启用 MiniMax CN").props.onClick(); tree = ch.render(api.SubusageSection, cp);
assert.equal(controlPatches.at(-1).visibility.providers["minimax-cn"], true); assert.deepEqual(JSON.parse(JSON.stringify(controlRefreshes.at(-1))), ["minimax-cn"], "手工重新开启立即刷新");
assert(nodes(tree).some(n => n.props.role === "tab" && n.props.id === "subusage-tab-minimax-cn"));
nodes(tree).find(n => n.type === "button" && n.children.includes("更换")).props.onClick(); tree = ch.render(api.SubusageSection, cp);
assert(nodes(tree).filter(n => n.props.role === "switch").every(n => n.props.disabled), "凭据脏草稿期间只锁定即时开关");
assert.equal(nodes(kimiEditor).find(n => n.type === "fieldset").props.disabled, false, "行内凭据不能被开关锁定误禁用");
const editedKey = nodes(tree).find(n => n.type === "input" && n.props.type === "password"); editedKey.props.onChange({ target: { value: "fixture-inline-draft" } }); tree = ch.render(api.SubusageSection, cp);
// 切到 MiniMax CN（国际版现为默认关闭，不可见）。
nodes(tree).find(n => n.props.id === "subusage-tab-minimax-cn").props.onClick(); tree = ch.render(api.SubusageSection, cp);
assert(nodes(tree).some(n => n.props.role === "tabpanel" && n.props["aria-label"] === "MiniMax (CN)"), "用量切换与编辑厂商独立");
assert.equal(nodes(tree).find(n => n.type === "input" && n.props.type === "password").props.value, "fixture-inline-draft", "切换用量不丢失行内草稿");
assert.equal(nodes(tree).find(n => n.props.id === `subusage-credentials-${ids[1]}`).props.open, true);
nodes(tree).find(n => n.props["aria-label"] === "连接与凭据 MiniMax").props.onClick({ preventDefault() {} }); tree = ch.render(api.SubusageSection, cp);
assert.equal(nodes(tree).find(n => n.props.id === `subusage-credentials-${ids[1]}`).props.open, true, "切换其他编辑器必须先保存或取消草稿");
const beforeToggle = controlPatches.length; await nodes(tree).find(n => n.props["aria-label"] === "启用 MiniMax").props.onClick(); assert.equal(controlPatches.length, beforeToggle);
ch.unmount();
controlSnapshot = withPrefs(result(controlSnapshot.entries), preferences(Object.fromEntries(ids.map(id => [id, false]))));
const emptyControls = new Hooks(); tree = emptyControls.render(api.SubusageSection, cp);
assert.equal(nodes(tree).filter(n => n.props.role === "tab").length, 0); assert.equal(nodes(tree).filter(n => n.props.role === "switch").length, ids.length + defaultOff.length + 1);
assert.equal(nodes(tree).find(n => n.props.id === "subusage-provider-management").props.open, true, "空状态展开配置入口");
assert(textOf(tree).includes("没有可显示的提供商")); assert(!nodes(tree).some(n => n.props.role === "tabpanel"));
nodes(tree).find(n => n.props["aria-label"] === "连接与凭据 Z.ai").props.onClick({ preventDefault() {} }); tree = emptyControls.render(api.SubusageSection, cp);
assert.equal(nodes(tree).find(n => n.props.id === `subusage-credentials-${ids[0]}`).props.open, true, "全部关闭仍能行内配置");
assert(!nodes(tree).some(n => n.props.role === "tabpanel"), "关闭项不会被配置操作强制带回用量区"); emptyControls.unmount();
// 共享 store：关闭时暂停轮询请求和药丸；隐藏开关立即影响现有订阅，不能让迟到旧响应回滚。
let sharedControl = withPrefs(result(ids.map(id => entry(id, 20, { apiDetected: id !== ids[1], ...(id === ids[1] ? { state: "no-key" } : {}) }))));
const storeCalls = [], oldControlGate = deferred(); let blockRefresh = false;
const managedStore = api.createUsageStore((method, patch) => {
 storeCalls.push({ method, patch });
 if (method === "save") { const old = sharedControl.settings.visibility; sharedControl = withPrefs(result(sharedControl.entries, "controls-2"), { hideWithoutApi: patch.visibility.hideWithoutApi ?? old.hideWithoutApi, providers: { ...old.providers, ...patch.visibility.providers } }); return { ...sharedControl, entries: [] }; }
 return method === "refresh" && blockRefresh ? oldControlGate.promise : sharedControl;
});
await managedStore.readAll(); assert.equal((await managedStore.reader(ids[1])()).visible, false);
let observed; const offObserve = managedStore.reader(ids[0]).subscribe(e => observed = e);
blockRefresh = true; const lateControl = managedStore.refresh([ids[0]], true); await flush();
await managedStore.save({ expectedRevision: "1", visibility: { providers: { [ids[0]]: false }, hideWithoutApi: false } });
assert.equal(observed.visible, false); assert.equal(managedStore.getSnapshot().entries.find(e => e.providerId === ids[2]).windows[0].percent, 20, "全局可见性保存保留其他厂商用量");
const closedCalls = storeCalls.length; await managedStore.refresh([ids[0]], true); assert.equal(storeCalls.length, closedCalls, "关闭后客户端不发用量 RPC");
assert.equal((await managedStore.reader(ids[0])()).visible, false);
oldControlGate.resolve(withPrefs(result([entry(ids[0], 99)], "old-controls"))); await lateControl;
assert.equal(managedStore.getSnapshot().settings.visibility.providers[ids[0]], false); assert.equal(managedStore.getSnapshot().settings.revision, "controls-2");
blockRefresh = false; assert.equal((await managedStore.reader(ids[1])()).visible, true, "关闭默认隐藏后缺 API 的配置指引恢复");
offObserve(); managedStore.dispose();
// First read fails: the visible toolbar retries initialization, rather than leaving switches locked.
let initCalls = 0, retryAllowed = false, retrySnapshot = { settings: null, configured: {}, entries: [] };
const retryStore = { subscribe: () => () => {}, getSnapshot: () => retrySnapshot, activate: () => () => {}, refresh: async () => retrySnapshot, readAll: async () => { initCalls++; if (!retryAllowed) throw new Error("fixture initial read failed"); return retrySnapshot = result([entry(ids[0])]); } };
const retryHooks = new Hooks();
tree = retryHooks.render(api.SubusageSection, { ...props, usageStore: retryStore }); await flush();
tree = retryHooks.render(api.SubusageSection, { ...props, usageStore: retryStore });
assert(nodes(tree).some(n => n.props.role === "alert" && n.children.includes("fixture initial read failed")));
retryAllowed = true; const beforeRetry = initCalls;
await nodes(tree).find(n => n.type === "button" && n.children.includes("刷新全部")).props.onClick();
tree = retryHooks.render(api.SubusageSection, { ...props, usageStore: retryStore }, false);
assert.equal(retrySnapshot.settings.revision, "1");
assert.equal(initCalls, beforeRetry + 1);
assert(!nodes(tree).some(n => n.props.role === "alert")); retryHooks.unmount();
// New providers stay off even with missing visibility fields from an older settings snapshot.
for (const id of ["zai-coding", "synthetic", "nanogpt"]) assert.equal(api.providerVisible(publicSettings(), id, entry(id)), false);
console.log("PASS provider management switches/no-dropdown/filtering/persistence payloads/dirty guard/pill subscription/race + existing client behavior");
