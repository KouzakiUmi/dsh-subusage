// 双 DeepSeek 余额入口、仅余额药丸与 MiMo 无订阅：全程虚构凭据/桩服务。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService, normalizeDeepseekAccountBalance, normalizeMimo, normalizeCodexUsage } = await loadHostModule();
const files = new Map();
const io = { readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); }, mkdirSync() {}, chmodSync() {}, writeFileSync(p,v) { files.set(p,v); }, renameSync(a,b) { files.set(b,files.get(a)); files.delete(a); } };
let balance = "49.99", signedIn = true, accountCalls = 0, apiCalls = 0, accountFailed = false;
const account = {
 async getState() { return { status: signedIn ? "credential-stored" : "signed-out" }; },
 async getBalance(client) { assert.equal(typeof client.version, "string"); accountCalls++; return accountFailed ? { status: "failed" } : { status: "ready", value: [{ currency: "CNY", balance }], bonusWallets: [{ currency: "CNY", balance: "99" }], unrelated: "SECRET-ACCOUNT" }; },
 resolveToken() { throw new Error("must not read OAuth token"); }
};
const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [{ id: "deepseek-official" }, { id: "deepseek-account" }] } }, {
 io, configPath: "memory/balance-modes", resolveDeepseekAccount: () => account,
 resolveCredentials: async id => id === "deepseek" ? { value: "sk-fixture-independent-api" } : undefined, resolveEnvironment: () => undefined,
 fetch: async (url, init) => { assert.equal(url,"https://api.deepseek.com/user/balance"); assert.equal(init.headers.authorization,"Bearer sk-fixture-independent-api"); apiCalls++; return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "42.50" }] }) }; }
});
const first = await service.refresh({ providerIds: ["deepseek", "deepseek-account"], force: false });
assert.equal(first.configured.deepseek, false, "DSH 账号路由不冒充独立 API 路由");
assert.equal(first.configured["deepseek-account"], true);
assert.equal(first.settings.visibility.providers["deepseek-account"], true, "账号入口默认开启");
assert.deepEqual(first.entries.map(e=>e.extras[0].value), ["42.50 CNY", "49.99 CNY"]);
assert.deepEqual(first.entries.map(e=>e.keySource), ["credentials", "account-service"]);
assert.ok(!JSON.stringify(first).includes("sk-fixture") && !JSON.stringify(first).includes("SECRET-ACCOUNT"));
balance = "8.25";
const changed = await service.refresh({ providerIds: ["deepseek", "deepseek-account"], force: false });
assert.equal(changed.entries[1].extras[0].value, "8.25 CNY", "账号余额不跨会话沿用本插件缓存");
assert.equal(apiCalls, 1, "独立 API 余额仍使用独立缓存"); assert.equal(accountCalls, 2);
await assert.rejects(service.save({ providerId: "deepseek-account", keyMode: "manual", keyUpdate: { action: "replace", value: "fixture" } }), e=>e.code === "subusage/invalid-request");
accountFailed = true;
assert.equal((await service.refresh({ providerIds: ["deepseek-account"], force: true })).entries[0].state,"error", "账号读取失败不伪造 0 元");
signedIn = false;
assert.equal((await service.refresh({ providerIds: ["deepseek-account"], force: true })).entries[0].state,"no-key");
assert.equal((await service.refresh({ providerIds: ["deepseek"], force: true })).entries[0].state,"ok", "账号退出不影响 API 身份");
service.dispose();
assert.throws(()=>normalizeDeepseekAccountBalance({status:"ready", value:[]}));
assert.throws(()=>normalizeDeepseekAccountBalance({status:"ready", value:[{currency:"CNY",balance:"invalid"}]}));
assert.equal(normalizeDeepseekAccountBalance({status:"ready", value:[{currency:"CNY",balance:"0"}]}).extras[0].value,"0 CNY");
console.log("PASS 独立 API/默认账号余额、独立缓存与身份、不读取 token、失败不伪造零余额");
const stuck = new SubUsageService({ effect() {}, llm: { listProviders:()=>[] } }, {
 io, configPath:"memory/account-timeout", accountBalanceTimeoutMs:5,
 resolveDeepseekAccount:()=>({getState:async()=>({status:"credential-stored"}),getBalance:()=>new Promise(()=>{})}),
 resolveCredentials:async()=>undefined, resolveEnvironment:()=>undefined, fetch:async()=>{throw new Error("unexpected network");}
});
const timed = (await stuck.refresh({providerIds:["deepseek-account"],force:true})).entries[0];
assert.equal(timed.state,"error"); assert.equal(timed.errorCode,"subusage/network");
assert.ok(timed.error.includes("超时"), "宿主余额服务未返回时有截止时间，不会永久刷新中");
stuck.dispose();

const bal = { data: { balance: "0.50", currency: "CNY" } };
const zero = { data: { usage: { items: [{ name: "plan_total_token", used: 0, limit: 0, percent: 0 }] } } };
const noPlan = normalizeMimo(bal, { data: {} }, zero);
assert.equal(noPlan.windows.length, 0); assert.equal(noPlan.subscribed, false); assert.equal(noPlan.coverage, "complete");
assert.equal(normalizeMimo(bal, undefined, zero).coverage,"partial", "套餐详情失败不能声称没有订阅");
assert.equal(normalizeMimo(bal, {}, undefined).coverage,"partial", "用量读取失败不能变成已确认无订阅");
const usage = { data: { usage: { items: [{ name:"plan_total_token",used:100,limit:100,percent:1 }] } } };
assert.equal(normalizeMimo(bal, {data:{planName:"Pro"}}, usage).windows[0].status,"rate-limited");
assert.equal(normalizeMimo(undefined, {data:{planName:"Pro"}}, usage).windows[0].status,"rate-limited", "余额失败不抹掉套餐耗尽");
assert.equal(normalizeMimo(bal, { data: null }, { code: 0, data: { usage: { items: [] }, monthUsage: null } }).subscribed, false, "成功返回空用量组与空套餐详情是无套餐证据");
assert.equal(normalizeMimo(bal, { code: 500, data: null }, zero).coverage, "partial", "业务失败码不能当成空套餐");
assert.equal(normalizeMimo({data:{balance:"invalid"}}, {data:{planName:"Pro"}}, usage).balanceOk, false, "非法辅助余额不拖掉有效用量、不伪造零余额");
console.log("PASS MiMo 零容量不造100%余量、无订阅显示余额、读取失败与耗尽分开");

for (const providerId of ["xiaomi-token-plan-cn", "zenmux"]) {
 const path = `memory/endpoint-${providerId}`;
 files.set(path, JSON.stringify(providerId === "zenmux" ? { visibility:{providers:{zenmux:true}}, keyModes:{zenmux:"manual"}, keys:{zenmux:"fixture"} } : { xiaomi:{cookie:"userId=fixture; serviceToken=fixture"} }));
 let outage = providerId === "zenmux" ? "subscription" : "balance", status = 503;
 const endpoints = new SubUsageService({effect(){},llm:{listProviders:()=>[]}}, { io, configPath:path, resolveDeepseekAccount:()=>undefined, resolveCredentials:async()=>undefined, resolveEnvironment:()=>undefined,
  fetch:async url=>{
   const failed = providerId === "zenmux" ? url.includes(outage) : url.endsWith(`/${outage}`);
   const payload = providerId === "zenmux" ? {data:{currency:"USD",total_credits:3}} : url.endsWith("/balance") ? bal : url.endsWith("/detail") ? {data:{planName:"Pro"}} : usage;
   return {ok:!failed,status:failed?status:200,headers:{get:()=>null},text:async()=>JSON.stringify(payload)};
  }
 });
 const out = (await endpoints.refresh({providerIds:[providerId],force:true})).entries[0];
 assert.equal(out.state,"ok", `${providerId}: one optional endpoint failure does not drop readable data`);
 if (providerId === "zenmux") { assert.equal(out.coverage,"partial"); assert.equal(out.extras.find(x=>x.kind==="balance").value,"3 USD"); }
 else {
  assert.equal(out.windows[0].status,"rate-limited"); assert.equal(out.extras.some(x=>x.kind==="balance"),false);
  status=401;
  assert.equal((await endpoints.refresh({providerIds:[providerId],force:true})).entries[0].errorCode,"subusage/auth", "MiMo 余额鉴权失败必须外传");
 }
 endpoints.dispose();
}
console.log("PASS 独立端点失败保留成功数据、ZenMux 套餐失败仍未知、MiMo 401 不吞");
const codexZero = normalizeCodexUsage({ plan_type:"free", credits:{has_credits:true,unlimited:false,balance:"0"} });
assert.equal(codexZero.extras.find(x=>x.kind==="balance").value,"0", "明确报告的零余额不能被丢掉");
const codexBlocked = normalizeCodexUsage({ credits:{has_credits:true,unlimited:false,balance:"0"}, rate_limit:{allowed:false, primary_window:{used_percent:100}} });
assert.equal(codexBlocked.availability,"blocked", "显示零余额不会误判可由 credits 续用");

let spec;
const source = readFileSync(new URL("../lib/client.js", import.meta.url),"utf8");
const react = { createElement:(type,props,...children)=>({type,props,children}), Fragment:"fragment" };
vm.runInNewContext(source.replace("exports.apply = apply;", "exports.__test = { createUsageStore, computeStatus, providerVisible, PROVIDER_META, ROUTE_PROVIDER_ALIAS }; exports.apply = apply;"), { window:{__ModuleLoader__:{load:s=>{spec=s;}}},console,setTimeout,clearTimeout,setInterval,clearInterval });
const api = spec.factory(()=>react).__test;
assert.equal(api.ROUTE_PROVIDER_ALIAS["deepseek-official"], "deepseek-account");
assert.equal(api.ROUTE_PROVIDER_ALIAS.deepseek, undefined, "独立 API 不重映射");
assert.equal(api.PROVIDER_META["deepseek-account"].managedByPlugin,true);
const settings = {revision:"r1",hasKeys:{deepseek:true},keyModes:{deepseek:"manual"},visibility:{hideWithoutApi:true,providers:{deepseek:true,"deepseek-account":true}}};
const configured = {deepseek:false,"deepseek-account":false};
const old = {providerId:"deepseek",state:"no-key",apiDetected:false};
assert.equal(api.providerVisible(settings,"deepseek",old,{settings,configured}),true, "保存 Key 后不能被旧 no-key 或无模型路由隐藏");
const codexSettings = {visibility:{providers:{"openai-codex":true},hideWithoutApi:true}};
const codexKnown = {providerId:"openai-codex",state:"ok",apiDetected:true};
assert.equal(api.providerVisible(codexSettings,"openai-codex",codexKnown,{settings:codexSettings,configured:{"openai-codex":false},entries:[codexKnown]}), true, "路由短暂消失不能隐藏已检测到登录的 Codex");
const calls=[];
const store = api.createUsageStore((method,q)=>{calls.push({method,ids:q.providerIds});return Promise.resolve({settings,configured,updatedAt:"",entries:q.providerIds.map(providerId=>({providerId,state:"ok",coverage:"complete",freshness:"fresh",windows:[],extras:[{kind:"balance",value:"49.99 CNY"}]}))});});
await store.readAll();calls.length=0;
await store.refresh(["deepseek","deepseek-account"],true);
assert.deepEqual(calls.map(c=>c.ids[0]),["deepseek","deepseek-account"],"两个余额入口都绕过模型路由过滤");
store.dispose();
const args={providerId:"deepseek",t:k=>k,getLocale:()=>"zh"};
const entry=value=>({state:"ok",coverage:"complete",freshness:"fresh",windows:[],extras:[{kind:"balance",value}]});
for(const [value,color,short] of [["0.99 CNY","#ef4444","¥0.99"],["1 CNY","#eab308","¥1"],["5 CNY","#22c55e","¥5"],["-1.19 CNY","#ef4444","¥-1.19"],["0.19 USD","#ef4444","$0.19"],["0.2 USD","#eab308","$0.2"],["1 USD","#22c55e","$1"],["0 credits","#ef4444","0 credits"],["0.1 credits","#94a3b8","0.1 credits"],["0 EUR","#ef4444","0 EUR"],["0.5 EUR","#94a3b8","0.5 EUR"],["0","#ef4444","0"],["0.5","#94a3b8","0.5"]]) {
 const st=api.computeStatus(entry(value),args);assert.equal(st.key,"balance");assert.equal(st.color,color,value);assert.equal(st.short,short);assert.ok(st.icon, "余额状态必须有可辨识的图标");
}
const precise = api.computeStatus(entry("49.998903980000000 CNY"), args);
assert.equal(precise.short, "¥50");
assert.equal(precise.title, "balanceLabel 50 CNY");
assert.equal(api.computeStatus(entry("0.9999 CNY"), args).color, "#ef4444", "显示舍入不能改变低余额阈值");
const healthy=api.computeStatus({...entry("-1.19 CNY"),windows:[{kind:"sub",percent:10,status:"ok"}]},args);
assert.equal(healthy.key,"ok");assert.equal(healthy.color,"#22c55e","有套餐时负余额不覆盖可用窗口");
const exhausted=api.computeStatus({...entry("49.99 CNY"),windows:[{kind:"sub",percent:100,status:"rate-limited"}]},args);
assert.equal(exhausted.key,"blocked","余额不能掩盖已耗尽套餐");
assert.equal(api.computeStatus({...entry("49.99 CNY"),coverage:"partial"},args).key,"degraded","查询不完整不能伪装成确定仅余额");
assert.equal(api.computeStatus({...entry("49.99 CNY"),state:"error"},args).key,"error");
assert.equal(api.computeStatus({state:"ok",coverage:"complete",freshness:"fresh",windows:[],extras:[{kind:"spend",value:"0 USD"}]},args).color,"#94a3b8","累计消费不是余额，不按零余额警告");
console.log("PASS 双入口无路由刷新、金额药丸与分单位颜色、套餐优先与失败状态保留");
