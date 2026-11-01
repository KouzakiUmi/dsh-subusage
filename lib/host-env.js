// dsh-subusage —— Host 运行环境探测。
//
// 只回答一个问题：这台主机是不是 **dsh-go 手机 App 的本机引擎**。dsh-go 在 proot 里跑
// Ubuntu，没有 Chrome/Chromium，也没有可用的 `am` / `xdg-open`（实测 `/system/bin/am`
// 报 `cmd: inaccessible`），所以 `playwright-core` 的 `chromium.launch()` 必然失败：
//   Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
// 桌面 / 服务器主机上这套自动登录照旧可用，不能因为「跑在 Linux 上」就一律关掉。
//
// 判据用 App 自己写的标记文件（与 dsh-go 插件技能文档同一口径：「手机本机引擎有桥接，
// /etc/dsh-app/runtime.json 存在就是」）。文件内容只取版本号用于诊断，不读任何秘密。
//
// 检测必须是**可注入**的：隔离测试用内存 io 跑在同一台手机上，若直接读真实路径，
// 「桌面行为」的用例会被这台机器的标记文件带偏。
export const DSH_GO_RUNTIME_FILE = "/etc/dsh-app/runtime.json";

/** dsh-go 本机引擎的标记文件是否可读；任何异常都当作「不是」。 */
export function detectHostRuntime(io) {
	const runtime = { mobile: false };
	try {
		const parsed = JSON.parse(io.readFileSync(DSH_GO_RUNTIME_FILE, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return runtime;
		runtime.mobile = true;
		if (typeof parsed.runtimeVersion === "string" && parsed.runtimeVersion) runtime.runtimeVersion = parsed.runtimeVersion;
		if (typeof parsed.dshGoBridge === "string" && parsed.dshGoBridge) runtime.bridge = parsed.dshGoBridge;
	} catch { /* 不是 dsh-go：桌面、服务器或远程主机都走这条 */ }
	return runtime;
}

/**
 * 手机引擎没有可用浏览器时的说明。错误码由 Client 按语言本地化，这条只是 Host 侧的兜底原文。
 * 措辞只说事实（没有 Chrome）与下一步（在手机浏览器登录后粘贴 Cookie），不暗示「被禁用」。
 */
export const MOBILE_NO_BROWSER_MESSAGE = "手机本机引擎里没有可用的 Chrome，无法启动临时登录窗口；请在手机浏览器登录官方站点，再把会话 Cookie 粘贴到下方保存";
