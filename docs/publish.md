# 发布与市场收录

本项目有三个独立流程：GitHub Release 发布安装包、npm 发布版本、awesome-dsh-plugin 收录条目。发布安装包不等于已经被市场收录，也不自动安装或重启用户的 DSH。

## GitHub Release

推送到 `main` / `master` 或提交 PR 时，[CI](../.github/workflows/ci.yml) 运行回归、清单/语法检查和实际打包。`main` 构建包保存在 Actions artifact 中 7 天。

GitHub Release 与 npm 统一由[版本标签工作流](../.github/workflows/release.yml) 执行。推送 `vX.Y.Z` 标签后，工作流校验标签与包版本一致，完成检查及打包，再发布固定名称的 `dsh-subusage.tgz` 与 npm 包。

固定下载地址：[最新安装包](https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz)。资产名保持不带版本号，确保后续发布仍能通过该地址下载。

自动构建的包版本来自 `package.json`，每次提交不会自动提升版本。GitHub 使用内置 `GITHUB_TOKEN`；仓库策略须允许发布 job 的 `contents: write`。测试不安装依赖，也不使用真实账号。

[语义版本工作流](../.github/workflows/release.yml) 仅由版本 tag 推送触发。先更新包版本及相关说明并推送，再分别执行：

```console
git tag vX.Y.Z
git push origin vX.Y.Z
```

tag 必须等于 `v` 加包版本。版本 Release 使用 `make_latest: legacy`，由 GitHub 判定 latest；npm 使用 GitHub OIDC Trusted Publishing 发布同一已验证 tarball。registry 已有该版本时跳过；上传后每 10 秒核验一次，最多等待 5 分钟传播。超过窗口仍不可见时先核对 registry，再按实际状态重跑原版本标签的 Actions run。以下旧版本记录保留当时的发布过程，当前入口与等待策略以上述流程为准。

## npm

0.24.5 工具报告补实际额度数字（`（余 N unit）`，detail.left/remaining/used·limit 反推 + Unlimited 中文化，与客户端 fmtTokens 同口径）与 `subusage_quota` schema 必填修复（联动展开账号行缺 `label` 让全量查询被判 `missing required property`，0.24.4 发布后才修）。awesome 条目同步为 31 条入口 + 「项目正在进行重构」提示。推送前只读核验（DeepSeek V4.1 Flash）发现 2 项中等：label=account 时标题行重复账户名（把 4 行推过 220 上限）、数量密度断言没进形态表没真守住——均已修复（`accountSuffix` 在 label===account 时去掉重复名、`assertToolShape` 加型别核对、数量断言换长形态夹具并实测 205 字符）。已于 2026-11-08 经 `v0.24.5` 标签 → `release.yml` 发布：提交 `ecaa093`，版本工作流（run 42430508445）success；registry 的 `versions["0.24.5"]` 与 `dist-tags.latest` 均为 0.24.5。Release 资产与 npm tarball 完全相同（`sha256:a2e835f93d1cb6294ca42d9192ef79c92589835167080c177173f4b16b055d1f`，289851 字节）。已重新物化安装到本机 `desktop` profile，**未重启 DSH**。

0.24.4 DSH Go 原生面板、Magpie 聚合网关与 wire lossless 修复（详见更新记录）。已于 2026-11-06 经 `v0.24.4` 标签 → `release.yml` 发布：标签提交 `2185fad` 为 SSH 签名，版本工作流（run 42264807649）与后续合并提交的主分支 CI（run 42265626882）均 success；registry 的 `versions["0.24.4"]` 与 `dist-tags.latest` 均为 0.24.4。Release 资产与 npm tarball SHA256 一致（`sha256:5af46de3576b1caadfbbc96dd4e8e98c2900fd56420c12f0b466088004975488`，288934 字节）。过程中 `test-go-panel.mjs` 一条「更新时间」断言按 +08:00 硬编码预期在 UTC runner 上失败，改为从 `updatedAt` 动态计算后于合并提交内收敛（`main` 拒绝非快进，用 merge 收拢 tag 提交与修正提交）。已重新物化安装到本机 `desktop` profile，**未重启 DSH**。

0.24.3 兼容宿主 Core `0.2.2-rc.1`：`peerDependencies` 按「逐 minor 分支」规则补 `>=0.2.2-0 <0.3.0-0`，修掉 node-semver 静默排除预发布 Core 的问题（本机 semver 实测 0.2.0 / 0.2.1 / 0.2.2 的预发布版均覆盖）；`dsh.compatibility.dshReleases` 补 `0.2.2-rc.1: unknown`（只有静态核对与全量回归，未在该 Core 上实机安装运行，不标 `compatible`），README 兼容表与 development.md 同步，并清理 0.2.2 安装树里已不存在的 `dsh.client.inject` 包名。新增 `tests/test-peer-range.mjs` 守住每个 minor 的下界比较符。已于 2026-11-05 经 `v0.24.3` 标签 → `release.yml` 发布：提交 `5c25d33` 为 SSH 签名，主分支 CI（run 42048690413）与版本工作流（run 42048701165）均 success；registry 的 `versions["0.24.3"]` 与 `dist-tags.latest` 均为 0.24.3。`v0.24.3` Release 资产与 npm tarball SHA256 一致（`sha256:9a81f277bed4a92614bcdadb9c03e60d82a3b713dd925a45f1ec7f73c36d982e`，250710 字节）。**未安装到本机 Profile、未重启 DSH**。

0.24.0 MiMo 扫码登录自动续期（保存 `passToken` 续期材料，Cookie 到期前 / 被拒时静默换新，失败才提示重新扫码）、修复设置页扫码与浏览器登录按钮冲突，并一并发布上一版之后积累的本机直取、EAC 回退、页面代取联动与积分包分组（详见更新记录）。已于 2026-11-03 经 `v0.24.0` 标签 → `release.yml` 发布：提交 `93a71ef` 为 SSH 签名且 GitHub 判定 Verified，主分支 CI 与版本工作流均 success（标签版本校验、测试、清单/语法、打包、Release、npm 发布全绿，未出现 registry 可见性窗口失败）；registry 的 `versions["0.24.0"]` 与 `dist-tags.latest` 均为 0.24.0，`v0.24.0` 为 Latest。Release 资产与 npm tarball SHA256 一致（`sha256:80613bc1827154762151b10fff479fa4d0001c00cb58773474ef9903fc29e937`，248276 字节）。发布前由只读代理（DeepSeek V4.1 Flash）做了一次快速交叉核验，未发现阻断问题，5 项次要发现中 3 项已修复（形状异常不提示重扫、passToken 到期不宣称自动续期、缺 deviceId 不保存续期材料），另 2 项（401 续期后多一次额度请求、扫码中切到 OpenDesign 标签的状态恢复）按次要问题保留。续期协议**未用真实账号长期验证**。**未安装到 `desktop` Profile、未重启 DSH**。

0.21.3 精简 `subusage_quota` 的工具提示词：主描述 2683 → 866 字符，`providers` 参数描述 792 → 63 字符，合计约 3475 → 929（约 870 → 232 token）；砍掉的是 render 报告与 output schema 已能表达的内容，保留无参全量、可传厂商名、认不出名字回全量加说明、只读、缓存 60 秒等模型必须知道的规则。4 处文案断言改为校验实际调用行为，并新增体量上限防止长回去。无功能变更。已于 2026-11-02 经 `v0.21.3` 标签 → `release.yml` 发布：工作流 success（标签版本校验、测试、清单/语法、打包、Release、npm 发布全绿），主分支 CI 同步 success；registry 的 `versions["0.21.3"]` 与 `dist-tags.latest` 均为 0.21.3。`v0.21.3` Release 资产与 npm tarball SHA256 一致（`sha256:570fd6545ff71c74fac7f8254351b40bc67cf852fe9830bf59d01cf2cb785c1c`，200065 字节）。**未安装到 `desktop` Profile、未重启 DSH**。

0.21.2 文档收尾（扫码登录后的措辞对齐）：`mobileNoAuto` 改为指明 MiMo 可扫码、其他站点才需手动粘贴（中英文同步），README 的 dsh-go 段落与 FAQ 同步，更新记录把 0.21.0 的两条「未发布」条目归入正式版本并写明原生胶囊已移除的原因。无功能变更。已于 2026-11-02 经 `v0.21.2` 标签 → `release.yml` 发布：工作流 success（标签版本校验、测试、清单/语法、打包、Release、npm 发布全绿），主分支 CI 同步 success；registry 的 `versions["0.21.2"]` 与 `dist-tags.latest` 均为 0.21.2。`v0.21.2` Release 资产与 npm tarball SHA256 一致（`sha256:67f8f08a76a877e6c41a9f95224bb4032936fa8fc5aad11929fbd226401fe8e1`，200922 字节）。本机发布环境缺 `ssh-keygen`，先装 `openssh-client` 才恢复 SSH 提交签名（此前提交均为签名提交）；远端凭据助手 `gh` 已不存在，推送改用已验证的 SSH 密钥。**未安装到 `desktop` Profile、未重启 DSH**。

0.21.1 / 0.21.0 小米账号扫码登录 MiMo 额度，并适配 dsh-go 手机引擎（0.21.1 把「小米扫码登录」提到药丸上方的建议操作横幅）。两个标签均于 2026-11-01 经 `release.yml` 发布成功，`v0.21.1` 工作流 success；registry 的 `dist-tags.latest` 与 `versions` 依次为 0.21.0、0.21.1。**扫码登录路径已在本机 dsh-go 引擎实机验收**（读到真实 Pro 套餐数据与 CNY 余额）；桌面主机的自动登录仍以隔离测试守住，未在桌面实机复验。

0.20.0 Antigravity 用量接入本机 dsh-tool-antigravity 并进入输入区药丸（新增 `antigravityAuth` 通道，与既有 `agyQuota` 双通道自动探测、同一份订阅只出一条；新 Typert 方法 `subUsage/readLinked`；模型路由 `google-antigravity` 归并到联动项）。已于 2026-11-01 经 `v0.20.0` 标签 → `release.yml` 发布：工作流一次 success（标签版本校验、测试、清单/语法、打包、Release、npm 发布全绿，run 41275567708，未出现 registry 可见性窗口失败），主分支 CI（run 41275556309）同步 success；registry 的 `versions["0.20.0"]` 与 `dist-tags.latest` 均为 0.20.0。`v0.20.0` Release 资产与 npm tarball SHA256 一致（`sha256:b0908b3cc6b8f477c576627f867ef318b015f4e193306191fe457b55f90c10b1`，188082 字节）。发布前的独立只读交叉核验两次未返回结论（子代理故障 / 长时间无输出终止），改由主代理逐项机械复核补位（通道回落、Trae undefined 防护、双端 codec、设置页隔离、版本一致性），不等同独立核验；真实形状依据 dsh-tool-antigravity 0.5.2 类型声明与其自带 pet-balance 消费代码双重核对。**未安装到 `desktop` Profile、未重启 DSH**，界面验收待安装后进行。

0.19.1 中转聚合商收窄到 APIGOTO（按用户决策移除 `unorouter` 与 `qnaigc` 两条 provider：它们只给 Key 级余额或时间范围内的花费，没有窗口与订阅语义；登记 31 条、默认 11 开 / 20 关），并优化 APIGOTO 显示（套餐到期带剩余天数且已过期改写、`policy_name` 与套餐名相同时不重复占行、`mode` 翻成中文、`points` 为 0 不占行、钱包文案改为「充值钱包另有 …」、`unit` 缺失时不留悬空空格）。已于 2026-10-31 经 `v0.19.1` 标签 → `release.yml` 发布：工作流 success（标签版本校验、测试、清单/语法、打包、Release、npm 发布全绿），主分支 CI 同步 success；registry 的 `versions["0.19.1"]` 与 `dist-tags.latest` 均为 0.19.1。`v0.19.1` Release 资产与 npm tarball SHA256 一致（`sha256:4d5a699770abeb1f89f98145a326d9b5e0670e41cc5cc6b251555165d826efc5`，183503 字节）。**未安装到 `desktop` Profile、未重启 DSH**，界面验收待安装后进行。

0.19.0 三家中转聚合商额度（新增 `apigoto` / `unorouter` / `qnaigc` 三条 provider，均默认关闭；登记 33 条、默认 11 开 / 22 关；`kxyai` 按用户要求未接入）。已于 2026-10-30 经 `v0.19.0` 标签 → `release.yml` 发布：工作流 success（标签版本校验、测试、清单/语法、打包、Release、npm 发布全绿），主分支 CI 同步 success；registry 的 `versions["0.19.0"]` 与 `dist-tags.latest` 均为 0.19.0，未出现既有传播延迟形态。`v0.19.0` Release 资产与 npm tarball SHA256 一致（`sha256:faa4c7b4918b185ff7b3611fae6cfaaabdbd4fdd4d4d3b7d454a1829b5c733f8`，184681 字节）。**未安装到 `desktop` Profile、未重启 DSH**，界面验收待安装后进行。

0.18.2 客户端 Key 同步与多 Key 监控（解析优先路由实际 `apiKeyEnv`；每个 provider 最多 8 个 `keyRefs` 额外引用名；清除手动 Key 后自动回到 `inherit`）。已于 2026-10-30 经 `v0.18.2` 标签 → `release.yml` 发布：工作流 success（测试、清单/语法、打包、Release、npm 发布全绿），registry 的 `versions["0.18.2"]` 与 `dist-tags.latest` 均为 0.18.2；`v0.18.2` Release 资产与 npm tarball SHA256 一致（`sha256:17186836ac2a610933b55a280bd645146e63a7951d1694a6fa3f33ac049f4858`，180706 字节）。未安装到 `desktop` Profile、未重启 DSH。

0.16.2 OpenCode Go 的 GO 专属凭据引用（`OPENCODE_GO_API_KEY` 优先、`OPENCODE_API_KEY` 回退；修掉「模型能调用、额度报无凭据」）。发布完成仍以 registry 与对应 Actions / Release 结果为准，不自动安装或重启本机 DSH。

0.16.2 已于 2026-10-25 发布并核验：`v0.16.2` tag → `release.yml` 发布 npm；首轮照旧在 60 秒可见性窗口内报 `Publication verification failed for dsh-subusage@0.16.2; check registry before retrying`（6/6 等待后失败），直接查询 registry 已读到 `versions["0.16.2"]` 与 `dist-tags.latest` 均为 0.16.2（`published 2026-10-25T03:17:43Z`，即验证窗口关闭后 5 秒），按「依据只能是 registry」以 `workflow_dispatch`（`version_tag=v0.16.2`）重跑转绿，未重复发布；同一提交的 CI（main）也通过并发布 `build-dc2fc96dfc3a` 资产。`v0.16.2` Release 资产、`build-dc2fc96dfc3a` 资产与 npm tarball 三者 SHA256 一致（`sha256:41f8d4c48925b20589aaad54f2841e0f900db7ae41370eb904804cf736f7a141`，171530 字节）；`build-dc2fc96dfc3a` 为 latest。

0.16.2 已于 2026-10-25 装进 `desktop` Profile（`dsh-subusage@0.16.2`）：发布未满 24 小时，按 pnpm 供应链策略用 Profile 的 `minimumReleaseAgeExclude`（`dsh-subusage@0.16.1 || 0.16.2`）放行，未下调全局 `minimumReleaseAge`；随包 Desktop CLI 的 `add` 两次都在 pnpm `added 0` 处因 Electron crashpad 崩溃（退出码 `4294930435`），改用随包独立 node 驱动同一 pnpm 完成，随后核对依赖 spec / `pnpm-lock.yaml` / 已安装产物均为 `0.16.2`，`dsh.profile.bundles` 不变。未重启 DSH，界面验收由用户重启后执行。

0.16.1 客户端小修与文档新鲜度巡检（Ark 组开关开启后立即刷新全部路由、Client query codec 允许空 `providerIds`、OpenDesign 自动登录说明纠正为实测可用；README 横幅 / 实测表 / 端点清单与 design-ux / development 的计数及契约描述同步修正，`check-browser-runtime.mjs` 计数断言对齐当前 UI）。发布完成仍以 registry 与对应 Actions / Release 结果为准，不自动安装或重启本机 DSH。

0.16.1 已于 2026-10-24 发布并核验：`v0.16.1` tag → `release.yml` 发布 npm；首轮照旧在 60 秒可见性窗口内报 `Publication verification failed`（`Publication verification failed for dsh-subusage@0.16.1; check registry before retrying`），直接查询 registry 已读到 `versions["0.16.1"]` 与 `dist-tags.latest` 均为 0.16.1（`time.modified 2026-10-24T07:10:54Z`），按「依据只能是 registry」以 `workflow_dispatch`（`version_tag=v0.16.1`）重跑转绿，未重复发布；`v0.16.1` Release 资产、主分支 `build-15451385f176` 资产与 npm tarball 三者 SHA256 一致（`sha256:7cd645c7d32adb63fa9a68c58f7f04c9cbbbe93f34ed8c93cc3a2835546b9c48`，170244 字节）；`build-15451385f176` 为 latest。未安装到桌面 Profile、未重启 DSH。

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

> **发布后核对不到版本时**：脚本会自动等待最多 5 分钟的 registry 传播。窗口耗尽后先查询精确版本，再决定是否重跑原标签的 Actions run。
>
> **但「核对失败」不等于「已经传上去了」。** `0.10.8` 就出现过一次反例：`npm publish` 返回成功、脚本照常进入可见性等待，而 registry 里**始终没有**这个版本（等了八分钟仍是 404，包版本列表停在 `0.10.7`），重跑一次才真正发布成功。**所以依据只能是 registry，不能是日志**：`npm view <pkg>@<version> version`（或直接请求 `https://registry.npmjs.org/<pkg>/<version>`）读到版本 → 重跑只为转绿；读不到 → 重跑就是恢复手段（脚本会先查 registry，明确 E404 才重新发布，不会重复发布）。**绝不能把工作流那次失败直接当成版本未发布而去手工再发一次**。

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
node --check lib/cookie-login.js
node --check lib/opendesign-login.js
node --check lib/volcengine.js
node --check lib/grok-credits.js
npm publish --dry-run --ignore-scripts
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm publish --access public --ignore-scripts
npm view dsh-subusage version dist-tags
```

`publishConfig` 固定公共 registry 和公开访问。认证在 npm 官方页面完成，不把密码、验证码或 token 写入仓库。截图与维护文档存放在 GitHub，当前 `files` 白名单只打包运行代码（`lib`）、patch、README 与 LICENSE；README 的图片和文档链接使用 GitHub 地址，npm 页面也能访问。

## 市场收录

提交前以 [awesome-dsh-plugin 贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 为准。用户提供的 [fork 指南](https://github.com/KouzakiUmi/awesome-dsh-plugin/blob/main/contributing.md) 可用于准备条目；市场收录需要目标注册表接受并合并投稿。

本仓库的条目文件名为 `data/plugins/KouzakiUmi__dsh-subusage.yml`，分类为 `usage`。以下描述涵盖当前支持的服务，可作为投稿内容（2026-11-08 起与 [fork 条目](https://github.com/KouzakiUmi/awesome-dsh-plugin/blob/main/data/plugins/KouzakiUmi__dsh-subusage.yml) 同步，含 31 条入口与重构提示）：

```yaml
url: https://github.com/KouzakiUmi/dsh-subusage
name: KouzakiUmi/dsh-subusage
category: usage
description:
  en: 'Subscription quota and balance pills beside the DeepSeek Harness model selector for 31 provider entries (DeepSeek, Z.ai, Kimi, Xiaomi MiMo, OpenCode Go, Command Code, Codex, SuperGrok, MiniMax, Volcengine Ark, GitHub Copilot, SiliconFlow, OpenRouter and more), with a shared settings page, a read-only quota tool and linked pills from Antigravity/Trae/WorkBuddy/OFM/Magpie provider plugins. Under active refactor (QuotaEntry contract, DSH Go panel, Magpie gateway); bugs may appear — please report issues.'
  zh: '在 DeepSeek Harness 模型选择器旁显示 31 条提供商入口的订阅额度与账户余额（DeepSeek、Z.ai、Kimi、小米 MiMo、OpenCode Go、Command Code、Codex、SuperGrok、MiniMax、火山方舟 Ark、GitHub Copilot、SiliconFlow、OpenRouter 等），附统一设置页、只读额度查询工具与 Antigravity/Trae/WorkBuddy/OFM/Magpie 提供方联动。项目正在持续重构（QuotaEntry 契约、DSH Go 面板、Magpie 网关），版本间可能出现 bug——发现异常请回报 issue。'
tarball: https://github.com/KouzakiUmi/dsh-subusage/releases/latest/download/dsh-subusage.tgz
```

分类维持 `usage`：本插件只**读取并展示**用量/余额，不注册模型路由（`models` 会误导为「提供模型」）。提交只添加该条目，不修改其他插件条目或手工改写注册表的生成 README。npm 关联由本包的 `repository` 字段自动建立，条目不添加 `npm:` 字段。「重构提示」按事实写进描述（贡献指南要求描述只说功能；功能正经历持续重构是用户安装前需要知道的事实），不是营销措辞。

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
