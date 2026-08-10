import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAdmin } from "../middleware/auth";

interface KeyRow {
  id: number;
  key: string;
  name: string;
  models: string; // JSON whitelist; '[]' = all models
  enabled: number;
  created_at: string;
  updated_at: string;
}

function genKey(): string {
  return "sk-pulse-" + Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function toKey(row: KeyRow, reveal = false) {
  return {
    id: row.id,
    name: row.name,
    models: row.models,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Full key only right after creation; listings show the masked form.
    key: reveal ? row.key : undefined,
    key_masked: maskKey(row.key),
  };
}

function normalizeModels(input: unknown): string | null {
  // Accept a JSON string or a string[]; null means "invalid input".
  if (input === undefined || input === null) return "[]";
  let arr: unknown = input;
  if (typeof input === "string") {
    try { arr = JSON.parse(input); } catch { return null; }
  }
  if (!Array.isArray(arr) || !arr.every((m) => typeof m === "string")) return null;
  return JSON.stringify([...new Set(arr as string[])]);
}

export const keysRoutes = new Elysia({ prefix: "/api/keys" })
  .get("/", ({ headers }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;
    const db = getDb();
    const rows = db.query("SELECT * FROM gateway_keys ORDER BY id ASC").all() as KeyRow[];
    // Return full key for admin (they need to copy it to configure clients
    // / test endpoints). The gateway key is a client credential for the
    // gateway itself, not an upstream secret — masking it breaks copying.
    return rows.map((r) => ({ ...toKey(r), key: r.key }));
  })
  .post("/", ({ body, headers, set }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const { name, key, models } = (body ?? {}) as { name?: string; key?: string; models?: unknown };
    const modelsJson = normalizeModels(models);
    if (modelsJson === null) {
      set.status = 400;
      return { error: "models must be a JSON array of model names (empty = all)" };
    }
    const finalKey = (key ?? "").trim() || genKey();
    const db = getDb();
    const dup = db.query("SELECT id FROM gateway_keys WHERE key = ?").get(finalKey);
    if (dup) {
      set.status = 409;
      return { error: "Key already exists" };
    }
    db.run("INSERT INTO gateway_keys (key, name, models) VALUES (?, ?, ?)", [finalKey, name ?? "", modelsJson]);
    const row = db.query("SELECT * FROM gateway_keys WHERE key = ?").get(finalKey) as KeyRow;
    return toKey(row, true); // reveal full key once, on creation
  })
  .put("/:id", ({ params: { id }, body, headers, set }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const existing = db.query("SELECT * FROM gateway_keys WHERE id = ?").get(id) as KeyRow | null;
    if (!existing) {
      set.status = 404;
      return { error: "Not found" };
    }

    const fields = (body ?? {}) as { name?: string; models?: unknown; enabled?: number | boolean; key?: string };
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) { sets.push("name = ?"); values.push(fields.name); }
    if (fields.enabled !== undefined) { sets.push("enabled = ?"); values.push(fields.enabled ? 1 : 0); }
    if (fields.models !== undefined) {
      const modelsJson = normalizeModels(fields.models);
      if (modelsJson === null) {
        set.status = 400;
        return { error: "models must be a JSON array of model names (empty = all)" };
      }
      sets.push("models = ?");
      values.push(modelsJson);
    }
    if (fields.key !== undefined) {
      const newKey = fields.key.trim();
      if (!newKey) {
        set.status = 400;
        return { error: "key cannot be empty" };
      }
      const dup = db.query("SELECT id FROM gateway_keys WHERE key = ? AND id != ?").get(newKey, Number(id));
      if (dup) {
        set.status = 409;
        return { error: "Key already exists" };
      }
      sets.push("key = ?");
      values.push(newKey);
    }
    if (sets.length > 0) {
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
      values.push(Number(id));
      db.run(`UPDATE gateway_keys SET ${sets.join(", ")} WHERE id = ?`, values as (string | number)[]);
    }
    const row = db.query("SELECT * FROM gateway_keys WHERE id = ?").get(id) as KeyRow;
    return toKey(row);
  })
  .delete("/:id", ({ params: { id }, headers, set }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;
    const db = getDb();
    const res = db.run("DELETE FROM gateway_keys WHERE id = ?", [Number(id)]);
    if (res.changes === 0) {
      set.status = 404;
      return { error: "Not found" };
    }
    return { success: true };
  });
