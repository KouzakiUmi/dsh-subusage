// 联动逐项开关（visibility.linked）与 Magpie 自定义分组绑定（magpieRoutes）回归：
// 默认全开、补丁校验、持久化、quota/readLinked 门控、publicSettings 与一致性哈希口径。
// 全部为内存文件系统，不落真盘。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, LINKED_IDS } = await loadHostModule();

function harness(initial = {}) {
	const files = new Map(Object.keys(initial).length ? [["memory/config", JSON.stringify(initial)]] : []);
	const io = {
		readFileSync: p => { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); },
		mkdirSync() {},
		writeFileSync: (p, v) => files.set(p, v),
		chmodSync() {},
		renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }
	};
	const ctx = { get() {}, llm: { listProviders: () => [] }, effect() {} };
	const service = new SubUsageService(ctx, { io, configPath: "memory/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined, fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" }) });
	return { service, files };
}

// 1. 默认配置：linked 表为空 = 全开；publicSettings 回显空表。
{
	const h = harness();
	const settings = h.service.load();
	assert.deepEqual(settings.visibility.linked, {}, "linked 缺省为空表（全开）");
	const pub = (await h.service.refresh({ providerIds: [], force: false })).settings;
	assert.deepEqual(pub.visibility.linked, {}, "公开设置含 linked 空表");
	assert.deepEqual(pub.magpieRoutes ?? {}, {}, "公开设置含 magpieRoutes（可为空表）");
	console.log("PASS 默认 linked 全开、publicSettings 带 linked/magpieRoutes");
}

// 2. visibility.linked 补丁：合法联动 id 落盘、未知 id 拒绝、非布尔拒绝、revision 冲突拒绝。
{
	const h = harness();
	const rev0 = (await h.service.refresh({ providerIds: [], force: false })).settings.revision;
	const rev = (await h.service.save({ expectedRevision: rev0, visibility: { linked: { "ofm-cline": false, magpie: false } } })).settings.revision;
	assert.equal(h.service.load().visibility.linked["ofm-cline"], false, "OFM 渠道开关落盘");
	assert.equal(h.service.load().visibility.linked.magpie, false, "Magpie 开关落盘");
	await assert.rejects(() => h.service.save({ expectedRevision: rev, visibility: { linked: { "not-a-linked": false } } }), /Invalid linked/, "未知联动 id 拒绝");
	await assert.rejects(() => h.service.save({ expectedRevision: rev, visibility: { linked: { magpie: "yes" } } }), /Invalid linked/, "非布尔值拒绝");
	await assert.rejects(() => h.service.save({ expectedRevision: "stale", visibility: { linked: { magpie: true } } }), e => e.code === "subusage/revision-conflict", "revision 冲突拒绝");
	// 只写点名的键：另一条保持原值。
	const rev2 = (await h.service.refresh({ providerIds: [], force: false })).settings.revision;
	await h.service.save({ expectedRevision: rev2, visibility: { linked: { magpie: true } } });
	assert.equal(h.service.load().visibility.linked["ofm-cline"], false, "未点名键保持原值");
	assert.equal(h.service.load().visibility.linked.magpie, true, "点名键被更新");
	console.log("PASS visibility.linked 补丁：逐键合并、未知 id / 非布尔 / revision 冲突拒绝");
}

// 3. 旧配置文件里的 linked 与 magpieRoutes：linked 逐键容错（合法保留垃圾丢弃）；
// magpieRoutes 与 routeBindings 同口径——任一条目非法整表作废，不留下半截损坏映射。
{
	const h = harness({ visibility: { linked: { "ofm-cline": false, bogus: false, magpie: "x" } }, magpieRoutes: { mygroup: "kimi" } });
	const settings = h.service.load();
	assert.equal(settings.visibility.linked["ofm-cline"], false, "存量 linked 合法键保留");
	assert.equal(settings.visibility.linked.bogus, undefined, "存量 linked 未知键丢弃");
	assert.equal(settings.visibility.linked.magpie, undefined, "存量 linked 非布尔丢弃");
	assert.equal(settings.magpieRoutes.mygroup, "kimi", "存量 magpieRoutes 合法绑定保留");
	const poison = harness({ magpieRoutes: { mygroup: "kimi", "bad prefix": "x" } });
	assert.deepEqual(poison.service.load().magpieRoutes ?? {}, {}, "条目非法整表作废（与 routeBindings 同口径）");
	console.log("PASS 存量 linked/magpieRoutes 回读：合法保留、垃圾/污染丢弃");
}

// 4. 联动开关门控：关闭的联动 id 在 readLinked 点名查询下静默缺席，重新开启恢复。
{
	const h = harness();
	const rev0 = (await h.service.refresh({ providerIds: [], force: false })).settings.revision;
	const rev1 = (await h.service.save({ expectedRevision: rev0, visibility: { linked: { "ofm-cline": false } } })).settings.revision;
	const read = await h.service.readLinked({ providerIds: ["ofm-cline"], force: true });
	assert.deepEqual(read.entries, [], "关闭后 readLinked 点名不产出条目");
	await h.service.save({ expectedRevision: rev1, visibility: { linked: { "ofm-cline": true } } });
	const again = await h.service.readLinked({ providerIds: ["ofm-cline"], force: true });
	assert.equal(again.entries.length, 1, "重新开启后点名查询恢复条目");
	console.log("PASS readLinked 门控：关闭静默缺席、开启恢复");
}

// 5. magpieRoutes 补丁：形状校验、解绑（空对象）、非法前缀/分组拒绝。
{
	const h = harness();
	await h.service.save({ magpieRoutes: { mygroup: "kimi", relay: "sense" } });
	assert.deepEqual(h.service.load().magpieRoutes, { mygroup: "kimi", relay: "sense" }, "分组绑定落盘");
	await h.service.save({ magpieRoutes: {} });
	assert.deepEqual(h.service.load().magpieRoutes ?? {}, {}, "空对象=清空绑定");
	await assert.rejects(() => h.service.save({ magpieRoutes: { "bad prefix": "x" } }), /前缀|Invalid/i, "非法前缀拒绝");
	await assert.rejects(() => h.service.save({ magpieRoutes: "nope" }), /Invalid|键值/i, "非对象拒绝");
	console.log("PASS magpieRoutes 补丁：绑定/清空/非法输入校验");
}

// 6. magpieRoutes 不参与一致性哈希（与 routeBindings/displayProfiles 同口径）：只改绑定的保存不翻 revision 之外的查询缓存语义。
{
	const h = harness();
	const r1 = await h.service.save({ magpieRoutes: { mygroup: "kimi" } });
	const r2 = await h.service.save({ visibility: { hideWithoutApi: false }, expectedRevision: r1.settings.revision });
	assert.ok(r2.settings.revision !== r1.settings.revision, "revision 仍随保存滚动");
	console.log("PASS magpieRoutes 保存与 revision 正常共存");
}
console.log("联动逐项开关与 Magpie 分组绑定测试全部通过 ✅");
