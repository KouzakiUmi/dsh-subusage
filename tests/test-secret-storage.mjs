// 秘密加密存储回归：enc:v1 AES-256-GCM 落盘、跨实例密钥持久化、明文迁移、坏密文隔离。
// 全部为内存文件系统，不落真盘。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService } = await loadHostModule();
const Z = "zai-coding-cn";

function harness(initial = {}) {
	const files = new Map(Object.keys(initial).length ? [["memory/config", JSON.stringify(initial)]] : []);
	const io = {
		readFileSync: p => { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); },
		mkdirSync() {},
		writeFileSync: (p, v) => files.set(p, v),
		chmodSync() {},
		renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }
	};
	const ctx = { get() {}, llm: { listProviders: () => [{ id: Z }] }, effect() {} };
	const service = new SubUsageService(ctx, { io, configPath: "memory/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined, fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" }) });
	return { service, files, io, ctx };
}

// 1. 保存手动 Key：磁盘上是 enc:v1 密文，service.load() 还原明文。
{
	const h = harness();
	await h.service.save({ providerId: Z, keyUpdate: { action: "replace", value: "sk-plaintext-key-1" } });
	const stored = JSON.parse(h.files.get("memory/config"));
	assert.ok(stored.keys[Z].startsWith("enc:v1:"), "手动 Key 必须以 enc:v1 落盘");
	assert.ok(!stored.keys[Z].includes("sk-plaintext"), "密文不得含明文");
	assert.equal(h.service.load().keys[Z], "sk-plaintext-key-1", "load() 解密回明文");
	// 密钥文件已生成且与配置分离。
	assert.ok(h.files.has("memory/config.key"), "密钥文件独立存放");
	console.log("PASS 手动 Key 加密落盘 + load() 解密");
}

// 2. 跨实例重启：第二个 service 用同一份密钥文件解密旧密文。
{
	const h = harness();
	await h.service.save({ providerId: Z, keyUpdate: { action: "replace", value: "sk-persist-across" } });
	h.service.dispose();
	const service2 = new SubUsageService(h.ctx, { io: h.io, configPath: "memory/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined });
	assert.equal(service2.load().keys[Z], "sk-persist-across", "重启后旧密文仍可解");
	service2.dispose();
	console.log("PASS 密钥文件跨实例复用");
}

// 3. 旧明文配置迁移：读回照常工作，下一次保存自动加密。
{
	const h = harness({ keys: { [Z]: "legacy-plaintext" }, keyModes: { [Z]: "manual" } });
	assert.equal(h.service.load().keys[Z], "legacy-plaintext", "旧明文照常解密透传");
	await h.service.save({ providerId: Z, keyUpdate: { action: "replace", value: "legacy-plaintext" } });
	const stored = JSON.parse(h.files.get("memory/config"));
	assert.ok(stored.keys[Z].startsWith("enc:v1:"), "再保存自动迁移为密文");
	console.log("PASS 旧明文配置自动迁移加密");
}

// 4. MiMo Cookie 与续期材料加密：cookie 字段与 renewal 对象均以 enc:v1 存储。
{
	const h = harness();
	await h.service.save({
		providerId: "xiaomi-token-plan-cn",
		cookieUpdate: { action: "replace", value: "api-platform_serviceToken=MIMO_TOKEN_X; userId=u-1" }
	});
	const stored = JSON.parse(h.files.get("memory/config"));
	assert.ok(stored.xiaomi.cookie.startsWith("enc:v1:"), "MiMo Cookie 必须以密文落盘");
	assert.equal(h.service.load().xiaomi.cookie, "api-platform_serviceToken=MIMO_TOKEN_X; userId=u-1", "Cookie 解密回原文");
	console.log("PASS MiMo Cookie 加密落盘");
}

// 5. 坏密文：单条解密失败返回空值，不污染其他字段，不崩溃。
{
	const h = harness({ keys: { [Z]: "enc:v1:AAAA:BBBB:CCCC" }, volc: { accessKeyId: "enc:v1:ZZZZ:YYYY:XXXX", secretAccessKey: "" } });
	const s = h.service.load();
	assert.equal(s.keys[Z], "", "坏密文解密为空调用未配置");
	assert.equal(s.volc.accessKeyId, "", "坏密文不泄漏乱码");
	console.log("PASS 坏密文安全降级为空值");
}

// 6. 密钥文件损坏：拒绝整体读取并报错，不静默生成新密钥覆盖。
{
	const h = harness({ keys: { [Z]: "enc:v1:AAA:BBB:CCC" } });
	h.files.set("memory/config.key", "!!!not-base64-key!!!");
	assert.throws(() => h.service.load(), e => e.code === "subusage/config" || e.code === "subusage/key-corrupt", "密钥损坏必须显式失败");
	console.log("PASS 密钥文件损坏显式报错");
}

console.log("PASS 秘密加密存储：落盘密文、跨实例解密、明文迁移、坏密文隔离、密钥损坏报错");
