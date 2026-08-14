# GemPlan Cloudflare Worker

GemPlan 是一个基于 Cloudflare Workers 构建的高性能全能大模型网关 / 代理服务。它将 Google 官方的 **Gemini CodeAssist** 以及 **Antigravity (Google One AI / DeepMind Agent)** 接口无缝封装为标准协议格式，支持多协议转发、动态配额查询、模型列表自省、思维链提取与工具调用。

---

## 🌟 核心特性

- **多协议原生兼容**：
  - **OpenAI 格式**：标准 `/v1/chat/completions` 与 `/v1/models`，支持流式 (SSE) 与非流式，支持 Function Calling / Tool Use。
  - **Claude 格式**：原生 `/v1/messages` 接口支持，完美兼容 Claude Code、Codex 及第三方 Claude 客户端。
  - **Gemini 原生格式**：支持 `/v1beta/models/{model}:streamGenerateContent` 与 `:generateContent`。
- **双引擎支持 (CodeAssist & Antigravity)**：
  - **CodeAssist 模式**：原生支持 Google Cloud CodeAssist 接口。
  - **Antigravity 模式**：内置 Google One AI / DeepMind 智能体协议封装，支持 Claude 3.5/3.7 Sonnet、Gemini 2.5/3 系列模型。
- **深度思考思维链 (Reasoning / Thinking)**：
  - 自动适配思考模型，提取思维链内容。
  - OpenAI 规范映射：`choices.delta.reasoning_content` / `choices.message.reasoning_content`。
  - Claude 规范映射：`thinking` block 结构。
  - 支持动态思考预算（`thinking_budget`、`reasoning_effort` 分档与自动模式）。
- **完善的 Tool Use / Function Call 转换**：
  - 针对 Antigravity 后端做 schema 规范化（自动内联 `$ref` / `$defs`、严格 Draft 2020-12 校验兼容）。
  - 支持多模态工具响应（图片/截图等嵌套进 `functionResponse`）。
  - 严格保持 `tool_use` 与 `tool_result` 配对。
- **可视化 Web 管理控制台**：
  - 内置 OAuth2 登录与 Google 账号授权流程（支持一键授权绑定与 Token 自动续期）。
  - 实时查看 Antigravity 模式各模型配额百分比、重置时间与思考预算。
  - 用户配置面板（自定义 API 路径、API Key 生成与管理、模型名称正则模式路由映射）。
- **稳定性与容灾设计**：
  - 内置智能重试与退避机制（应对上游短时 400/429/空响应缓存）。
  - 针对大 Prompt 进行内存与 CPU 优化。

---

## 🚀 快速部署

### 1. 准备工作
确保本地已安装 Node.js 环境并安装 Wrangler：
```bash
npm install -g wrangler
wrangler login
```

### 2. 创建 Cloudflare KV 命名空间
Worker 使用 Cloudflare KV 存储用户配置、OAuth Token 及配额缓存：
```bash
wrangler kv:namespace create GEMINI_KV
```
执行后将生成的 `id` 填写到 `wrangler.jsonc` 中：
```jsonc
"kv_namespaces": [
  {
    "id": "你的_KV_NAMESPACE_ID",
    "binding": "GEMINI_KV"
  }
]
```

### 3. 配置 Google OAuth 环境变量 / Secrets
在 Cloudflare 控制台或使用 Wrangler 命令行安全配置 OAuth 客户端信息（避免将机密直接硬编码进代码）：

```bash
# 配置 CodeAssist 模式凭证
wrangler secret put CODEASSIST_CLIENT_ID
wrangler secret put CODEASSIST_CLIENT_SECRET

# 配置 Antigravity 模式凭证
wrangler secret put ANTIGRAVITY_CLIENT_ID
wrangler secret put ANTIGRAVITY_CLIENT_SECRET
```

> **本地开发调试**：可在根目录创建 `.dev.vars` 文件（已在 `.gitignore` 中）：
> ```env
> CODEASSIST_CLIENT_ID="你的_CODEASSIST_CLIENT_ID"
> CODEASSIST_CLIENT_SECRET="YOUR_CODEASSIST_CLIENT_SECRET"
> ANTIGRAVITY_CLIENT_ID="你的_ANTIGRAVITY_CLIENT_ID"
> ANTIGRAVITY_CLIENT_SECRET="YOUR_ANTIGRAVITY_CLIENT_SECRET"
> ```

### 4. 部署上线
```bash
# 安装依赖
npm install

# 本地调试
npx wrangler dev

# 部署至 Cloudflare Workers
npx wrangler deploy
```

---

## 📖 使用指南

### 1. 初始化控制台
部署成功后，通过浏览器访问 Worker 绑定的域名（如 `https://your-worker.workers.dev` 或自定义域名）：
1. 首次访问按提示创建管理员密码。
2. 登录后进入控制台，点击 **绑定 Google 账号** 完成 OAuth 授权。
3. 控制台会为你生成专属的 **API Key**（格式形如 `sk-...`）和 **自定义 API 路径**。

### 2. 接口调用地址

所有接口均支持通过以下形式进行认证：
- HTTP Header：`Authorization: Bearer <your_api_key>`
- Anthropic Header：`x-api-key: <your_api_key>`
- Google Header：`x-goog-api-key: <your_api_key>` 或 URL Query 参数 `?key=<your_api_key>`

#### 1) OpenAI 兼容接口
- **Chat Completions**: `https://<domain>/<custom_path>/v1/chat/completions`
- **Models 列表**: `https://<domain>/<custom_path>/v1/models` (返回当前账号真实的可用模型及配额元数据)

#### 2) Claude 兼容接口
- **Messages**: `https://<domain>/<custom_path>/v1/messages`

#### 3) Gemini 原生接口
- **GenerateContent**: `https://<domain>/<custom_path>/v1beta/models/{model}:generateContent`
- **StreamGenerateContent**: `https://<domain>/<custom_path>/v1beta/models/{model}:streamGenerateContent`

---

## 🔒 安全与脱敏规范

- 请勿在公开仓库中提交真实的 Google OAuth Client Secret、API Key 或本地 Cookie / Session 文件。
- 建议所有密钥均通过 Cloudflare Dashboard 的 Secrets / Environment Variables 注入。

---

## 📄 License
MIT License
