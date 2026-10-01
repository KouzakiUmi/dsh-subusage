// Cookie 归一化单测：cookies.json / 多行 name-value / 标准串 / Tab 分隔。
import { readFileSync } from "node:fs";
import { makeAssert } from "./helpers.mjs";

// normalizeCookieText 是 client 工厂内的闭包函数，抽取函数体执行（防拷贝漂移）。
const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const m = src.match(/function normalizeCookieText\(raw\) \{[\s\S]*?\n\t\t\}/);
if (!m) { console.error("FAIL 未找到 normalizeCookieText"); process.exit(1); }
const normalizeCookieText = new Function(m[0] + "; return normalizeCookieText;")();
const assert = makeAssert();

// 多行 name/value 清单（Chrome 扩展「当前页面 Cookies」样式）
const out1 = normalizeCookieText(`当前页面 Cookies
api-platform_serviceToken
"A/EKIm1WUwZb=="
userId
171340177
clngdbkpkpeebahjckkjfobafhncgmne
d06948e9-24c4-46db-acab-4541169db504`);
assert(out1.includes('api-platform_serviceToken="A/EKIm1WUwZb=="'), "多行清单 → 标准串（保值原样）");
assert(out1.includes("userId=171340177"), "name/value 成对解析");
assert(!out1.includes("当前页面"), "表头行被跳过");

// JSON 导出
const out2 = normalizeCookieText(JSON.stringify([
	{ name: "a", value: "1" }, { name: "b", value: "x=y" }
]));
assert(out2 === "a=1; b=x=y", "cookies.json 数组 → 标准串");

// 对象形态
const out3 = normalizeCookieText('{"sid":"abc"}');
assert(out3 === "sid=abc", "cookies.json 对象 → 标准串");

// 标准串原样
assert(normalizeCookieText("a=b; c=d") === "a=b; c=d", "标准串原样通过");

// Tab 分隔
assert(normalizeCookieText("sid\tabc123\nuid\t42") === "sid=abc123; uid=42", "Tab 分隔解析");

// 空
assert(normalizeCookieText("") === "", "空输入");
const throws = (input, label) => {
	let threw = false;
	try { normalizeCookieText(input); } catch (error) { threw = error instanceof Error && !!error.message; }
	assert(threw, label);
};
assert(normalizeCookieText("api-platform_serviceToken=abc==\r\nuserId=42") === "api-platform_serviceToken=abc==; userId=42", "多行 KV 与合法 CRLF 行分隔规范化");
assert(normalizeCookieText("Name\tValue\tDomain\tPath\tExpires\napi-platform_serviceToken\tabc==\t.platform.xiaomimimo.com\t/\tSession\nuserId\t42\t.xiaomimimo.com\t/\tSession\nforeign\tsecret\tother.example\t/\tSession") === "api-platform_serviceToken=abc==; userId=42", "多列 TAB 只取 name/value，过滤外域");
assert(normalizeCookieText(JSON.stringify({ cookies: [
	{ name: "token", value: "good", domain: ".xiaomimimo.com" },
	{ name: "token", value: "bad", domain: "evil.xiaomimimo.com" },
	{ name: "sid", value: "bad", domain: "xiaomimimo.com.evil" }
] })) === "token=good", "JSON cookies 包装及域边界过滤");
assert(normalizeCookieText(".xiaomimimo.com\tTRUE\t/\tFALSE\t0\tuserId\t42") === "userId=42", "Netscape 多列 TAB");
assert(normalizeCookieText("a=1\na=2\nb=x=y") === "a=2; b=x=y", "重复 Cookie 后值覆盖，保留等号");
throws("[{ broken", "JSON 失败明确抛错，不静默清空");
throws("unrecognized input", "无法识别文本明确抛错");
throws("name\nvalue\nodd", "成对清单缺项明确抛错");
throws("a=b\r", "禁止孤立 CR 注入");
throws("a=b\r\nX-Injected: value", "禁止伪 HTTP header 注入");
throws(JSON.stringify([{ name: "a", value: "ok\r\nX-Test: bad" }]), "禁止 JSON 值内 CRLF 注入");
throws(JSON.stringify([{ name: "bad;name", value: "x" }]), "禁止 Cookie 名分隔符注入");
throws(JSON.stringify([{ name: "a", value: "x;y" }]), "禁止 Cookie 值分号注入");
throws(JSON.stringify([{ name: "a", value: "x", domain: "example.com" }]), "全外域导出明确报错");
for (const value of ["a b", "中文", "a,b", "a\\b", '"a b"']) throws(JSON.stringify([{ name: "sid", value }]), "禁止非 RFC cookie-octet 值 " + JSON.stringify(value));
assert.summary();
