# usb-ai-agent · U盘私有化AI智能体

> Private AI agent on USB — encrypted & portable, zero host residue, password-gated.
> 基于U盘的私有化AI智能体：配置/密钥/人设/记忆加密随盘携带，本机零残留，GUI密码认证。

**版本 V4.0 · 纯U盘 + GUI密码版**：无需任何硬件令牌，一只 U 盘 + 一个密码即可运行，可直接整体实现。

> **底座说明**：本项目的可移植打包层（两段式便携启动器、`data/` 数据树、便携 Ollama 本地模型、环回加固）移植自开源项目
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT 协议，见仓库 LICENSE）。产品本身（密码门、
> AES-256-GCM 加密、多 AI 隔离、对话壳层）为自研实现。

---

## 项目概述

本项目构建一套**以 U 盘为唯一数据载体**的私有化AI智能体运行系统。全部配置文件、密钥、智能体人设与记忆数据仅存放于U盘；本地电脑仅作为临时运行载体，不持久化保存AI隐私数据。系统以 **GUI 密码作为唯一认证凭证**，支持多AI配置动态切换、SSE 流式对话，并提供 **正常退出全量清理 + 拔盘兜底清理 + 下次启动补清理 + clean.bat 一键清理** 多级机制。

**使用场景**：在公共或临时电脑上使用个人AI助手，要求对话记录、API密钥、人设规则等敏感数据随U盘携带、输入密码才能使用、不遗留于所用电脑。

### 设计原则

- 能做自动的才自动：程序只对确定性可完成的动作做自动化处理；
- 做不到的明示给使用者：凡程序无法保证的清理动作，以明确的操作指引要求使用者手动完成；
- 安全边界诚实：在文档与界面中明确说明系统防护范围与不防护范围，不做超出能力的承诺；
- 单一凭证原则：认证只依赖一个GUI密码，不引入任何需要额外安装或驱动的硬件依赖；
- 零第三方依赖：应用层只用 Node.js 内置模块（http / crypto / fs / fetch），无需 npm install。

### 安全目标边界

**系统防护目标：**

- 防止共用电脑的使用者翻看残留临时文件；
- 防止U盘丢失后他人直接读取配置与记忆（需密码；无密码时密文不可读）；
- 防止配置文件被单独复制后直接读出明文（AES-256-GCM，密钥被密码保护）；
- 防止局域网内他人访问本机服务（服务仅绑定 127.0.0.1，并校验 Host/Origin 防 DNS 重绑定）。

**系统明确不防护的范围：**

- 专业取证环境与受监控电脑；
- 第三方API中转服务对对话内容的可见性；
- 口令强度不足导致的暴力破解（由密码策略与登录限速缓解）；
- 键盘记录器等恶意软件在运行期间窃取已解密会话内容。

## 核心特性

| 特性 | 说明 |
|---|---|
| 🛡️ GUI 密码认证 | 登录密码同时承担「页面访问控制」与「数据加密钥匙」双重职责（替代 ESP32 硬件令牌） |
| 🔐 AES-256-GCM 加密 | 配置 / 密钥 / 人设 / 记忆全部密文落盘；scrypt 口令派生 KEK 保护主密钥 |
| 💾 数据不出盘 | 本机零持久化，会话仅驻留内存，退出即释放 |
| 🧹 四档清理 | 正常退出全量清理 → 拔盘尽力清理 → 下次启动补清理 → `clean.bat`/`clean.sh` 一键清残留 |
| 🧠 多AI人设与记忆隔离 | 每AI独立 `config.enc / prompt.md / memory.enc`，互不覆盖，可动态切换 |
| 🌐 多模型接入 | 兼容 OpenAI 协议，一套机制接入 DeepSeek / NVIDIA / OpenRouter / Ollama 等 |
| 🏠 本地离线模型 | 移植上游便携 Ollama：`tools\Setup_Local_Models.bat` 安装引擎与 GGUF 模型，断网可用 |
| ⚡ 流式对话 | SSE 流式输出，边生成边显示；不支持流式的端点自动回退为非流式 |
| 🖥️ 自研本地 Web 壳层 | 全部页面自研可控，零第三方依赖（仅需便携 Node.js） |
| 🔄 便携 Node 自举 | 首次运行自动下载固定版本 Node（SHA256 校验）到 `engine\`，无需手工解压 |

## 快速开始

1. 准备一只 **U盘**（建议 8GB 以上，NTFS 或 exFAT），将本仓库文件拷贝到 U 盘根目录；
2. 双击 `start.bat`（mac/Linux 运行 `./start.sh`）。**首次运行会自动下载便携 Node.js**（约 30MB，需联网；之后缓存于 `engine\`）；
3. 浏览器自动打开 `127.0.0.1:<空闲端口>`；**首次使用**：设置登录密码 → 添加第一个AI（模型API密钥，可先连通性测试）→ 开始对话；
4. 使用完毕：点击「保存并退出 / 不保存退出」→ 自动清理本机残留 → 拔出U盘（可再运行 `clean.bat` 复核）。

> 提示：正常运行无需管理员权限；建议将U盘程序目录加入杀软排除项。
> 离线使用：先用「本地模型安装」装好 Ollama 引擎与模型，之后断网也能对话。

## 目录结构

```text
U盘根目录/
├── start.bat / start.sh      # 入口：两段式启动（bootstrap → launcher）
├── clean.bat / clean.sh      # 一键清理本机残留（读 data\keys\cache_path.txt）
├── package.json              # 仅元数据（零 dependencies）
├── LICENSE                   # MIT
├── lib/                      # 自研壳层（Node.js）
│   ├── server.js             # 本地 Web 服务器（路由 / SSE / 会话守卫 / 环回加固）
│   ├── paths.js              # 统一路径解析（PORTABLE_AI_DATA_DIR 可覆盖）
│   └── modules/
│       ├── auth.js           # 密码认证、scrypt KEK、会话令牌、限速
│       ├── crypto.js         # AES-256-GCM 加解密、scrypt KEK
│       ├── config.js         # AI 配置扫描/读写、active 切换、prompt.md
│       ├── ai.js             # OpenAI 兼容客户端（chat / chatStream / test）
│       ├── memory.js         # 记忆库读写（memory.enc）
│       ├── cleanup.js        # 缓存路径登记与清理
│       ├── usb.js            # 拔盘兜底（unclean.flag）
│       └── local-models.js   # 便携 Ollama 启停/状态（移植上游）
├── dashboard/                # 前端页面（login / main / exit）
├── tools/                    # 移植自上游的打包底座
│   ├── bootstrap.ps1 / .sh   # 下载+校验便携 Node → engine\
│   ├── launcher.mjs          # 平台无关入口（dashboard/status/clean/local-setup）
│   ├── runtime-manifest.json # 固定 Node 版本清单
│   ├── Setup_Local_Models.bat / setup_local_models.ps1 / .sh  # 本地 Ollama 模型安装
│   └── Change_Provider 由网页完成
├── templates/prompt.md       # 人设模板（createAI 时复制）
├── engine/                   # 运行时生成：便携 Node（自动）
└── data/                     # 运行时生成（PORTABLE_AI_DATA_DIR 可覆盖）
    ├── keys/                 # master.key.enc · cache_path.txt · unclean.flag
    ├── configs/ai_XXX/       # config.enc · prompt.md · memory.enc
    ├── workspace/            # 工作文件默认输出目录
    ├── logs/
    ├── models/               # 本地模型注册表 installed-models.txt
    └── ollama/               # 便携 Ollama 引擎与模型数据
```

## 技术方案

| 类别 | 选型 |
|---|---|
| 运行时 | 便携 Node.js，固定版本自动下载（`tools/bootstrap.ps1` / `bootstrap.sh`，SHA256 校验） |
| 后端壳层 | Node.js 原生模块（http / crypto / fs / fetch），零第三方依赖 |
| GUI | 自研本地 Web 页面（HTML/CSS/JS）+ 127.0.0.1 本地服务器 |
| 加密方案 | AES-256-GCM（node:crypto），密文带随机 IV 与认证标签 |
| 口令派生 | scrypt（node:crypto 内置，N=2^15, r=8, p=1），派生约 0.2~0.5 秒 |
| 对话传输 | SSE 流式（`POST /api/chat`），不支持流式的端点自动回退非流式 |
| 本地模型 | 便携 Ollama 引擎（`data/ollama`）+ GGUF 导入 + `installed-models.txt` 注册表 |
| AI 接入 | 兼容 OpenAI 协议（/chat/completions），node 原生 fetch |
| 清理 | 正常退出清理 + 拔盘兜底（unclean.flag）+ 启动补清理 + clean.bat/sh |
| 平台 | Windows 10 / 11（macOS / Linux 提供 start.sh / clean.sh 对等脚本） |

## 使用说明（README.txt 摘要）

见 U 盘根目录 `README.txt`（首次使用 / 正常使用 / 退出与清理 / 安全边界 / FAQ）。

## 场景方向

- 团队共用（多指纹多角色，各自隔离的AI配置与记忆）；
- 访客模式（无认证时仅开放只读公共AI）。

## 许可证

本项目部分特性设计参考开源项目 [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT 协议）。
仓库内 LICENSE 为 MIT，以实际文件为准。
