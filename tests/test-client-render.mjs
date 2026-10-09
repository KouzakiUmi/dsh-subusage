// 渲染路径回归：执行真实 client 工厂，React/DOM 打桩，不调用网络。
// 检查 Hook 顺序、reader 稳定性及空额度/失败/正常窗口渲染。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

let spec, component;
let hooks = [], memo, stateValues = [], stateIndex = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: "fragment",
  useSyncExternalStore: (_subscribe, getSnapshot) => {
    hooks.push("useSyncExternalStore");
    return getSnapshot();
  },
  useMemo: (factory, deps) => {
    hooks.push("useMemo");
    if (!memo || deps.some((dep, i) => !Object.is(dep, memo.deps[i]))) {
      memo = { deps, value: factory() };
    }
    return memo.value;
  },
  useState: (initial) => [stateIndex < stateValues.length ? stateValues[stateIndex++] : (stateIndex++, typeof initial === "function" ? initial() : initial), () => {}],
  useRef: (value) => ({ current: value }),
  useEffect: () => {}
};
const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { SubusageSection, UsageWindowRow, PROVIDER_ORDER, PROVIDER_META }; exports.apply = apply;"), {
  window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console
});
const plugin = spec.factory((name) => {
  assert.equal(name, "react");
  return react;
});
const ctx = {
  effect() {},
  locale: { bind: () => (key) => key, getLocale: () => ({ active: "zh" }) },
  remote: { $mount: () => Promise.resolve(() => {}) },
  slots: {
    inject: (_name, factory) => factory(),
    register: (options, value) => {
      if (options.id === "subusage-usage") component = value;
      return () => {};
    }
  },
  inject: (_names, callback) => callback(ctx)
};
plugin.apply(ctx);
assert.equal(typeof component, "function");
let readerCalls = 0;
const readEntry = (provider) => { readerCalls++; return async () => ({ provider }); };
const renderWrapper = (provider) => {
  hooks = [];
  return component({
    store: { subscribe: () => () => {}, getSnapshot: () => ({ current: provider ? { provider } : null }) },
    readEntry, t: (key) => key, getLocale: () => "zh"
  });
};
const first = renderWrapper("xiaomi-token-plan-cn");
const second = renderWrapper("xiaomi-token-plan-cn");
assert.equal(first.props.readEntry, second.props.readEntry);
assert.equal(readerCalls, 1, "相同 provider 不得重建 reader");
for (const provider of ["vrtx-gemini", null, "kimi-coding", "zai-coding-cn", "opencode-go", "commandcode", "xai-oauth", "minimax", "minimax-cn", null, "xiaomi-token-plan-cn", "openai-codex"]) {
  const before = readerCalls;
  const element = renderWrapper(provider);
  assert.deepEqual(hooks, ["useSyncExternalStore", "useMemo"], `Hook 顺序必须稳定: ${provider}`);
  // vrtx-gemini 是本机存在但本插件不覆盖的路由：不支持的模型不得创建 reader。
  if (!provider || provider === "vrtx-gemini") {
    assert.equal(element, null);
    assert.equal(readerCalls, before, "不支持的模型不得创建 reader");
  } else assert.ok(element);
}
const pill = renderWrapper("xiaomi-token-plan-cn");
function renderPill(entry, open = false, failed = null, failState) {
  stateValues = [entry ? { entry, updatedAt: 0 } : null, failed, failState, false, open];
  stateIndex = 0;
  return pill.type(pill.props);
}
const empty = { state: "ok", windows: [], extras: [{ kind: "balance", value: "10 CNY" }] };
for (const open of [false, true]) {
  const tree = renderPill(empty, open);
  // 无额度窗口但有余额时药丸显示余额（余额型 provider 只有这一条信息，比「暂无额度数据」有用）。
  assert.ok(JSON.stringify(tree).includes("balanceLabel"), "无窗口时药丸显示余额");
  if (open) assert.ok(JSON.stringify(tree).includes("10 CNY"), "仍保留余额详情");
}
// 既无窗口也无余额（或只有套餐名）时才回落到明确占位。
assert.ok(JSON.stringify(renderPill({ state: "ok", windows: [], extras: [] })).includes("noUsageData"), "空额度必须显示明确占位");
assert.ok(JSON.stringify(renderPill({ state: "ok", windows: [], extras: [{ kind: "plan", value: "Pro" }] })).includes("noUsageData"), "只有套餐名也要占位");
const normal = { state: "ok", windows: [{ kind: "sub", percent: 25, status: "ok" }], extras: [] };
assert.ok(JSON.stringify(renderPill(normal)).includes("pillRemaining"));
assert.equal(renderPill({ ...normal, visible: false }), null, "隐藏药丸不渲染额度或提示");
assert.equal(renderPill({ ...normal, state: "disabled" }), null, "关闭提供商后药丸隐藏");
const limited = { ...normal, windows: [{ kind: "sub", percent: 100, status: "rate-limited" }] };
assert.ok(JSON.stringify(renderPill(limited)).includes("pillLimited"));
assert.ok(JSON.stringify(renderPill(null)).includes("loading"));
assert.ok(JSON.stringify(renderPill(null, true, "fetch failed", "error")).includes("statusError"));
function visibleText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  return (node.children || []).map(visibleText).join(' ');
}
const firstError = renderPill(null, true, 'fetch failed', 'error');
assert.ok(!visibleText(firstError).includes('loading'), '首次失败弹层不能继续显示加载提示');
const noKey = { ...normal, state: 'no-key', errorCode: 'subusage/no-key', retainPrevious: false, freshness: 'unknown' };
const missingKeyTree = renderPill(noKey, true, 'missing key', 'no-key');
assert.ok(!visibleText(missingKeyTree).includes('pillRemaining'), '删除凭据后不能渲染旧额度');
assert.ok(visibleText(missingKeyTree).includes('pillNeedKey'), '删除凭据后必须展示配置指引');
const stale = { ...normal, state: 'error', retainPrevious: true, freshness: 'stale', lastSuccessAt: new Date(0).toISOString(), errorCode: 'subusage/network' };
assert.ok(visibleText(renderPill(stale, true, 'temporary network failure', 'error')).includes('cacheAge'), '允许保留的网络错误必须标注缓存年龄');
assert.ok(!visibleText(renderPill({ ...stale, retainPrevious: false }, true, 'failed', 'error')).includes('pillRemaining'), '无保留许可不得展示旧额度');
assert.ok(!visibleText(renderPill({ ...stale, errorCode: 'subusage/auth' }, true, 'expired', 'error')).includes('pillRemaining'), '认证失效不得展示旧额度');
assert.ok(visibleText(renderPill({ ...empty, coverage: 'partial' })).includes('statusPartial'), '仅余额成功必须明确数据不完整、额度未知');
const monthlyEntry = { state: "ok", coverage: "complete", windows: [{ kind: "month", percent: 20.2, status: "ok", detail: { used: 14.14, limit: 70, remaining: 55.86, unit: "credits", limitSource: "plan-snapshot" } }], extras: [{ kind: "monthly-balance", value: "55.86 credits" }] };
assert.ok(visibleText(renderPill(monthlyEntry, true)).includes("monthlyBalanceLabel"));
assert.ok(visibleText(renderPill(monthlyEntry, true)).includes("55.86 credits"));
const monthlyRow = plugin.__test.UsageWindowRow({ w: monthlyEntry.windows[0], t: k => k === "detailUsed" ? "{used}/{limit} {unit}" : k, getLocale: () => "zh" });
assert.ok(visibleText(monthlyRow).includes("wmonth"));
assert.ok(visibleText(monthlyRow).includes("14.14/70 credits"));
assert.ok(visibleText(monthlyRow).includes("planSnapshotLimit"));
// 按钮导航、提供商开关、套餐单选按钮；整个设置页不使用 select/option。
const flattenNodes = (node) => Array.isArray(node) ? node.flatMap(flattenNodes) : node && typeof node === "object" ? [node, ...flattenNodes(node.children || [])] : [];
const settings = { revision: "public-1", zai: { type: 1 }, hasKeys: { "zai-coding-cn": true }, keyModes: {}, xiaomi: { hasCookie: true } };
const usageStore = { subscribe: () => () => {}, getSnapshot: () => ({ settings, configured: {}, entries: [] }) };
for (const provider of ["zai-coding-cn", "xiaomi-token-plan-cn", "commandcode", "xai-oauth"]) {
  stateValues = [provider]; stateIndex = 0;
  const section = plugin.__test.SubusageSection({ usageStore, t: (key) => key, getLocale: () => "zh" });
  const all = flattenNodes(section), selects = all.filter((n) => n.type === "select");
  assert.equal(selects.length, 0, "设置页不使用任何下拉列表");
  // 30 家 provider 的开关 + 1 个「没有检测到 API 的默认隐藏」开关；新增厂商时同步此数。
  assert.equal(all.filter(n => n.props?.role === "switch").length, 31, "提供商与默认隐藏开关均可见");
  if (provider === "xiaomi-token-plan-cn") {
    assert.ok(visibleText(section).includes("登录并自动导入")); assert.ok(visibleText(section).includes("手动导入"));
    assert.ok(visibleText(section).includes("不会自动导入")); assert.ok(visibleText(section).includes("清除登录凭据"));
  } else if (provider === "commandcode") {
    assert.ok(visibleText(section).includes("commandcodeManaged"), "Command Code 只读说明");
    assert.equal(all.filter((n) => typeof n.props?.["aria-pressed"] === "boolean").length, 0, "Command Code 无凭据编辑按钮");
  } else if (provider === "xai-oauth") {
    assert.ok(visibleText(section).includes("grokManaged"), "SuperGrok 只读说明");
    assert.ok(!visibleText(section).includes("继承变量："), "SuperGrok 无继承变量");
    assert.equal(all.filter((n) => typeof n.props?.["aria-pressed"] === "boolean").length, 0, "SuperGrok 无凭据编辑按钮");
  } else assert.equal(all.filter((n) => typeof n.props?.["aria-pressed"] === "boolean").length, 2);
}

// 用量面板内联行动条：MiMo Cookie 失效时，修复入口就在当前卡片上（不必去下面的管理区找）。
{
  const mimoEntry = { providerId: "xiaomi-token-plan-cn", label: "MiMo", state: "no-cookie", windows: [], extras: [], coverage: "partial", freshness: "unknown", lastAttemptAt: "2026-10-09T00:00:00.000Z" };
  // 只让 MiMo 可见，否则用量面板会落到第一家可见 provider 上。
  const providers = Object.fromEntries(plugin.__test.PROVIDER_ORDER.map(id => [id, id === "xiaomi-token-plan-cn"]));
  const settings = { revision: "r", zai: { type: 1 }, hasKeys: {}, keyModes: {}, xiaomi: { hasCookie: false }, visibility: { hideWithoutApi: false, providers } };
  const sectionFor = (entry) => {
    stateValues = ["xiaomi-token-plan-cn"]; stateIndex = 0;
    return plugin.__test.SubusageSection({ usageStore: { subscribe: () => () => {}, getSnapshot: () => ({ settings, configured: {}, entries: [entry] }) }, t: (key) => key, getLocale: () => "zh" });
  };
  const section = sectionFor(mimoEntry), txt = visibleText(section);
  assert.ok(txt.includes("需要登录 MiMo"), "面板内给出行动提示");
  assert.ok(txt.includes("登录并自动导入"), "面板内直接给登录按钮");
  assert.ok(txt.includes("手动填写"), "保留手动入口");
  assert.ok(flattenNodes(section).some(n => n.props?.["aria-label"] === "建议操作"), "行动条带无障碍名");
  // 正常状态不得出现行动条，否则就是噪音。
  assert.ok(!visibleText(sectionFor({ ...mimoEntry, state: "ok" })).includes("需要登录 MiMo"), "正常状态不打扰");
}
// 待处理项排到前面 + 顶部计数变跳转入口。
{
  const order = plugin.__test.PROVIDER_ORDER;
  const providers = Object.fromEntries(order.map(id => [id, true]));
  const settings = { revision: "r", zai: { type: 1 }, hasKeys: {}, keyModes: {}, xiaomi: { hasCookie: true }, visibility: { hideWithoutApi: false, providers } };
  const broken = order.at(-1);
  const entries = order.map(id => ({ providerId: id, state: id === broken ? "error" : "ok", windows: [], extras: [], coverage: "complete", freshness: "fresh", lastAttemptAt: "2026-10-09T00:00:00.000Z" }));
  stateValues = []; stateIndex = 0;
  const section = plugin.__test.SubusageSection({ usageStore: { subscribe: () => () => {}, getSnapshot: () => ({ settings, configured: {}, entries }) }, t: (key) => key, getLocale: () => "zh" });
  const tabs = flattenNodes(section).filter(n => n.props?.role === "tab");
  assert.equal(tabs.length, order.length, "所有可见 provider 都还在");
  assert.equal(tabs[0].props.id, `subusage-tab-${broken}`, "出错的那家排到最前");
  const restIds = tabs.slice(1).map(n => n.props.id);
  assert.equal(restIds.length, order.length - 1, `其余 provider 数量：${restIds.length} vs ${order.length - 1}`);
  // order 来自 vm realm：跨 realm 数组不能直接 deepEqual，统一用 JSON 比较。
  assert.equal(JSON.stringify(restIds), JSON.stringify(order.slice(0, -1).map(id => `subusage-tab-${id}`)), "其余保持登记顺序，组内不抖动");
  // 顶部计数可点击，直达第一家待处理的。
  const counter = flattenNodes(section).find(n => n.type === "button" && JSON.stringify(n.children).includes("家数据获取成功"));
  assert.ok(counter, "顶部计数是可点击按钮");
  assert.equal(counter.props.disabled, false, "有待处理项时可点");
  assert.ok(counter.props["aria-label"].includes(plugin.__test.PROVIDER_META[broken].short), "无障碍名说明会跳到哪家");
  // 全部正常时按钮禁用，不做无意义的跳转。
  stateValues = []; stateIndex = 0;
  const healthy = plugin.__test.SubusageSection({ usageStore: { subscribe: () => () => {}, getSnapshot: () => ({ settings, configured: {}, entries: entries.map(e => ({ ...e, state: "ok" })) }) }, t: (key) => key, getLocale: () => "zh" });
  const healthyCounter = flattenNodes(healthy).find(n => n.type === "button" && JSON.stringify(n.children).includes("家数据获取成功"));
  assert.equal(healthyCounter.props.disabled, true, "全部正常时不可点");
  assert.equal(JSON.stringify(flattenNodes(healthy).filter(n => n.props?.role === "tab").map(n => n.props.id)), JSON.stringify(order.map(id => `subusage-tab-${id}`)), "没有待处理项时保持登记顺序");}
console.log("PASS Hook/reader稳定性、空额度/缓存/失败、凭据按钮/提供商开关/无下拉布局、用量面板内联行动条、待处理排序与计数跳转");
