# dsh-subusage —— DeepSeek Harness 订阅用量显示

在 DeepSeek Harness 的模型选择器旁以**药丸**显示当前模型商的订阅额度，设置页按厂商 **tag 分页**呈现详细用量（进度条 / 已用-总计 Credits / 重置时间 / 套餐档位）。拉取成功 🟢、加载中 🟡、失败 🔴。

### 2026-09-30 首版（四家模型商 + 限额递归连坐 + 小米内嵌登录窗）

## ✨ 功能

- **四家模型商**：Z.ai Coding（CN）/ Kimi Coding / Xiaomi MiMo / OpenCode Go，与 llm-pi-ai 的 provider 路由对齐。
- **输入区药丸**：随当前选中模型自动切换厂商，点开向上弹出明细（进度条、重置于、限额提示）。
- **设置页 tag 分页**：每家独立面板——用量详情 + 凭据配置（Key / Cookie / 套餐类型），互不拥挤。
- **限额层级连坐（递归 🔴 判定）**：外层窗口（月 / 周 / 7 天）用尽时，内层窗口（5 小时 / 滚动）即便 0% 也标红并注明「受更长周期限额连累」。
- **小米 Cookie 登录**：粘贴 Cookie 即可（**内嵌登录窗暂不可用**，见下方 Cookie 说明）；粘贴内容自动归一化——`cookies.json` / 多行 name-value / 标准 `a=b; c=d` 三格式通吃。
- **凭据继承**：Key 解析顺序 = 凭据服务 → 启动环境（与 llm-pi-ai 的 `apiKeyEnv` 同名）→ 设置页手动填写兜底。

## 📥 安装

```console
git clone https://github.com/KouzakiUmi/dsh-subusage.git
cd dsh-subusage
```

在 DeepSeek Harness 的 profile（`~/.dsh/profiles/desktop`）中以本地依赖挂载：

```console
# package.json 增加依赖（或用 dsh plugin add <路径>）
#   "dsh-subusage": "file:D:/dsh-subusage"
# 并把 "dsh-subusage" 加入 dsh.profile.bundles 数组
```

随后在 profile 目录执行 `dsh plugin install`，**完全重启 DeepSeek Harness**。

> ⚠️ 本地插件建议在 `node_modules` 里用 **Junction** 指向源码目录（改代码即生效，无需重装）。注意：junction 插件若 import `@deepseek-ai/*` 核心包，**必须在 `peerDependencies` 里声明它们**——运行时解析器只对声明过的核心包做转发，否则模块加载静默失败、插件永不激活（详见 [docs/development.md](docs/development.md)）。本仓库已声明。

## 🎮 使用

- **药丸**：选中 Z.ai / Kimi / MiMo / OpenCode Go 模型时自动出现，点开看明细；缺 Key / Cookie 时给出配置指引而非报错。
- **设置页**：设置 → **订阅用量**——顶部总状态灯 + 厂商 tag（带状态点）+ 每家详情：进度条、`已用 x / 总计 y Credits`、`重置于`、套餐/余额，下方是该家凭据配置。
- **小米（Cookie 登录）**：设置 → MiMo 面板 → 粘贴 Cookie → 点「保存设置」→「立即刷新」。获取与处理方法见下节。

### 🔑 环境变量

| 模型商 | 变量 | 说明 |
|---|---|---|
| Z.ai | `ZAI_CODING_CN_API_KEY` | 个人套餐免 org/project；团队套餐在设置页填组织/项目 ID |
| Kimi | `KIMI_CODING_API_KEY` | Kimi Code 控制台 key |
| MiMo | —（Cookie 会话） | **粘贴 Cookie**（内嵌登录窗暂不可用，见下节） |

## 🍪 Cookie 获取与处理（MiMo）

内嵌登录窗（webview）在当前桌面壳版本下无法正常显示，**现阶段只支持 Cookie 方式**。步骤：

1. **登录**：Chrome 打开 <https://platform.xiaomimimo.com> 并登录进控制台。
2. **导出 Cookie**（三选一，插件都能识别）：
   - **DevTools 抄取**：`F12` → `Application` → `Cookies` → `https://platform.xiaomimimo.com`，把每条的 `Name` 和 `Value` 抄成 `name=value`，用 `; ` 连接；
   - **扩展导出 `cookies.json`**（EditThisCookie 等）：导出后**整段 JSON 原文**粘贴即可；
   - **「当前页面 Cookies」文本**：扩展弹窗里的多行 name/value 清单，**整段**粘贴即可。
3. **粘贴**：设置 → 订阅用量 → MiMo 面板 → `Cookie` 框粘贴（任意格式）→ 点开别处（失焦）会**自动归一化**为标准 `a=b; c=d` 串 → 点「保存设置」→「立即刷新」。

要点：

- **必须包含** `api-platform_serviceToken`（核心凭证，httpOnly）和 `userId`；其余条目一并粘贴无妨。
- 导出时的引号会**原样保留**（部分 Cookie 值本身就是带引号的），无需手动处理。
- Cookie 保存在 `~/.dsh/dsh-subusage.json`，仅本机使用；过期后（接口报 401/登录已过期）重复上述步骤换新即可。
- `tokenPlan` 相关接口用 Cookie 鉴权，无需 API Key。
| OpenCode Go | `OPENCODE_API_KEY` | 与 dsh-opencode-go 的凭证引用同名 |

## 🧩 支持的数据

| 模型商 | 窗口 | 明细 | 其它 |
|---|---|---|---|
| Z.ai | 5 小时 / 每周 | Credits（已用/总计） | 套餐档（lite 等） |
| Kimi | 5 小时 / 7 天 | 百分比 | 套餐档（Allegro 等，取自 `/me`） |
| MiMo | 本周期（月度额度池） | Credits（已用/总计） | 重置于下月、套餐名、余额 |
| OpenCode Go | 滚动 / 每周 / 每月 | 百分比 | 各窗重置时间 |

## 📁 目录结构

```
dsh-subusage/
├── lib/
│   ├── index.js          # Host：四家取数、归一化、限额连坐、subUsage remote
│   └── client.js         # Client：药丸、设置页、小米 webview 桥、Cookie 归一化
├── locale/{zh,en}.json   # 插件元数据文案
├── cordis.patch.yml      # loader 条目（id: subusage）
├── tests/                # 单测 + 冒烟（node tests/run-all.mjs）
└── docs/                 # 开发笔记、设计存档
```

## 🛠️ 技术细节

### Host / Client 双平面

Host 经 `subUsage` remote（Typert 契约）向 Client 暴露 `read` / `save`；Client 只在 apply 里立即注册 slot，取数故障仅影响状态灯，不影响界面出现。

### 限额层级连坐

窗口层级：订阅池/月度 ⊃ 周/7 天 ⊃ 5 小时/滚动。外层 `rate-limited`（≥100% 或服务商标记）时逐级向下递归标记，反向不连坐。

### Cookie 归一化

粘贴内容自动识别三种形态：`cookies.json`（EditThisCookie 导出）、多行 name/value 清单（跳过表头、剥离引号）、标准 `a=b; c=d` 串；失焦与保存时自动转换。

### 各家 API 契约

| 模型商 | 端点 | 备注 |
|---|---|---|
| Z.ai | `open.bigmodel.cn/api/monitor/usage/quota/limit?type=1` | `data.limits[]`：`unit 3`=5h、`unit 6`=周，`percentage` 为 0–100 |
| Kimi | `api.kimi.com/coding/v1/usages` + `/me` | 响应双格式并存：`usages.limit_5h/7d.used_ratio`（0–1）与新版 `usage`/`limits[]` |
| MiMo | `platform.xiaomimimo.com/api/v1/{balance,tokenPlan/detail,tokenPlan/usage}` | `percent` 为 **0–1 小数**（需 ×100）；`currentPeriodEnd` 即下月重置 |
| OpenCode Go | `opencode.ai/zen/go/v1/usage` | 三窗在 **`usage` 外层**里；`percent` 为 0–100 |

## ⚙️ 测试与发布（维护者）

```console
node tests/run-all.mjs      # 归一化/级连/Cookie/冒烟 全量回归
```

**兼容性**：严格匹配 DeepSeek Harness 核心 **`0.2.0-rc.2`**（`peerDependencies` 精确版本，含 `@deepseek-ai/dsh` 本体；不匹配的环境会拒绝加载）。升级核心后需同步修改版本声明。

改 Host 侧需**完全重启** DeepSeek Harness 才生效；仅 Client 改动在窗口内 `Ctrl+R` 即可。发版前用真实 Key 跑一遍四家取数（Key 存于用户级环境变量）。

## ⚠️ 版权与许可

MIT License。与 DeepSeek Harness 及各模型商服务无官方关联；API 为公开接口的自助调用，请遵守各服务商的使用条款。
