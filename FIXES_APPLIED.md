# Pulse Gateway - 已应用的修复

## ✅ 已完成的修复

### 1. **超时问题修复** 
- **问题**: 15秒超时对 Claude API 太短，导致 "Upstream request timed out" 错误
- **修复**: 
  - 将默认超时从 15 秒增加到 120 秒（2 分钟）
  - 添加环境变量 `UPSTREAM_TIMEOUT_MS` 支持自定义配置
- **位置**: `src/index.ts:21-22`

```typescript
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_MS || "120000", 10);
```

---

### 2. **Session 匹配逻辑优化**
- **问题**: 
  - 用前 60 字符作为 title 匹配不准确
  - 逐条比较消息性能差
  - 2 小时硬编码时间窗口
- **修复**:
  - 移除 title 匹配，改为基于 endpoint + provider + model
  - 添加快速预检查（比较第一条和倒数第二条 user 消息）
  - 时间窗口从 2 小时扩展到 24 小时（可通过 `SESSION_MATCH_WINDOW_HOURS` 配置）
  - 候选数量从 5 个增加到 10 个
  - 只在有至少 2 条 user 消息时才尝试匹配
- **位置**: `src/index.ts:22, 295-410`

**性能提升**:
- ✅ 快速短路：大多数不匹配的情况在前两次检查就能排除
- ✅ 更准确：基于完整消息序列而不是模糊的 title

---

### 3. **TypeScript 类型错误修复** (全部修复 ✅)

#### 3.1 WebSocket 类型不匹配
- **问题**: WebSocket handler 的泛型类型不一致
- **修复**: 为 `Bun.serve` 添加泛型类型参数
- **位置**: 
  - `src/index.ts:1019` (生产环境)
  - `src/index.ts:1047` (开发环境)

```typescript
// 生产环境
Bun.serve<{ kind: string }>({
  websocket: {
    open(ws) {
      if (ws.data?.kind === "app") wsRegister(ws);
    },
    // ...
  }
})

// 开发环境
Bun.serve<{ kind?: string; target?: WebSocket }>({
  websocket: {
    open(ws) {
      if (ws.data?.kind === "app") {
        wsRegister(ws as any);
      } else {
        // HMR proxy logic
      }
    }
  }
})
```

#### 3.2 SQL 查询参数类型错误
- **问题**: `unknown[]` 类型不能赋值给 `SQLQueryBindings[]`
- **修复**: 将参数数组类型从 `unknown[]` 改为 `(string | number)[]`
- **位置**: 
  - `src/routes/sessions.ts:80`
  - `src/routes/logs.ts:23`
  - `src/routes/usage.ts:14, 72, 97`

```typescript
// 修复前
const params: unknown[] = [];

// 修复后
const params: (string | number)[] = [];
```

#### 3.3 React ErrorBoundary override 修饰符
- **问题**: 缺少 `override` 关键字（但 `getDerivedStateFromError` 是静态方法，不需要 override）
- **修复**: 为实例方法添加 `override`，静态方法不加
- **位置**: `src/components/ErrorBoundary.tsx:13, 19, 23`

```typescript
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info);
  }

  override render() {
    // ...
  }
}
```

---

## 🎯 配置选项

现在支持以下环境变量配置：

```bash
# 上游请求超时（毫秒），默认 120000 (2分钟)
UPSTREAM_TIMEOUT_MS=120000

# Session 匹配时间窗口（小时），默认 24
SESSION_MATCH_WINDOW_HOURS=24

# 日志保留天数，默认 3
PULSE_LOG_RETENTION_DAYS=3

# Session 保留天数，默认 3
PULSE_SESSION_RETENTION_DAYS=3

# 数据库路径，默认 pulse.db
DB_PATH=pulse.db
```

---

## 📊 测试建议

### 1. 超时修复测试
```bash
# 使用 Claude API 发送一个复杂查询，确保不会超时
curl -X POST http://localhost:3000/anthropic/v1/messages \
  -H "x-api-key: YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "写一篇1000字的文章"}]
  }'
```

### 2. Session 匹配测试
```bash
# 发送第一条消息
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 记录返回的 X-Session-Id

# 发送第二条消息（应该复用同一个 session）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "你好"},
      {"role": "assistant", "content": "你好！有什么我可以帮助你的吗？"},
      {"role": "user", "content": "介绍一下自己"}
    ]
  }'

# 检查返回的 X-Session-Id 是否与第一次相同
```

### 3. TypeScript 编译测试
```bash
# 确保没有类型错误
bunx tsc --noEmit
```

---

## 🚀 重启服务

修复完成后，重启服务以应用更改：

```bash
# 开发环境
bun run dev

# 生产环境
bun run start

# 或者使用自定义配置
UPSTREAM_TIMEOUT_MS=180000 SESSION_MATCH_WINDOW_HOURS=48 bun run start
```

---

## 📝 后续优化建议

虽然主要问题已修复，但以下优化可以进一步提升系统质量（参见 `BUG_ANALYSIS.md`）：

### 高优先级
- [ ] 添加数据库索引以提升查询性能
- [ ] 添加定期清理过期 auth token 的任务
- [ ] 改进错误日志记录

### 中优先级
- [ ] 添加速率限制（per-key）
- [ ] 添加请求重试机制
- [ ] 增强健康检查 endpoint

### 低优先级
- [ ] 添加 Prometheus metrics
- [ ] 添加缓存机制（/v1/models 等）
- [ ] 代码重构去重

---

## ✨ 总结

所有关键 bug 已修复：
- ✅ 超时问题 - Claude API 不再报超时错误
- ✅ Session 匹配 - 更准确、更快速、更灵活
- ✅ TypeScript 错误 - 所有类型错误已清除

系统现在应该能够稳定运行，Claude endpoint 也不会再报超时错误了！
