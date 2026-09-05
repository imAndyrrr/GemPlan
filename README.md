# GemPlan Cloudflare Worker

GemPlan 是一个基于 Cloudflare Workers 构建的高性能全能大模型网关 / 代理服务。它将 Google 官方的 **Gemini CodeAssist** 以及 **Antigravity** 接口无缝封装为标准协议格式，支持多协议转发、动态配额查询、模型列表自省、思维链提取与工具调用。

### GemPlan将使用GoogleOAuth的GeminiCodeAssist及Antigravity调用封装为API.

制作人：imAndyrrr

参考项目：glowingjade/obsidian-smart-composer；lbjlaq/Antigravity-Manager

项目地址：[https://github.com/imAndyrrr/GemPlan](https://github.com/imAndyrrr/GemPlan)

---

## 🌟 核心特性

- **多协议原生兼容**：
  - **OpenAI Chat格式**：标准 `/v1/chat/completions` 与 `/v1/models`，支持流式 (SSE) 与非流式，支持 Function Calling / Tool Use。
  - **OpenAI Responses 格式**：`/v1/responses`，支持 `input`、`instructions`、Function Calling / Tool Use，以及事件式流式 SSE。
  - **Claude 格式**：原生 `/v1/messages` 接口支持，完美兼容 Claude Code、Codex 及第三方 Claude 客户端。
  - **Gemini 原生格式**：支持 `/v1beta/models/{model}:streamGenerateContent` 与 `:generateContent`。
- **双引擎支持 (CodeAssist & Antigravity)**：
  - **CodeAssist 模式**：原生支持 Google Cloud CodeAssist 接口。
  - **Antigravity 模式**：内置 Antigravity 智能体协议封装，支持 Claude 、Gemini 系列模型。
- **深度思考思维链 (Reasoning / Thinking)**：
  - 自动适配思考模型，提取思维链内容。
  - OpenAI 规范映射：`choices.delta.reasoning_content` / `choices.message.reasoning_content`。
  - Claude 规范映射：`thinking` block 结构。
  - 支持动态思考预算（`thinking_budget`、`reasoning_effort` 分档与自动模式）。
- **完善的 Tool Use / Function Call 转换**：
  - 针对 Antigravity 后端做 schema 规范化（自动内联 `$ref` / `$defs`、严格 Draft 2020-12 校验兼容）。
  - 支持多模态工具响应（图片/截图等嵌套进 `functionResponse`）。
  - 严格保持 `tool_use` 与 `tool_result` 配对。
- **多账号管理与智能配额池**：
  - 支持绑定多个 Google 账号（Antigravity 与 CodeAssist 均支持添加多个独立账号）。
  - **智能配额路由**：请求发起时自动评估各账号的实时配额，优先调度目标模型剩余配额最充裕（%）的账号；配额相同时按 LRU 时间均衡轮询。
  - **无缝自动故障转移 (Failover)**：当某一账号遭遇 429 速率限制、配额耗尽或临时封禁时，系统自动将其加入冷却队列，并在同一次请求中无缝切换至备用可用账号继续执行，用户侧零感知报错。
  - **可视化账号与配额池控制台**：直观查看全部账号状态、各模型聚合配额与单账号配额，支持一键启用/禁用、删除和解除冷却。
- **可视化 Web 管理控制台**：
  - 内置 OAuth2 登录与 Google 账号授权流程（支持一键授权绑定与 Token 自动续期）。
  - 实时查看 Antigravity 模式各模型配额百分比、重置时间与思考预算；每个模型百分比都会标注“五小时窗口”“周窗口”或“窗口未标注”，并与共享的五小时 / 周配额分栏显示。
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
Worker 使用 Cloudflare KV 存储用户配置、OAuth 状态和账号信息；配额及思维签名属于可恢复的临时缓存，不依赖 KV 持久写入：
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

代码不会再内置 Google OAuth Client ID 或 Client Secret。生产环境必须先配置上面四个
Cloudflare Secret，本地开发则使用 `.dev.vars` 注入；`.dev.vars` 已被 git 忽略，不会提交到仓库。

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

### 2. 调用说明

所有接口均支持通过以下形式进行认证：
- HTTP Header：`Authorization: Bearer <your_api_key>`
- Anthropic Header：`x-api-key: <your_api_key>`
- Google Header：`x-goog-api-key: <your_api_key>` 或 URL Query 参数 `?key=<your_api_key>`

API Key 只应通过环境变量、密钥管理工具或本地配置注入，不要直接写入公开文档或代码仓库。

#### 1) OpenAI Chat格式（Chat Completions）

```bash
curl https://your.domain/<user>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_api_key>" \
  -d '{
    "model": "<modelname>",
    "messages": [
      {
        "role": "user",
        "content": "你好，请用一句话介绍自己。"
      }
    ]
  }'
```

#### 2) OpenAI Responses

普通请求：

```bash
curl https://your.domain/<user>/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_api_key>" \
  -d '{
    "model": "<modelname>",
    "instructions": "请简洁回答。",
    "input": "你好，请用一句话介绍自己。"
  }'
```

返回内容主要从以下字段读取：

```text
output_text
```

也可以从结构化输出中读取：

```text
output[].content[].text
```

流式请求：

```bash
curl -N https://your.domain/<user>/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_api_key>" \
  -d '{
    "model": "<modelname>",
    "input": "请输出一段简短问候语。",
    "stream": true
  }'
```

流式请求会返回事件式 SSE，例如：

```text
response.created
response.in_progress
response.output_text.delta
response.output_text.done
response.completed
```

工具调用示例：

```json
{
  "model": "<modelname>",
  "input": "查询北京天气。",
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "查询指定城市的天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string"
          }
        },
        "required": ["city"]
      }
    }
  ]
}
```

模型产生函数调用后，客户端将函数执行结果作为 `function_call_output` 放入下一次 Responses 请求中。

#### 3) 模型列表

```bash
curl https://your.domain/<user>/v1/models \
  -H "Authorization: Bearer <your_api_key>"
```

模型列表会返回当前账号实际可用的模型及配额元数据。请优先使用返回的 `id` 作为后续请求的 `model` 值。

#### 4) Claude Messages

```bash
curl https://your.domain/<user>/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your_api_key>" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "<modelname>",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "你好，请简短回答。"
      }
    ]
  }'
```

#### 5) Gemini 原生接口

```bash
curl 'https://your.domain/<user>/v1beta/models/{modelname}:generateContent' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_api_key>" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "你好，请简短回答。"
          }
        ]
      }
    ]
  }'
```

流式 Gemini 请求使用：

```text
https://your.domain/<user>/v1beta/models/{modelname}:streamGenerateContent
```

请将上述地址中的域名、秘钥和用户名替换为实际配置。

---

## 🔒 安全与脱敏规范

- 请勿在公开仓库中提交真实的 Google OAuth Client Secret、API Key 或本地 Cookie / Session 文件。
- 建议所有密钥均通过 Cloudflare Dashboard 的 Secrets / Environment Variables 注入。

---

## 📄 License
MIT License
