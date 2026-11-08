/**
 * 本地秘密加密存储（Secret Box）：
 * - AES-256-GCM，随机 IV，密钥为随机 256 位、独立存放在 ~/.dsh/dsh-subusage.key（0600）；
 * - 密文格式 enc:v1:<iv_b64>:<tag_b64>:<ct_b64>，只加密用户输入/登录获得的秘密
 *   （手动 Key、Ark AK/SK、MiMo Cookie 与续期材料、实例秘密）；
 * - 明文兼容：读回时非 enc: 前缀值按旧明文透传，下次保存自动加密迁移；
 * - 密钥生成/读取全部走注入的 io 层，隔离测试不落真盘。
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const KEY_BYTES = 32;

export function encryptSecretJson(value, key) {
	if (value === undefined || value === null) return value;
	return encryptSecret(JSON.stringify(value), key);
}

/** 解密 JSON 包裹的秘密（失败/非密文透传原值，兼容旧明文对象）。 */
export function decryptSecretJson(value, key) {
	const plain = decryptSecret(value, key);
	if (typeof plain !== "string" || !plain.startsWith("{")) return value;
	try { return JSON.parse(plain); } catch { return undefined; }
}

export function isEncryptedValue(value) {
	return typeof value === "string" && value.startsWith(PREFIX);
}

/** 惰性加载/生成密钥：文件缺失则生成并写入；io 不支持写入时退化为本进程随机密钥（测试桩友好）；损坏文件抛错。 */
export function loadSecretKey(io, keyPath) {
	let raw;
	try {
		raw = io.readFileSync(keyPath, "utf8");
	} catch (e) {
		if (e?.code !== "ENOENT") throw e;
		const key = randomBytes(KEY_BYTES);
		if (typeof io.writeFileSync === "function" && typeof io.mkdirSync === "function") {
			try {
				io.mkdirSync(dirnameOf(keyPath), { recursive: true, mode: 0o700 });
				io.writeFileSync(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
				io.chmodSync?.(keyPath, 0o600);
			} catch {
				// 密钥文件写不进去时仍可用进程内密钥完成本次会话；重启后旧密文不可解，
				// 但配置文件损坏面不变（密文丢弃=重新输入），优于阻塞整个设置读写。
			}
		}
		return key;
	}
	const key = Buffer.from(String(raw).trim(), "base64");
	if (key.length !== KEY_BYTES) {
		const err = new Error("秘密密钥文件已损坏，请删除 ~/.dsh/dsh-subusage.key 后重新保存凭据（已加密的秘密将无法恢复，需要重新输入）");
		err.code = "subusage/key-corrupt";
		throw err;
	}
	return key;
}

function dirnameOf(path) {
	const norm = String(path).replace(/\\/g, "/");
	const idx = norm.lastIndexOf("/");
	return idx > 0 ? norm.slice(0, idx) : ".";
}

export function encryptSecret(value, key) {
	if (typeof value !== "string" || value === "") return value;
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

/** 解密 enc:v1 密文；非密文按明文透传（旧配置迁移），密文损坏返回 undefined 而不是垃圾。 */
export function decryptSecret(value, key) {
	if (typeof value !== "string" || value === "") return value;
	if (!isEncryptedValue(value)) return value;
	const parts = value.slice(PREFIX.length).split(":");
	if (parts.length !== 3) return undefined;
	try {
		const [ivB64, tagB64, ctB64] = parts;
		const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
		decipher.setAuthTag(Buffer.from(tagB64, "base64"));
		return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
	} catch {
		return undefined;
	}
}
