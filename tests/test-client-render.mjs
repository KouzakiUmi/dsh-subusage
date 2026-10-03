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
vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { SubusageSection, UsageWindowRow }; exports.apply = apply;"), {
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
for (const provider of ["openai-codex", null, "kimi-coding", "zai-coding-cn", "opencode-go", "commandcode", null, "xiaomi-token-plan-cn"]) {
  const before = readerCalls;
  const element = renderWrapper(provider);
  assert.deepEqual(hooks, ["useSyncExternalStore", "useMemo"], `Hook 顺序必须稳定: ${provider}`);
  if (!provider || provider === "openai-codex") {
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
  assert.ok(JSON.stringify(tree).includes("noUsageData"), "空额度必须显示明确占位");
  if (open) assert.ok(JSON.stringify(tree).includes("10 CNY"), "仍保留余额详情");
}
const normal = { state: "ok", windows: [{ kind: "sub", percent: 25, status: "ok" }], extras: [] };
assert.ok(JSON.stringify(renderPill(normal)).includes("pillRemaining"));
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
// 原生菜单保留键盘导航，所有option随系统主题成对着色；敏感动作不再使用select。
const flattenNodes = (node) => Array.isArray(node) ? node.flatMap(flattenNodes) : node && typeof node === "object" ? [node, ...flattenNodes(node.children || [])] : [];
const settings = { revision: "public-1", zai: { type: 1 }, hasKeys: { "zai-coding-cn": true }, keyModes: {}, xiaomi: { hasCookie: true } };
const usageStore = { subscribe: () => () => {}, getSnapshot: () => ({ settings, configured: {}, entries: [] }) };
for (const provider of ["zai-coding-cn", "xiaomi-token-plan-cn", "commandcode"]) {
  stateValues = [provider]; stateIndex = 0;
  const section = plugin.__test.SubusageSection({ usageStore, t: (key) => key, getLocale: () => "zh" });
  const all = flattenNodes(section), selects = all.filter((n) => n.type === "select");
  assert.ok(selects.every((n) => !["keep", "replace", "clear", "inherit", "manual"].includes(n.props.value)));
  assert.ok(selects.every((n) => n.props.style.colorScheme === "light dark"));
  for (const option of all.filter((n) => n.type === "option")) {
    assert.equal(option.props.style.color, "CanvasText"); assert.equal(option.props.style.backgroundColor, "Canvas");
  }
  if (provider === "xiaomi-token-plan-cn") {
    assert.ok(visibleText(section).includes("登录并自动导入")); assert.ok(visibleText(section).includes("手动导入"));
    assert.ok(visibleText(section).includes("不会自动导入")); assert.ok(visibleText(section).includes("清除登录凭据"));
  } else if (provider === "commandcode") {
    assert.ok(visibleText(section).includes("commandcodeManaged"), "Command Code 只读说明");
    assert.equal(all.filter((n) => typeof n.props?.["aria-pressed"] === "boolean").length, 0, "Command Code 无凭据编辑按钮");
  } else assert.equal(all.filter((n) => typeof n.props?.["aria-pressed"] === "boolean").length, 2);
}
console.log("PASS Hook/reader稳定性、空额度/缓存/失败、凭据按钮与主题原生option");
