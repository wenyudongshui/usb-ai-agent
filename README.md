# usb-ai-agent · U盘私有化AI智能体

> Private AI agent on USB — portable Claude Code, encrypted gate, zero host residue.
> 基于U盘的私有化AI智能体：网页是**管理控制台**，AI 对话交给随盘携带的 **Claude Code** 命令行；配置/提示词档案随盘携带、可切换，本机零残留，GUI密码认证。

**定位**：网页只做管理（管引擎、管提供商、管提示词档案），不内置对话聊天页。对话在 Claude Code 终端里进行——这既是官方编码智能体的原生形态，也让工具/权限/会话能力直接落在命令行本体上。

> **底座说明**：可移植打包层（两段式启动器、`data/` 树、Claude Code 引擎安装与原生二进制 stub 修复、OpenAI→Anthropic 本地适配器、环回加固、本地 Ollama 模型）移植自开源项目
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT，见 LICENSE）。产品侧的密码门、加密、档案模型为自研。

---

## 它做什么

| 能力 | 说明 |
|---|---|
| 🖥️ 管理控制台（网页） | 不用来聊天；用来：安装/更新 Claude Code 引擎、管理提供商档案、管理提示词、开关本地模型、查看日志 |
| 🚀 命令行对话 | 点「命令行对话」，按当前档案的配置打开 Claude Code 终端，直接开始对话/编码 |
| 📁 档案（CC-switch 式切换） | 每个档案 = 一个工作对象：`settings.json`（提供商+环境变量+systemPrompt）+ `CLAUDE.md`（习惯/规则），一键切换 |
| 🔌 多提供商 | Anthropic / DeepSeek / OpenRouter / NVIDIA / Gemini / OpenAI / Ollama 等；非 Anthropic 走内置本地适配器 |
| 🗂️ 提示词档案 | 每个档案独立 systemPrompt（写入 settings.json，主流格式）+ CLAUDE.md；面向不同工作对象各自一套 |
| 🔐 GUI 密码门 | 管理控制台需密码登录；密码即凭证，本机零持久化 |
| 🧹 多级清理 | 安全退出全量清理 → 拔盘兜底 → 下次启动补清理 → `clean.bat` 一键清残留 |
| 🏠 本地离线模型 | 便携 Ollama 引擎 + GGUF 模型下载，断网可用 |
| 🔄 便携 Node 自举 | 首次运行自动下载固定 Node（SHA256 校验）到 `engine\` |

## 快速开始

1. 拷贝本仓库到 U 盘根目录（建议 ≥8GB，NTFS/exFAT）；
2. 双击 `start.bat`（mac/Linux：`./start.sh`）→ 首次自动下载便携 Node（约 30MB）；
3. 浏览器打开管理控制台 → **设置密码**；
4. 网页点击「**安装 / 更新引擎**」→ 下载固定版本 Claude Code（约 300MB）到 U 盘 `engine\`；
5. 新建**档案**（选提供商/模型/密钥，填提示词）→ 激活 → 点「**🚀 命令行对话**」；
6. 在打开的 Claude Code 终端里对话与编码；使用完毕回到网页「安全退出」。

> 提权与执行：Claude Code 在终端内拥有完整能力（读写文件、运行命令、审批）。请在终端内按需使用权限模式；不经网页中转、不经第三方代理时最直接。

## 目录结构

```text
U盘根目录/
├── start.bat / start.sh        # 两段式启动：bootstrap → launcher
├── clean.bat / clean.sh        # 一键清理本机残留
├── package.json                # 仅元数据（零 dependencies）
├── LICENSE                     # MIT
├── lib/                        # 后端（Node.js）
│   ├── server.js               # 管理控制台 HTTP 服务（auth/session/环回加固）
│   ├── paths.js                # 统一路径解析（PORTABLE_AI_DATA_DIR 可覆盖）
│   └── modules/
│       ├── auth.js             # GUI 密码门、scrypt KEK、会话
│       ├── crypto.js           # AES-256-GCM / scrypt（密码门）
│       ├── profiles.js         # 档案 CRUD + 切换（CC-switch 式）
│       ├── providers.js        # 提供商目录 + 启动环境变量
│       ├── adapter.js          # OpenAI→Anthropic 本地适配器（非 Anthropic 提供商）
│       ├── runtime.js          # Claude Code 引擎安装/回滚/stub 修复
│       ├── cleanup.js / usb.js # 残留清理 / 拔盘兜底
│       └── local-models.js     # 便携 Ollama
├── dashboard/                  # 管理控制台页面（login / main / exit）
├── tools/                      # 打包底座（移植上游）
│   ├── bootstrap.ps1 / .sh     # 下载+校验便携 Node → engine\
│   ├── launcher.mjs            # dashboard | cli [slug] | install | status | clean | local-setup
│   ├── runtime-manifest.json   # 固定依赖：@anthropic-ai/claude-code
│   └── Setup_Local_Models.*    # 本地 Ollama + 模型下载
├── templates/prompt.md         # 预留人设模板
├── engine/                     # 运行时生成：便携 Node + Claude Code 引擎
└── data/                       # 运行时生成（PORTABLE_AI_DATA_DIR 可覆盖）
    ├── profiles/<slug>/        # 档案 = Claude Code 配置目录
    │   ├── profile.json        # 档案主记录（提供商/模型/密钥/提示词）
    │   ├── settings.json       # 主流 Claude Code 设置（env + systemPrompt）
    │   └── CLAUDE.md           # 该工作对象的习惯/规则（启动时自动加载）
    ├── keys/ · cache/ · logs/ · npm-cache/ · launch/ · models/ · ollama/
```

## 档案 = 主流格式，可直接使用

`data/profiles/<slug>/` 本身就是一个标准的 Claude Code 配置目录：

- `settings.json` —— Claude Code 原生读取：`env`（ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL …）+ `systemPrompt`；
- `CLAUDE.md` —— 启动时以该目录为工作目录，自动作为该工作对象的基础规则；
- 你在其他机器上也可以直接 `claude` 进入同一目录，行为一致（`用主流方式保存`）。

切换档案即切换 `CLAUDE_CONFIG_DIR` 与工作目录——等价于「CC Switch」的内置实现，无需额外安装工具。

## 安全边界（诚实说明）

**防护**：管理控制台仅绑定 127.0.0.1 并校验 Host/Origin（防 DNS 重绑定）；GUI 密码门控制访问；U 盘丢失后无密码无法进入；本机零持久化，退出即清。
**不防护**：专业取证/受监控电脑；第三方 API 中转对对话内容的可见性；键盘记录器窃取运行期间已解密内容；口令强度不足的暴力破解（有策略与限速缓解）。
**注意**：档案的 `settings.json` 为**主流明文格式**（Claude Code 原生读取），含密钥。请将 U 盘视为敏感介质；若需更强加密，请依赖磁盘级加密或妥善保管 U 盘。

## 技术方案

| 类别 | 选型 |
|---|---|
| 运行时 | 便携 Node.js，固定版本自动下载（SHA256 校验） |
| 引擎 | 官方 @anthropic-ai/claude-code，固定版本安装到 `engine\<platform>\current`，`--no-bin-links` + stub 修复（兼容 FAT32/exFAT） |
| 后端 | Node.js 原生模块，零第三方依赖 |
| 适配 | OpenAI Chat Completions ↔ Anthropic Messages 本地适配器（127.0.0.1 + 每轮 token） |
| 档案 | 主流 Claude Code 配置目录（settings.json + CLAUDE.md），内置切换 |
| GUI | 自研管理控制台页面 + 127.0.0.1 本地服务器 |
| 口令 | scrypt（N=2^15,r=8,p=1）KEK → 主密钥；AES-256-GCM（密码门） |
| 清理 | 安全退出 + 拔盘兜底 + 启动补清理 + clean.bat/sh |
| 本地模型 | 便携 Ollama + GGUF 导入 + installed-models.txt |
| 平台 | Windows 10/11（macOS/Linux 提供 start.sh/clean.sh 对等脚本） |

## 常见问题

- **安装引擎时提示网络失败？** 检查网络/代理后重试；安装日志在网页「引擎→安装日志」。
- **命令行对话打开后未运行？** 请确认引擎已安装成功，且在网页中已激活档案。
- **忘记密码？** 数据不可恢复，删除 `data\keys\` 后重新初始化。
- **端口被占用？** 自动从 8787 递增选择空闲端口。
- **杀软拦截？** 将 U 盘程序目录加入杀软信任/排除项。

## 许可证

MIT。打包层设计参考 [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。仓库内 LICENSE 以实际文件为准。