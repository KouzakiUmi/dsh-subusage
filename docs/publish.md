# 发布与市场收录

本项目有三个独立流程：GitHub Release 发布安装包、npm 发布版本、awesome-dsh-plugin 收录条目。发布安装包不等于已经被市场收录，也不自动安装或重启用户的 DSH。

## GitHub Release

推送到 `main` 后，[CI](../.github/workflows/ci.yml) 运行回归、清单/语法检查和实际打包。PR 与 `master` 只检查，不发布。

检查通过后，发布 job 下载同一次构建验证过的安装包，使用 `build-<12位提交SHA>` 标签发布 Release，资产名固定为 `dsh-subusage.tgz`，并设为 latest。重跑同一提交复用对应 Release；发布前检查远端主分支，已被新提交取代的构建跳过发布。

同一发布 job 在 Release 之后通过 npm Trusted Publishing（GitHub OIDC）自动发布 npm，发布 test job 打包并验证过的同一 `dist/dsh-subusage.tgz`。发布前先查询 registry，该版本已存在则跳过——npm 不允许重复发布同版本，文档同步不能靠重复发布。npm 发布失败时，已成功生成的 GitHub Release 保留。

固定下载地址：[最新安装包](https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz)。资产名保持不带版本号，确保后续发布仍能通过该地址下载。

自动构建的包版本来自 `package.json`，每次提交不会自动提升版本；registry 尚无该版本时才尝试发布 npm。GitHub 使用内置 `GITHUB_TOKEN`；仓库策略须允许发布 job 的 `contents: write`。测试不安装依赖，也不使用真实账号。

可选的 [语义版本工作流](../.github/workflows/release.yml) 由 `v*` tag 触发。先更新包版本及相关说明并推送，再分别执行：

```console
git tag vX.Y.Z
git push origin vX.Y.Z
```

tag 必须等于 `v` 加包版本。该工作流再次检查与打包，发布版本 Release（`make_latest: false`，避免旧版本覆盖主分支 latest），并按与 CI 相同的幂等守卫发布 npm——registry 已有该版本时跳过，因此先推 `main` 再打 tag 不会重复发布。

## npm

包名：[dsh-subusage](https://www.npmjs.com/package/dsh-subusage)。`0.7.0` 已于 2026-10-05 发布；后续发布必须使用未发布过的新版本。npm 包与 GitHub 提交快照可能包含不同的文档更新，请分别检查版本与来源。

**自动发布（默认路径）**：推送新版本号到 `main` 后，CI 在 GitHub Release 之后自动发布 npm（见上节）。认证使用已配置的 npm Trusted Publisher，不要求仓库发布令牌；结果在「Publish to npm (new versions only)」步骤核对。

### 2026-10-08 流程检查

检查时仓库版本为 0.8.1，registry 只有 0.7.0。最近两次自动发布失败的直接原因是 tarball 参数缺少 `./`，被 npm 解析为 GitHub 仓库简写。用户已配置 Trusted Publisher，但旧工作流仍使用令牌模板，未赋予 OIDC 权限。没有 npm Secret 在 Trusted Publishing 模式下属于正常情况。

工作流现共用 [publish-npm.mjs](../scripts/publish-npm.mjs)：使用显式本地路径 `./dist/dsh-subusage.tgz`，只有 registry 明确返回 E404 才进入发布；网络或认证查询错误立即终止。已发布版本直接跳过；未发布版本检查 GitHub OIDC 环境后由 npm CLI 完成认证。发布后核对具体版本。main 与 tag 发布共用串行组，避免同时查询到版本缺失后抢发。

### Trusted Publisher 配置

按 [npm 官方指南](https://docs.npmjs.com/trusted-publishers/) 在包设置中配置 GitHub Actions：owner 为 `KouzakiUmi`，repository 为 `dsh-subusage`，workflow filename 与实际执行发布的工作流一致。主分支为 `ci.yml`，tag 为 `release.yml`；需要两个入口都发布时分别建立信任。当前工作流不声明 deployment environment；若 npm 信任绑定了 environment，须同步工作流设置。

发布 job 使用 GitHub 托管 runner、`id-token: write` 与 Node 24（包含支持 OIDC 的 npm CLI）。要求 npm CLI 至少 11.5.1、Node 至少 22.14.0。`setup-node` 不设置 `registry-url`，脚本显式指定公共 registry，不生成空的令牌认证项。身份令牌由 GitHub 自动提供，不写入日志或仓库。

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

`publishConfig` 固定公共 registry 和公开访问。认证在 npm 官方页面完成，不把密码、验证码或 token 写入仓库。截图与维护文档存放在 GitHub，当前 `files` 白名单只打包运行代码、locale、patch 与 README；README 的图片和文档链接使用 GitHub 地址，npm 页面也能访问。

## 市场收录

提交前以 [awesome-dsh-plugin 贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 为准。用户提供的 [fork 指南](https://github.com/KouzakiUmi/awesome-dsh-plugin/blob/main/contributing.md) 可用于准备条目；市场收录需要目标注册表接受并合并投稿。

本仓库的条目文件名为 `data/plugins/KouzakiUmi__dsh-subusage.yml`，分类为 `usage`。以下描述涵盖当前支持的服务，可作为投稿内容：

```yaml
url: https://github.com/KouzakiUmi/dsh-subusage
name: KouzakiUmi/dsh-subusage
category: usage
description:
  en: 'Subscription usage for Z.ai, Kimi, MiMo, OpenCode Go, Command Code, MiniMax, Synthetic and NanoGPT, with a model-selector pill and provider settings.'
  zh: '显示 Z.ai、Kimi、MiMo、OpenCode Go、Command Code、MiniMax、Synthetic 和 NanoGPT 订阅用量，提供模型选择器旁的余量药丸与提供商设置。'
tarball: https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz
```

提交只添加该条目，不修改其他插件条目或手工改写注册表的生成 README。npm 关联由本包的 `repository` 字段自动建立，条目不添加 `npm:` 字段。

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

根目录 [screenshots.json](../screenshots.json) 与 `package.json` 相邻，声明两张仓库内图片，顺序即展示顺序：

```json
[
  "assets/screenshots/settings-dark.png",
  "assets/screenshots/usage-popover-light.png"
]
```

第一张展示深色设置页、MiMo 凭据入口及新增三项默认关闭；第二张展示浅色 NanoGPT 用量弹层。两张均为 0.7.0 离线组件测试截图，包含虚构数据及预览标记。

更新截图时，用当前组件生成预览并检查布局，复制所选 PNG 到 `assets/screenshots/`，再同步声明和 README。具体生成方法见 [开发说明](development.md#离线浏览器与截图)。不要将 `debug/` 路径写入声明，该目录被 Git 忽略；不要放入真实 Key、Cookie 或账户数据。

声明支持 1–8 张图片，相对路径不能以 `/` 开头或包含 `..`。推送图片与声明到本仓库后，已收录条目的后续市场构建可获取更新，无需另交截图 PR。

## 发布检查

- 检查版本、peer 范围、README 支持表与更新记录一致。
- 按 [开发说明](development.md) 完成检查；[prepare-release.mjs](../scripts/prepare-release.mjs) 验证实际打包文件与固定资产名。
- 确认 GitHub Release 工作流成功，下载地址能解析到所需提交。
- npm 发布单独核对目标版本，不能用重复发布同版本来同步文档。
- 明确记录真实安装、账号与界面验证的实际范围，离线预览不代替实机验收。
