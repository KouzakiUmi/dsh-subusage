# 发布流程(基于 awesome-dsh-plugin / dsh-market 官方发布文档整理)

来源:[awesome-dsh-plugin contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
与 [dshmarket README](https://github.com/dsh-market/dsh-market#readme)。
dshmarket 本身不收插件条目——上架走 awesome-dsh-plugin 注册表,市场/站点自动收录。

## 本仓库的发布管线

| 文件 | 作用 |
|---|---|
| [scripts/check-manifest.mjs](../scripts/check-manifest.mjs) | 本地清单校验(对齐收录 CI 的机械检查点) |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | push/PR:测试 + 清单校验 + `npm pack --dry-run` 形状检查 |
| [.github/workflows/release.yml](../.github/workflows/release.yml) | 打 `v*` tag:测试 → `npm pack` → 资产重命名为**无版本名** `dsh-subusage.tgz` → 附到 GitHub Release |

发版 = 改 `package.json` 的 `version` → 提交 → `git tag vX.Y.Z && git push --tags`,其余自动。

无版本资产名是刻意的:条目里的 `tarball:` 链接用 `releases/latest/download/dsh-subusage.tgz`,
`latest/download/` 在请求时解析 latest 但**文件名照字面取**——资产名带版本号的话,下次发版链接就 404。

## 收录到市场(一次性)

向 awesome-dsh-plugin 提 PR,只加一个文件 `data/plugins/KouzakiUmi__dsh-subusage.yml`:

```yaml
url: https://github.com/KouzakiUmi/dsh-subusage
name: KouzakiUmi/dsh-subusage
category: usage
description:
  en: 'Subscription usage pill beside the model selector for Z.ai, Kimi, Xiaomi MiMo and OpenCode Go, with a per-provider settings page.'
  zh: 在模型选择器旁显示 Z.ai / Kimi / 小米 / OpenCode Go 订阅余量的状态药丸,附每家厂商的设置面板。
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

- **发 npm 包**:市场能显示并按下载量排序;`repository` 字段已指回本仓库,映射由 registry 自动采集,无需通知注册表。启用:去掉 `package.json` 的 `"private": true`、在仓库 Secrets 配 `NPM_TOKEN`、取消 release.yml 里 publish 步骤的注释。
- **市场截图**:仓库根放 `screenshots.json`(1–8 张图片相对路径,不得越出仓库);不声明则市场从 README 自动抽取。

## 注意

- `peerDependencies` 精确钉死核心版本是本仓库的既定策略(加载器兼容性检查按此比对);
  但也意味着 **DSH 核心每次升级都必须同步改版本声明并发版**,否则新环境拒绝加载。
