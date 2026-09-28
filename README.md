# 🔒 usb-ai-agent · U盘私有化AI智能体

> **Private AI agent on USB — portable Claude Code, single account, zero host residue.**
> 把官方 Claude Code 装进一只 U 盘：网页是**管理控制台**，对话走 Claude Code；账号/智能体/人格随盘携带，本机零残留。

![license](https://img.shields.io/badge/license-MIT-blue) ![runtime](https://img.shields.io/badge/runtime-Node.js_24-green) ![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## 它解决什么

在公共/临时电脑上使用 AI 助手时，你往往不希望把 **API 密钥、提示词、账号** 留在那台机器上。本项目把一切都放进 U 盘：

- **引擎**：官方 **Claude Code**（命令行编码智能体），免安装、随盘携带；
- **配置**：一个账号可绑定**多个智能体（API 配置）**与**多套工作人格**；
- **数据**：密钥加密存储、密码不落明文、退出即清理，本机零持久化。

网页只做**管理**（管引擎、管智能体、管人格、管本地模型），真正的对话在 **Claude Code 命令行**里进行。

> **底座**：可移植打包层（两段式启动器、`data/` 树、引擎安装与原生二进制 stub 修复、OpenAI→Anthropic 本地适配器、环回加固、便携 Ollama）移植自
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。产品侧的单账号、智能体/人格模型为自研。

---

## 核心特性

| 特性 | 说明 |
|---|---|
| 🔐 **单账号** | 首次填账号名+密码即创建（无需确认）；之后同账号+密码登录；不做多账号管理 |
| 🤖 **智能体（API 配置）** | 一账号多智能体；**手动录入** 或 **拖拽导入 CC Switch 的 settings.json**；密钥 AES-256-GCM 加密 |
| 🧠 **工作人格** | 只需名称/描述/人设/CLAUDE.md，一套一个工作对象；可选（再点已选卡片即取消，无人设直连）；激活即生成主流 Claude Code `settings.json` |
| 🧩 **MCP 工具层** | 内置 `base_会话管理`（/sessions 存档）+ `base_项目文件`（账号目录内浏览/读写），零配置默认启用；第三方拖入 `.mcp.json`/服务文件导入，握手读 Skill、检测重名（仅警告不拦截）、独立启停 |
| 🚀 **命令行对话** | 以当前智能体 + 工作人格在 Claude Code 终端里对话/编码 |
| 🛡️ **安全** | 仅 127.0.0.1 + Host/Origin 防 DNS 重绑定；本机零持久化；正常退出/拔盘/补清理多级清理 |
| 🏠 **本地离线** | 便携 Ollama 引擎 + GGUF 模型，断网可用 |
| ⚡ **便携 Node 自举** | 首次运行自动下载固定 Node（SHA256 校验）到 `engine/` |

## 使用流程

```
① 前置环境检查 → ② 选择智能体 → ③ MCP 管理 → ④ 选择工作人格 → ⑤ 启动命令行
```

1. 拷贝仓库到 U 盘根目录（≥8GB），双击 `start.bat`（mac/Linux `./start.sh`）；
2. 登录页首次填**账号名 + 密码**（无需确认）创建并进入；之后同账号 + 密码登录；
3. **① 环境检查**：先「检查」再「确认安装」引擎（约 300MB）——两步独立；
4. **② 选择智能体**：手动录入，或把 CC Switch 的 settings.json **拖入**导入，点选为当前；
5. **③ MCP 管理**：内置两项默认启用，可直接开关；第三方拖入 `.mcp.json` / 服务文件导入，点「测试连接」握手读取 Skill 列表；
6. **④ 选择工作人格**：新建（名称/描述/人设/CLAUDE.md）并设为当前；
7. **⑤ 启动**：点「命令行对话」打开 Claude Code 终端对话/编码。

## MCP（工具层）

全部 MCP 能力由 **AI 自主调用**，无需手动触发；启用状态与会话数据独立存放，与工作人格完全解耦。

**内置基础 MCP**（默认自带 · 零配置 · 统一 `base_` 前缀防重名，仅工作于 U 盘本地目录）：

| 内置 MCP | Skills |
|---|---|
| `base_会话管理` | `base_session_save` · `base_session_list` · `base_session_load` · `base_session_delete`（存档落在 `data/users/<账号>/sessions/`） |
| `base_项目文件` | `base_fs_list` · `base_fs_tree` · `base_fs_read` · `base_fs_write` · `base_fs_search`（限定在账号目录内，越界拒绝） |

无自动保存、无弹窗：只有你在对话里明确要求，模型才会调用存档 / 写入。

**第三方 MCP**：拖入 `.mcp.json`（`mcpServers` 格式）或直接拖入 `.js/.mjs/.py` 服务文件；握手自动读取 Skill 列表并检测与其它 MCP 的重名——**仅警告、不拦截**；每个 MCP 独立开关；不改名、不修改源码，安全性/兼容性由用户自行负责。暂只支持 stdio 类本地进程（远程 http/sse 会明确拒绝）。

**冲突处理三层**：`base_` 前缀隔离 → 每个 MCP 独立开关可随时关闭 → 握手时检测重名仅警告。

**落地方式**：激活人格 / 启动命令行时，已启用的 MCP 会被物化进会话目录的 `.mcp.json`（Claude Code 原生格式），同时 `settings.json` 写入 `enableAllProjectMcpServers: true` 免确认——引擎自行拉起并托管这些进程。

## 目录结构

```text
USB root/
├── start.bat / start.sh          # 两段式启动：bootstrap（下载校验 Node）→ launcher
├── clean.bat / clean.sh          # 一键清理本机残留
├── lib/                          # 后端（Node.js 原生，零第三方依赖）
│   ├── server.js                 # 管理控制台 HTTP（auth/会话/环回加固）
│   ├── paths.js
│   ├── modules/                  # auth（单账号） · crypto · agents · personas · mcp
│   │                             #  · providers · adapter · runtime · cleanup · usb · local-models
│   └── mcp/                      # 内置 MCP 服务（stdio，零依赖）
│       ├── protocol.js           # JSON-RPC 2.0 脚手架
│       ├── base-sessions.js      # base_会话管理
│       └── base-files.js         # base_项目文件
├── dashboard/                    # login（单一表单）/ main（流程） / exit
├── tools/                        # bootstrap · launcher · runtime-manifest · Setup_Local_Models.*
├── tests/                        # smoke · mcp · mcp-api · dashboard（node tests/run.mjs）
├── engine/                       # 运行时生成：便携 Node + Claude Code 引擎
└── data/                         # 运行时生成（PORTABLE_AI_DATA_DIR 可覆盖）
    ├── users.json
    └── users/<账号>/
        ├── master.key.enc        # 密码派生 KEK 包裹的主密钥（密文，不可读）
        ├── agents.enc            # 智能体（API 密钥）AES-256-GCM 加密
        ├── mcp.enc               # MCP 注册表（内置开关 + 第三方配置）加密
        ├── sessions/             # base_会话管理 的会话存档（/sessions）
        ├── prefs.json
        ├── bare/                 # （可选）无人设会话：仅智能体 env
        └── personas/<slug>/      # 工作人格：persona.json · CLAUDE.md · settings.json · .mcp.json
```

## 技术方案

| 类别 | 选型 |
|---|---|
| 运行时 | 便携 Node.js，固定版本自动下载（SHA256 校验） |
| 引擎 | `@anthropic-ai/claude-code` 固定版本，`--no-bin-links` + 原生二进制 stub 修复（兼容 FAT32/exFAT） |
| 密码 | scrypt（N=2^15, r=8, p=1）KEK → 主密钥；密码不落明文 |
| 智能体密钥 | AES-256-GCM 加密；手动 或 CC Switch settings.json 拖拽导入 |
| MCP | 内置服务为自研 stdio JSON-RPC（零依赖，`lib/modules/mcp/`）；启停集合物化为会话目录的 `.mcp.json`，由引擎托管进程 |
| 适配器 | OpenAI Chat Completions ↔ Anthropic Messages 本地适配（127.0.0.1 + 每轮 token） |
| 命令行 | `launcher.mjs cli <账号> <人格>` 读已物化 settings.json，直连提供商 |
| 后端 | Node.js 原生模块，零第三方依赖 |

## 安全边界（诚实说明）

**防护**：控制台仅 127.0.0.1 可访问，校验 Host/Origin（防 DNS 重绑定）；账号密码不可从文件读取；智能体密钥加密存储；本机零持久化。

**不防护**：专业取证/受监控电脑；第三方 API 中转对对话内容的可见性；键盘记录器窃取运行期间已解密内容；口令强度不足的暴力破解（有策略与限速缓解）。

**MCP 边界**：内置 MCP 只在自己的账号目录内活动（路径越界直接拒绝），无系统高危权限；第三方 MCP 是你主动导入的本地进程，**以你的用户权限运行、不受本项目约束**——其安全性、兼容性与数据去向由你自行负责。

**注意**：人格激活后生成的 `settings.json` / `.mcp.json` 为 Claude Code 原生**明文**格式（含密钥、含第三方 MCP 的 env），U 盘请妥善保管；如需要更强加密请配合磁盘级加密。

## 常见问题

- **忘记账号密码？** 该账号数据不可恢复；删除 `data\users\`（或整个 `data\`）后重新初始化即可（单账号无图形化管理入口）。
- **安装引擎失败？** 检查网络与 U 盘空间（需 ≥2GB）；日志在「引擎 → 安装日志」；如反复失败删除 `engine/<平台>/staging` 后重试。
- **命令行对话打开后没反应？** 确认引擎已安装、已激活智能体与工作人格。
- **拖入 CC Switch settings.json 无反应？** 需含 `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL` 等字段；未知域名按 Anthropic 兼容端点直连识别。
- **MCP 拖入后没出现？** `.mcp.json` 需含 `command` + `args`（远程 http/sse 暂不支持）；`npx` 类命令首次握手要下载依赖，慢一些属正常；点「测试连接」看具体报错。
- **开关拨了没生效？** MCP 在**下次启动命令行**时生效（物化进 `.mcp.json`），当前已开的会话不受影响。
- **想看存档？** 会话存档不设图形入口——在命令行里对 AI 说「保存这次会话」，由 `base_会话管理` 执行；文件在 `data/users/<账号>/sessions/`。
- **杀软拦截？** 将 U 盘程序目录加入信任/排除项。

## License

MIT。可移植打包层参考 [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。仓库内 LICENSE 以实际文件为准。
