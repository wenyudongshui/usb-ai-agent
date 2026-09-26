# 🔒 usb-ai-agent · U盘私有化AI智能体

> **Private AI agent on USB — portable Claude Code, multi-account, zero host residue.**
> 把官方 Claude Code 装进一只 U 盘：网页是**管理控制台**，对话走 Claude Code；账号/智能体/人格随盘携带，本机零残留。

![license](https://img.shields.io/badge/license-MIT-blue) ![runtime](https://img.shields.io/badge/runtime-Node.js_24-green) ![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## 它解决什么

在公共/临时电脑上使用 AI 助手时，你往往不希望把 **API 密钥、提示词、账号** 留在那台机器上。本项目把一切都放进 U 盘：

- **引擎**：官方 **Claude Code**（命令行编码智能体），免安装、随盘携带；
- **配置**：一个账号可绑定**多个智能体（API 配置）**与**多套工作人格**；
- **数据**：密钥加密存储、密码不落明文、退出即清理，本机零持久化。

网页只做**管理**（管引擎、管智能体、管人格、管本地模型），真正的对话在 **Claude Code 命令行**或**网页对话框**里进行。

> **底座**：可移植打包层（两段式启动器、`data/` 树、引擎安装与原生二进制 stub 修复、OpenAI→Anthropic 本地适配器、环回加固、便携 Ollama）移植自
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。产品侧的多账号、智能体/人格模型、对话框模式为自研。

---

## 核心特性

| 特性 | 说明 |
|---|---|
| 🔐 **多账号** | 账号名可见、密码不可读（scrypt KEK 包裹）；删除账号 = 级联删除其下全部智能体/人格/数据 |
| 🤖 **智能体（API 配置）** | 一账号多智能体；**手动录入** 或 **拖拽导入 CC Switch 的 settings.json**；密钥 AES-256-GCM 加密 |
| 🧠 **工作人格** | 只需名称/描述/人设/CLAUDE.md，一套一个工作对象；激活即生成主流 Claude Code `settings.json` |
| 🚀 **两种运行模式** | **⌨️ 命令行模式**（终端，能力最完整）／ **💬 对话框模式**（网页流式 + 工具审批，基于 Agent SDK） |
| 🛡️ **安全** | 仅 127.0.0.1 + Host/Origin 防 DNS 重绑定；本机零持久化；正常退出/拔盘/补清理多级清理 |
| 🏠 **本地离线** | 便携 Ollama 引擎 + GGUF 模型，断网可用 |
| ⚡ **便携 Node 自举** | 首次运行自动下载固定 Node（SHA256 校验）到 `engine/` |

## 使用流程

```
① 前置环境检查 → ② 选择智能体 → ③ 选择工作人格 → ④ 运行模式（命令行/对话框）
```

1. 拷贝仓库到 U 盘根目录（≥8GB），双击 `start.bat`（mac/Linux `./start.sh`）；
2. 登录页「＋ 新增账号」设密码进入；
3. **① 环境检查**：先「检查」再「确认安装」引擎（约 300MB，含对话 SDK）——两步独立；
4. **② 选择智能体**：手动录入，或把 CC Switch 的 settings.json **拖入**导入，点选为当前；
5. **③ 选择工作人格**：新建（名称/描述/人设/CLAUDE.md）并设为当前；
6. **④ 运行模式**：命令行（开终端）或对话框（网页聊天），点「启动」。

## 目录结构

```text
USB root/
├── start.bat / start.sh          # 两段式启动：bootstrap（下载校验 Node）→ launcher
├── clean.bat / clean.sh          # 一键清理本机残留
├── lib/                          # 后端（Node.js 原生，零第三方依赖）
│   ├── server.js                 # 管理控制台 HTTP（auth/会话/环回加固）
│   ├── paths.js
│   └── modules/                  # auth · crypto · agents · personas · dialog
│                                 #  · providers · adapter · runtime · cleanup · usb · local-models
├── dashboard/                    # login（多账号）/ main（流程） / dialog（对话框） / exit
├── tools/                        # bootstrap · launcher · runtime-manifest · Setup_Local_Models.*
├── engine/                       # 运行时生成：便携 Node + Claude Code 引擎
└── data/                         # 运行时生成（PORTABLE_AI_DATA_DIR 可覆盖）
    ├── users.json
    └── users/<账号>/
        ├── master.key.enc        # 密码派生 KEK 包裹的主密钥（密文，不可读）
        ├── agents.enc            # 智能体（API 密钥）AES-256-GCM 加密
        ├── prefs.json
        └── personas/<slug>/      # 工作人格：persona.json · CLAUDE.md · settings.json
```

## 技术方案

| 类别 | 选型 |
|---|---|
| 运行时 | 便携 Node.js，固定版本自动下载（SHA256 校验） |
| 引擎 | `@anthropic-ai/claude-code` + `claude-agent-sdk` 固定版本，`--no-bin-links` + 原生二进制 stub 修复（兼容 FAT32/exFAT） |
| 密码 | scrypt（N=2^15, r=8, p=1）KEK → 主密钥；密码不落明文 |
| 智能体密钥 | AES-256-GCM 加密；手动 或 CC Switch settings.json 拖拽导入 |
| 适配器 | OpenAI Chat Completions ↔ Anthropic Messages 本地适配（127.0.0.1 + 每轮 token） |
| 对话框 | Agent SDK 流式 `query`，`canUseTool` 工具审批，权限模式（默认/自动接受编辑/无限制） |
| 后端 | Node.js 原生模块，零第三方依赖 |

## 安全边界（诚实说明）

**防护**：控制台与对话框仅 127.0.0.1 可访问，校验 Host/Origin（防 DNS 重绑定）；多账号密码不可从文件读取；智能体密钥加密存储；删除账号级联清空；本机零持久化。

**不防护**：专业取证/受监控电脑；第三方 API 中转对对话内容的可见性；键盘记录器窃取运行期间已解密内容；口令强度不足的暴力破解（有策略与限速缓解）。

**注意**：人格激活后生成的 `settings.json` 为 Claude Code 原生**明文**格式（含密钥），U 盘请妥善保管；如需要更强加密请配合磁盘级加密。

## 常见问题

- **忘记账号密码？** 该账号数据不可恢复；可新增新账号，或在「账号管理」删除旧账号。
- **安装引擎失败？** 检查网络与 U 盘空间（需 ≥2GB）；日志在「引擎 → 安装日志」；如反复失败删除 `engine/<平台>/staging` 后重试。
- **对话框模式提示未装引擎？** 先「① 环境检查 → ② 确认安装」。
- **拖入 CC Switch settings.json 无反应？** 需含 `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL` 等字段；未知域名按 Anthropic 兼容端点直连识别。
- **杀软拦截？** 将 U 盘程序目录加入信任/排除项。

## License

MIT。可移植打包层参考 [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。仓库内 LICENSE 以实际文件为准。
