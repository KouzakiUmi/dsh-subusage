# 发布与市场收录

本项目有三个独立流程：GitHub Release 发布安装包、npm 发布版本、awesome-dsh-plugin 收录条目。发布安装包不等于已经被市场收录，也不自动安装或重启用户的 DSH。

## GitHub Release

推送到 `main` 后，[CI](../.github/workflows/ci.yml) 运行回归、清单/语法检查和实际打包。PR 与 `master` 只检查，不发布。

检查通过后，发布 job 下载同一次构建验证过的安装包，使用 `build-<12位提交SHA>` 标签发布 Release，资产名固定为 `dsh-subusage.tgz`，并设为 latest。重跑同一提交复用对应 Release；发布前检查远端主分支，已被新提交取代的构建跳过发布。

主分支 CI 只发布 GitHub Release，不调用 npm。npm 信任绑定 `release.yml`，由下述版本标签工作流执行 Trusted Publishing。

固定下载地址：[最新安装包](https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz)。资产名保持不带版本号，确保后续发布仍能通过该地址下载。

自动构建的包版本来自 `package.json`，每次提交不会自动提升版本。GitHub 使用内置 `GITHUB_TOKEN`；仓库策略须允许发布 job 的 `contents: write`。测试不安装依赖，也不使用真实账号。

可选的 [语义版本工作流](../.github/workflows/release.yml) 由 `v*` tag 触发。先更新包版本及相关说明并推送，再分别执行：

```console
git tag vX.Y.Z
git push origin vX.Y.Z
```

tag 必须等于 `v` 加包版本。该工作流再次检查与打包，发布版本 Release（`make_latest: false`，避免旧版本覆盖主分支 latest），然后以 GitHub OIDC 身份发布同一已验证 tarball 到 npm。registry 已有该版本时跳过，失败后重跑不会重复发布。

## npm

0.16.0 新增 GitHub Copilot 额度（`github-copilot`，第 30 条 provider，默认关闭；复用 `@inventec/dsh-copilot-auth` 存入凭据库的 OAuth 记录，只读）。发布完成以 `v0.16.0` 标签对应的 Actions、GitHub Release 资产与 npm registry 的实际结果为准，不自动安装或重启本机 DSH。

0.16.0 已于 2026-10-23 发布并核验：`v0.16.0` tag → `release.yml` 发布 npm；首轮同样在 60 秒可见性窗口内报 `Publication verification failed`（`Waiting for registry visibility (6/6)`），随后直接查询 registry，约 30 秒内 `versions["0.16.0"]` 与 `dist-tags.latest` 均读到 0.16.0（`time.modified 2026-10-22T20:04:35Z`），未重跑。`v0.16.0` Release 资产、主分支 `build-d4cd43d90d01` 资产与 npm tarball 的 SHA256 三者一致（`sha256:7aeb2424e224a44b5834567bc6f87656042782bd9814a33bb35190138ecfa93e`，169471 字节）；`build-d4cd43d90d01` 为 latest。未安装到桌面 Profile、未重启 DSH。

0.15.1 已于 2026-10-23 发布并核验：`v0.15.1` tag → `release.yml` 发布 npm；首轮同样在 60 秒可见性窗口内报 `Publication verification failed`，这一次 registry **确实还没读到**该版本（等约 4 分钟后 `versions["0.15.1"]` 与 `dist-tags.latest` 才变成 0.15.1，`published 2026-10-22T18:01:53Z`），按「依据只能是 registry」的固定处置：先在 registry 确认可读，再 `workflow_dispatch`（`version_tag=v0.15.1`）重跑转绿，未重复发布；`v0.15.1` Release 资产与 npm tarball 的 SHA256 一致（`sha256:f7638911021c4d63a30f142cc1e347f59b85b360f2c85abb0d8c16c16295475b`，165290 字节）。随后用随包 Desktop CLI（`plugin --profile desktop add dsh-subusage@0.15.1`）装进 `desktop` profile：依赖与已安装包 `version` 均为 `0.15.1`，已安装产物里能查到并段逻辑与联动项汇总文案；重启验收由用户执行。

0.15.0 已于 2026-10-23 发布并核验：`v0.15.0` tag → `release.yml` 发布 npm；registry 的 `dist-tags.latest` 与 `versions["0.15.0"]` 均读到该版本（`published 2026-10-22T17:10:51Z`），`v0.15.0` Release 资产与 npm tarball 的 SHA256 一致（`sha256:43d41bd9e347a40e873d9f4e48efab83caab87f2e1b36cdf5ae08374974672f5`，164599 字节）；主分支 `build-47599fcaddd0` 保持 latest。首轮 `Publish to npm` 在 60 秒可见性窗口内报 `Publication verification failed`（既有已知形态：上传已成功、registry 稍后才可读），先在 registry 确认版本可读，再 `workflow_dispatch`（`version_tag=v0.15.0`）重跑转绿，未重复发布。随后用随包 Desktop CLI（`plugin --profile desktop add dsh-subusage@0.15.0`）装进 `desktop` profile，profile 的 `package.json` 依赖与已安装包的 `version` 均核对为 `0.15.0`；重启验收由用户执行。

0.15.0 新增两条兄弟插件联动额度（`antigravity` 读 `dsh-antigravity-acp` 的 `agyQuota` 服务；`trae` / `trae-global` / `trae-enterprise` 读 `dsh-connect-trae` 挂在本机 web 服务器上的只读用量路由），并把 OpenDesign 的两个美元数字按池子改名为「套餐余额 / 总额度」。Trae 链接已用真实运行中的 DSH 实测（CN 面板 `signed-in`、企业版/国际版 `signed-out` 不产生条目、60 秒缓存与 `force` 行为均核对），`antigravity` 仍是进程内服务、只在隔离测试中验证。同步包版本与 Host 标识；以 registry 与对应 Actions/Release 结果为发布完成依据，不自动安装或重启本机 DSH。

0.14.5 修复 OpenDesign 认证错误被双端点降级吞成部分数据的问题；同步更正有效默认开关 13 开 / 16 关、29 条提供商清单、保存后独立验证及历史实测覆盖口径。包版本与 Host 标识同步；发布完成仍以对应 Actions、GitHub Release 资产与 npm registry 的实际结果为准，不自动安装或重启本机 DSH。

0.14.4 修复 Grok 零值百分比省略：REST 缺百分比时补查 consumer gRPC，仅完整成功且活跃的匹配周期确认隐式零；失败保持部分数据。同步包版本与 Host 标识，以 registry 与对应 Actions/Release 结果核验发布，不自动安装或重启本机 DSH。

0.14.3 补齐 OpenDesign 个人钱包余额及订阅额度剩余，两端点独立降级；以 registry 与对应 Actions/Release 结果核验发布状态，不自动安装或重启本机 DSH。

0.14.2 修正 OpenDesign 的实测契约：额度路径改为先取 `GET /v1/workspaces/current` 的 `workspaceId`，再拼 `/v1/workspaces/<id>/billing/coding-plan-usage`（把 `current` 当路径参数会回 403 `workspace_member_required`），解析器同时改读扁平响应。同步包版本与 Host 标识。以对应版本标签的 Actions 状态、Release 资产和 npm registry 实际结果为发布完成依据；本地测试通过不等于已发布。

0.14.1 修 OpenDesign 自动登录：Playwright 启动的 Chrome 默认把 `navigator.webdriver` 置为 true，带 Cloudflare 防护的站点在点「验证」时据此判为自动化。启动参数加上 `--disable-blink-features=AutomationControlled`，同步包版本与 Host 标识。以对应版本标签的 Actions 状态、Release 资产和 npm registry 实际结果为发布完成依据；本地测试通过不等于已发布。

0.14.0 新增 OpenDesign 额度与通用 Cookie 登录（第 29 家 provider，默认关闭），`lib/cookie-login.js`、`lib/opendesign-login.js` 进入打包清单与语法检查，同步包版本与 Host 标识。已于 2026-10-18 经 `release.yml` 的 Trusted Publishing 发布：registry 的 latest 已核对为 0.14.0，`v0.14.0` Release 资产与 npm tarball 的 SHA256 一致（`sha256:6e17d871…b7fe4`，147825 字节），主分支自动构建的 `build-5cf3c1fc957f` 保持 latest。首次运行出现的是 `0.10.8` 那类形态而不是传播延迟：`npm publish` 已返回成功结果（带完整 shasum/integrity），但 registry 在六轮可见性窗口内全为 404、latest 仍停在 0.13.4；按「依据只能是 registry」先查 registry 确认未发布，再 `gh run rerun` 重跑同一 run，第二次 `Publish to npm` 转绿后 registry 随即读到 0.14.0。没有改动已发布版本，也没有重新打包。

0.13.4 同步包版本与 Host 标识，Grok credits 500 时回退 grok.com GetGrokCreditsConfig；不更换 0.13.0 的主页图片。以对应版本标签的 Actions 状态、Release 资产和 npm registry 实际结果为发布完成依据；本地测试通过不等于已发布。

包名：[dsh-subusage](https://www.npmjs.com/package/dsh-subusage)。`0.7.0` 已于 2026-10-05 发布；后续发布必须使用未发布过的新版本。npm 包与 GitHub 提交快照可能包含不同的文档更新，请分别检查版本与来源。

`0.8.1` 已于 2026-10-08 经 `release.yml` 的 Trusted Publishing 发布，registry 的 latest 已核对为 0.8.1。首次发布后查询短暂读到旧元数据，工作流因此报验证失败，但上传已完成；恢复时应先查询 registry，不能把工作流失败直接等同于版本未发布。

`0.8.2` 已于 2026-10-08 经 `release.yml` 的 Trusted Publishing 发布，registry 的 latest 已核对为 0.8.2。上传成功，但可见性核对在 60 秒重试窗口内未通过——**这是 npm 发布后的验证与传播过程，属正常行为，不是工作流缺陷**；随后直接查询 registry 确认版本可读，再经 `workflow_dispatch`（`version_tag=v0.8.2`）重跑，脚本核对到已发布版本后跳过发布并转绿。

`0.8.3` 已于 2026-10-08 经 `release.yml` 的 Trusted Publishing 发布，registry 的 latest 已核对为 0.8.3。同样是发布后验证/传播延迟：上传成功，但 60 秒可见性窗口内 registry 仍只读到旧版本，工作流报 `Publication verification failed`；直接查询 registry 确认 0.8.3 可读后经 `workflow_dispatch`（`version_tag=v0.8.3`）重跑。第一次重跑在「Create versioned GitHub Release」的资产上传阶段遇到 GitHub 侧 `other side closed`——该步骤 `overwrite_files: true` 已先删除旧附件，`v0.8.3` Release 因此一度没有任何资产；再次重跑转绿，`v0.8.3` 与 `build-d17346a3ef0c` 两个 Release 的 `dsh-subusage.tgz` digest 一致（`sha256:1b6f2d61…`）。

`0.10.4` 与 `0.10.5` 已于 2026-10-09 经 `release.yml` 的 Trusted Publishing 发布，registry 的 latest 已核对为 0.10.5。同一条延迟两次都出现：`npm publish --json` 已返回成功结果（脚本因此走到可见性等待，而不是报 `npm publish failed`），但 60 秒窗口内 registry 仍只读到上一个版本；约两分钟后新版本可读，再经 `workflow_dispatch`（`version_tag=v0.10.4` / `v0.10.5`）重跑转绿。

> **发布后核对不到版本时怎么办（0.8.1 起每次发布都会遇到）**：多数情况这是 **npm 侧的发布后验证 / 传播延迟**，不是工作流缺陷——`0.8.1` / `0.8.2` / `0.8.3` / `0.10.0` / `0.10.1` / `0.10.2` / `0.10.3` / `0.10.4` / `0.10.5` / `0.10.6` / `0.10.7` 都出现过。处置固定为「**先查 registry 确认版本可读，再用 `workflow_dispatch` 重跑让工作流转绿**」，不改动已发布版本，也不为此放宽核对窗口。
>
> **但「核对失败」不等于「已经传上去了」。** `0.10.8` 就出现过一次反例：`npm publish` 返回成功、脚本照常进入可见性等待，而 registry 里**始终没有**这个版本（等了八分钟仍是 404，包版本列表停在 `0.10.7`），重跑一次才真正发布成功。**所以依据只能是 registry，不能是日志**：`npm view <pkg>@<version> version`（或直接请求 `https://registry.npmjs.org/<pkg>/<version>`）读到版本 → 重跑只为转绿；读不到 → 重跑就是恢复手段（脚本会先查 registry，明确 E404 才重新发布，不会重复发布）。**绝不能把工作流那次失败直接当成版本未发布而去手工再发一次**，也不要为了消掉这条失败而放宽核对窗口。

**自动发布（默认路径）**：更新版本并推送代码后，推送对应的 `vX.Y.Z` 标签；`release.yml` 检查、打包并发布 npm。认证使用已配置的 npm Trusted Publisher，不要求仓库发布令牌；结果在「Publish to npm (new versions only)」步骤核对。仅推送 `main` 不会更新 npm。

### 2026-10-08 流程检查

检查时仓库版本为 0.8.1，registry 只有 0.7.0。最近两次自动发布失败的直接原因是 tarball 参数缺少 `./`，被 npm 解析为 GitHub 仓库简写。用户已配置 Trusted Publisher，但旧工作流仍使用令牌模板，未赋予 OIDC 权限。没有 npm Secret 在 Trusted Publishing 模式下属于正常情况。

`release.yml` 调用 [publish-npm.mjs](../scripts/publish-npm.mjs)：使用显式本地路径 `./dist/dsh-subusage.tgz`，只有 registry 明确返回 E404 才进入发布；网络或认证查询错误立即终止。已发布版本直接跳过；未发布版本检查 GitHub OIDC 环境后由 npm CLI 完成认证。发布后核对具体版本。main 与 tag 的 Release job 共用串行组，不并行修改 Release。

### Trusted Publisher 配置

按 [npm 官方指南](https://docs.npmjs.com/trusted-publishers/) 在包设置中配置 GitHub Actions：owner 为 `KouzakiUmi`，repository 为 `dsh-subusage`，workflow filename 为 **`release.yml`**。用户已确认此信任绑定；未受信任的 `ci.yml` 不尝试发布 npm。当前 `release` job 声明 `environment: npm`；npm 信任绑定与 GitHub 的 environment 规则须和此名称一致。

发布 job 使用 GitHub 托管 runner、`id-token: write` 与 Node 24（包含支持 OIDC 的 npm CLI）。要求 npm CLI 至少 11.5.1、Node 至少 22.14.0。`setup-node` 不设置 `registry-url`，脚本显式指定公共 registry，不生成空的令牌认证项。身份令牌由 GitHub 自动提供，不写入日志或仓库。

发布后使用 `--prefer-online` 查询具体版本，对短暂 E404 最多重试六次，等待间隔十秒；npm 命令返回成功但版本始终不可见仍判失败。`release.yml` 也支持手动运行：选择包含修复的代码分支，输入与包版本一致的 `version_tag`。这可以恢复尚未发布的版本，不移动旧 tag；应核对分支代码确实是要发布的内容。

若预查询读到旧数据，但发布返回明确的“该版本已发布” E403，脚本转为核对该版本，确认可读后跳过；其他 E403 仍为失败。这样既处理 registry 读取延迟，也不掩盖权限错误。

信任配置须允许直接 `npm publish`；若仅允许 staged publishing，此流程不能直接发布。发布失败时核对工作流文件名、environment、允许的动作和信任有效性，而不是添加发布 Secret。修复后推送新提交或运行新工作流；重跑旧提交仍使用旧工作流文件，不会自动应用修复。

**手动发布（可选兜底）**：仅在 npm 包权限允许交互式发布时使用。GitHub OIDC 身份不能在本机复用；自动发布优先通过上述 Trusted Publisher 流程执行。

1. 更新 `package.json` 的版本、Host 请求的版本标识及更新记录。
2. 运行基础检查和打包预检，检查文件清单中无凭据或调试数据。
3. 登录拥有发布权限的 npm 账号，完成 npm 要求的二次验证，发布后核对版本与标签。

```console
node tests/run-all.mjs
node scripts/check-manifest.mjs
node --check lib/index.js
node --check lib/client.js
node --check lib/mimo-login.js
npm publish --dry-run --ignore-scripts
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm publish --access public --ignore-scripts
npm view dsh-subusage version dist-tags
```

`publishConfig` 固定公共 registry 和公开访问。认证在 npm 官方页面完成，不把密码、验证码或 token 写入仓库。截图与维护文档存放在 GitHub，当前 `files` 白名单只打包运行代码（`lib`）、patch、README 与 LICENSE；README 的图片和文档链接使用 GitHub 地址，npm 页面也能访问。

## 市场收录

提交前以 [awesome-dsh-plugin 贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 为准。用户提供的 [fork 指南](https://github.com/KouzakiUmi/awesome-dsh-plugin/blob/main/contributing.md) 可用于准备条目；市场收录需要目标注册表接受并合并投稿。

本仓库的条目文件名为 `data/plugins/KouzakiUmi__dsh-subusage.yml`，分类为 `usage`。以下描述涵盖当前支持的服务，可作为投稿内容：

```yaml
url: https://github.com/KouzakiUmi/dsh-subusage
name: KouzakiUmi/dsh-subusage
category: usage
description:
  en: 'Subscription quota and balance pills for DeepSeek, Z.ai, Kimi, Xiaomi MiMo, OpenCode Go, Command Code, Codex, SuperGrok, MiniMax, Volcengine Ark, SiliconFlow, OpenRouter and other AI providers in DeepSeek Harness, with one settings page for detection switches and credentials and a read-only quota API for other plugins.'
  zh: '在 DeepSeek Harness 的模型选择器旁为 DeepSeek、Z.ai、Kimi、小米 MiMo、OpenCode Go、Command Code、Codex、SuperGrok、MiniMax、火山方舟 Ark、SiliconFlow、OpenRouter 等提供商显示订阅余量与余额药丸，提供统一管理检测开关与凭据的设置页，并对其他插件开放只读额度查询接口。'
tarball: https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz
```

分类维持 `usage`：本插件只**读取并展示**用量/余额，不注册模型路由（`models` 会误导为「提供模型」）。提交只添加该条目，不修改其他插件条目或手工改写注册表的生成 README。npm 关联由本包的 `repository` 字段自动建立，条目不添加 `npm:` 字段。

### 本仓库核对结果

截至 2026-10-05：

| 项目 | 状态 |
|---|---|
| `dsh.bundle.patch` 与真实 Host/Client 代码 | 已具备，清单检查通过 |
| 核心依赖 | 位于 peerDependencies，范围 `>=0.2.0-rc.1 <0.3.0-0` |
| 仓库年龄 | 2026-09-30 创建，已满一天 |
| `dsh-plugin` topic | 已设置 |
| npm repository 与仓库一致 | 已设置，0.7.0 已发布 |
| 两张截图与根目录声明 | 已添加 |
| 真实 DSH 安装与在线账号验收 | 尚未确认 |
| 注册表投稿与收录 | 本轮尚未提交；是否合并由维护者决定 |

本地 [清单检查](../scripts/check-manifest.mjs) 只覆盖部分静态要求，不查询仓库年龄、topic、条目重复或市场审核结果。自动检查通过也不能替代维护者对功能、安全与重复性的审核。

## 截图维护

根目录 [screenshots.json](../screenshots.json) 与 `package.json` 相邻，声明五张仓库内图片，顺序即展示顺序：

```json
[
  "assets/screenshots/settings-dark.png",
  "assets/screenshots/usage-popover-light.png",
  "assets/screenshots/account-pool-expanded-dark.png",
  "assets/screenshots/scoped-quota-dark.png",
  "assets/screenshots/balance-pills-dark.png"
]
```

第一张是深色设置页（订阅用量面板 + Cookie 到期提醒 + 凭据编辑器展开），第二张是浅色 NanoGPT 用量弹层与收起态药丸，第三张是 Command Code 轮换池详情展开后（默认账户额度与池内 40 个账户分开说明），第四张是方舟 Agent Plan 的双额度线分组与能力作用域，第五张是余额单位分级与套餐优先画廊。五张都执行真实 Client 组件、使用虚构数据并标明离线预览，不代表真实账号验收。

声明上限是 8 张，这里只留能各自说明一项能力的图。[README 首屏](../README.md) 的深浅主题功能特写由 [render-readme-assets.mjs](../scripts/render-readme-assets.mjs) 另行合成，属 README 物料，不作为市场截图声明——它带营销标题与副文案，市场详情页要的是插件本身的界面。

更新截图时跑 `node scripts/render-market-screenshots.mjs`，再同步声明和 README。具体生成方法见 [开发说明](development.md#离线浏览器与截图)。不要将 `debug/` 路径写入声明，该目录被 Git 忽略；不要放入真实 Key、Cookie 或账户数据。

声明支持 1–8 张图片，相对路径不能以 `/` 开头或包含 `..`。推送图片与声明到本仓库后，已收录条目的后续市场构建可获取更新，无需另交截图 PR。

## 发布检查

- 检查版本、peer 范围、README 支持表与更新记录一致。
- 按 [开发说明](development.md) 完成检查；[prepare-release.mjs](../scripts/prepare-release.mjs) 验证实际打包文件与固定资产名。
- 确认 GitHub Release 工作流成功，下载地址能解析到所需提交。
- npm 发布单独核对目标版本，不能用重复发布同版本来同步文档。
- 明确记录真实安装、账号与界面验证的实际范围，离线预览不代替实机验收。
