// 一键回归：node tests/run-all.mjs
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(dir).filter((f) => /^(test|smoke)-.*\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
	console.log(`\n===== ${f} =====`);
	const r = spawnSync(process.execPath, [join(dir, f)], { stdio: "inherit" });
	if (r.status !== 0) failed += 1;
}
console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 个文件失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
