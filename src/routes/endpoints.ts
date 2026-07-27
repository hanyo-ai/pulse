import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAdmin } from "../middleware/auth";

interface EndpointRow {
  id: number;
  provider_name: string;
  provider_key: string;
  endpoint_url: string;
  status: string;
  latency_ms: number;
  error_rate: number;
  enabled: number;
  display_name: string;
  provider_format: string;
  model_name: string;
  models: string;
  api_key: string;
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function toEndpoint(row: EndpointRow) {
  return {
    ...row,
    api_key_masked: maskKey(row.api_key),
  };
}

export const endpointsRoutes = new Elysia({ prefix: "/api/endpoints" })
  .get("/", ({ headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const rows = db.query("SELECT * FROM endpoints ORDER BY id ASC").all() as EndpointRow[];
    return rows.map(toEndpoint);
  })
  .get("/:id", ({ params: { id }, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const row = db.query("SELECT * FROM endpoints WHERE id = ?").get(id) as EndpointRow | undefined;
    return row ? toEndpoint(row) : null;
  })
  .post("/", ({ body, headers, set }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { display_name, provider_name, provider_key, endpoint_url, model_name, models, api_key,
      price_input_per_m, price_output_per_m, price_cache_input_per_m } =
      body as {
        display_name: string; provider_name: string; provider_key: string;
        endpoint_url: string; model_name: string; models?: string; api_key: string;
        price_input_per_m?: number; price_output_per_m?: number;
        price_cache_input_per_m?: number;
      };

    // No more per-endpoint random keys: authentication is centralized in
    // the gateway_keys table (managed from the API Keys page). Endpoints
    // only declare which models they serve; any enabled gateway key whose
    // whitelist permits the model can route here.

    // Normalize models: if only model_name provided, populate models automatically
    const modelsJson = models || (model_name ? JSON.stringify([model_name]) : '[]');

    // Validate: ensure no duplicate model names across endpoints
    try {
      const newModels = JSON.parse(modelsJson) as string[];
      if (newModels.length > 0) {
        const existing = db.query("SELECT id, display_name, models FROM endpoints WHERE enabled = 1").all() as Array<{id: number; display_name: string; models: string}>;
        const conflicts: string[] = [];
        for (const row of existing) {
          try {
            const existingModels = JSON.parse(row.models) as string[];
            for (const m of newModels) {
              if (existingModels.includes(m)) {
                conflicts.push(`"${m}" (already used by endpoint ${row.id} "${row.display_name}")`);
              }
            }
          } catch { /* skip invalid JSON */ }
        }
        if (conflicts.length > 0) {
          set.status = 409;
          return { error: `Model name conflict: ${conflicts.join(", ")}` };
        }
      }
    } catch { /* skip validation if models is not valid JSON */ }

    db.run(
      `INSERT INTO endpoints (display_name, provider_name, provider_key, endpoint_url, model_name, models, api_key,
        price_input_per_m, price_output_per_m, price_cache_input_per_m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [display_name || provider_name, provider_name, provider_key, endpoint_url, model_name, modelsJson, api_key,
        price_input_per_m || 0, price_output_per_m || 0, price_cache_input_per_m || 0]
    );
    const row = db.query("SELECT * FROM endpoints ORDER BY id DESC LIMIT 1").get() as EndpointRow;
    return toEndpoint(row);
  })
  .put("/:id", ({ params: { id }, body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const fields = body as Record<string, unknown>;
    const allowedFields = [
      "provider_name", "provider_key", "endpoint_url", "status", "latency_ms",
      "error_rate", "enabled", "display_name", "provider_format", "model_name", "models", "api_key",
      "price_input_per_m", "price_output_per_m", "price_cache_input_per_m",
    ];
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];
    for (const f of allowedFields) {
      if (fields[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        values.push(fields[f] as string | number | null);
      }
    }
    if (setClauses.length > 0) {
      // Validate: ensure no duplicate model names when updating models field
      const newModelsJson = fields["models"] as string | undefined;
      if (newModelsJson) {
        try {
          const newModels = JSON.parse(newModelsJson) as string[];
          if (newModels.length > 0) {
            const existing = db.query("SELECT id, display_name, models FROM endpoints WHERE enabled = 1 AND id != ?").all(Number(id)) as Array<{id: number; display_name: string; models: string}>;
            const conflicts: string[] = [];
            for (const row of existing) {
              try {
                const existingModels = JSON.parse(row.models) as string[];
                for (const m of newModels) {
                  if (existingModels.includes(m)) {
                    conflicts.push(`"${m}" (already used by endpoint ${row.id} "${row.display_name}")`);
                  }
                }
              } catch { /* skip invalid JSON */ }
            }
            if (conflicts.length > 0) {
              return new Response(JSON.stringify({ error: `Model name conflict: ${conflicts.join(", ")}` }), { status: 409 });
            }
          }
        } catch { /* skip validation if models is not valid JSON */ }
      }

      setClauses.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
      values.push(id);
      db.run(`UPDATE endpoints SET ${setClauses.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
    }
    const row = db.query("SELECT * FROM endpoints WHERE id = ?").get(id) as EndpointRow | undefined;
    return row ? toEndpoint(row) : null;
  })
  .delete("/:id", ({ params: { id }, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    db.run("DELETE FROM endpoints WHERE id = ?", [id]);
    return { success: true };
  })
  // Test endpoint connection (auto-detects OpenAI vs Anthropic format)
  .post("/test", async ({ body, headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const { base_url, api_key, model_name } = body as {
      base_url: string;
      api_key: string;
      model_name: string;
    };

    if (!base_url || !api_key) {
      return new Response(JSON.stringify({ error: "base_url 和 api_key 不能为空" }), { status: 400 });
    }

    const normalizedBase = base_url.replace(/\/+$/, "");
    const testModel = model_name || "gpt-4o-mini";

    // Try OpenAI and Anthropic in parallel — first to succeed wins
    // Use Promise.any: whichever succeeds first, with both errors collected on failure
    const errors: string[] = [];
    let winner: { ok: boolean; success: boolean; latency_ms: number; model_used: string; format: string } | null = null;

    try {
      winner = await Promise.any([
        tryOpenAI(normalizedBase, api_key, testModel).then(r => {
          if (r.ok) return r as { ok: boolean; success: boolean; latency_ms: number; model_used: string; format: string };
          if (r.error) errors.push(r.error);
          throw r;
        }),
        tryAnthropic(normalizedBase, api_key, testModel).then(r => {
          if (r.ok) return r as { ok: boolean; success: boolean; latency_ms: number; model_used: string; format: string };
          if (r.error) errors.push(r.error);
          throw r;
        }),
      ]);
      return winner;
    } catch {
      return new Response(
        JSON.stringify({ error: errors.join("; ") || "连接测试失败" }),
        { status: 502 },
      );
    }
  });

async function tryOpenAI(baseUrl: string, apiKey: string, model: string) {
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const latencyMs = Date.now() - start;

    // Any HTTP response means the endpoint is reachable
    const text = await res.text().catch(() => "");
    if (res.ok) {
      return { ok: true, success: true, latency_ms: latencyMs, model_used: model, format: "openai" as const };
    }
    // 401/403/429 — connected but auth or rate-limited
    return { ok: true, success: true, latency_ms: latencyMs, model_used: model, format: "openai" as const };
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, error: isTimeout ? "OpenAI-compatible request timed out after 30s" : undefined };
  }
}

async function tryAnthropic(baseUrl: string, apiKey: string, model: string) {
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const latencyMs = Date.now() - start;

    // Any HTTP response means the endpoint is reachable
    if (res.ok) {
      return { ok: true, success: true, latency_ms: latencyMs, model_used: model, format: "anthropic" as const };
    }
    // Non-2xx but server responded — connected
    return { ok: true, success: true, latency_ms: latencyMs, model_used: model, format: "anthropic" as const };
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, error: isTimeout ? "Anthropic-compatible request timed out after 30s" : undefined };
  }
}
