#!/usr/bin/env node
// peer 范围必须覆盖 0.2.x 每个 minor 的预发布 Core：0.8.1~0.10.7 的
// 0.2.1-alpha.x、以及 0.24.2 之后本机遇到的 0.2.2-rc.1，都因缺对应
// 下界比较符被 node-semver 静默排除。这里只做纯文本核对，不引入 semver
// 依赖（工作区与 CI 都没有该包），真正的 semver 实测记录在 development.md。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const peers = Object.entries(pkg.peerDependencies || {})
	.filter(([name]) => name.startsWith("@deepseek-ai/"));
const fail = (msg) => {
	console.error(`FAIL ${msg}`);
	process.exitCode = 1;
};
const ok = (msg) => console.log(`PASS ${msg}`);

if (peers.length === 0) fail("peerDependencies 缺少 @deepseek-ai/* 核心包");

// 每个已出现的 0.2.x minor 都要有自己的带预发布标签的下界比较符。
// Core 升 0.2.3 / 0.3.x 时按 development.md 的规则补分支，并同步这里的清单。
const expectedLowerBounds = [">=0.2.0-rc.1", ">=0.2.1-0", ">=0.2.2-0"];
for (const [name, range] of peers) {
	for (const bound of expectedLowerBounds) {
		if (!range.includes(bound)) fail(`${name} 的 peer 范围缺少 ${bound} 分支（会排除对应的预发布 Core）`);
	}
	if (!range.includes("<0.3.0-0")) fail(`${name} 的 peer 范围缺少 <0.3.0-0 上界`);
	if (/>=0\.2\.1-0 <0\.3\.0-0/.test(range)) fail(`${name} 仍用 >=0.2.1-0 <0.3.0-0 单分支覆盖到 0.3（会排除 0.2.2-* 预发布）`);
}
if (!process.exitCode) ok(`核心包 peer 范围均覆盖 ${expectedLowerBounds.join(" / ")} 下界`);

// 所有核心包的范围必须一致，避免只改其中一个。
const ranges = new Set(peers.map(([, range]) => range));
if (ranges.size !== 1) fail(`核心包 peer 范围不一致：${[...ranges].join(" | ")}`);
else ok("核心包 peer 范围一致");

// 兼容声明：新 Core 只做静态核对、未实机运行，必须保持 unknown。
const releases = pkg.dsh?.compatibility?.dshReleases || {};
if (releases["0.2.2-rc.1"] !== "unknown") {
	fail(`dshReleases["0.2.2-rc.1"] 应为 unknown（无实机运行证据），实际 ${releases["0.2.2-rc.1"]}`);
} else ok('dshReleases["0.2.2-rc.1"] = unknown（未实机验证，不猜）');

// client.inject 是信息性名单，不应保留新 Core 安装树里已不存在的基座包名。
const inject = pkg.dsh?.client?.inject || [];
if (inject.includes("@deepseek-ai/dsh-client-ui-slots")) {
	fail("dsh.client.inject 仍含已失效的 @deepseek-ai/dsh-client-ui-slots");
} else ok("dsh.client.inject 无失效包名");

if (!process.exitCode) console.log("\npeer 范围与兼容声明核对全部通过 ✅");
