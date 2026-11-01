// dsh-subusage —— 小米账号二维码登录（MiMo Token Plan）。
//
// 为什么需要它：MiMo 的套餐额度接口 `/api/v1/tokenPlan/*` **只认控制台会话 Cookie**
// （`api-platform_serviceToken` + `userId`），推理用的 `tp-` / `sk-` API Key 读不到
// （实测两者都返回 401 loginUrl）。而手机上所有浏览器都不再允许导出 Cookie，
// 手动粘贴这条路在移动端等于不存在。
//
// 小米账号支持"用小米手机扫一扫"授权：协议全程是普通 HTTP，不需要浏览器。
// 手机端「设置 > 小米账号」里自带扫码器，扫码即确认，于是这条路绕开了"浏览器导不出 Cookie"
// 的死结。走的是官方 `sid=api-platform` 通道，扫码页由小米自己渲染。
//
// 协议（每一步都实测过，顺序不能变）：
//   1. GET  account.xiaomi.com/pass/serviceLogin?sid=api-platform&_json=true
//      → 拿到 `_sign` 与初始 Cookie（其中 `deviceId` 是必须带上的：缺它扫码后
//        小米会回 `70036 系统错误`，带上就正常，这一点是实测踩出来的）
//   2. GET  account.xiaomi.com/longPolling/loginUrl?...&_sign=...&qs=...
//      → 拿到二维码图片地址 `qr` 与长轮询地址 `lp`
//   3. GET  `lp`（长轮询，最长 300 秒）：扫码并确认后返回 `userId` / `passToken` /
//      `nonce` / `ssecurity` / `location`
//   4. GET  `location` + `&clientSign=`，其中
//      `clientSign = base64(sha1("nonce=<nonce>&<ssecurity>"))`
//      → 下发 `api-platform_serviceToken` 等控制台 Cookie
//
// **nonce 精度陷阱**：`nonce` 是 19 位整数（如 `1234567890123456789`），
// `JSON.parse` 会把它变成 `1582322695214276000`（超出 2^53），签名随之算错，
// 服务端一律回 401。必须先用正则从原文里取出字面量再参与签名。这个坑排查了四轮。
//
// 登录态有效期：`passToken` Cookie 是**一个月**（扫码响应里带 `Max-Age`），
// 控制台 `serviceToken` 按服务端声明通常 24 小时。所以保存 `userId` + `passToken`，
// 每次取数前重新走第 1、4 步换票，而不是保存 24 小时的会话 Cookie。
import { createHash, randomUUID } from "node:crypto";

export const MIMO_QR_SID = "api-platform";
export const MIMO_QR_CALLBACK = "https://platform.xiaomimimo.com/sts";
export const MIMO_QR_ORIGIN = "https://platform.xiaomimimo.com";
/** 扫码页自带说明：用小米手机「设置 > 小米账号」里的扫码器。 */
const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const START = /^&&&START&&&/;
// 官方域名白名单：换票回调在 platform.xiaomimimo.com，二维码与长轮询在 account/lp 的 xiaomi.com 子域。
const TRUSTED_STS_PREFIXES = ["https://platform.xiaomimimo.com/sts"];
const TRUSTED_ACCOUNT_PREFIXES = ["https://account.xiaomi.com/", "https://ak.account.xiaomi.com/"];
const TRUSTED_LP_PREFIXES = ["https://account.xiaomi.com/", "https://ak.lp.account.xiaomi.com/", "https://lp.account.xiaomi.com/", "https://c3.lp.account.xiaomi.com/"];
const ACTIVE_STATES = ["starting", "waiting", "verifying"];

/** 小米 SSO 的响应体统一带 `&&&START&&&` 前缀，去掉后再解析。 */
const json = (text) => JSON.parse(String(text ?? "").replace(START, ""));

/**
 * 保留 `nonce` 原始字面量的解析器。
 *
 * 必须这么做：19 位整数超过 `Number.MAX_SAFE_INTEGER`，`JSON.parse` 会静默改写末几位，
 * 用它算出来的 `clientSign` 服务端不认（401）。其余字段照常走 JSON。
 * @param text 原始响应文本
 */
export function parsePollResponse(text) {
	const body = String(text ?? "").replace(START, "");
	const parsed = JSON.parse(body);
	const literal = body.match(/"nonce"\s*:\s*(-?\d+)/);
	// 只在字面量与解析结果不一致时才替换，避免把普通小整数也变成字符串。
	if (literal && String(parsed.nonce) !== literal[1]) parsed.nonce = literal[1];
	return parsed;
}

/** `clientSign = base64(sha1("nonce=<nonce>&<ssecurity>"))`，小米 STS 换票的签名。 */
export function clientSign(nonce, ssecurity) {
	return Buffer.from(createHash("sha1").update(`nonce=${nonce}&${ssecurity}`).digest()).toString("base64");
}

/** 从 `Set-Cookie` 头拼出请求用的 Cookie 串（只取 name=value）。 */
export function cookieHeader(setCookies) {
	return (setCookies ?? []).map(raw => String(raw).split(";")[0]).filter(part => part.includes("=")).join("; ");
}

/** 把 `Set-Cookie` 解析成 name/value 对，供上层挑选需要的项。 */
export function parseSetCookies(setCookies) {
	return (setCookies ?? []).map(raw => {
		const [pair] = String(raw).split(";");
		const index = pair.indexOf("=");
		return index < 0 ? null : { name: pair.slice(0, index).trim(), value: pair.slice(index + 1) };
	}).filter(Boolean);
}

/**
 * 只接受官方域名的 URL。
 *
 * `qr` / `lp` / `location` 都来自服务端响应——那是外部输入。把含 `passToken` 的 Cookie
 * 发往响应里任意给出的地址，等于让一次投毒把小米账号凭据送到别处去。这里按前缀白名单卡死。
 * @param raw 待校验地址
 * @param allowed 允许的 https 前缀列表
 */
export function assertTrustedUrl(raw, allowed) {
	let url;
	try { url = new URL(String(raw ?? "")); } catch { throw new Error("invalid-url"); }
	if (url.protocol !== "https:") throw new Error("insecure-url");
	if (!allowed.some(prefix => url.href.startsWith(prefix))) throw new Error("untrusted-url");
	return url.href;
}
const headerGet = (response, name) => response?.headers?.get?.(name) ?? null;
const setCookieOf = (response) => response?.headers?.getSetCookie?.() ?? [];

/**
 * 一次扫码登录的完整状态机。
 *
 * 与 `CookieLogin` 并列而不是嵌进去：那套骨架是"开浏览器 → 抓 Cookie → 验证"，
 * 这里全程无浏览器、多了一步换票，且二维码本身要交给 UI 显示，生命周期差别太大。
 * 终态语义沿用 `CookieLogin`（starting / waiting / verifying / success / error / cancelled），
 * 这样 Client 的登录卡片可以复用同一套渲染。
 */
export class MimoQrLogin {
	/**
	 * @param callbacks 与 CookieLogin 同形：error / capture / verify / commit / reconcileResult
	 * @param options now / fetch / pollMs / timeoutMs / userAgent / accountBase 均可注入，便于隔离测试
	 */
	constructor(callbacks, options = {}) {
		this.callbacks = callbacks;
		this.options = options;
		this.now = options.now ?? Date.now;
		this.fetch = options.fetch ?? globalThis.fetch;
		this.current = null;
		this.disposed = false;
	}

	/** 当前扫码任务的可公开状态（不含凭据）。 */
	status() {
		const job = this.current;
		if (!job) return { jobId: null, state: "idle" };
		// 成功终态可被 UI 反复轮询，但不能回放旧身份。
		if (job.public.state === "success" && this.callbacks.reconcileResult) {
			let result;
			try { result = this.callbacks.reconcileResult(job.public.result); } catch { result = null; }
			if (!result) { this.current = null; return { jobId: null, state: "idle" }; }
			job.public.result = result;
		}
		return structuredClone(job.public);
	}

	/**
	 * 开始一次扫码登录：立刻返回状态，二维码在出码后写入状态里供 UI 轮询。
	 * 返回值不含任何凭据。
	 */
	start(request = {}) {
		if (this.disposed) throw this.callbacks.error("subusage/disposed", "服务已卸载");
		if (this.current && ACTIVE_STATES.includes(this.current.public.state)) return this.status();
		// 上一个任务若已到终态，它的定时器与长轮询可能还挂着：先回收，避免遗留请求跑到超时。
		if (this.current) { clearTimeout(this.current.timer); this.current.controller.abort(); }
		const captured = this.callbacks.capture(request.expectedRevision);
		const job = {
			// channel 让 Client 知道这是扫码任务：它要轮询 getMimoQrStatus，而不是浏览器登录的 status。
			public: { jobId: randomUUID(), state: "starting", startedAt: new Date(this.now()).toISOString(), message: "正在获取小米登录二维码", channel: "qr" },
			controller: new AbortController(),
			captured,
			qrDataUrl: null,
			qrTip: null
		};
		this.current = job;
		job.timer = setTimeout(() => this.finish(job, "error", "subusage/login-timeout", "二维码已过期，请重新获取"), this.options.timeoutMs ?? 300000);
		// 出码只排队，RPC 不等待网络或人工扫码。
		void Promise.resolve().then(() => this.run(job));
		return this.status();
	}

	alive(job) { return !!job && !job.controller.signal.aborted && !this.disposed && this.current === job; }

	finish(job, state, errorCode, message, result) {
		if (!job || this.current !== job) return;
		if (job.public.state === "success" && state !== "success") return;
		Object.assign(job.public, {
			state,
			finishedAt: new Date(this.now()).toISOString(),
			...(errorCode ? { errorCode } : {}),
			...(message ? { message } : {}),
			...(result ? { result } : {})
		});
		clearTimeout(job.timer);
		job.controller.abort();
	}

	cancel(request = {}) {
		const job = this.current;
		if (job && job.public.jobId === request.jobId && ACTIVE_STATES.includes(job.public.state)) {
			this.finish(job, "cancelled", undefined, "已取消扫码登录");
		}
		return this.status();
	}

	dispose() {
		if (this.current && ACTIVE_STATES.includes(this.current.public.state)) this.finish(this.current, "cancelled", undefined, "服务已卸载，登录已取消");
		this.disposed = true;
	}

	async run(job) {
		const headers = { "User-Agent": this.options.userAgent ?? DEFAULT_UA, Referer: `${MIMO_QR_ORIGIN}/` };
		try {
			// 步骤 1：取 _sign 与初始 Cookie（deviceId 缺了会让扫码报 70016/70036）
			const first = await this.fetch(`${this.accountBase()}/pass/serviceLogin?sid=${MIMO_QR_SID}&_json=true`, { headers, signal: job.controller.signal });
			const baseCookies = cookieHeader(setCookieOf(first));
			const signed = json(await first.text());
			if (!this.alive(job)) return;
			if (!signed?._sign) throw this.callbacks.error("subusage/login-protocol", "小米登录接口未返回签名，请稍后重试");

			// 步骤 2：换二维码
			const query = new URLSearchParams({ sid: MIMO_QR_SID, _sign: signed._sign, callback: MIMO_QR_CALLBACK, qs: signed.qs ?? "", _json: "true" });
			const second = await this.fetch(`${this.accountBase()}/longPolling/loginUrl?${query}`, { headers: { ...headers, Cookie: baseCookies, Referer: `${this.accountBase()}/` }, signal: job.controller.signal });
			const issued = json(await second.text());
			if (!this.alive(job)) return;
			if (issued?.code !== 0 || !issued?.qr) throw this.callbacks.error("subusage/login-protocol", "未能获取登录二维码，请稍后重试");

			// 二维码转 data URL 交给 UI；Host 不落盘、不暴露 lp 地址（那是本次会话的票据）。
			// qr 与 lp 同样来自响应体：二维码地址若指向别处，等于把"本次登录票据"送出去。
			let qrUrl, lpUrl;
			try {
				qrUrl = assertTrustedUrl(issued.qr, TRUSTED_ACCOUNT_PREFIXES);
				lpUrl = assertTrustedUrl(issued.lp, TRUSTED_LP_PREFIXES);
			} catch { throw this.callbacks.error("subusage/login-protocol", "登录二维码地址不是官方域名，已中止"); }
			const image = await this.fetch(qrUrl, { headers: { ...headers, Cookie: baseCookies }, signal: job.controller.signal });
			const bytes = Buffer.from(await image.arrayBuffer());
			job.qrDataUrl = `data:${headerGet(image, "content-type")?.split(";")[0] || "image/png"};base64,${bytes.toString("base64")}`;
			job.qrTip = typeof issued.qrTips === "string" ? issued.qrTips : null;
			Object.assign(job.public, {
				state: "waiting",
				message: "请用小米手机「设置 > 小米账号」里的扫码器扫描二维码",
				qr: job.qrDataUrl,
				qrTip: job.qrTip,
				expiresInSec: Number(issued.timeout) || 300
			});

			// 步骤 3：长轮询等扫码确认
			const poll = await this.fetch(lpUrl, { headers: { ...headers, Cookie: baseCookies }, signal: job.controller.signal });
			if (!this.alive(job)) return;
			const scanned = parsePollResponse(await poll.text());
			if (scanned?.code !== 0 || !scanned?.location) throw this.callbacks.error("subusage/auth", "扫码未完成或已取消，请重新获取二维码");
			// 换票签名要 nonce 与 ssecurity；缺任何一个都只能算出无效签名（服务端 401），
			// 必须在这里点明，否则会被当成"扫码未完成"，让人反复扫码却始终失败。
			if (!scanned.nonce || !scanned.ssecurity) throw this.callbacks.error("subusage/login-protocol", "扫码结果缺少换票参数，请重新扫码");
			// 凭据：passToken 一个月，serviceToken 24 小时。只留换票要用的，其余不保存。
			const identity = { userId: String(scanned.userId ?? ""), passToken: typeof scanned.passToken === "string" ? scanned.passToken : "" };
			if (!identity.userId || !identity.passToken) throw this.callbacks.error("subusage/login-protocol", "扫码结果缺少账号凭据，请重新扫码");

			// 步骤 4：签名换 serviceToken
			Object.assign(job.public, { state: "verifying", message: "扫码成功，正在验证账户与套餐额度" });
			// 必须**合并**而不是替换：长轮询的 Set-Cookie 通常只有 passToken/userId，把第 1 步的
// deviceId 丢掉会让后续请求被小米当作陌生设备（扫码阶段报 70036 就是这个原因）。
			const ticketCookies = [baseCookies, cookieHeader(setCookieOf(poll))].filter(Boolean).join("; ");
			const cookie = await this.exchange(job, identity, scanned, ticketCookies);
			if (!this.alive(job)) return;

			// 用换到的控制台 Cookie 走原有验证 / 保存路径，与手动粘贴 Cookie 完全一致。
			const verified = await this.callbacks.verify(cookie, job.controller.signal);
			if (!this.alive(job)) return;
			const result = this.callbacks.commit(cookie, job.captured, verified, this.expiryOf(poll));
			this.finish(job, "success", undefined, verified.coverage === "complete" && verified.windows?.length ? "扫码登录成功，套餐额度已验证并保存" : "扫码登录已保存；仅余额可读，订阅额度未知", result);
		} catch (e) {
			// 先判 AbortError：取消/超时会 abort controller，此时 alive 已经为 false，
			// 若先判 alive 就把这一支变成死代码，且真实的中断会被错报成网络失败。
			if (e?.name === "AbortError") { this.finish(job, "cancelled", undefined, "登录已取消"); return; }
			if (!this.alive(job)) return;
			if (["subusage/revision-conflict", "subusage/invalid-request", "subusage/config", "subusage/auth", "subusage/login-protocol", "subusage/disposed"].includes(e?.code)) {
				// 已知错误的文案来自本模块（固定中文），不透传上游异常文本，避免把响应内容带进 UI。
				this.finish(job, "error", e.code, e.message || "扫码登录失败"); return;
			}
			this.finish(job, "error", "subusage/login-network", "无法连接小米登录服务，请检查网络后重试");
		}
	}

	/** 用扫码得到的 location + clientSign 换控制台会话 Cookie。 */
	async exchange(job, identity, scanned, ticketCookies) {
		const sign = clientSign(scanned.nonce, scanned.ssecurity);
		// location 来自响应体，必须确认它仍在官方域内，再带上 passToken 去请求。
		let location;
		try { location = assertTrustedUrl(scanned.location, TRUSTED_STS_PREFIXES); }
		catch { throw this.callbacks.error("subusage/login-protocol", "换票地址不是官方域名，已中止以免凭据外流"); }
		const url = `${location}&clientSign=${encodeURIComponent(sign)}`;
		const response = await this.fetch(url, {
			headers: { "User-Agent": this.options.userAgent ?? DEFAULT_UA, Cookie: ticketCookies },
			redirect: "manual",
			signal: job.controller.signal
		});
		const cookies = parseSetCookies(setCookieOf(response));
		const serviceToken = cookies.find(item => item.name === "api-platform_serviceToken");
		const userId = cookies.find(item => item.name === "userId");
		if (!serviceToken?.value) throw this.callbacks.error("subusage/auth", "换票失败：小米未下发控制台会话，请重新扫码");
		// 控制台 Cookie 必须同时带 userId，否则额度接口仍回 401。
		return `api-platform_serviceToken=${serviceToken.value}; userId=${userId?.value ?? identity.userId}`;
	}

	/** 取 passToken 的声明有效期（毫秒）；没有声明就返回 0，由上层按既有上限处理。 */
	expiryOf(response) {
		for (const raw of setCookieOf(response)) {
			const text = String(raw);
			if (!text.trimStart().startsWith("passToken=")) continue;
			const maxAge = text.match(/Max-Age=(\d+)/i);
			if (maxAge) return this.now() + Number(maxAge[1]) * 1000;
		}
		return 0;
	}

	accountBase() { return this.options.accountBase ?? "https://account.xiaomi.com"; }
}
