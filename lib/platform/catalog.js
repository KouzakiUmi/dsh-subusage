/**
 * 动态目录（Catalog）投影构建：
 * 向 Client 与 Go 面板下发声明式适配器模板列表（recipes）与用户已配置连接实例（instances）。
 */

import { listDeclarativeRecipes } from "./registry.js";
import { publicInstanceView } from "./instances.js";

export function buildPlatformCatalog(settings = {}) {
	const instances = Array.isArray(settings.instances) ? settings.instances : [];
	const secrets = settings.instanceSecrets && typeof settings.instanceSecrets === "object"
		? settings.instanceSecrets
		: {};
	return {
		recipes: listDeclarativeRecipes(),
		instances: instances.map(inst => publicInstanceView(inst, Boolean(secrets[inst.id])))
	};
}
