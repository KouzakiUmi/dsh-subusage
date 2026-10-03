# 发布流程(基于 awesome-dsh-plugin / dsh-market 官方发布文档整理)

来源:[awesome-dsh-plugin contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
与 [dshmarket README](https://github.com/dsh-market/dsh-market#readme)。
dshmarket 本身不收插件条目——上架走 awesome-dsh-plugin 注册表,市场/站点自动收录。

## 本仓库的发布管线

| 文件 | 作用 |
|---|---|
| [scripts/check-manifest.mjs](../scripts/check-manifest.mjs) | 本地清单校验(对齐收录 CI 的机械检查点) |
| [CI 工作流](<../.github/workflows/ci.yml>) | push/PR：测试、清单/语法校验、实际打包；`main` 推送或合并后自动发布 GitHub Release |
| [版本发布工作流](<../.github/workflows/release.yml>) | 可选的 `v*` tag 发布；要求 tag 与包版本一致，不改变自动构建的 latest |
| [产物校验脚本](<../scripts/prepare-release.mjs>) | 检查 `npm pack --json` 的包名、版本、文件清单及唯一产物，生成固定资产名 |

### 推送 / 合并后自动发布

1. 推送到 `main`（包括 merge、squash merge、rebase merge PR）触发 CI；测试失败不发布。
2. PR 和 `master` 分支只测试/打包；只有 `main` 的 push 才进入拥有 `contents: write` 的发布 job。
3. CI 使用 `npm pack --ignore-scripts`，验证必需文件，上传已验证的产物；发布 job 直接下载同一产物，不重新打包。
4. 每个提交使用 `build-<12位提交SHA>` 标签，标题包含当前包版本和 SHA；重跑同一提交复用同一 Release，不覆盖其他提交的历史标签。
5. 自动构建作为普通 Release 并显式设为 latest；资产始终叫 `dsh-subusage.tgz`。发布前检查远端 `main`，跳过已被更新提交取代的慢构建，避免旧包回退 latest。
6. 使用 GitHub 提供的 `GITHUB_TOKEN`，不需要新增 Secrets；仓库/组织策略须允许发布 job 的 `contents: write`。不自动改版本、不提交机器人版本 bump，也不发布到 npm。

自动标签表示提交快照，不是新的语义版本；安装包内的版本仍来自 [包清单](<../package.json>)，正式升级仍需维护该版本。连续推送时发布 job 串行，GitHub concurrency 可能替换尚未开始的旧 pending job，最终发布最新通过检查的主分支构建。

可选的正式版本发布：修改 [包清单](<../package.json>) 的 `version` 并推送后，再执行 `git tag vX.Y.Z && git push origin vX.Y.Z`。tag 必须与包版本相同；此流程不会让旧版本覆盖 latest。

自动发布只上传安装包，**不自动安装插件或重启 DSH**。

无版本资产名是刻意的:条目里的 `tarball:` 链接用 `releases/latest/download/dsh-subusage.tgz`,
`latest/download/` 在请求时解析 latest 但**文件名照字面取**——资产名带版本号的话,下次发版链接就 404。

## 收录到市场(一次性)

向 awesome-dsh-plugin 提 PR,只加一个文件 `data/plugins/KouzakiUmi__dsh-subusage.yml`:

```yaml
url: https://github.com/KouzakiUmi/dsh-subusage
name: KouzakiUmi/dsh-subusage
category: usage
description:
  en: 'Subscription usage pill beside the model selector for Z.ai, Kimi, Xiaomi MiMo, OpenCode Go and Command Code, with a per-provider settings page.'
  zh: 在模型选择器旁显示 Z.ai / Kimi / 小米 / OpenCode Go / Command Code 订阅余量的状态药丸,附每家厂商的设置面板。
tarball: https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz
```

- `description` 必须属实——维护者会对着代码核对描述里的每个说法;含 `: ` 要加引号。
- 分类选 `usage`(Usage & Billing)。
- 一个 PR 最多 3 条;本仓库只占 1 条。

### 收录前置条件(收录 CI 会逐项机器检查)

- [x] `package.json` 声明 `dsh.bundle`(只声明 `dsh.client` 会被直接拒)
- [x] 真实可用代码、可 `dsh plugin add` 安装
- [x] `@deepseek-ai/*` 走 `peerDependencies`(本仓库精确钉 `0.2.0-rc.2`;升级核心后同步改)
- [ ] **仓库创建满 1 天**(CI 自动查)
- [ ] **给仓库加 `dsh-plugin` topic**(GitHub 仓库页 About → 齿轮 → Topics)

### 可选增强

- **发 npm 包**:市场能显示并按下载量排序;`repository` 字段已指回本仓库,映射由 registry 自动采集,无需通知注册表。当前工作流未启用 npm 发布；若另行授权启用，需去掉 [包清单](<../package.json>) 的 `"private": true`、配置 npm 认证，并单独设计按唯一语义版本发布的 job，不能把每提交快照直接当作同版本 npm 发布。
- **市场截图**:仓库根放 `screenshots.json`(1–8 张图片相对路径,不得越出仓库);不声明则市场从 README 自动抽取。

## 注意

- `peerDependencies` 精确钉死核心版本是本仓库的既定策略(加载器兼容性检查按此比对);
  但也意味着 **DSH 核心每次升级都必须同步改版本声明并发版**,否则新环境拒绝加载。
