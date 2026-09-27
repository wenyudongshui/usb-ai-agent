# 内嵌 NextChat 构建说明

本项目把 [NextChat](https://github.com/ChatGPTNextWeb/NextChat) 的**静态导出产物**内嵌为「对话框模式」前端，
由后端提供 OpenAI 兼容的 `/v1/chat/completions` 桥接，路由到当前激活智能体（适配 CC Switch 全部提供商）。

## 一次性构建（有 Node 的机器上执行）

```bash
cd NextChat-main
npm install --no-audit --no-fund --ignore-scripts        # 用 npm 代替 yarn（Windows 上 yarn classic 有解包 bug）
```

**两步源码改动（仅影响本内嵌产物，聊天功能不变）：**

1. `app/mcp/actions.ts` → 用 `tools/nextchat-mcp-stub.ts` 的内容替换
   （`"use server"` 与静态导出冲突；存根导出同名 no-op，MCP 特性禁用，聊天不变）。
2. `next.config.mjs` → `nextConfig` 增加：
   ```js
   typescript: { ignoreBuildErrors: true },
   ```
   （npm 解析的依赖与 yarn.lock 有差异导致个别 TS 隐式 any 报错，产物已能正常编译运行，跳过校验。）

**构建：**
```bash
BUILD_MODE=export BUILD_APP=1 npx next build --no-lint
```
产物在 `out/`。

## 拷入本项目

```bash
rm -rf dashboard/nextchat && cp -r NextChat-main/out dashboard/nextchat
```

## 运行时

- 后端 `server.js` 已实现：`/nextchat/*`(SPA 回退)、`/_next/*`、根级公共资源(favicon/icons/manifest)静态服务；
- `/v1/models`、`/v1/chat/completions` 走 `lib/modules/openai-bridge.js`：OpenAI 系直连、Anthropic 系自动翻译，
  并注入当前人格的 CLAUDE.md 为 system 消息、使用激活智能体的密钥与模型。
- `/v1/meta` 返回当前激活的智能体 + 人格 + 人格 Prompt；`/nextchat/index.html` 由服务端注入一段**同步**引导脚本，
  在 NextChat 加载前把其原生配置做**初始注入**（`localStorage['access-control']`），**不强制、可编辑**：
  - OpenAI 系智能体 → `provider=OpenAI, openaiUrl=真实地址, openaiApiKey=密钥`，NextChat **原生直连**；
  - Anthropic 系智能体 → NextChat 的 Anthropic 浏览器客户端**刻意不发密钥**（`anthropic.ts` 注释掉 Authorization），
    浏览器内无法原生直连，只能指向本机 `/v1` 桥（服务端发密钥 + 翻译 + 可选人格）。
- 对话框模式下无需安装 Claude Code 引擎（纯对话直连提供商）。

## 配置/人格如何同步

1. 外层「② 选择智能体」「③ 选择工作人格」完成配置后，对话框**每次请求**由桥接使用「激活智能体 + 激活人格的 CLAUDE.md」；
2. 人格为**可选**：未配置人格时 CLAUDE.md 为空，桥接**不注入** system；配置了才注入（服务端实时生效）；
3. 打开对话框时，服务端注入的同步脚本把 NextChat 原生配置预填为当前智能体（OpenAI 系=真实直连，Anthropic 系=本机 `/v1`）；
   你在 NextChat 里可自由改动/直连其它 API——注入仅是初始种子，不侵入原生逻辑。

## 升级 NextChat

重复上面步骤即可；升级后把新的 `out/` 再拷入 `dashboard/nextchat/`。
