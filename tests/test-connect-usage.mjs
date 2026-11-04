import test from "node:test";
import assert from "node:assert/strict";
import { ConnectUsageReader, normalizeWorkBuddy, accountMetadata } from "../lib/connect-usage.js";

// 契约依据：Trae 4.6.12 lib/index.js accountStateOf11331-11348 / toCheckin8639-8645；
 // WorkBuddy5.17.0 lib/index.js toCredits10308-10320 把内部 refreshAtMs 映射为 HTTP cycleRefreshMs，
// account-credits10410-10425失败省略credits；Web类型3750-3770与selectionExplicit3972-3975。
// 两插件 pool.accounts 以 accountId 标识账号（Trae8947/WB10645）；WB host-heartbeat6401 SOON_MS为30天。
const NOW = Date.parse("2026-11-02T12:00:00Z");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const credit = (total = 60) => ({ total, expiringSoon: 5, nearestExpiryMs: NOW + 86400000, packages: [{ packageName: "月度套餐", remain: 40, size: 100, monthly: true, cycleRefreshMs: NOW + 10000 }, { packageName: "奖励", remain: 20, size: 20, monthly: false, expiresAtMs: NOW + 86400000 }] });
const signed = (extra = {}) => ({ status: "signed-in", accountId: "a", accountName: "alice@example.test", tokenExpiresAtMs: NOW + 100000, accounts: [{ id: "a", accountName: "alice@example.test", selected: true, tokenExpiresAtMs: NOW + 100000 }], ...extra });
const allRows = [{ id: "a", accountName: "same", selected: true, tokenExpiresAtMs: NOW + 1000 }, { id: "b", accountName: "same", selected: false, tokenExpiresAtMs: NOW - 1000 }, { id: "c", accountName: "third" }];

test("Trae CN 按 ID 读取不同账号，200 空对象和抛错均只损坏自身", async () => {
 const calls = [];
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (plugin, endpoint, query) => {
  calls.push([plugin, endpoint, query]);
  if (endpoint === "usage") return signed({ accounts: [...allRows, { id: "d", accountName: "fourth" }], credits: { total: 1000, available: 900 } });
  if (query.accountId === "a") return { id: "a", credits: { total: 100, consumed: 70, available: 30, workAvailable: 20, generalAvailable: 10, accounts: [{ remain: 30, size: 100, displayDesc: "包", token: "secret" }] } };
  if (query.accountId === "b") return { id: "b", credits: { total: 200, available: 120 } };
  if (query.accountId === "c") return { id: "c" };
  throw new Error("secret upstream token=should-not-escape");
 } });
 const result = await reader.readTrae("cn");
 assert.deepEqual(result.accountReadings.map(row => row.credits?.available), [30, 120, undefined, undefined]);
 assert.equal(result.accountReadings[2].error, result.accountReadings[3].error);
 assert.equal(calls.filter(row => row[1] === "account-status").length, 4);
 assert.deepEqual(calls[1][2], { region: "cn", accountId: "a" });
 assert.ok(!JSON.stringify(result).includes("secret"));
 assert.deepEqual(result.accountReadings.slice(0, 2).map(row => [row.id, row.accountName]), [["a", "same"], ["b", "same"]]);
});

test("Trae AI 独立套餐、false 有效字段、错配 ID 与缺席 payStatus", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint, { accountId }) => endpoint === "usage" ? signed({ accounts: allRows }) : accountId === "a" ? { id: "a", payStatus: { payIdentityStr: "Pro", hasPackage: true } } : accountId === "b" ? { id: "b", payStatus: { hasPackage: false, inTrial: false } } : { id: "other", payStatus: { payIdentityStr: "wrong" } } });
 const result = await reader.readTrae("ai");
 assert.equal(result.accountReadings[0].payStatus.payIdentityStr, "Pro");
 assert.equal(result.accountReadings[1].payStatus.hasPackage, false);
 assert.equal(result.accountReadings[2].payStatus, undefined);
 assert.ok(result.accountReadings[2].error);
});

test("Trae 企业账号绝不读取或保留个人积分", async () => {
 const calls = [];
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => {
  calls.push(endpoint);
  return signed({ accounts: allRows.map(row => ({ ...row, enterprise: true })), credits: { total: 100, available: 99 }, payStatus: { hasPackage: true } });
 } });
 const result = await reader.readTrae("enterprise");
 assert.deepEqual(calls, ["usage"]);
 assert.equal(result.credits, undefined);
 assert.equal(result.payStatus, undefined);
 assert.ok(result.accountReadings.every(row => row.creditsUnavailable === "enterprise" && row.credits === undefined && !row.error));
});

test("空账号索引保留当前账号单份读数；Trae 单账号复用 full usage", async () => {
 let count = 0;
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => { assert.equal(endpoint, "usage"); count++; return signed({ accounts: [], credits: { available: 0 } }); } });
 const result = await reader.readTrae("cn");
 assert.equal(count, 1);
 assert.equal(result.accountReadings[0].id, "a");
 assert.equal(result.accountReadings[0].credits.available, 0);
 assert.equal(result.accountReadings[0].accountName, "a***@example.test");
 assert.equal(result.accountReadings[0].tokenExpiresAtMs, NOW + 100000);
});

test("WB 顶层完整包按 accountId 匹配，active 独立按 pool.current；排除原因不改余额", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => endpoint === "usage" ? signed({ accounts: allRows, credits: credit(), pool: { enabled: true, accounts: [{ accountId: "a", current: false }, { accountId: "b", current: true }] } }) : { accounts: [{ id: "a", credits: 999 }, { id: "b", credits: 125, excludedBy: "cooldown" }, { id: "c", excludedBy: "exhausted" }] } });
 const result = await reader.readWorkBuddy("cn");
 assert.equal(result.accountReadings[0].credits.total, 60);
 assert.equal(result.accountReadings[1].credits, 125);
 assert.equal(result.accountReadings[2].credits, undefined);
 assert.ok(result.accountReadings[2].error);
 const entry = normalizeWorkBuddy(result, "workbuddy", NOW);
 assert.deepEqual(entry.windows, []);
 assert.deepEqual(entry.extras, []);
 assert.equal(entry.state, "ok");
 assert.equal(entry.coverage, "partial");
 assert.equal(entry.lastSuccessAt, new Date(NOW).toISOString());
 const [a, b, c] = entry.linkedAccounts;
 assert.equal(a.accountActive, false);
 assert.equal(b.accountActive, true);
 assert.equal(a.accountMode, "auto");
 assert.equal(a.windows[0].percent, 60);
 assert.equal(a.windows[0].resetsAt, new Date(NOW + 10000).toISOString());
 assert.equal(a.windows.length, 1, "一次性包到期不生成窗口");
 assert.equal(a.coverage, "complete");
 assert.equal(b.extras[0].value, "125 credits");
  assert.equal(b.coverage, "complete", "批量接口已给出该账号余额，缺少可选积分包不等于额度不完整");
  assert(b.extras.some(row => row.kind === "note" && row.value.includes("未提供积分包明细")), "缺少的明细须如实说明");
 assert.deepEqual(b.windows, []);
 assert.equal(c.state, "error");
 assert.equal(c.lastSuccessAt, undefined);
 assert.equal(c.freshness, "unknown");
 assert.equal(a.authStatus, "present");
 assert.equal(b.authStatus, "expired");
});

test("WB account-credits 整体失败仍保留总览账号的成功包", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => { if (endpoint === "usage") return signed({ accounts: allRows, credits: credit(45) }); throw new Error("private-token"); } });
 const result = await reader.readWorkBuddy("global");
 assert.equal(result.accountReadings[0].credits.total, 45);
 assert.ok(result.accountReadings.slice(1).every(row => row.error && row.credits === undefined));
 assert.ok(!JSON.stringify(result).includes("private-token"));
});

test("WB full usage 不含 credits 时可保留独立总余额，缺值不补零", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => endpoint === "usage" ? signed({ accounts: allRows }) : { accounts: [{ id: "a", credits: 0 }, { id: "b", credits: 41 }, { id: "c" }] } });
 const result = await reader.readWorkBuddy("cn");
 assert.deepEqual(result.accountReadings.map(row => row.credits), [0, 41, undefined]);
 const entry = normalizeWorkBuddy(result, "workbuddy", NOW);
 assert.equal(entry.linkedAccounts[0].state, "ok");
 assert.equal(entry.linkedAccounts[0].extras[0].value, "0 credits");
 assert.equal(entry.linkedAccounts[2].state, "error");
});

test("WB 单账号在顶层保留窗口；仅包到期不是重置", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async () => signed({ credits: credit(), pool: { enabled: false, accounts: [] }, selectionExplicit: true }) });
 const snapshot = await reader.readWorkBuddy("cn");
 const entry = normalizeWorkBuddy(snapshot, "workbuddy", NOW);
 assert.equal(entry.linkedAccounts.length, 1);
 assert.equal(entry.windows.length, 1);
 assert.deepEqual(entry.windows, entry.linkedAccounts[0].windows);
 assert.equal(entry.accountMode, "fixed");
 assert.equal(entry.accountActive, true);
 assert.equal(entry.account, "a***@example.test");
 assert.equal(entry.authExpiresAt, new Date(NOW + 100000).toISOString());
 assert.equal(entry.coverage, "complete");
 assert.equal(entry.freshness, "fresh");
 assert.equal(normalizeWorkBuddy(snapshot, "workbuddy", NOW + 180001).freshness, "stale");
});

test("账号模式与认证只根据已证实元数据；未知不伪造当前账号", () => {
 const row = { id: "a", accountName: "alice@example.test", source: "desktop", selected: true, token: "secret" };
 assert.deepEqual(accountMetadata(row, {}, NOW), { accountId: "a", account: "a***@example.test", authStatus: "unknown" });
 assert.equal(accountMetadata({ ...row, tokenExpiresAtMs: 0 }, {}, NOW).authStatus, "unknown");
 assert.equal(accountMetadata({ ...row, tokenExpiresAtMs: NOW }, {}, NOW).authStatus, "expired");
 assert.equal(accountMetadata(row, { accountId: "a", pool: { enabled: false }, selectionExplicit: false }, NOW).accountMode, undefined);
 assert.equal(accountMetadata(row, { accountId: "a", selectionExplicit: true }, NOW).accountMode, undefined);
 assert.equal(accountMetadata(row, { pool: { enabled: true, accounts: [{ id: "b", current: true }] } }, NOW).accountActive, false);
 assert.equal(accountMetadata(row, { pool: { enabled: true, accounts: [{ id: "a", current: true }, { id: "b", current: true }] } }, NOW).accountActive, undefined);
 assert.equal(accountMetadata(row, { pool: { enabled: true, accounts: [{ id: "a", selected: true }] } }, NOW).accountActive, undefined);
});

test("只拣额度和账号白名单，不泄露 token、ref、原始错误、诊断和邮箱", async () => {
 const secret = "SHOULD_NEVER_LEAK";
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async () => signed({ token: secret, accessToken: secret, credentialRef: secret, rawChat: secret, creditsError: secret, models: [{ token: secret }], accounts: [{ id: "a", accountName: "alice@example.test", source: secret, token: secret, credentialRef: secret }], pool: { enabled: false, token: secret, accounts: [{ accountId: "a", current: true, credential: secret }] }, credits: { ...credit(), token: secret, packages: [{ packageName: "奖励", remain: 10, size: 10, monthly: false, token: secret, ref: secret }] } }) });
 const result = await reader.readWorkBuddy("cn");
 const serialized = JSON.stringify([result, normalizeWorkBuddy(result, "workbuddy", NOW)]);
 assert.ok(!serialized.includes(secret));
 assert.ok(!serialized.includes("alice@example.test"));
 assert.ok(serialized.includes("a***@example.test"));
});

test("每实例、plugin 和 region 独立 60s 缓存，force 真正重读", async () => {
 let time = NOW;
 const calls = [];
 const readJson = async (plugin, endpoint, query) => { calls.push([plugin, endpoint, query.region]); return signed({ credits: plugin === "trae" ? { available: calls.length } : credit(calls.length) }); };
 const reader = new ConnectUsageReader({ now: () => time, readJson });
 const first = await reader.readWorkBuddy("cn");
 first.accountReadings[0].credits.total = 999;
 assert.equal((await reader.readWorkBuddy("cn")).accountReadings[0].credits.total, 1);
 await reader.readWorkBuddy("global");
 await reader.readTrae("cn");
 assert.equal(calls.length, 3);
 time += 59999;
 await reader.readWorkBuddy("cn");
 assert.equal(calls.length, 3);
 time += 1;
 await reader.readWorkBuddy("cn");
 assert.equal(calls.length, 4);
 await reader.readWorkBuddy("cn", true);
 assert.equal(calls.length, 5);
 await new ConnectUsageReader({ now: () => time, readJson }).readWorkBuddy("cn");
 assert.equal(calls.length, 6);
});

test("合并同地区在途；force 绕过在途且旧响应不能覆盖新缓存", async () => {
 const old = deferred(), latest = deferred(); let count = 0;
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: () => (++count === 1 ? old : latest).promise });
 const first = reader.readWorkBuddy("cn"), same = reader.readWorkBuddy("cn");
 assert.equal(count, 1);
 const forced = reader.readWorkBuddy("cn", true);
 assert.equal(count, 2);
 latest.resolve(signed({ credits: credit(20) }));
 assert.equal((await forced).accountReadings[0].credits.total, 20);
 old.resolve(signed({ credits: credit(10) }));
 assert.equal((await first).accountReadings[0].credits.total, 10);
 assert.equal((await same).accountReadings[0].credits.total, 10);
 assert.equal((await reader.readWorkBuddy("cn")).accountReadings[0].credits.total, 20);
 assert.equal(count, 2);
});

test("dispose 后迟到响应不回填，后续读取拒绝", async () => {
 const late = deferred();
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: () => late.promise });
 const pending = reader.readTrae("cn");
 reader.dispose();
 late.resolve(signed({ credits: { available: 12 } }));
 await pending;
 assert.equal(reader.cache.size, 0);
 assert.equal(reader.pending.size, 0);
 await assert.rejects(reader.readTrae("cn"), /已卸载/);
});

test("缺席、signed-out、损坏响应与查询错误各自保留语义", async () => {
 assert.equal(await new ConnectUsageReader({ readJson: async () => undefined }).readWorkBuddy("cn"), undefined);
 const signedOut = await new ConnectUsageReader({ readJson: async () => ({ status: "signed-out" }) }).readWorkBuddy("cn");
 assert.equal(normalizeWorkBuddy(signedOut), null);
 await assert.rejects(new ConnectUsageReader({ readJson: async () => ({}) }).readTrae("cn"), /形状/);
 await assert.rejects(new ConnectUsageReader({ readJson: async () => { throw new Error("SECRET"); } }).readTrae("cn"), error => !error.message.includes("SECRET"));
 await assert.rejects(new ConnectUsageReader({ readJson: async () => signed() }).readWorkBuddy("ai"), /未知/);
 const errorEntry = normalizeWorkBuddy({ status: "error", generatedAt: NOW, accountReadings: [] }, "workbuddy", NOW);
 assert.equal(errorEntry.state, "error");
 assert.equal(errorEntry.lastSuccessAt, undefined);
});

test("提供方失败刷新叠层标注为旧数据，不伪造成功时间", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async () => signed({ credits: credit(), refreshError: "SECRET raw error" }) });
 const snapshot = await reader.readWorkBuddy("cn");
 const entry = normalizeWorkBuddy(snapshot, "workbuddy", NOW);
 assert.equal(entry.state, "ok");
 assert.equal(entry.coverage, "partial");
 assert.equal(entry.freshness, "stale");
 assert.equal(entry.lastSuccessAt, undefined);
 assert.ok(!JSON.stringify(snapshot).includes("SECRET"));
});

test("Trae 非池模式没有 selectionExplicit，不能推断 fixed；只标已知当前 ID", () => {
 const snapshot = { plugin: "trae", accountId: "a", pool: { enabled: false, accounts: [] } };
 const current = accountMetadata({ id: "a", selected: false }, snapshot, NOW);
 assert.equal(current.accountMode, undefined);
 assert.equal(current.accountActive, true);
 assert.equal(accountMetadata({ id: "b", selected: true }, snapshot, NOW).accountActive, false);
 assert.equal(accountMetadata({ id: "a" }, { ...snapshot, pool: undefined }, NOW).accountActive, undefined);
});

test("Trae checkin 只保留真实只读 Web 契约字段", async () => {
 const checkin = { checkedIn: true, didCheckedIn: true, credits: 10, enabled: true, extraCredits: 2 };
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async () => signed({ credits: { available: 2 }, checkin: { ...checkin, token: "SECRET", todayCheckedIn: true } }) });
 const result = await reader.readTrae("cn");
 assert.deepEqual(result.checkin, checkin);
 assert.deepEqual(result.accountReadings[0].checkin, checkin);
});

test("WB 极小正余额不会四舍五入成耗尽，用尽包不再显示", () => {
 const snapshot = { plugin: "workbuddy", status: "signed-in", generatedAt: NOW, accountReadings: [{ id: "a", credits: { total: 0.00001, packages: [{ packageName: "tiny", monthly: true, size: 100, remain: 0.00001, cycleRefreshMs: NOW + 1000 }, { packageName: "empty", monthly: true, size: 100, remain: 0 }] } }] };
 const entry = normalizeWorkBuddy(snapshot, "workbuddy", NOW);
 assert.equal(entry.windows[0].percent, 99.9);
 assert.equal(entry.windows[0].status, "ok");
 assert.equal(entry.windows.length, 1);
 assert.equal(entry.windows[0].groupLabel, "tiny");
 assert(!JSON.stringify(entry.extras).includes("empty"));
});

test("WB 总览刷新失败不污染独立读取成功的其他账号", async () => {
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => endpoint === "usage" ? signed({ accounts: allRows.slice(0, 2), credits: credit(), refreshError: "SECRET" }) : { accounts: [{ id: "b", credits: 50 }] } });
 const snapshot = await reader.readWorkBuddy("cn");
 const entry = normalizeWorkBuddy(snapshot, "workbuddy", NOW);
 assert.equal(entry.linkedAccounts[0].freshness, "stale");
 assert.equal(entry.linkedAccounts[0].lastSuccessAt, undefined);
 assert.equal(entry.linkedAccounts[1].freshness, "fresh");
 assert.equal(entry.linkedAccounts[1].lastSuccessAt, new Date(NOW).toISOString());
 assert.equal(entry.freshness, "stale");
 assert.equal(entry.lastSuccessAt, new Date(NOW).toISOString());
});

test("冷启动插件缺席不缓存，后续正常轮询可恢复；force缺席清除旧值", async () => {
 let calls = 0;
 const reader = new ConnectUsageReader({ now: () => NOW, readJson: async () => ++calls === 1 || calls === 3 ? undefined : signed({ credits: credit() }) });
 assert.equal(await reader.readWorkBuddy("cn"), undefined);
 assert.equal(reader.cache.size, 0);
 assert.equal((await reader.readWorkBuddy("cn")).status, "signed-in");
 assert.equal(calls, 2);
 assert.equal(await reader.readWorkBuddy("cn", true), undefined);
 assert.equal(reader.cache.size, 0);
 assert.equal((await reader.readWorkBuddy("cn")).status, "signed-in");
 assert.equal(calls, 4);
});

test("仅保留Host白名单错误码和JSON/HTTP类别，任意原始错误仍被剔除", async () => {
 const fails = error => new ConnectUsageReader({ readJson: async () => { throw error; } }).readTrae("cn");
 await assert.rejects(fails(Object.assign(new Error("dsh-connect-trae 的用量接口没有返回 JSON SECRET"), { code: "subusage/response" })), error => error.code === "subusage/response" && error.message.includes("JSON") && !error.message.includes("SECRET"));
 await assert.rejects(fails(Object.assign(new Error("dsh-connect-workbuddy 的用量接口返回 HTTP 503 SECRET"), { code: "subusage/transport" })), error => error.code === "subusage/transport" && error.message.endsWith("HTTP 503") && !error.message.includes("SECRET"));
 await assert.rejects(fails(Object.assign(new Error("HTTP 401 JSON SECRET"), { code: "untrusted/upstream" })), error => error.code === undefined && !/401|JSON|SECRET/.test(error.message));
 await assert.rejects(fails(Object.assign(new Error("SECRET raw error"), { code: "subusage/response" })), error => error.code === "subusage/response" && !error.message.includes("SECRET"));
});

test("真实Trae/WB pool.accountId均转为内部ID，current不借selected推断", async () => {
 for (const plugin of ["trae", "workbuddy"]) {
  const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint, query) => {
   if (endpoint === "usage") return signed({ accounts: allRows.slice(0, 2), credits: plugin === "trae" ? { available: 4 } : credit(), pool: { enabled: true, accounts: [{ accountId: "a", current: false }, { accountId: "b", current: true }] } });
   return plugin === "trae" ? { id: query.accountId, credits: { available: 4 } } : { accounts: [{ id: "a", credits: 2 }, { id: "b", credits: 9 }] };
  } });
  const snapshot = await (plugin === "trae" ? reader.readTrae("cn") : reader.readWorkBuddy("cn"));
  assert.deepEqual(snapshot.pool.accounts, [{ id: "a", current: false }, { id: "b", current: true }]);
  assert.equal(accountMetadata(snapshot.accountReadings[0], snapshot, NOW).accountActive, false);
  assert.equal(accountMetadata(snapshot.accountReadings[1], snapshot, NOW).accountActive, true);
 }
});

test("WB usage顶层ID与selected冲突时只采用批量ID余额，不迁移未知归属包", async () => {
 for (const batchFails of [false, true]) {
  const reader = new ConnectUsageReader({ now: () => NOW, readJson: async (_, endpoint) => {
   if (endpoint === "usage") return signed({ accounts: [{ id: "a", selected: false }, { id: "b", selected: true }], credits: credit(9), pool: { enabled: true, accounts: [{ accountId: "b", current: true }] } });
   if (batchFails) throw new Error("failure");
   return { accounts: [{ id: "a", credits: 2 }, { id: "b", credits: 9 }] };
  } });
  const snapshot = await reader.readWorkBuddy("cn");
  assert.equal(snapshot.credits, undefined);
  assert.deepEqual(snapshot.accountReadings.map(row => row.credits), batchFails ? [undefined, undefined] : [2, 9]);
  const entry = normalizeWorkBuddy(snapshot, "workbuddy", NOW);
  assert.ok(entry.linkedAccounts.every(row => row.windows.length === 0));
  assert.equal(entry.linkedAccounts[1].accountActive, true);
  assert.equal(entry.linkedAccounts[0].accountActive, false);
  assert.equal(entry.state, batchFails ? "error" : "ok");
 }
});

test("WB跟随app时顶层ID确认当前账号，固定模式仍仅由显式选择确认", () => {
 const snapshot = { plugin: "workbuddy", accountId: "a", selectionExplicit: false, pool: { enabled: false, accounts: [] }, accounts: [{ id: "a", selected: true }, { id: "b", selected: false }] };
 assert.equal(accountMetadata({ id: "a" }, snapshot, NOW).accountActive, true);
 assert.equal(accountMetadata({ id: "b" }, snapshot, NOW).accountActive, false);
 assert.equal(accountMetadata({ id: "a" }, snapshot, NOW).accountMode, undefined);
 const conflict = { ...snapshot, accounts: [{ id: "a", selected: false }, { id: "b", selected: true }] };
 assert.equal(accountMetadata({ id: "a" }, conflict, NOW).accountActive, undefined);
});

test("WB旧rawusage安全回退只给匹配当前账号完整包，其他账号仍为error", () => {
 const raw = signed({ accounts: allRows.slice(0, 2), generatedAt: NOW, credits: credit(), pool: { enabled: true, accounts: [{ accountId: "b", current: true }] } });
 const entry = normalizeWorkBuddy(raw, "workbuddy", NOW);
 assert.equal(entry.linkedAccounts[0].extras[0].value, "60 credits");
 assert.equal(entry.linkedAccounts[0].windows.length, 1);
 assert.equal(entry.linkedAccounts[1].state, "error");
 assert.equal(entry.linkedAccounts[1].accountActive, true);
 assert.ok(entry.linkedAccounts[0].extras.some(row => row.value.startsWith("3 天内到期：20 credits")), "逐包到期按分组聚合");
 assert.ok(!entry.linkedAccounts[0].extras.some(row => row.value === "即将到期：5 credits"), "已有逐包分组时不重复上游聚合提醒");
 assert.ok(!JSON.stringify(entry).includes("最早的积分包到期"), "不再为逐包日期另加说明行");
 const single = normalizeWorkBuddy(signed({ accounts: [], generatedAt: NOW, credits: credit() }), "workbuddy", NOW);
 assert.equal(single.linkedAccounts.length, 1);
 assert.equal(single.windows.length, 1);
 const conflict = normalizeWorkBuddy({ ...raw, accounts: [{ id: "a", selected: false }, { id: "b", selected: true }] }, "workbuddy", NOW);
 assert.equal(conflict.state, "error");
 assert.ok(conflict.linkedAccounts.every(row => !row.windows.length && !row.extras.length));
});
