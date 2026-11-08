/**
 * 凭据生命周期归属与脱敏规则：
 * - read-only：本插件只读凭据，不主动刷新、不签到、不轮换 refresh_token（防止与兄弟插件抢刷新权）；
 * - delegate：委托提供方插件或服务执行认证；
 * - managed：本插件自管登录会话（仅限已声明的专用通道，如 MiMo 扫码续期）。
 */

export const LIFECYCLE_MODES = ["read-only", "delegate", "managed"];

export function validateLifecycleMode(mode) {
	if (!LIFECYCLE_MODES.includes(mode)) {
		throw new Error(`未知凭据生命周期模式「${String(mode)}」`);
	}
	return mode;
}

/**
 * 秘密值脱敏展示（严禁在日志、诊断、导出或公开设置中保留明文）。
 */
export function redactSecretString(value) {
	if (typeof value !== "string" || !value.trim()) return "";
	return "[REDACTED]";
}
