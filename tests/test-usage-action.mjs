// 用量面板里的内联行动条：判定什么时候该出现「去修凭据 / 重新登录」。
// 原则：只在真正需要用户处理时出现——缺凭据、凭据被拒、Cookie 已过期或临近到期；
// 正常倒计时（还有几小时）不算事件，不该打扰。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

let spec;
const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { usageActionKind }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
const kind = spec.factory((name) => { assert.equal(name, "react"); return react; }).__test.usageActionKind;
const t = (key) => key;
// cookieExpiry 用真实 Date.now() 判定，所以基准也必须取当前时刻。
const now = Date.now();
const mimo = (patch) => ({ providerId: "xiaomi-token-plan-cn", state: "ok", windows: [], extras: [], ...patch });

// 非 MiMo：缺 Key 或凭据被拒 → 直接给该厂商的凭据编辑器入口。
assert.equal(kind({ providerId: "openrouter", state: "no-key", windows: [], extras: [] }, "openrouter", t), "credentials");
assert.equal(kind({ providerId: "openrouter", state: "error", errorCode: "subusage/auth", windows: [], extras: [] }, "openrouter", t), "credentials");
assert.equal(kind({ providerId: "deepseek", state: "ok", windows: [], extras: [] }, "deepseek", t), null, "正常状态不打扰");
assert.equal(kind({ providerId: "deepseek", state: "disabled", windows: [], extras: [] }, "deepseek", t), null, "关闭的条目不给行动");
assert.equal(kind({ providerId: "deepseek", state: "loading", windows: [], extras: [] }, "deepseek", t), null, "加载中不给行动");
assert.equal(kind(null, "deepseek", t), null);

// MiMo：Cookie 未配置 / 被拒 → 登录；已过期 → 重新登录。
assert.equal(kind(mimo({ state: "no-cookie" }), "xiaomi-token-plan-cn", t), "mimo-login");
assert.equal(kind(mimo({ state: "error", errorCode: "subusage/auth" }), "xiaomi-token-plan-cn", t), "mimo-login");
assert.equal(kind(mimo({ cookieExpiresAt: new Date(now - 60000).toISOString() }), "xiaomi-token-plan-cn", t), "mimo-relogin", "已过期优先提示重新登录");
// 临近到期（≤2 小时）才算事件；还有几小时的正常倒计时不打扰。
assert.equal(kind(mimo({ cookieExpiresAt: new Date(now + 10 * 60 * 1000).toISOString() }), "xiaomi-token-plan-cn", t), "mimo-login", "30 分钟内有提醒");
assert.equal(kind(mimo({ cookieExpiresAt: new Date(now + 60 * 60 * 1000).toISOString() }), "xiaomi-token-plan-cn", t), "mimo-login", "2 小时内有提醒");
assert.equal(kind(mimo({ cookieExpiresAt: new Date(now + 5 * 60 * 60 * 1000).toISOString() }), "xiaomi-token-plan-cn", t), null, "还有 5 小时不打扰");
assert.equal(kind(mimo({ cookieExpiresAt: "not-a-date" }), "xiaomi-token-plan-cn", t), null, "计时不可解析时不编造提醒");
assert.equal(kind(mimo({}), "xiaomi-token-plan-cn", t), null, "无计时记录且读取正常时不打扰");

console.log("行动条判定：缺凭据 / 凭据被拒 / Cookie 过期与临近到期 / 正常状态不打扰 —— 全部通过 ✅");
