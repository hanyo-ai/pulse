import { useState, useEffect, useCallback } from "react";

export type Lang = "en" | "zh";

const STORAGE_KEY = "pulse_lang";

// ---- Translation dictionary ----
const dict: Record<Lang, Record<string, string>> = {
  en: {
    // Sidebar
    "nav.monitor": "Monitor",
    "nav.sessionMonitor": "Session",
    "nav.auditLogs": "Logs",
    "nav.manage": "Manage",
    "nav.endpoints": "Endpoints",
    "nav.keys": "API Keys",
    "nav.usage": "Usage",
    "nav.users": "Users",

    // Roles
    "role.admin": "Admin",
    "role.user": "User",

    // Topbar
    "topbar.sessionMonitor": "Session",
    "topbar.auditLogs": "Logs",
    "topbar.endpoints": "Endpoints",
    "topbar.keys": "API Keys",
    "topbar.usage": "Usage Analytics",
    "topbar.users": "Users",
    "topbar.login": "Login",
    "topbar.active": "Active",
    "topbar.requests": "Requests",
    "topbar.monthlyCost": "Monthly Cost",
    "topbar.logout": "Logout",

    // AuditLogs
    "logs.allProviders": "All Providers",
    "logs.allStatus": "All Status",
    "logs.searchPlaceholder": "Search request ID…",
    "logs.time": "Time",
    "logs.requestId": "Request ID",
    "logs.provider": "Provider",
    "logs.model": "Model",
    "logs.status": "Status",
    "logs.latency": "Latency",
    "logs.cost": "Cost",
    "logs.clickHint": "Click to view request/response",
    "logs.detailTitle": "Request Details",
    "logs.noData": "No request/response data",
    "logs.emptyResponse": "(empty response)",
    "logs.records": "records",
    "logs.page": "Page",
    "logs.prev": "Prev",
    "logs.next": "Next",

    // LoginPage
    "login.title": "Sign in to Panel",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign In",
    "login.error": "Login failed",
    "login.needRegister": "Need an account? Contact admin.",

    // Common
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "copy": "Copy",
    "loading": "Loading…",

    // Keys
    "keys.title": "API Keys",
    "keys.subtitle": "Access credentials for the gateway. Restrict each key to specific models, or leave empty for all.",
    "keys.create": "New Key",
    "keys.createdTitle": "Key created — copy it now",
    "keys.createdHint": "For security, the full key is only shown once. Store it somewhere safe.",
    "keys.dismiss": "Done",
    "keys.name": "Name",
    "keys.key": "Key",
    "keys.allowedModels": "Allowed models",
    "keys.allModels": "All models",
    "keys.modelPlaceholder": "model name, Enter to add",
    "keys.addModel": "Add",
    "keys.createSubmit": "Create key",
    "keys.status": "Status",
    "keys.actions": "Actions",
    "keys.enabled": "Enabled",
    "keys.disabled": "Disabled",
    "keys.enable": "Enable",
    "keys.disable": "Disable",
    "keys.empty": "No keys yet. Create one to get started.",
    "keys.confirmDelete": "Delete key \"{{name}}\"? Clients using it will immediately lose access.",

    // SessionMonitor
    "session.selectSession": "Select Session",
    "session.searchPlaceholder": "Search sessions…",
    "session.thinking": "Thinking",
    "session.system": "System Prompt",
    "session.input": "Input",
    "session.output": "Output",
    "session.cacheHitRate": "Cache Hit",
    "session.cacheHit": "Cache Hit",
    "session.cacheWrite": "Cache Write",
    "session.blocked": "Request blocked",
    "session.emptyHint1": "← Select a Session from the dropdown above",
    "session.emptyHint2": "to view the real-time conversation",
    "session.noMessages": "No messages in this session",
    "session.roleUser": "User",
    "session.roleAssistant": "Assistant",
    "session.roleSystem": "System",
    "session.roleToolResult": "Tool Result",
    "session.roleTool": "Tool",
    "session.toolCall": "Tool call",
    "session.toolResult": "Tool result",
    "session.toolError": "Tool error",
    "session.viewInput": "Input",
    "session.viewOutput": "Output",
    "session.expand": "Expand",
    "session.collapse": "Collapse",
    "session.copy": "Copy",
    "session.copied": "Copied",
    "session.image": "Image",

    // Usage
    "usage.last7d": "Last 7 Days",
    "usage.last24h": "Last 24 Hours",
    "usage.last30d": "Last 30 Days",
    "usage.allProviders": "All Providers",
    "usage.allModels": "All Models",
    "usage.totalTokens": "Total Tokens",
    "usage.totalRequests": "Total Requests",
    "usage.avgLatency": "Avg Latency",
    "usage.cacheHitRate": "Cache Hit Rate",
    "usage.estimatedCost": "Estimated Cost",
    "usage.tokenTrend": "Token Usage Trend",
    "usage.unitTokens": "Unit: tokens",
    "usage.noData": "No data",
    "usage.byModel": "Breakdown by Model",
    "usage.colModel": "Model",
    "usage.colProvider": "Provider",
    "usage.colRequests": "Requests",
    "usage.colTokens": "Token Usage",
    "usage.colAvgLatency": "Avg Latency",
    "usage.colCost": "Cost",

    // Endpoints
    "ep.title": "Manage AI provider endpoints and status",
    "ep.pageTitle": "Endpoints",
    "ep.add": "+ Add",
    "ep.addEndpoint": "Add Endpoint",
    "ep.editEndpoint": "Edit Endpoint",
    "ep.created": "Endpoint created successfully",
    "ep.externalInfo": "External Connection Info",
    "ep.copy": "Copy",
    "ep.curlExample": "Example request:",
    "ep.getKeyFromApiKeys": "Get your API key from the API Keys page.",
    "ep.testApiKey": "API Key",
    "ep.testApiKeyHint": "Enter your API key to test",
    "ep.enterApiKeyFirst": "Please enter an API key first",
    "keys.copyFullKey": "Copy full key",
    "keys.copied": "Copied",
    "ep.customName": "Display Name (optional)",
    "ep.customNameHint": "Defaults to provider name",
    "ep.providerPreset": "Provider",
    "ep.providerCustom": "Custom…",
    "ep.providerName": "Provider Name *",
    "ep.providerKeyId": "Key ID *",
    "ep.providerKeyIdHint": "e.g. OpenAI",
    "ep.providerKeyHint": "e.g. OA",
    "ep.baseUrl": "Base URL *",
    "ep.baseUrlHint": "e.g. https://api.openai.com/v1",
    "ep.apiKey": "API Key *",
    "ep.model": "Default Model *",
    "ep.modelHint": "e.g. gpt-4o-mini",
    "ep.models": "Extra Models",
    "ep.modelsHint": "Type a model name and press + or Enter to add",
    "ep.pricingConfig": "Pricing Config ($/M tokens)",
    "ep.priceInput": "Input Price",
    "ep.priceOutput": "Output Price",
    "ep.priceCacheInput": "Cache Input Price",
    "ep.testConnecting": "Testing…",
    "ep.testConnection": "🧪 Test Connection",
    "ep.testFillFirst": "Please fill Base URL and API Key first",
    "ep.testFailed": "Test failed",
    "ep.testSuccess": "Connected! Latency {latency}ms, model: {model}",
    "ep.testNetworkError": "Network error, cannot test",
    "ep.addFailed": "Failed to add",
    "ep.networkError": "Network error, please retry",
    "ep.submitting": "Submitting…",
    "ep.confirm": "Confirm",
    "ep.cancel": "Cancel",
    "ep.running": "Running…",
    "ep.run": "▶ Run",
    "ep.testSuccessLabel": "✓ Success",
    "ep.testFailLabel": "✗ Failed",
    "ep.colName": "Name",
    "ep.colProvider": "Provider",
    "ep.colEndpointUrl": "Endpoint URL",
    "ep.colModel": "Model",
    "ep.colStatus": "Status",
    "ep.colLatency": "Latency",
    "ep.colErrorRate": "Error Rate",
    "ep.colEnabled": "Enabled",
    "ep.noEndpoints": "No endpoints",
    "ep.statusHealthy": "Healthy",
    "ep.statusUnhealthy": "Unhealthy",
    "ep.testBtn": "🧪 Test",
    "ep.copyCurl": "📋 Copy curl",
    "ep.colActions": "Actions",
    "ep.edit": "Edit",
    "ep.delete": "Delete",
    "ep.deleteConfirm": "Delete endpoint \"{name}\"? This cannot be undone.",
    "ep.deleteFailed": "Failed to delete",
    "ep.updateFailed": "Failed to update",
    "ep.save": "Save",
    "ep.saving": "Saving…",
    "ep.apiKeyEditHint": "(leave blank to keep unchanged)",

    // UserManagement
    "users.title": "Manage system users & permissions",
    "users.add": "+ Add User",
    "users.colUsername": "Username",
    "users.colDisplayName": "Display Name",
    "users.colRole": "Role",
    "users.colCreated": "Created",
    "users.colActions": "Actions",
    "users.noUsers": "No users",
    "users.edit": "Edit",
    "users.delete": "Delete",
    "users.editUser": "Edit User",
    "users.newUser": "New User",
    "users.password": "Password",
    "users.passwordHint": "(leave blank to keep)",
    "users.update": "Update",
    "users.create": "Create",
    "users.cancel": "Cancel",
    "users.updateFailed": "Update failed",
    "users.createFailed": "Create failed",
    "users.deleteFailed": "Delete failed",
    "users.deleteConfirm": "Delete user {username}?",

    // App
    "app.noAccess": "Access Denied",

    // Lang switcher
    "lang.switch": "Language",

    // Settings
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.changePassword": "Change Password",
    "settings.oldPassword": "Current Password",
    "settings.newPassword": "New Password",
    "settings.confirmPassword": "Confirm Password",
    "settings.passwordMismatch": "Passwords do not match",
    "settings.passwordChanged": "Password changed successfully",
    "settings.passwordFailed": "Failed to change password",
    "settings.save": "Save",
    "settings.version": "Version",

    // Day names
    "day.sun": "Sun",
    "day.mon": "Mon",
    "day.tue": "Tue",
    "day.wed": "Wed",
    "day.thu": "Thu",
    "day.fri": "Fri",
    "day.sat": "Sat",
  },

  zh: {
    // Sidebar
    "nav.monitor": "监控",
    "nav.sessionMonitor": "Session 监控",
    "nav.auditLogs": "日志",
    "nav.manage": "管理",
    "nav.endpoints": "Endpoints",
    "nav.keys": "API Keys",
    "nav.usage": "Usage",
    "nav.users": "用户管理",

    // Roles
    "role.admin": "管理员",
    "role.user": "普通用户",

    // Topbar
    "topbar.sessionMonitor": "Session 实时监控",
    "topbar.auditLogs": "日志",
    "topbar.endpoints": "Endpoints",
    "topbar.keys": "API Keys",
    "topbar.usage": "Usage 用量分析",
    "topbar.users": "用户管理",
    "topbar.login": "登录",
    "topbar.active": "活跃",
    "topbar.requests": "请求",
    "topbar.monthlyCost": "月成本",
    "topbar.logout": "退出",

    // AuditLogs
    "logs.allProviders": "全部供应商",
    "logs.allStatus": "全部状态",
    "logs.searchPlaceholder": "搜索请求 ID…",
    "logs.time": "时间",
    "logs.requestId": "请求 ID",
    "logs.provider": "供应商",
    "logs.model": "模型",
    "logs.status": "状态",
    "logs.latency": "延迟",
    "logs.cost": "成本",
    "logs.clickHint": "点击查看请求/响应",
    "logs.detailTitle": "请求详情",
    "logs.noData": "无请求/响应数据",
    "logs.emptyResponse": "(空响应)",
    "logs.records": "条",
    "logs.page": "页",
    "logs.prev": "上一页",
    "logs.next": "下一页",

    // LoginPage
    "login.title": "登录管理面板",
    "login.username": "用户名",
    "login.password": "密码",
    "login.submit": "登录",
    "login.error": "登录失败",
    "login.needRegister": "需要注册？请联系管理员",

    // Common
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "edit": "编辑",
    "copy": "复制",
    "loading": "加载中…",

    // Keys
    "keys.title": "API Keys",
    "keys.subtitle": "网关访问凭证。可限制每个 key 只能访问指定模型，留空则允许全部模型。",
    "keys.create": "新建 Key",
    "keys.createdTitle": "Key 已创建 — 请立即复制",
    "keys.createdHint": "出于安全考虑，完整 key 只显示这一次，请妥善保存。",
    "keys.dismiss": "完成",
    "keys.name": "名称",
    "keys.key": "Key",
    "keys.allowedModels": "允许的模型",
    "keys.allModels": "全部模型",
    "keys.modelPlaceholder": "输入模型名，回车添加",
    "keys.addModel": "添加",
    "keys.createSubmit": "创建 Key",
    "keys.status": "状态",
    "keys.actions": "操作",
    "keys.enabled": "启用",
    "keys.disabled": "停用",
    "keys.enable": "启用",
    "keys.disable": "停用",
    "keys.empty": "还没有 key，点击右上角创建一个。",
    "keys.confirmDelete": "确定删除 key \"{{name}}\"？正在使用它的客户端会立即失去访问权限。",

    // SessionMonitor
    "session.selectSession": "选择会话",
    "session.searchPlaceholder": "搜索会话…",
    "session.thinking": "思考过程",
    "session.system": "系统提示词",
    "session.input": "输入",
    "session.output": "输出",
    "session.cacheHitRate": "缓存命中",
    "session.cacheHit": "缓存命中",
    "session.cacheWrite": "缓存写入",
    "session.blocked": "请求被拦截",
    "session.emptyHint1": "← 从上方下拉菜单中选择一个 Session",
    "session.emptyHint2": "即可查看实时对话流",
    "session.noMessages": "该会话暂无消息记录",
    "session.roleUser": "用户",
    "session.roleAssistant": "助手",
    "session.roleSystem": "系统",
    "session.roleToolResult": "工具返回",
    "session.roleTool": "工具",
    "session.toolCall": "工具调用",
    "session.toolResult": "工具返回",
    "session.toolError": "工具错误",
    "session.viewInput": "入参",
    "session.viewOutput": "返回",
    "session.expand": "展开",
    "session.collapse": "收起",
    "session.copy": "复制",
    "session.copied": "已复制",
    "session.image": "图片",

    // Usage
    "usage.last7d": "最近 7 天",
    "usage.last24h": "最近 24 小时",
    "usage.last30d": "最近 30 天",
    "usage.allProviders": "全部供应商",
    "usage.allModels": "全部模型",
    "usage.totalTokens": "总 Token 用量",
    "usage.totalRequests": "总请求数",
    "usage.avgLatency": "平均延迟",
    "usage.cacheHitRate": "缓存命中率",
    "usage.estimatedCost": "预估成本",
    "usage.tokenTrend": "Token 用量趋势",
    "usage.unitTokens": "单位：tokens",
    "usage.noData": "暂无数据",
    "usage.byModel": "按模型拆分",
    "usage.colModel": "模型",
    "usage.colProvider": "供应商",
    "usage.colRequests": "请求数",
    "usage.colTokens": "Token 用量",
    "usage.colAvgLatency": "平均延迟",
    "usage.colCost": "成本",

    // Endpoints
    "ep.title": "管理大模型供应商接入与端点状态",
    "ep.pageTitle": "端点",
    "ep.add": "+ 添加",
    "ep.addEndpoint": "添加 Endpoint",
    "ep.editEndpoint": "编辑 Endpoint",
    "ep.created": "Endpoint 创建成功",
    "ep.externalInfo": "外部连接信息",
    "ep.copy": "复制",
    "ep.curlExample": "示例请求：",
    "ep.getKeyFromApiKeys": "请从 API Keys 页面获取您的密钥。",
    "ep.testApiKey": "API Key",
    "ep.testApiKeyHint": "输入您的 API key 进行测试",
    "ep.enterApiKeyFirst": "请先输入 API key",
    "keys.copyFullKey": "复制完整密钥",
    "keys.copied": "已复制",
    "ep.customName": "自定义名称（可选）",
    "ep.customNameHint": "留空则使用供应商名称",
    "ep.providerPreset": "供应商",
    "ep.providerCustom": "自定义…",
    "ep.providerName": "供应商名称 *",
    "ep.providerKeyId": "标识 *",
    "ep.providerKeyIdHint": "例：OpenAI",
    "ep.providerKeyHint": "例：OA",
    "ep.baseUrl": "Base URL *",
    "ep.baseUrlHint": "例：https://api.openai.com/v1",
    "ep.apiKey": "API Key *",
    "ep.model": "默认模型 *",
    "ep.modelHint": "例：gpt-4o-mini",
    "ep.models": "额外模型",
    "ep.modelsHint": "输入模型名称后按 + 或 Enter 添加",
    "ep.pricingConfig": "定价配置（$/M tokens）",
    "ep.priceInput": "Input 价格",
    "ep.priceOutput": "Output 价格",
    "ep.priceCacheInput": "缓存命中 Input 价格",
    "ep.testConnecting": "测试中…",
    "ep.testConnection": "🧪 测试连接",
    "ep.testFillFirst": "请先填写 Base URL 和 API Key",
    "ep.testFailed": "测试失败",
    "ep.testSuccess": "连接成功！延迟 {latency}ms，测试模型: {model}",
    "ep.testNetworkError": "网络错误，无法测试连接",
    "ep.addFailed": "添加失败",
    "ep.networkError": "网络错误，请重试",
    "ep.submitting": "添加中…",
    "ep.confirm": "确认添加",
    "ep.cancel": "取消",
    "ep.running": "执行中…",
    "ep.run": "▶ 执行",
    "ep.testSuccessLabel": "✓ 成功",
    "ep.testFailLabel": "✗ 失败",
    "ep.colName": "名称",
    "ep.colProvider": "供应商",
    "ep.colEndpointUrl": "端点 URL",
    "ep.colModel": "模型",
    "ep.colStatus": "状态",
    "ep.colLatency": "延迟",
    "ep.colErrorRate": "错误率",
    "ep.colEnabled": "启用",
    "ep.noEndpoints": "暂无端点",
    "ep.statusHealthy": "健康",
    "ep.statusUnhealthy": "异常",
    "ep.testBtn": "🧪 测试",
    "ep.copyCurl": "📋 复制 curl",
    "ep.colActions": "操作",
    "ep.edit": "编辑",
    "ep.delete": "删除",
    "ep.deleteConfirm": "确定删除 endpoint \"{name}\"？此操作不可撤销。",
    "ep.deleteFailed": "删除失败",
    "ep.updateFailed": "更新失败",
    "ep.save": "保存",
    "ep.saving": "保存中…",
    "ep.apiKeyEditHint": "（留空则保持不变）",

    // UserManagement
    "users.title": "管理系统用户与权限",
    "users.add": "+ 新增用户",
    "users.colUsername": "用户名",
    "users.colDisplayName": "显示名称",
    "users.colRole": "角色",
    "users.colCreated": "创建时间",
    "users.colActions": "操作",
    "users.noUsers": "暂无用户",
    "users.edit": "编辑",
    "users.delete": "删除",
    "users.editUser": "编辑用户",
    "users.newUser": "新增用户",
    "users.password": "密码",
    "users.passwordHint": "(留空保持不变)",
    "users.update": "更新",
    "users.create": "创建",
    "users.cancel": "取消",
    "users.updateFailed": "更新失败",
    "users.createFailed": "创建失败",
    "users.deleteFailed": "删除失败",
    "users.deleteConfirm": "确定删除用户 {username}？",

    // App
    "app.noAccess": "无权访问",

    // Lang switcher
    "lang.switch": "Language",

    // Settings
    "settings.title": "设置",
    "settings.language": "语言",
    "settings.changePassword": "修改密码",
    "settings.oldPassword": "当前密码",
    "settings.newPassword": "新密码",
    "settings.confirmPassword": "确认密码",
    "settings.passwordMismatch": "两次密码不一致",
    "settings.passwordChanged": "密码修改成功",
    "settings.passwordFailed": "密码修改失败",
    "settings.save": "保存",
    "settings.version": "版本",

    // Day names
    "day.sun": "周日",
    "day.mon": "周一",
    "day.tue": "周二",
    "day.wed": "周三",
    "day.thu": "周四",
    "day.fri": "周五",
    "day.sat": "周六",
  },
};

// ---- Global state (triggers re-render via custom event) ----
let currentLang: Lang = (typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null) as Lang || "en";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang) {
  currentLang = lang;
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, lang);
  notify();
}

/**
 * Translate a key, optionally interpolating values like `{key}`.
 */
export function t(key: string, values?: Record<string, string | number>): string {
  let text = dict[currentLang]?.[key] ?? dict.en[key] ?? key;
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/**
 * React hook: returns `{ t, lang, setLang }` and re-renders on language change.
 */
export function useTranslation() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const cb = () => setTick((n) => n + 1);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);

  return {
    t,
    lang: currentLang,
    setLang: useCallback((l: Lang) => setLang(l), []),
  };
}
