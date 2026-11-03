// Trae 中国版：桌面客户端把登录态存在 `storage.json` 里，值是一段自封装密文。
//
// 为什么需要这一层：`~/.trae-cn/trae-jwt-token` 是 TRAE CLI 的 JWT，与桌面客户端的
// `Cloud-IDE-JWT` 不是同一个签发族，拿它调额度接口只会得到 HTTP 401 / code 1001（实测）。
// 唯一可用的凭据是这里解密出来的 `token`。
//
// 密文布局：`[6 字节类型头][32 字节 random][AES-128-CBC 密文]`
//   - 头 `74 63 05 10 00 00` = `aes`，`12 39 20 20 02 03` = `aes-private`
//   - salt = SALT_A ^ SALT_B（`aes-private` 用 SALT_C ^ SALT_D）
//   - key/iv = sha512(sha512(random) || salt) 的前 16 / 次 16 字节
//   - 明文 = sha512(body) || body，前 64 字节是自校验
//
// 四张盐常量与算法照抄 `dsh-connect-trae`（同一台机器的已装实现），因为这是客户端自己定的
// 私有格式、没有公开规格。**客户端大版本升级若换了头或盐，这里会解密失败**——失败就返回
// undefined 让上层回退，不要试图猜格式。
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TRAE_AUTH_STORAGE_KEY = "iCubeAuthInfo://icube.cloudide";

const SALT_A = Uint8Array.from([
	82, 9, 106, 213, 48, 54, 165, 56,
	191, 64, 163, 158, 129, 243, 215, 251,
	124, 227, 57, 130, 155, 47, 255, 135,
	52, 142, 67, 68, 196, 222, 233, 203,
	84, 123, 148, 50, 166, 194, 35, 61,
	238, 76, 149, 11, 66, 250, 195, 78,
	8, 46, 161, 102, 40, 217, 36, 178,
	118, 91, 162, 73, 109, 139, 209, 37,
]);
const SALT_B = Uint8Array.from([
	31, 221, 168, 51, 136, 7, 199, 49,
	177, 18, 16, 89, 39, 128, 236, 95,
	96, 81, 127, 169, 25, 181, 74, 13,
	45, 229, 122, 159, 147, 201, 156, 239,
	160, 224, 59, 77, 174, 42, 245, 176,
	200, 235, 187, 60, 131, 83, 153, 97,
	23, 43, 4, 126, 186, 119, 214, 38,
	225, 105, 20, 99, 85, 33, 12, 125,
]);
const SALT_C = Uint8Array.from([
	191, 192, 216, 250, 122, 246, 220, 97,
	31, 254, 98, 27, 8, 72, 71, 176,
	135, 99, 96, 18, 127, 101, 203, 104,
	211, 102, 191, 125, 37, 72, 150, 156,
	51, 229, 121, 35, 17, 153, 141, 177,
	110, 131, 150, 128, 172, 255, 254, 6,
	18, 140, 55, 62, 236, 249, 135, 64,
	135, 12, 117, 4, 89, 149, 168, 209,
]);
const SALT_D = Uint8Array.from([
	246, 204, 26, 232, 232, 70, 129, 109,
	223, 146, 169, 242, 23, 241, 105, 145,
	50, 196, 165, 42, 254, 120, 3, 54,
	244, 207, 209, 85, 53, 6, 138, 106,
	175, 148, 31, 204, 186, 186, 165, 182,
	87, 142, 49, 10, 39, 110, 26, 154,
	86, 56, 173, 125, 18, 64, 198, 225,
	99, 99, 83, 82, 191, 134, 76, 170,
]);
const xor = (left, right) => Uint8Array.from(left, (value, index) => value ^ right[index]);
const HEADER_AES = Buffer.from([116, 99, 5, 16, 0, 0]);
const HEADER_PRIVATE = Buffer.from([18, 57, 32, 32, 2, 3]);

/** 头 → 加密族；认不出就当格式已变，直接失败，不猜。 */
function encryptionType(header) {
	const hex = header.toString("hex");
	if (hex === "746305100000") return "aes";
	if (hex === "123920200203") return "aes-private";
	return undefined;
}

/** 解一段 `storage.json` 里的密文；失败返回 undefined（上层据此回退，不抛给用户）。 */
export function decryptTraeStorageValue(encoded) {
	try {
		const buffer = Buffer.from(String(encoded ?? ""), "base64");
		if (buffer.length <= 102) return undefined;
		const type = encryptionType(buffer.subarray(0, 6));
		if (!type) return undefined;
		const random = buffer.subarray(6, 38), encrypted = buffer.subarray(38);
		const salt = type === "aes-private" ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B);
		const first = createHash("sha512").update(random).digest();
		const derived = createHash("sha512").update(Buffer.concat([first, Buffer.from(salt)])).digest();
		const decipher = createDecipheriv("aes-128-cbc", derived.subarray(0, 16), derived.subarray(16, 32));
		const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
		if (plain.length < 64) return undefined;
		const expected = plain.subarray(0, 64), payload = plain.subarray(64);
		if (!expected.equals(createHash("sha512").update(payload).digest())) return undefined;
		return payload.toString("utf8");
	} catch { return undefined; }
}

/**
 * 反向封装。本插件不需要回写 Trae 的文件，实现它有两个用处：
 * 一是回归里能造出合法密文，真正覆盖解密成功路径（只有失败路径的测试锁不住这个私有格式）；
 * 二是将来若要做「清理失效账号」之类需要写回的改动时有现成入口。
 */
export function encryptTraeStorageValue(payload, { type = "aes", random } = {}) {
	const rand = Buffer.from(random ?? randomBytes(32));
	if (rand.length !== 32) throw new TypeError("Trae 随机前缀必须是 32 字节");
	const salt = type === "aes-private" ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B);
	const first = createHash("sha512").update(rand).digest();
	const derived = createHash("sha512").update(Buffer.concat([first, Buffer.from(salt)])).digest();
	const body = Buffer.from(String(payload), "utf8");
	const cipher = createCipheriv("aes-128-cbc", derived.subarray(0, 16), derived.subarray(16, 32));
	const sealed = Buffer.concat([createHash("sha512").update(body).digest(), body]);
	const encrypted = Buffer.concat([cipher.update(sealed), cipher.final()]);
	return Buffer.concat([type === "aes-private" ? HEADER_PRIVATE : HEADER_AES, rand, encrypted]).toString("base64");
}

/** Trae 桌面客户端的 `storage.json` 候选路径（Windows 下按 APPDATA 推导）。 */
/**
 * Trae 插件的账号池（`$DSH_HOME/.trae-auth.<region>.json`，v2 `{version, credentials:[...]}`）。
 * 客户端 `storage.json` 只有「当前登录」那一个账号，**多账号只在这里**。
 */
export function traePoolCandidates(environment = process.env, dshHome = environment.DSH_HOME || join(environment.USERPROFILE ?? "", ".dsh")) {
	const out = [];
	for (const region of ["cn", "ai"]) out.push(join(dshHome, `.trae-auth.${region}.json`));
	out.push(join(dshHome, ".trae-auth.json"));
	return [...new Set(out)];
}

export function traeStorageCandidates(environment = process.env) {
	const roots = [environment.APPDATA, join(environment.USERPROFILE ?? "", "AppData", "Roaming")].filter(Boolean);
	const names = ["Trae CN", "trae-cn"];
	const out = [];
	for (const root of roots) for (const name of names) out.push(join(root, name, "User", "globalStorage", "storage.json"));
	return [...new Set(out)];
}

/** 池里的单条凭据：字段名与客户端 `storage.json` 不同（`accessToken` / `accountName` / `expiresAtMs`）。 */
function poolCredential(row) {
	const token = typeof row?.accessToken === "string" ? row.accessToken : typeof row?.token === "string" ? row.token : "";
	if (!token) return undefined;
	const region = (typeof row?.userRegion === "object" && row.userRegion ? row.userRegion.region : row?.userRegion) ?? "CN";
	const expires = Number(row?.expiresAtMs);
	return {
		access_token: token,
		region: typeof region === "string" ? region.toUpperCase() : "CN",
		...(typeof row?.accountName === "string" && row.accountName ? { nickname: row.accountName } : {}),
		...(Number.isFinite(expires) && expires > 0 ? { expires_at: String(expires) } : {}),
		...(row?.userId !== undefined && row.userId !== null ? { userId: String(row.userId) } : {}),
	};
}

/**
 * 读一个 Trae 凭据文件的**全部**账号：
 *  - 账号池 `{version, credentials:[...]}` → 每条一个账号（多账号只在这里）；
 *  - 客户端 `storage.json` → 解出当前登录的单条。
 * 返回 `undefined` 表示这个文件不是可用的凭据来源。
 */
export function readTraeCredentials(file, { readFile = readFileSync } = {}) {
	let document;
	try { document = JSON.parse(readFile(file, "utf8")); } catch { return undefined; }
	if (Array.isArray(document?.credentials)) {
		const rows = document.credentials.map(poolCredential).filter(Boolean);
		return rows.length ? rows : undefined;
	}
	const single = readTraeCredential(file, { readFile: () => JSON.stringify(document) });
	return single ? [single] : undefined;
}

/**
 * 读一份 `storage.json` 并解出凭据。只读、不写回——Trae 客户端运行时会覆写这个文件，
 * 我们只当它是别人家的数据。
 */
export function readTraeCredential(file, { readFile = readFileSync } = {}) {
	let document;
	try { document = JSON.parse(readFile(file, "utf8")); } catch { return undefined; }
	const encoded = document?.[TRAE_AUTH_STORAGE_KEY];
	if (typeof encoded !== "string" || !encoded) return undefined;
	// 有些客户端版本直接把明文 JSON 放在同一个键里，而不是密文；两种都要认。
	const plain = encoded.trimStart().startsWith("{") ? encoded : decryptTraeStorageValue(encoded);
	if (!plain) return undefined;
	let auth;
	try { auth = JSON.parse(plain); } catch { return undefined; }
	const token = typeof auth?.token === "string" ? auth.token : typeof auth?.accessToken === "string" ? auth.accessToken : "";
	if (!token) return undefined;
	const region = (typeof auth?.userRegion === "object" && auth.userRegion ? auth.userRegion.region : auth?.userRegion) ?? "CN";
	return {
		access_token: token,
		region: typeof region === "string" ? region.toUpperCase() : "CN",
		...(typeof auth?.refreshToken === "string" && auth.refreshToken ? { refreshToken: auth.refreshToken } : {}),
		...(typeof auth?.expiredAt === "string" && auth.expiredAt ? { expires_at: String(Date.parse(auth.expiredAt)) } : {}),
		...(typeof auth?.userId === "string" || typeof auth?.userId === "number" ? { userId: String(auth.userId) } : {}),
		...(typeof auth?.account?.username === "string" ? { nickname: auth.account.username } : {}),
	};
}
