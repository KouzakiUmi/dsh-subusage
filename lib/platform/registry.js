/**
 * 统一适配器注册表（AdapterRegistry）：
 * 管理声明式 HTTP 适配器（sub2api / litellm / custom-http）、原生适配器与联动通道的能力描述。
 */

import { SUB2API_RECIPE, normalizeSub2ApiPayload } from "../adapters/declarative/sub2api.js";
import { LITELLM_RECIPE, normalizeLiteLLMPayload } from "../adapters/declarative/litellm.js";
import { CUSTOM_HTTP_RECIPE, normalizeCustomHttpPayload } from "../adapters/declarative/custom-http.js";

export const DECLARATIVE_RECIPES = new Map([
	[SUB2API_RECIPE.id, { ...SUB2API_RECIPE, normalize: normalizeSub2ApiPayload }],
	[LITELLM_RECIPE.id, { ...LITELLM_RECIPE, normalize: normalizeLiteLLMPayload }],
	[CUSTOM_HTTP_RECIPE.id, { ...CUSTOM_HTTP_RECIPE, normalize: (body, opts) => normalizeCustomHttpPayload(body, opts?.mapping ?? {}) }]
]);

export function getDeclarativeRecipe(adapterId) {
	return DECLARATIVE_RECIPES.get(adapterId);
}

export function listDeclarativeRecipes() {
	return [...DECLARATIVE_RECIPES.values()].map(({ normalize, ...recipe }) => recipe);
}

export function isDeclarativeAdapterId(adapterId) {
	return DECLARATIVE_RECIPES.has(adapterId);
}
