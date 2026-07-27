import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAuth } from "../middleware/auth";
import { notifySessionsChanged, notifyMessagesChanged } from "../ws";

export const sessionsRoutes = new Elysia({ prefix: "/api/sessions" })
  .get("/", ({ headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    if (result.user.role === "admin") {
      return db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all();
    }
    return db
      .query("SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC")
      .all(result.user.id);
  })
  .get("/:id", ({ params: { id }, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const session = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!session) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    if (result.user.role !== "admin" && session.user_id !== result.user.id) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
    }

    const messages = db
      .query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(id);
    return { ...session, messages };
  })
  .get("/:id/messages", ({ params: { id }, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const session = db.query("SELECT user_id FROM sessions WHERE id = ?").get(id) as { user_id: number } | null;
    if (!session) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    if (result.user.role !== "admin" && session.user_id !== result.user.id) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
    }

    return db
      .query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(id);
  })
  .post("/", ({ body, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { title, provider, model } = body as { title: string; provider: string; model: string };
    const id = `sess_${crypto.randomUUID()}`;
    db.run(
      "INSERT INTO sessions (id, title, provider, model, user_id) VALUES (?, ?, ?, ?, ?)",
      [id, title, provider, model, result.user.id]
    );
    notifySessionsChanged();
    return db.query("SELECT * FROM sessions WHERE id = ?").get(id);
  })
  .put("/:id", ({ params: { id }, body, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const session = db.query("SELECT user_id FROM sessions WHERE id = ?").get(id) as { user_id: number } | null;
    if (!session) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    if (result.user.role !== "admin" && session.user_id !== result.user.id) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
    }

    const { title, provider, model, status } = body as Record<string, string>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (title) { fields.push("title = ?"); values.push(title); }
    if (provider) { fields.push("provider = ?"); values.push(provider); }
    if (model) { fields.push("model = ?"); values.push(model); }
    if (status) { fields.push("status = ?"); values.push(status); }
    if (fields.length > 0) {
      fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
      values.push(id);
      db.run(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`, values);
    }
    notifySessionsChanged();
    return db.query("SELECT * FROM sessions WHERE id = ?").get(id);
  })
  .delete("/:id", ({ params: { id }, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const session = db.query("SELECT user_id FROM sessions WHERE id = ?").get(id) as { user_id: number } | null;
    if (!session) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    if (result.user.role !== "admin" && session.user_id !== result.user.id) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
    }

    db.run("DELETE FROM sessions WHERE id = ?", [id]);
    notifySessionsChanged();
    return { success: true };
  })
  .post("/:id/messages", ({ params: { id }, body, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const session = db.query("SELECT user_id FROM sessions WHERE id = ?").get(id) as { user_id: number } | null;
    if (!session) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    if (result.user.role !== "admin" && session.user_id !== result.user.id) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
    }

    const { role, content, tokens, latency } = body as {
      role: string;
      content: string;
      tokens?: number;
      latency?: string;
    };
    db.run(
      "INSERT INTO messages (session_id, role, content, tokens, latency) VALUES (?, ?, ?, ?, ?)",
      [id, role, content, tokens || 0, latency || "—"]
    );
    db.run("UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?", [id]);
    notifySessionsChanged();
    notifyMessagesChanged(id);
    return db
      .query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(id);
  })
  .post("/cleanup-stale", ({ headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    // Mark sessions as idle if they've been live for more than 5 minutes
    const staleResult = db.run(
      "UPDATE sessions SET status = 'idle' WHERE status = 'live' AND updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 minutes')"
    );

    if (staleResult.changes > 0) notifySessionsChanged();

    return {
      success: true,
      cleaned: staleResult.changes,
      message: `Cleaned up ${staleResult.changes} stale session(s)`
    };
  });
