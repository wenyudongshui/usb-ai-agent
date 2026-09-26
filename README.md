# usb-ai-agent · U盘私有化AI智能体

> Private AI agent on USB — portable Claude Code, multi-account, zero host residue.
> 基于U盘的私有化AI智能体：**一个账号 → 绑定多个智能体 + 多套工作人格**；流程为 **前置环境检查 → 选择智能体 → 选择工作人格 → 运行模式**；对话走 Claude Code，本机零残留。

> **底座说明**：可移植打包层（两段式启动器、`data/` 树、Claude Code 引擎安装与原生二进制 stub 修复、OpenAI→Anthropic 本地适配器、环回加固、本地 Ollama 模型）移植自
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT，见 LICENSE）。产品侧多账号、智能体/人格模型、对话框模式为自研。

---

## 核心绑定关系

- **一个账号** → 绑定**多个智能体**（API 配置：提供商/模型/密钥）+ **多套工作人格**（名称/描述/人设/CLAUDE.md）。
- 绑定保持数据边界：**删除账号 → 级联删除该账号下全部智能体、全部工作人格与数据**。
- 密码不落明文（scrypt KEK 包裹，文件内不可读取）；仅「账号管理」页允许删除账号。

## 整体执行流程

**前置环境检查 → 选择智能体 → 选择工作人格 → 运行模式**

1. **① 前置环境检查**：先「检查是否安装/有更新」，确认后再「确认安装/更新」（两段式，不合并）。
2. **② 选择智能体**：支持新增、删除；新增两种方式——**手动录入** / **文件拖拽导入（CC Switch settings.json）**。
3. **③ 选择工作人格**：支持新增、删除；每个工作人格独立 settings.json（人设）+ CLAUDE.md，点选为当前。
4. **④ 运行模式（二选一）**：
   - **⌨️ 命令行模式**：打开 Claude Code 终端对话/编码；
   - **💬 对话框模式**：网页内流式对话（基于 Agent SDK，含工具审批）。

## 快速开始

1. 拷贝仓库到 U 盘根目录（≥8GB）；双击 `start.bat`（mac/Linux `./start.sh`），首次自动下载便携 Node（约 30MB）。
2. 登录页「＋ 新增账号」→ 设账号名+密码进入。
3. **① 环境检查**：先检查、再确认安装引擎（约 300MB，含 Agent SDK）。
4. **② 选择智能体**：手动录入，或把 CC Switch 的 settings.json 拖入导入 → 设为当前。
5. **③ 选择工作人格**：新建（名称/描述/人设/CLAUDE.md）→ 设为当前。
6. **④ 运行模式**：选「命令行模式」或「对话框模式」→ 启动。

## 目录结构

```text
U盘根目录/
├── start.bat / start.sh / clean.bat / clean.sh / package.json / LICENSE
├── lib/
│   ├── server.js  paths.js
│   └── modules/  auth(多账号) · crypto · agents(智能体) · personas(工作人格) · dialog(对话框SDK) · providers · adapter · runtime · cleanup · usb · local-models
├── dashboard/      login / main(流程) / dialog(对话框) / exit
├── tools/          bootstrap · launcher · runtime-manifest(@anthropic-ai/claude-code + claude-agent-sdk) · Setup_Local_Models.*
├── engine/         运行时生成：便携 Node + Claude Code
└── data/           users.json · users/<账号>/{master.key.enc, agents.enc, personas/<slug>/{persona.json, CLAUDE.md, settings.json}, prefs.json}
```

## 退出（仅两项）

- **① 全部删除退出**：清本机残留 + 全部账号/智能体/人格/密钥数据 → 退出。
- **② 保留本次在本机的全部更改，其余数据全部清除**：不清本机、清其余全部数据 → 退出。

## 安全边界（诚实说明）

**防护**：控制台/Dialog 仅 127.0.0.1 + Host/Origin 校验；账号密码不落明文；智能体密钥 AES-256-GCM 加密；级联删除维持数据边界；本机零持久化。
**不防护**：专业取证/受监控电脑；第三方 API 中转对对话的可见性；键盘记录器；口令强度不足。**注意**：人格激活后生成的 `settings.json` 为主流明文格式（含密钥），U 盘请妥善保管。

## 技术方案

| 类别 | 选型 |
|---|---|
| 账号 | 多账号；密码 scrypt KEK → 主密钥，不可读；删除级联 |
| 智能体 | 密钥加密存储；手动 或 CC Switch settings.json 拖拽导入 |
| 工作人格 | 仅名称/描述/人设/CLAUDE.md；主流 Claude Code 配置目录 |
| 引擎 | @anthropic-ai/claude-code + claude-agent-sdk 固定版本，`--no-bin-links` + stub 修复 |
| 对话框 | Agent SDK (`loadSDK`) 流式 query，`canUseTool` 工具审批、权限模式 |
| 命令行 | `launcher.mjs cli <账号> <人格>` 读已物化 settings.json |
| 后端 | Node.js 原生模块，零第三方依赖 |

## 常见问题

- **对话框模式提示未装引擎？** 先「环境检查 → 确认安装」（需联网，包含 SDK）。
- **命令行模式 vs 对话框模式？** 命令行工具/权限/会话能力最完整；对话框更直观、带审批 UI。
- **拖入 settings.json 无反应？** 需含 `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL` 等字段。
- **忘记密码？** 该账号不可恢复；可新增新账号，或删除旧账号。

## 许可证

MIT。打包层参考 [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。仓库内 LICENSE 以实际文件为准。