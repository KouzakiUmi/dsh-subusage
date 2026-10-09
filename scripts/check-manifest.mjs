#!/usr/bin/env node
// 发布前机械校验 —— 对齐 awesome-dsh-plugin 收录 CI 的检查点:
//   https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 的 contributing.md
// 在本地与 GitHub Actions 中都运行;任何一项失败即退出非零。

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
	console.error(`FAIL ${msg}`);
	process.exitCode = 1;
};
const ok = (msg) => console.log(`PASS ${msg}`);

// ── package.json ────────────────────────────────────────────────────────────
const pkgPath = join(root, "package.json");
if (!existsSync(pkgPath)) fail("package.json 不存在");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

if (pkg.name !== "dsh-subusage") fail(`package.name 应为 dsh-subusage,实际 ${pkg.name}`);
else ok("package.name = dsh-subusage");

// awesome CI 第 2 项:必须声明 dsh.bundle(只声明 dsh.client 会被拒)
const dsh = pkg.dsh || {};
if (!dsh.bundle || !dsh.bundle.patch) fail("缺少 dsh.bundle.patch(awesome 收录的硬性要求)");
else {
	const patchPath = join(root, dsh.bundle.patch);
	if (!existsSync(patchPath)) fail(`dsh.bundle.patch 指向的文件不存在: ${dsh.bundle.patch}`);
	else ok(`dsh.bundle.patch -> ${dsh.bundle.patch}`);
}

// 官方核心包必须走 peerDependencies(不能进 dependencies)
const peer = pkg.peerDependencies || {};
const peers = Object.keys(peer).filter((k) => k.startsWith("@deepseek-ai/"));
if (peers.length === 0) fail("peerDependencies 未声明任何 @deepseek-ai/* 核心包");
else if (Object.keys(pkg.dependencies || {}).some((k) => k.startsWith("@deepseek-ai/"))) {
	fail("@deepseek-ai/* 出现在 dependencies —— 应只在 peerDependencies");
} else ok(`peerDependencies 声明核心包: ${peers.join(", ")}`);

// 版本号存在且符合 semver 形态
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version || "")) fail(`version 不是 semver: ${pkg.version}`);
else ok(`version = ${pkg.version}`);

// npm 映射前提:repository 指回本仓库
if (!pkg.repository || !/github\.com[:/]KouzakiUmi\/dsh-subusage/.test(
	typeof pkg.repository === "string" ? pkg.repository : pkg.repository.url || ""
)) fail("repository 字段缺失或未指回 KouzakiUmi/dsh-subusage(npm 映射关联的前提)");
else ok("repository 指回本仓库");

// files 白名单必须覆盖安装所需的全部产物
for (const f of ["lib", "cordis.patch.yml", "LICENSE"]) {
	if (!(pkg.files || []).includes(f)) fail(`files 缺少 ${f}`);
}
if ((pkg.files || []).length > 0) ok(`files = ${pkg.files.join(", ")}`);

// exports 目标全部存在(通配目标只校验其目录)
for (const [key, target] of Object.entries(pkg.exports || {})) {
	if (typeof target !== "string") continue;
	if (target.endsWith("*")) {
		const dir = join(root, dirname(target));
		if (!existsSync(dir)) fail(`exports["${key}"] -> ${target} 目录不存在`);
		continue;
	}
	if (!existsSync(join(root, target))) fail(`exports["${key}"] -> ${target} 文件不存在`);
}
ok("exports 目标均存在");

// ── cordis.patch.yml ───────────────────────────────────────────────────────
const patchText = readFileSync(join(root, "cordis.patch.yml"), "utf8");
if (!patchText.includes("- insert:")) fail("cordis.patch.yml 缺少 - insert: 结构");
if (!/name:\s*dsh-subusage\b/.test(patchText)) fail("cordis.patch.yml 未注册 name: dsh-subusage");
ok("cordis.patch.yml 含 insert 条目(dsh-subusage)");

// ── 许可证 ─────────────────────────────────────────────────────────────────
// GitHub 与 DSH STORE 都要求 manifest / 仓库 / 分发产物三方一致地声明许可证；
// 仓库根缺 LICENSE 时 GitHub 的 licenseInfo 会是 null（本项目曾经如此）。
if (!existsSync(join(root, "LICENSE"))) fail("缺少 LICENSE");
else if (!readFileSync(join(root, "LICENSE"), "utf8").includes("MIT License")) fail("LICENSE 不是 MIT");
else if (!(pkg.files || []).includes("LICENSE")) fail("files 未包含 LICENSE");
else ok("LICENSE 存在、为 MIT 且已打进包");

// locale/ 目录已移除：DSH 不读它，客户端文案走 lib/client.js 里 ctx.locale.register 的内联字典。

if (process.exitCode) {
	console.error("\n清单校验未通过 —— 以上 FAIL 项修完再发版。");
} else {
	console.error("\n清单校验全部通过。");
}
