import { Elysia } from "elysia";
import { sessionsRoutes } from "./routes/sessions";
import { logsRoutes } from "./routes/logs";
import { endpointsRoutes } from "./routes/endpoints";
import { usageRoutes } from "./routes/usage";
import { authRoutes } from "./routes/auth";
import { keysRoutes } from "./routes/keys";
import { retentionRoutes, startLogRetentionLoop } from "./routes/retention";
import { getDb } from "./db";
import { notifySessionsChanged, notifyMessagesChanged, wsRegister, wsUnregister } from "./ws";
import index from "./index.html";

// Initialize database on startup
getDb();

// Start daily pruning of request_logs (PULSE_LOG_RETENTION_DAYS, default 7)
startLogRetentionLoop();

// ── Constants ──
const UPSTREAM_TIMEOUT_MS = 15_000;

// ── Fetch with timeout ──
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Forward safe headers from original request to upstream ──
function forwardHeaders(originalHeaders: Headers, overrides: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...overrides };
  // Forward standard headers that identify the client
  const safeHeaders = ["accept", "user-agent"];
  for (const name of safeHeaders) {
    const val = originalHeaders.get(name);
    if (val) result[name] = val;
  }
  // Forward X-Stainless-* telemetry headers (Anthropic SDK identity)
  for (const [name, val] of originalHeaders.entries()) {
    if (name.toLowerCase().startsWith("x-stainless-") && val) {
      result[name] = val;
    }
  }
  return result;
}

// ── Gateway proxy helpers ──
interface EndpointRow {
  id: number;
  endpoint_url: string;
  api_key: string;
  model_name: string;
  models: string;
  provider_name: string;
  provider_format: string;
  price_input_per_m: number;
  price_output_per_m: number;
  price_cache_input_per_m: number;
}

function normalizeSystem(system: unknown): string | undefined {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return (system as Array<{ type: string; text?: string }>)
      .filter(b => b.type === "text")
      .map(b => b.text ?? "")
      .join("\n") || undefined;
  }
  return undefined;
}

function parseModels(modelsJson: string): string[] {
  try {
    const arr = modelsJson ? JSON.parse(modelsJson) : [];
    return Array.isArray(arr) ? arr.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

interface GatewayKeyRow {
  id: number;
  key: string;
  name: string;
  models: string; // JSON whitelist; empty array = all models
  enabled: number;
}

const EP_COLS =
  "id, endpoint_url, api_key, model_name, models, provider_name, provider_format, price_input_per_m, price_output_per_m, price_cache_input_per_m";

// ── Gateway resolution ──
// Two phases:
//  1. Authenticate the presented key against the standalone gateway_keys
//     table, then enforce its model whitelist.
//  2. Route to the enabled endpoint that declares the requested model.
type LookupResult =
  | { ok: true; ep: EndpointRow }
  | { ok: false; status: number; error: string };

function resolveGateway(gatewayKey: string, requestedModel?: string, providerFormat?: string): LookupResult {
  if (!gatewayKey) return { ok: false, status: 401, error: "Invalid or disabled API key" };
  const db = getDb();

  // Phase 1: key authentication + permission check
  const keyRow = db.query(
    "SELECT id, key, name, models, enabled FROM gateway_keys WHERE key = ?"
  ).get(gatewayKey) as GatewayKeyRow | null;

  if (!keyRow) return { ok: false, status: 401, error: "Invalid or disabled API key" };
  if (!keyRow.enabled) return { ok: false, status: 401, error: "Invalid or disabled API key" };

  const allowed = parseModels(keyRow.models);
  const whitelist: string[] | null = allowed.length > 0 ? allowed : null; // null = unrestricted

  if (whitelist && requestedModel && !whitelist.includes(requestedModel)) {
    return { ok: false, status: 403, error: `Model "${requestedModel}" not allowed for this API key` };
  }

  // Phase 2: route to an endpoint declaring the requested model,
  // optionally narrowed by the gateway route's provider format.
  const endpoints = db.query(`SELECT ${EP_COLS} FROM endpoints WHERE enabled = 1`).all() as EndpointRow[];
  let candidates = endpoints;
  if (requestedModel) {
    candidates = endpoints.filter((ep) => {
      const models = parseModels(ep.models);
      return models.includes(requestedModel);
    });
  }
  if (whitelist) {
    candidates = candidates.filter((ep) => {
      const models = parseModels(ep.models);
      const effective = models.length > 0 ? models : (ep.model_name ? [ep.model_name] : []);
      return effective.some((m) => whitelist.includes(m));
    });
  }
  // Narrow by provider format when the gateway route implies one
  if (providerFormat) {
    candidates = candidates.filter((ep) => ep.provider_format === providerFormat);
  }

  if (candidates.length === 1) return { ok: true, ep: candidates[0]! };
  if (candidates.length === 0) {
    return { ok: false, status: 400, error: requestedModel
      ? `No enabled ${providerFormat || ""} endpoint serves model "${requestedModel}"`
      : "No enabled endpoint available" };
  }
  return { ok: false, status: 400, error: `Model "${requestedModel ?? ""}" is ambiguous across ${candidates.length} endpoints` };
}

// Aggregate view for GET /v1/models: every model this key may see.
// Optional format narrows to endpoints of that provider format.
function listModelsForKey(gatewayKey: string, format?: string): string[] | null {
  const db = getDb();
  const keyRow = db.query("SELECT models, enabled FROM gateway_keys WHERE key = ?").get(gatewayKey) as
    { models: string; enabled: number } | null;
  if (!keyRow) return null;
  if (!keyRow.enabled) return null;
  const whitelist = parseModels(keyRow.models);

  const endpoints = db.query(`SELECT ${EP_COLS} FROM endpoints WHERE enabled = 1`).all() as EndpointRow[];

  const out = new Set<string>();
  for (const ep of endpoints) {
    if (format && ep.provider_format !== format) continue;
    const models = parseModels(ep.models);
    const effective = models.length > 0 ? models : (ep.model_name ? [ep.model_name] : []);
    for (const m of effective) {
      if (!whitelist || whitelist.length === 0 || whitelist.includes(m)) out.add(m);
    }
  }
  return [...out];
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

function calcCost(ep: EndpointRow, usage: UsageInfo): string {
  const { inputTokens, outputTokens, cacheHitTokens, cacheMissTokens } = usage;
  if (!ep.price_input_per_m && !ep.price_output_per_m) return "$0.00";
  // cache hit tokens priced at cache rate, miss tokens at normal input rate
  const cacheHitCost = cacheHitTokens * (ep.price_cache_input_per_m || 0) / 1_000_000;
  const missTokens = cacheMissTokens || (inputTokens - cacheHitTokens);
  const inputCost = Math.max(0, missTokens) * (ep.price_input_per_m || 0) / 1_000_000;
  const outputCost = outputTokens * (ep.price_output_per_m || 0) / 1_000_000;
  const total = cacheHitCost + inputCost + outputCost;
  return "$" + total.toFixed(6);
}

function logRequest(
  provider: string, model: string, statusCode: number, latencyMs: number,
  usage: UsageInfo, cost: string, sessionId?: string, responseBody?: string, requestBody?: string
) {
  const db = getDb();
  db.run(
    "INSERT INTO request_logs (request_id, session_id, provider, model, status_code, latency_ms, tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens, cost, response_body, request_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      crypto.randomUUID(), sessionId || null, provider, model, statusCode, latencyMs,
      usage.inputTokens + usage.outputTokens,
      usage.cacheHitTokens, usage.cacheMissTokens, cost,
      responseBody || "",
      requestBody || "",
    ]
  );
}

interface BodyMessage {
  role: string;
  content: unknown;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
}

// Normalize a client-sent message into the (role, content-json) shape we persist.
// Handles two OpenAI-style cases that don't map 1:1 onto our stored schema:
//  - assistant messages with content:null + tool_calls[] (the model called a tool, no text)
//  - tool-result messages (role "tool"/"function") echoing a tool's output back to the model
function serializeIncomingMessage(m: BodyMessage): { role: string; text: string } {
  if (m.role === "tool" || m.role === "function") {
    const resultText = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: resultText };
    return { role: "tool_result", text: JSON.stringify(block) };
  }

  if (m.role === "assistant" && (m.content === null || m.content === undefined) && m.tool_calls?.length) {
    const toolCalls = m.tool_calls.map((tc) => {
      let input: Record<string, unknown> | undefined;
      try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined; } catch { input = { raw: tc.function?.arguments }; }
      return { id: tc.id, name: tc.function?.name || "", input };
    });
    return { role: "assistant", text: JSON.stringify({ text: "", tool_calls: toolCalls }) };
  }

  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  return { role: m.role, text };
}

function getOrCreateSession(endpointId: number, provider: string, model: string, messages: BodyMessage[], systemPrompt: string | undefined, existingSessionId?: string): string {
  const db = getDb();

  const insertMessages = (sessionId: string, msgs: BodyMessage[]) => {
    for (const m of msgs) {
      const { role, text } = serializeIncomingMessage(m);
      db.run("INSERT INTO messages (session_id, role, content, tokens, latency) VALUES (?, ?, ?, 0, '—')", [sessionId, role, text]);
    }
  };

  // If a session ID is provided, verify it exists, belongs to this endpoint, and append messages
  if (existingSessionId) {
    const existing = db.query("SELECT id FROM sessions WHERE id = ? AND endpoint_id = ?").get(existingSessionId, endpointId) as { id: string } | null;
    if (existing) {
      const run = db.transaction(() => {
        db.run("UPDATE sessions SET status = 'live', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [existingSessionId]);
        insertMessages(existingSessionId, messages);
      });
      run();
      return existingSessionId;
    }
  }

  // Try to match an existing session by conversation continuity:
  // The request's messages array is the full context window sent to the model.
  // If a recent session's stored messages are a prefix of the incoming messages,
  // this is the same ongoing conversation — reuse that session and append only the new tail.
  const firstUser = messages.find((m) => m.role === "user");
  const firstUserText = typeof firstUser?.content === "string" ? firstUser.content : JSON.stringify(firstUser?.content || "");

  if (messages.length > 1) {
    // Look for recent sessions (within 2 hours) on this same endpoint with matching provider/model/title.
    // Scoping by endpoint_id prevents unrelated tenants/API keys from ever being matched together,
    // and wrapping the match+append in a transaction prevents concurrent requests from double-appending.
    const titlePrefix = firstUserText.slice(0, 60);
    const title = titlePrefix + (firstUserText.length > 60 ? "…" : "");

    const matchAndAppend = db.transaction(() => {
      const candidates = db.query(
        `SELECT id FROM sessions WHERE endpoint_id = ? AND provider = ? AND model = ? AND title = ? AND updated_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours') ORDER BY updated_at DESC LIMIT 5`
      ).all(endpointId, provider, model, title) as { id: string }[];

      for (const candidate of candidates) {
        // Get stored messages for this candidate session
        const stored = db.query(
          "SELECT role, content FROM messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY id ASC"
        ).all(candidate.id) as { role: string; content: string }[];

        if (stored.length === 0) continue;

        // Compare against only the user/assistant messages in the incoming array, in order,
        // so tool/tool_result messages interleaved in the conversation don't throw off alignment.
        const incomingUA = messages.filter((m) => m.role === "user" || m.role === "assistant");

        // Check if incoming messages contain all stored messages as a prefix
        // (the client re-sends the full conversation each time)
        let matches = true;
        for (let i = 0; i < stored.length && i < incomingUA.length; i++) {
          const incomingText = typeof incomingUA[i]!.content === "string"
            ? incomingUA[i]!.content
            : JSON.stringify(incomingUA[i]!.content);
          // Assistant messages are stored as JSON (finalizeSession), compare role only for assistant
          if (incomingUA[i]!.role !== stored[i]!.role) { matches = false; break; }
          if (stored[i]!.role === "user" && incomingText !== stored[i]!.content) { matches = false; break; }
        }

        if (matches && incomingUA.length > stored.length) {
          // Reuse this session — append only the new messages beyond what's already stored.
          // Walk the original (unfiltered) messages array and skip the leading run that
          // corresponds to the already-stored user/assistant messages, so interleaved
          // tool/tool_result messages in the new tail are still appended.
          let uaSeen = 0;
          let cutoff = 0;
          for (; cutoff < messages.length && uaSeen < stored.length; cutoff++) {
            const r = messages[cutoff]!.role;
            if (r === "user" || r === "assistant") uaSeen++;
          }
          db.run("UPDATE sessions SET status = 'live', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [candidate.id]);
          insertMessages(candidate.id, messages.slice(cutoff));
          return candidate.id;
        }
      }
      return null;
    });

    const reusedId = matchAndAppend();
    if (reusedId) return reusedId;
  }

  // Create new session
  const id = `sess_${crypto.randomUUID()}`;
  const title = firstUserText.slice(0, 60) + (firstUserText.length > 60 ? "…" : "");
  const createNew = db.transaction(() => {
    db.run("INSERT INTO sessions (id, title, provider, model, status, endpoint_id) VALUES (?, ?, ?, ?, 'live', ?)",
      [id, title || "New Session", provider, model, endpointId]);

    // Save system prompt as first message if provided
    if (systemPrompt) {
      db.run("INSERT INTO messages (session_id, role, content, tokens, latency) VALUES (?, 'system', ?, 0, '—')", [id, systemPrompt]);
    }

    insertMessages(id, messages);
  });
  createNew();
  return id;
}

interface ToolCallInfo { id?: string; name: string; input?: Record<string, unknown> }

function finalizeSession(
  sessionId: string,
  response: { text: string; thinking?: string; model?: string; stop_reason?: string; usage?: Record<string, number>; tool_calls?: ToolCallInfo[] },
  totalTokens: number,
  latencyMs: number
) {
  const db = getDb();
  const payload = response.tool_calls?.length
    ? { ...response, tool_calls: response.tool_calls.map((tc) => ({ type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.input })) }
    : response;
  const content = JSON.stringify(payload);
  db.run("INSERT INTO messages (session_id, role, content, tokens, latency) VALUES (?, 'assistant', ?, ?, ?)",
    [sessionId, content, totalTokens, `${latencyMs}ms`]);
  // Accumulate total tokens across the whole session (not just the last message).
  // Add cacheHit to totalTokens because some providers report prompt_token cache
  // hits separately (not already included in input_tokens/prompt_tokens).
  const cacheHit = (response.usage?.cache_read_input_tokens as number) || 0;
  const cacheMiss = (response.usage?.cache_creation_input_tokens as number) || 0;
  db.run(
    "UPDATE sessions SET status = 'idle', tokens = tokens + ?, cache_hit_tokens = cache_hit_tokens + ?, cache_miss_tokens = cache_miss_tokens + ?, latency = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    [totalTokens + cacheHit, cacheHit, cacheMiss, `${latencyMs}ms`, sessionId]
  );
  notifySessionsChanged();
  notifyMessagesChanged(sessionId);
}

// ── Shared stream proxy helper ──
// Uses ReadableStream.tee() to split the upstream body:
//   - clientStream → returned directly to the client (zero JS overhead, native pass-through)
//   - logStream   → read asynchronously in the background for logging/finalization
// This avoids the "incomplete chunked read" error caused by manual data pumping
// through a custom ReadableStream.
function createProxyStream(
  upstreamBody: ReadableStream<Uint8Array>,
  upstreamStatus: number,
  setHeaders: Record<string, string>,
  onFinalize: (buffer: string) => void,
  logLabel = "Stream",
): Response {
  const [clientStream, logStream] = upstreamBody.tee();

  // Background: accumulate logStream for logging (doesn't block the client)
  (async () => {
    const reader = logStream.getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
      }
    } catch (e) {
      console.error(`${logLabel} tee read error:`, e);
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
      // Always finalize — even on error we want partial buffer for debugging
      try { onFinalize(buffer); } catch (e) { console.error(`${logLabel} finalize error:`, e); }
    }
  })();

  return new Response(clientStream, { status: upstreamStatus, headers: setHeaders });
}

async function proxyOpenAI(gatewayKey: string, request: Request, set: { status: number; headers: Record<string, string> }) {
  // Read the body before lookup so the request's `model` can act as the router
  // when several endpoints share one gateway key.
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { set.status = 400; return { error: "Invalid JSON body" }; }

  const epResult = resolveGateway(gatewayKey, typeof body.model === "string" ? body.model : undefined, "openai");
  if (!epResult.ok) { set.status = epResult.status; return { error: epResult.error }; }
  const ep = epResult.ep;

  const baseUrl = ep.endpoint_url.replace(/\/+$/, "");
  // Map external model name (from models array) to upstream model name (model_name)
  // e.g. "deepseek-v4-pro-alt" -> "deepseek-v4-pro"
  const requestedModel = (body.model || ep.model_name) as string;
  const allowedModels: string[] = parseModels(ep.models);
  const model = allowedModels.includes(requestedModel) && ep.model_name ? ep.model_name : requestedModel;
  // Validate model against allowed list if configured
  if (allowedModels.length > 0 && !allowedModels.includes(requestedModel)) {
    set.status = 400;
    return { error: `Model "${requestedModel}" not allowed. Allowed: ${allowedModels.join(", ")}` };
  }
  const start = Date.now();
  const isStream = !!body.stream;
  const reqMessages = (body.messages as BodyMessage[] | undefined) || [];
  const systemPrompt = normalizeSystem(body.system);
  const existingSessionId = request.headers.get("x-session-id") || undefined;
  const sessionId = getOrCreateSession(ep.id, ep.provider_name || baseUrl, model, reqMessages, systemPrompt, existingSessionId);

  // Notify WebSocket clients of new/updated session
  notifySessionsChanged();

  // Add session ID to response headers
  set.headers["X-Session-Id"] = sessionId;

  try {
    const upstream = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: forwardHeaders(request.headers, {
        "Authorization": `Bearer ${ep.api_key}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ ...body, model }),
    });

    if (isStream && upstream.body) {
      set.status = upstream.status;
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["X-Accel-Buffering"] = "no";

      return createProxyStream(upstream.body, upstream.status, set.headers, (buffer) => {
        let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
        let assistantText = "";
        let thinkingText = "";
        let responseModel = "";
        let stopReason = "";
        const toolCallsByIndex = new Map<number, { id?: string; name: string; args: string }>();
        for (const line of buffer.split("\n")) {
          // Tolerate both "data: {...}" and "data:{...}" — some upstreams (e.g. Kimi k3)
          // omit the space after the colon, which previously caused every line to be skipped.
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trimStart();
          if (!payload || payload === "[DONE]") continue;
          {
            try {
              const j = JSON.parse(payload);
              if (j.usage) {
                usage = {
                  inputTokens: j.usage.prompt_tokens || 0,
                  outputTokens: j.usage.completion_tokens || 0,
                  cacheHitTokens: j.usage.prompt_tokens_details?.cached_tokens ?? j.usage.prompt_cache_hit_tokens ?? 0,
                  cacheMissTokens: (j.usage.prompt_tokens || 0) - (j.usage.prompt_tokens_details?.cached_tokens ?? j.usage.prompt_cache_hit_tokens ?? 0),
                };
              }
              if (j.model && !responseModel) responseModel = j.model;
              if (j.choices?.[0]?.finish_reason) stopReason = j.choices[0].finish_reason;
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) assistantText += delta;
              const reasoningDelta = j.choices?.[0]?.delta?.reasoning_content;
              if (reasoningDelta) thinkingText += reasoningDelta;
              const toolDeltas = j.choices?.[0]?.delta?.tool_calls as
                Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> | undefined;
              if (toolDeltas) {
                for (const td of toolDeltas) {
                  const existing = toolCallsByIndex.get(td.index) || { id: td.id, name: "", args: "" };
                  if (td.id) existing.id = td.id;
                  if (td.function?.name) existing.name += td.function.name;
                  if (td.function?.arguments) existing.args += td.function.arguments;
                  toolCallsByIndex.set(td.index, existing);
                }
              }
            } catch { /* skip unparseable lines */ }
          }
        }
        const toolCalls: ToolCallInfo[] = [...toolCallsByIndex.values()].map((tc) => {
          let input: Record<string, unknown> | undefined;
          try { input = tc.args ? JSON.parse(tc.args) : undefined; } catch { input = { raw: tc.args }; }
          return { id: tc.id, name: tc.name, input };
        });
        const cost = calcCost(ep, usage);
        const totalTokens = usage.inputTokens + usage.outputTokens;
        logRequest(ep.provider_name, model, upstream.status, Date.now() - start, usage, cost, sessionId, buffer, JSON.stringify(body));
        finalizeSession(sessionId, {
          text: assistantText,
          thinking: thinkingText || undefined,
          model: responseModel || (model as string),
          stop_reason: stopReason,
          tool_calls: toolCalls.length ? toolCalls : undefined,
          usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
        }, totalTokens, Date.now() - start);
      }, "OpenAI");
    }

    const text = await upstream.text();
    const latencyMs = Date.now() - start;

    let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    let assistantText = "";
    let thinkingText = "";
    let responseModel = "";
    let stopReason = "";
    let toolCalls: ToolCallInfo[] = [];
    try {
      const j = JSON.parse(text);
      usage = {
        inputTokens: j.usage?.prompt_tokens || 0,
        outputTokens: j.usage?.completion_tokens || 0,
        cacheHitTokens: j.usage?.prompt_tokens_details?.cached_tokens ?? j.usage?.prompt_cache_hit_tokens ?? 0,
        cacheMissTokens: (j.usage?.prompt_tokens || 0) - (j.usage?.prompt_tokens_details?.cached_tokens ?? j.usage?.prompt_cache_hit_tokens ?? 0),
      };
      assistantText = j.choices?.[0]?.message?.content || "";
      thinkingText = j.choices?.[0]?.message?.reasoning_content || "";
      responseModel = j.model || "";
      stopReason = j.choices?.[0]?.finish_reason || "";
      const rawToolCalls = j.choices?.[0]?.message?.tool_calls as
        Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined;
      if (rawToolCalls) {
        toolCalls = rawToolCalls.map((tc) => {
          let input: Record<string, unknown> | undefined;
          try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined; } catch { input = { raw: tc.function?.arguments }; }
          return { id: tc.id, name: tc.function?.name || "", input };
        });
      }
      if (!assistantText && !toolCalls.length) assistantText = text;
    } catch { /* */ }

    const cost = calcCost(ep, usage);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    logRequest(ep.provider_name, model, upstream.status, latencyMs, usage, cost, sessionId, text, JSON.stringify(body));
    finalizeSession(sessionId, {
      text: assistantText,
      thinking: thinkingText || undefined,
      model: responseModel || (model as string),
      stop_reason: stopReason,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
    }, totalTokens, latencyMs);

    set.status = upstream.status;
    set.headers["Content-Type"] = "application/json";
    return text;
  } catch (err: unknown) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    set.status = isTimeout ? 504 : 502;
    return { error: isTimeout ? "Upstream request timed out" : `Upstream error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function proxyAnthropic(gatewayKey: string, request: Request, set: { status: number; headers: Record<string, string> }) {
  // See proxyOpenAI: body parsed first so `model` can route shared keys.
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { set.status = 400; return { error: "Invalid JSON body" }; }

  const epResult = resolveGateway(gatewayKey, typeof body.model === "string" ? body.model : undefined, "anthropic");
  if (!epResult.ok) { set.status = epResult.status; return { error: epResult.error }; }
  const ep = epResult.ep;

  const baseUrl = ep.endpoint_url.replace(/\/+$/, "");
  // Map external model name (from models array) to upstream model name (model_name)
  const requestedModel = (body.model || ep.model_name) as string;
  const allowedModels: string[] = parseModels(ep.models);
  const model = allowedModels.includes(requestedModel) && ep.model_name ? ep.model_name : requestedModel;
  // Validate model against allowed list if configured
  if (allowedModels.length > 0 && !allowedModels.includes(requestedModel)) {
    set.status = 400;
    return { error: `Model "${requestedModel}" not allowed. Allowed: ${allowedModels.join(", ")}` };
  }
  const start = Date.now();
  const isStream = !!body.stream;
  const reqMessages = (body.messages as BodyMessage[] | undefined) || [];
  const systemPrompt = normalizeSystem(body.system);
  const existingSessionId = request.headers.get("x-session-id") || undefined;
  const sessionId = getOrCreateSession(ep.id, ep.provider_name || baseUrl, model, reqMessages, systemPrompt, existingSessionId);

  // Notify WebSocket clients of new/updated session
  notifySessionsChanged();

  // Add session ID to response headers
  set.headers["X-Session-Id"] = sessionId;

  try {
    const upstream = await fetchWithTimeout(`${baseUrl}/messages`, {
      method: "POST",
      headers: forwardHeaders(request.headers, {
        "x-api-key": ep.api_key,
        "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ ...body, model }),
    });

    if (isStream && upstream.body) {
      set.status = upstream.status;
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["X-Accel-Buffering"] = "no";

      return createProxyStream(upstream.body, upstream.status, set.headers, (buffer) => {
        let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
        let assistantText = "";
        let thinkingText = "";
        let responseModel = "";
        let stopReason = "";
        const toolBlocksByIndex = new Map<number, { id?: string; name: string; jsonInput: string }>();
        for (const line of buffer.split("\n")) {
          // Tolerate both "data: {...}" and "data:{...}" (see OpenAI branch above).
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trimStart();
          if (!payload || payload === "[DONE]") continue;
          {
            try {
              const j = JSON.parse(payload);
              if (j.usage) {
                usage = {
                  inputTokens: j.usage.input_tokens || 0,
                  outputTokens: j.usage.output_tokens || 0,
                  cacheHitTokens: j.usage.cache_read_input_tokens ?? j.usage.prompt_cache_hit_tokens ?? 0,
                  cacheMissTokens: j.usage.input_tokens || 0,
                };
              }
              if (j.type === "message_start" && j.message?.model && !responseModel) {
                responseModel = j.message.model;
              }
              if (j.type === "message_delta" && j.delta?.stop_reason) {
                stopReason = j.delta.stop_reason;
              }
              if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
                toolBlocksByIndex.set(j.index, { id: j.content_block.id, name: j.content_block.name, jsonInput: "" });
              }
              if (j.type === "content_block_delta" && j.delta?.text) {
                assistantText += j.delta.text;
              }
              if (j.type === "content_block_delta" && j.delta?.thinking) {
                thinkingText += j.delta.thinking;
              }
              if (j.type === "content_block_delta" && j.delta?.type === "input_json_delta") {
                const existing = toolBlocksByIndex.get(j.index);
                if (existing) existing.jsonInput += j.delta.partial_json || "";
              }
            } catch { /* skip unparseable lines */ }
          }
        }
        const toolCalls: ToolCallInfo[] = [...toolBlocksByIndex.values()].map((tb) => {
          let input: Record<string, unknown> | undefined;
          try { input = tb.jsonInput ? JSON.parse(tb.jsonInput) : undefined; } catch { input = { raw: tb.jsonInput }; }
          return { id: tb.id, name: tb.name, input };
        });
        const cost = calcCost(ep, usage);
        const totalTokens = usage.inputTokens + usage.outputTokens;
        logRequest(ep.provider_name, model, upstream.status, Date.now() - start, usage, cost, sessionId, buffer, JSON.stringify(body));
        finalizeSession(sessionId, {
          text: assistantText,
          thinking: thinkingText || undefined,
          model: responseModel || (model as string),
          stop_reason: stopReason,
          tool_calls: toolCalls.length ? toolCalls : undefined,
          usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
        }, totalTokens, Date.now() - start);
      }, "Anthropic");
    }

    const text = await upstream.text();
    const latencyMs = Date.now() - start;

    let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    let assistantText = "";
    let thinkingText = "";
    let responseModel = "";
    let stopReason = "";
    let toolCalls: ToolCallInfo[] = [];
    try {
      const j = JSON.parse(text);
      usage = {
        inputTokens: j.usage?.input_tokens || 0,
        outputTokens: j.usage?.output_tokens || 0,
        cacheHitTokens: j.usage?.cache_read_input_tokens ?? j.usage?.prompt_cache_hit_tokens ?? 0,
        cacheMissTokens: j.usage?.input_tokens || 0,
      };
      // Anthropic content is an array of blocks: [{type:"text",...}, {type:"thinking",...}, {type:"tool_use",...}]
      const blocks = j.content as Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
      if (blocks) {
        for (const b of blocks) {
          if (b.type === "text" && b.text) assistantText += b.text;
          if (b.type === "thinking" && b.thinking) thinkingText += b.thinking;
          if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name || "", input: b.input });
        }
      }
      if (!assistantText && !toolCalls.length) assistantText = text;
      responseModel = j.model || "";
      stopReason = j.stop_reason || "";
    } catch { /* */ }

    const cost = calcCost(ep, usage);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    logRequest(ep.provider_name, model, upstream.status, latencyMs, usage, cost, sessionId, text, JSON.stringify(body));
    finalizeSession(sessionId, {
      text: assistantText,
      thinking: thinkingText || undefined,
      model: responseModel || (model as string),
      stop_reason: stopReason,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheHitTokens, cache_creation_input_tokens: usage.cacheMissTokens },
    }, totalTokens, latencyMs);

    set.status = upstream.status;
    set.headers["Content-Type"] = "application/json";
    return text;
  } catch (err: unknown) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    set.status = isTimeout ? 504 : 502;
    return { error: isTimeout ? "Upstream request timed out" : `Upstream error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// === Environment & Port ===
const isProduction = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// === Frontend dev server with HMR (internal port, dev only) ===
if (!isProduction) {
  Bun.serve({
    port: PORT + 1,
    routes: { "/*": index },
    development: { hmr: true },
  });
}

const app = new Elysia()
  // API routes first (matched before catch-all)
  .use(sessionsRoutes)
  .use(logsRoutes)
  .use(endpointsRoutes)
  .use(usageRoutes)
  .use(authRoutes)
  .use(keysRoutes)
  .use(retentionRoutes)
  .get("/api/health", () => ({ status: "ok", time: new Date().toISOString() }))
  // Gateway proxy: external clients connect via /v1/*
  // OpenAI-compatible: POST /v1/chat/completions
  .post("/v1/chat/completions", async ({ request, set }) => {
    const auth = request.headers.get("Authorization") || "";
    const gatewayKey = auth.replace(/^Bearer\s+/i, "");
    const proxySet = { status: 200, headers: {} as Record<string, string> };
    const result = await proxyOpenAI(gatewayKey, request, proxySet);
    set.status = proxySet.status;
    Object.assign(set.headers, proxySet.headers);
    return result;
  })
  // Anthropic-compatible: POST /anthropic/v1/messages
  .post("/anthropic/v1/messages", async ({ request, set }) => {
    const gatewayKey = request.headers.get("x-api-key") || "";
    const proxySet = { status: 200, headers: {} as Record<string, string> };
    const result = await proxyAnthropic(gatewayKey, request, proxySet);
    set.status = proxySet.status;
    Object.assign(set.headers, proxySet.headers);
    return result;
  })
  // GET /v1/models - List every model this key is allowed to access
  .get("/v1/models", ({ request, set }) => {
    // Accept both auth styles: Anthropic SDKs send x-api-key, OpenAI SDKs send Bearer.
    const gatewayKey =
      request.headers.get("x-api-key") ||
      (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const modelIds = listModelsForKey(gatewayKey);
    if (!modelIds) {
      set.status = 401;
      return { error: "Invalid or disabled API key" };
    }
    const data = modelIds.map((id) => ({
      id,
      type: "model",
      created_at: "2024-01-01T00:00:00Z",
      display_name: id,
    }));
    return {
      data,
      has_more: false,
      first_id: data[0]?.id || "",
      last_id: data[data.length - 1]?.id || "",
    };
  })
  // GET /anthropic/v1/models - List models served by Anthropic-format endpoints only
  .get("/anthropic/v1/models", ({ request, set }) => {
    // Accept both auth styles: Anthropic SDKs send x-api-key, OpenAI SDKs send Bearer.
    const gatewayKey =
      request.headers.get("x-api-key") ||
      (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const modelIds = listModelsForKey(gatewayKey, "anthropic");
    if (!modelIds) {
      set.status = 401;
      return { error: "Invalid or disabled API key" };
    }
    const data = modelIds.map((id) => ({
      id,
      type: "model",
      created_at: "2024-01-01T00:00:00Z",
      display_name: id,
    }));
    return {
      data,
      has_more: false,
      first_id: data[0]?.id || "",
      last_id: data[data.length - 1]?.id || "",
    };
  })
  // POST /anthropic/v1/messages/count_tokens - Count tokens in a message
  .post("/anthropic/v1/messages/count_tokens", async ({ request, set }) => {
    const gatewayKey = request.headers.get("x-api-key") || "";

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      set.status = 400;
      return { error: "Invalid JSON body" };
    }

    const epResult = resolveGateway(gatewayKey, typeof body.model === "string" ? body.model : undefined);
    if (!epResult.ok) {
      set.status = epResult.status;
      return { error: epResult.error };
    }
    const ep = epResult.ep;

    const baseUrl = ep.endpoint_url.replace(/\/+$/, "");
    const model = (body.model || ep.model_name) as string;

    try {
      // Proxy to upstream count_tokens endpoint
      const upstream = await fetchWithTimeout(`${baseUrl}/messages/count_tokens`, {
        method: "POST",
        headers: forwardHeaders(request.headers, {
          "x-api-key": ep.api_key,
          "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ ...body, model }),
      });

      const text = await upstream.text();
      set.status = upstream.status;
      set.headers["Content-Type"] = "application/json";
      return text;
    } catch (err: unknown) {
      set.status = 502;
      return { error: `Upstream error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

// === Production: serve built frontend (dist/) + API directly via Elysia ===
if (isProduction) {
  // Resolve dist relative to this file so cwd doesn't matter.
  const distDir = new URL("../dist/", import.meta.url).pathname;
  app.get("*", async ({ set, path }) => {
    // path is like "/index-abc.js" or "/"
    const rel = path === "/" ? "/index.html" : path;
    const filePath = distDir + rel.replace(/^\//, "");
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = rel.split(".").pop() || "";
      const mime: Record<string, string> = {
        html: "text/html; charset=utf-8",
        css: "text/css",
        js: "application/javascript",
        map: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
        ico: "image/x-icon",
        json: "application/json",
        woff: "font/woff",
        woff2: "font/woff2",
      };
      set.headers["Content-Type"] = mime[ext] || "application/octet-stream";
      return file;
    }
    // SPA fallback for client-side routes
    set.headers["Content-Type"] = "text/html; charset=utf-8";
    return Bun.file(distDir + "index.html");
  });

  Bun.serve({
    port: PORT,
    hostname: HOST,
    websocket: {
      open(ws) { if (ws.data.kind === "app") wsRegister(ws); },
      close(ws) { if (ws.data.kind === "app") wsUnregister(ws); },
    },
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws" && req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        if (server.upgrade(req, { data: { kind: "app" } })) return;
      }
      return app.fetch(req);
    },
  });
  console.log(`🚀 Pulse AI Gateway running on http://${HOST}:${PORT} (production)`);
} else {
  // === Dev: Bun.serve with HMR proxy ===
  Bun.serve({
    port: PORT,
    websocket: {
      open(ws) {
        const data = ws.data as { kind?: string; target?: WebSocket } | undefined;
        if (data?.kind === "app") {
          wsRegister(ws);
        } else {
          const target = new WebSocket(`ws://localhost:${PORT + 1}/_bun/hmr`);
          (ws as unknown as { data: { target: WebSocket } }).data = { target };
          target.addEventListener("message", (e) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
          });
          target.addEventListener("close", () => ws.close());
        }
      },
      message(ws, message) {
        const data = ws.data as { kind?: string; target?: WebSocket } | undefined;
        if (data?.kind === "app") return;
        if (data?.target && data.target.readyState === WebSocket.OPEN) {
          data.target.send(message);
        }
      },
      close(ws) {
        const data = ws.data as { kind?: string; target?: WebSocket } | undefined;
        if (data?.kind === "app") {
          wsUnregister(ws);
        } else {
          data?.target?.close();
        }
      },
    },
    fetch(req, server) {
      const url = new URL(req.url);
      // App WebSocket
      if (url.pathname === "/ws" && req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        if (server.upgrade(req, { data: { kind: "app" } })) return;
      }
      // Proxy /_bun/hmr WebSocket upgrade to HMR server
      if (url.pathname === "/_bun/hmr" && req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        if (server.upgrade(req)) return;
      }
      // Proxy frontend requests to HMR server
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/anthropic/")) {
        const target = new URL(req.url);
        target.port = `${PORT + 1}`;
        return fetch(target, req);
      }
      // Delegate API requests to Elysia
      return app.fetch(req);
    },
  });
  console.log(`🔥 Pulse AI Gateway running on http://localhost:${PORT} (dev + HMR)`);
}
