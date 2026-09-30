// Cookie 归一化单测：cookies.json / 多行 name-value / 标准串 / Tab 分隔。
import { readFileSync } from "node:fs";
import { loadClientFactory, makeAssert } from "./helpers.mjs";

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
assert.summary();
