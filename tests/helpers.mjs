// tests/helpers.mjs —— 测试公共设施：
// host/client 模块都在闭包里 import 了 DSH 核心包，测试时用 stub 替换后载入，
// 只验证「本插件自身的逻辑」（归一化/级联/注册装配）。
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

const HOST_STUBS = [
	[
		/import \{ RemoteError, TypertRemoteService \} from "@deepseek-ai\/dsh-typert-protocol";/,
		"class RemoteError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }\nclass TypertRemoteService { constructor(ctx, key) { if (typeof key !== 'string' || !key) throw new Error('bad serviceKey'); this.ctx = ctx; } }"
	],
	[/import \{ credentialRef, isCredentialRefName \} from "@deepseek-ai\/dsh-credentials";/, "const credentialRef = (name) => ({ kind: 'env', name });\nconst isCredentialRefName = (value) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);"],
	[/import \{ launchEnvironmentOf \} from "@deepseek-ai\/dsh-launch-environment";/, "const launchEnvironmentOf = (ctx) => ({ get: (k) => ctx.__env?.[k] });"],
	// defineTool 在真实核心包里有校验；测试只需要它原样返回定义，才能核对工具契约。
	[/import \{ defineTool \} from "@deepseek-ai\/dsh-tools";/, "const defineTool = (spec) => spec;"]
];

/** 载入 host 模块（核心包 import 打桩）。 */
export async function loadHostModule() {
	let code = readFileSync(join(ROOT, "lib", "index.js"), "utf8");
	for (const [pattern, stub] of HOST_STUBS) code = code.replace(pattern, stub);
 // 子模块按绝对路径重写：临时目录里的副本必须仍解析到工作区的真实模块，
 // 否则新增的 lib 子模块（如 volcengine.js）在临时目录里找不到。
 for (const mod of ["mimo-login.js", "volcengine.js"]) code = code.replace(`from "./${mod}"`, `from ${JSON.stringify(pathToFileURL(join(ROOT, "lib", mod)).href)}`);
	const file = join(tmpdir(), `dsh-subusage-host-${process.pid}.mjs`);
	writeFileSync(file, code, "utf8");
	return import(pathToFileURL(file).href);
}

/** 载入 client 模块并物化工厂（window/document/react 全部打桩）。 */
export async function loadClientFactory() {
	let captured = null;
	globalThis.window = { __ModuleLoader__: { load(spec) { captured = spec; } } };
	globalThis.document = {
		createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {} }),
		body: { appendChild() {} },
		addEventListener() {},
		removeEventListener() {},
		visibilityState: "visible"
	};
	const code = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
	const file = join(tmpdir(), `dsh-subusage-client-${process.pid}.mjs`);
	writeFileSync(file, code, "utf8");
	await import(pathToFileURL(file).href);
	if (!captured) throw new Error("__ModuleLoader__.load 未被调用");
	const reactStub = {
		createElement: () => null,
		Fragment: Symbol("Fragment"),
		useState: (v) => [typeof v === "function" ? v() : v, () => {}],
		useRef: (v) => ({ current: v }),
		useEffect: () => {},
		useCallback: (f) => f,
		useMemo: (f) => f(),
		useSyncExternalStore: () => null
	};
	const fakeRequire = (spec) => {
		if (spec === "react") return reactStub;
		throw new Error("unexpected require: " + spec);
	};
	const exportsObj = captured.factory(fakeRequire);
	return { id: captured.id, exportsObj };
}

/** 断言小工具。 */
export function makeAssert() {
	let failed = 0;
	const assert = (cond, label) => {
		console.log((cond ? "PASS " : "FAIL ") + label);
		if (!cond) failed += 1;
	};
	assert.summary = () => {
		if (failed > 0) {
			console.error(`${failed} 项断言失败`);
			process.exit(1);
		}
	};
	return assert;
}
