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
  useState: (initial) => [stateIndex < stateValues.length ? stateValues[stateIndex++] : (stateIndex++, initial), () => {}],
  useRef: (value) => ({ current: value }),
  useEffect: () => {}
};
const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
vm.runInNewContext(code, {
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
for (const provider of ["openai-codex", null, "kimi-coding", "zai-coding-cn", "opencode-go", null, "xiaomi-token-plan-cn"]) {
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
console.log("PASS Hook 路径、reader 稳定性、空额度与弹层、正常/限额/加载/失败状态");
