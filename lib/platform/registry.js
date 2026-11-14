/**
 * 统一适配器注册表（AdapterRegistry）：
 * 管理声明式 HTTP 适配器（sub2api / litellm / custom-http）、原生适配器与联动通道的能力描述。
 */

import { SUB2API_RECIPE, normalizeSub2ApiPayload } from "../adapters/declarative/sub2api.js";
import { LITELLM_RECIPE, normalizeLiteLLMPayload } from "../adapters/declarative/litellm.js";
import { CUSTOM_HTTP_RECIPE, normalizeCustomHttpPayload } from "../adapters/declarative/custom-http.js";
import { NEWAPI_ADAPTER_RECIPE, normalizeNewApiPayload } from "../adapters/declarative/newapi.js";
import { newapiRoot } from "../providers/newapi.js";

export const DECLARATIVE_RECIPES = new Map([
	[SUB2API_RECIPE.id, { ...SUB2API_RECIPE, normalize: normalizeSub2ApiPayload }],
	[LITELLM_RECIPE.id, { ...LITELLM_RECIPE, normalize: normalizeLiteLLMPayload }],
	[NEWAPI_ADAPTER_RECIPE.id, { ...NEWAPI_ADAPTER_RECIPE, normalize: normalizeNewApiPayload }],
	[CUSTOM_HTTP_RECIPE.id, { ...CUSTOM_HTTP_RECIPE, normalize: (body, opts) => normalizeCustomHttpPayload(body, opts?.mapping ?? {}) }]
]);

/** 站点根归一（recipe.baseUrlMode 声明）：newapi 剥末层 /v1 与 /api；非法根原样交由 URL 校验报错。 */
export function recipeNormalizedBaseUrl(recipe, baseUrl) {
	if (typeof baseUrl !== "string") return baseUrl;
	if (recipe?.baseUrlMode === "newapi-root") return newapiRoot(baseUrl) || baseUrl;
	return baseUrl;
}

export function getDeclarativeRecipe(adapterId) {
	return DECLARATIVE_RECIPES.get(adapterId);
}

export function listDeclarativeRecipes() {
	return [...DECLARATIVE_RECIPES.values()].map(({ normalize, ...recipe }) => recipe);
}

export function isDeclarativeAdapterId(adapterId) {
	return DECLARATIVE_RECIPES.has(adapterId);
}
