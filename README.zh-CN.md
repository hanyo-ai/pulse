<div align="center">

# ⚡ PULSE

**透视每个 AI Agent。实时会话可视化、调试与可观测性。**

实时观看 Agent 对话展开 — `system` 提示词、`user` 消息、`assistant` 响应、`tool_result` 工具返回 — 在一个优雅的仪表盘中一览无余。基于 Bun 的自托管 AI 网关，兼容 OpenAI & Anthropic，内置费用追踪与审计日志。

<img src="./assets/pulse.jpg" alt="PULSE - AI Agent 可观测性" width="800" />

[![Powered by Bun](https://img.shields.io/badge/Powered%20by-Bun-black?logo=bun)](https://bun.sh)
[![Built with Elysia](https://img.shields.io/badge/Built%20with-Elysia-blue)](https://elysiajs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev)

[English](./README.md) · [演示](#-演示) · [快速开始](#-快速开始) · [API](#-api-参考) · [部署](#-部署)

</div>

---

## 🎬 演示

<div align="center">

![PULSE 演示](./assets/demo.gif)

</div>

---

## ✨ 为什么选择 PULSE

---

## 🚀 快速开始

需要 [Bun](https://bun.sh) **>= 1.2**。

### 从 npm 安装（单用户/本地）

```bash
# npm
npm install -g @hanyo_ai/pulse

# bun
bun install -g @hanyo_ai/pulse

# yarn / pnpm
yarn global add @hanyo_ai/pulse
pnpm add -g @hanyo_ai/pulse

# 然后运行
pulse run
```

打开 `http://127.0.0.1:3000`，无需登录 — 数据存储在 `~/.pulse/pulse.db`。使用 `pulse run --help` 查看参数（`--port`、`--host`、`--db-path`、`--auth` 启用登录页）。

随时更新到最新版本：

```bash
pulse update
```

> **💡 如需 VPN / 代理更新：**
> ```bash
> HTTPS_PROXY=http://127.0.0.1:7890 pulse update
> ```

### 从源码运行（开发模式）

```bash
git clone <your-repo-url>
cd pulse
bun install
bun run dev          # http://localhost:3000 (热更新)
```

使用 **admin / admin123** 登录，然后立即修改密码。

### 生产环境（自托管，多用户）

```bash
bun run build        # 打包前端 → ./dist
bun run start        # 提供 dist/ + API，端口 $PORT（默认 3000）
```

> `bun run start` 需要 `dist/` 目录存在。前端修改后需重新构建 — 生产分支提供的是打包后的静态资源，不是 `src/`。

---

## 🔌 API 参考

PULSE 提供两类接口：**网关代理**（用于上游 LLM 调用）和 **管理 API**（用于仪表盘）。

### 网关代理（对外）

OpenAI 兼容：

```bash
POST /v1/chat/completions
Authorization: Bearer <gateway_key>

{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "你好！"}],
  "stream": true
}
```

Anthropic 兼容：

```bash
POST /anthropic/v1/messages
x-api-key: <gateway_key>

{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "你好！"}],
  "stream": true
}
```

### 管理 API（内部）

<details>
<summary><strong>全部端点</strong></summary>

| 方法 | 端点 | 描述 |
|--------|----------|-------------|
| POST | `/api/auth/login` · `logout` · `register` · `change-password` | 认证流程 |
| GET | `/api/auth/me` | 当前用户 |
| GET / POST / PUT / DELETE | `/api/auth/users[/:id]` | 用户管理（管理员） |
| GET / POST / PUT / DELETE | `/api/sessions[/:id]` | 会话 CRUD |
| GET | `/api/sessions/:id/messages` | 会话消息 |
| GET / POST / PUT / DELETE | `/api/endpoints[/:id]` | 提供商端点 CRUD |
| POST | `/api/endpoints/test` | 测试端点配置（不保存） |
| GET | `/api/logs?provider=…&status=…` | 按条件查询审计日志 |
| GET | `/api/usage/stats` · `by-model` · `trend` | 用量分析 |
| GET | `/api/health` | 服务健康检查 |

</details>

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------------|-------------------------------|
| 运行时 | [Bun](https://bun.sh) 1.2+ |
| 框架 | [Elysia](https://elysiajs.com) |
| 数据库 | SQLite (`bun:sqlite`) |
| 前端 | React 19 + TypeScript |
| 认证 | bcrypt + JWT |

---

## ⚙️ 配置

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `NODE_ENV` | — | 设为 `production` 启用生产模式 |
| `PORT` | `3000` | 服务器监听端口 |
| `HOST` | `0.0.0.0` | 绑定地址（`pulse run` 默认为 `127.0.0.1`） |
| `DB_PATH` | `pulse.db` | SQLite 数据库文件路径 |
| `PULSE_NO_AUTH` | — | 设为 `1` 禁用登录（单用户/本地安装） |

在仪表盘的**端点**选项卡中配置上游提供商：上游 URL、上游 API Key、网关 Key（客户端发送的密钥）、默认模型以及每百万 Token 的定价。

> ⚠️ **不要在 `bunfig.toml` 的 `[define]` 表中放入 `process.env.NODE_ENV`。** Bun 在运行时和打包时都会应用 `[define]`，所以像 `"process.env.NODE_ENV" = "\"development\""` 这行会在 systemd/shell 设置 `NODE_ENV=production` 时静默覆盖它，导致服务器处于开发模式。如果只需要在打包时强制使用开发模式，请在 `bun build` 命令行中传入 `--define`。

---

## 🔗 接入 Claude Code

将 PULSE 作为 Claude Code 的 Anthropic 后端 — 所有 Agent 会话、工具调用和响应都会自动出现在 PULSE 仪表盘中。

### 一键配置

```bash
bash scripts/env-deploy.sh "http://127.0.0.1:3000/anthropic" "你的网关密钥"
```

该脚本将：
- 根据传参设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY`
- 将环境变量写入你的 Shell 配置文件（`~/.zshrc`、`~/.bashrc` 等）
- 更新 `~/.claude.json` 以白名单化 API 密钥

运行后，重启终端或执行 `source ~/.zshrc`（或你对应 Shell 的配置文件），然后启动 `claude` — 所有请求将通过 PULSE 代理。

> 将 `"你的网关密钥"` 替换为在 PULSE **端点**选项卡中配置的网关密钥。

### 手动配置

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:3000/anthropic"
export ANTHROPIC_API_KEY="你的网关密钥"
```

> ⚠️ 启动 Claude Code 前请确保 PULSE 正在运行（`bun run dev` 或 `pulse run`）。在 PULSE 仪表盘的**端点**选项卡中配置你的网关密钥和上游 Anthropic 端点。

---
