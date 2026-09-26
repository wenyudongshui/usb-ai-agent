# usb-ai-agent · U盘私有化AI智能体

> Private AI agent on USB — portable Claude Code, multi-account gate, zero host residue.
> 基于U盘的私有化AI智能体：网页是**管理控制台**，AI 对话交给随盘携带的 **Claude Code** 命令行；支持多账号、API密钥双方式配置、按工作对象的提示词档案，本机零残留。

**定位**：网页只做管理，不做对话。对话在 Claude Code 终端里进行。

> **底座说明**：可移植打包层（两段式启动器、`data/` 树、Claude Code 引擎安装与原生二进制 stub 修复、OpenAI→Anthropic 本地适配器、环回加固、本地 Ollama 模型）移植自
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT，见 LICENSE）。产品侧的多账号、密钥管理、档案模型为自研。

---

## 启动页（多账号）

- **无历史账号**：左侧只显示「＋ 新增账号」，创建账号名 + 密码后进入。
- **存在多个账号**：左侧展示多个账号选择框，点选后输入该账号密码登录。
- **存储与防护**：账号密码以 scrypt 派生钥匙加密（`data/users/<账号>/master.key.enc`），**文件内不可读取明文密码**；仅在控制台的「账号管理」页允许**删除**账号（连带其全部档案/密钥数据）。

## 控制台能力

| 能力 | 说明 |
|---|---|
| 🖥️ 引擎 · 先检查后安装 | 「① 检查是否安装/有更新」与「② 确认安装/更新」为**两个独立步骤**，不合并；含实时安装日志与回滚 |
| 🔑 API 密钥管理 | 两种配置方式：**①手动填写**（提供商/模型/地址/密钥）；**②拖拽导入 CC Switch 的 settings.json** 自动识别。密钥加密存储 |
| 📁 档案（工作对象） | 新建档案**仅需**：档案名称、描述、CLAUDE.md、人设（systemPrompt）——不再填写模型/服务商/密钥；激活即生成主流格式 `settings.json` |
| 🚀 命令行对话 | 按「当前 API 密钥 + 激活档案」打开 Claude Code 终端；非 Anthropic 提供商自动起本地适配器 |
| 🚪 退出（仅两项） | **① 全部删除退出**（清本机残留 + 全部账号/档案/密钥）；**② 保留本次在本机的全部更改，其余数据全部清除**（不清本机，清其余全部数据） |
| 🔄 便携 Node 自举 | 首次运行自动下载固定 Node（SHA256 校验）到 `engine\` |
| 🏠 本地离线模型 | 便携 Ollama + GGUF 模型下载，断网可用 |

## 快速开始

1. 拷贝仓库到 U 盘根目录（≥8GB，NTFS/exFAT）；
2. 双击 `start.bat`（mac/Linux `./start.sh`）→ 首次自动下载便携 Node（约 30MB）；
3. 登录页「＋ 新增账号」→ 设账号名+密码进入；
4. 「API 密钥管理」：手填密钥，或把 CC Switch 的 settings.json 拖入导入 → 设为当前；
5. 「档案管理」：新建档案（名称/描述/人设/CLAUDE.md）→ 激活；
6. 「引擎」：① 检查 → ② 确认安装（约 300MB）→ 等完成；
7. 点「🚀 命令行对话」，在 Claude Code 终端里对话/编码；
8. 完成回到控制台，按需选「全部删除退出」或「保留本机更改退出」。

## 目录结构

```text
U盘根目录/
├── start.bat / start.sh / clean.bat / clean.sh
├── package.json / LICENSE / .gitattributes
├── lib/
│   ├── server.js  paths.js
│   └── modules/  auth(多账号) · crypto · api-keys · profiles · providers · adapter · runtime · cleanup · usb · local-models
├── dashboard/                 # 管理控制台页面（login / main / exit）
├── tools/                     # 打包底座（bootstrap / launcher / runtime-manifest / Setup_Local_Models）
├── engine/                    # 运行时生成：便携 Node + Claude Code 引擎
└── data/                      # 运行时生成（PORTABLE_AI_DATA_DIR 可覆盖）
    ├── users.json             # 账号名索引（仅名称，明文可见以作选择）
    └── users/<账号>/
        ├── master.key.enc     # 密码派生 KEK 包裹的主密钥（密文，不可读取密码）
        ├── api.enc            # API 密钥配置（AES-256-GCM 加密）
        ├── prefs.json         # activeProfile
        └── profiles/<slug>/   # 工作对象档案（主流 Claude Code 配置目录）
            ├── profile.json   # { name, description, persona }
            ├── CLAUDE.md      # 该工作对象的习惯/规则
            └── settings.json  # 生成：env(当前 API 密钥) + systemPrompt(人设)
```

## 安全边界（诚实说明）

**防护**：控制台仅 127.0.0.1 + Host/Origin 校验；多账号密码不落明文（scrypt KEK 包裹，文件不可读）；API 密钥加密存储；本机零持久化；删除账号即删全部数据。
**不防护**：专业取证/受监控电脑；第三方 API 中转对对话内容的可见性；键盘记录器窃取运行期间已解密内容；口令强度不足的暴力破解（有策略与限速）。
**注意**：档案激活后生成的 `settings.json` 为 Claude Code 原生明文格式（含密钥），U 盘请妥善保管。

## 技术方案

| 类别 | 选型 |
|---|---|
| 账号 | 多账号，账号名可见、密码不可读；scrypt(N=2^15,r=8,p=1) KEK → 主密钥 |
| 引擎 | 官方 @anthropic-ai/claude-code，固定版本安装到 `engine\<platform>\current`，`--no-bin-links` + stub 修复 |
| API密钥 | 加密存储；手动填写 或 CC Switch settings.json 拖拽导入 |
| 档案 | 仅名称/描述/人设/CLAUDE.md；主流 Claude Code 配置目录 |
| 适配 | OpenAI→Anthropic 本地适配器（127.0.0.1 + 每轮 token） |
| 后端 | Node.js 原生模块，零第三方依赖 |
| 清理 | 退出两模式（wipe / keepHost）+ 拔盘兜底 + 启动补清理 + clean.bat |

## 常见问题

- **多账号怎么切换？** 退出登录后回登录页点选账号即可。
- **忘记密码？** 该账号数据不可恢复；可在登录页新增新账号，或「账号管理」删除旧账号。
- **CC Switch settings.json 拖入无反应？** 需含 `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL` 等字段。
- **安装引擎失败？** 检查网络/代理，日志在「引擎 → 安装日志」。
- **杀软拦截？** 将 U 盘程序目录加入信任/排除项。

## 许可证

MIT。打包层参考 [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable)（MIT）。仓库内 LICENSE 以实际文件为准。
