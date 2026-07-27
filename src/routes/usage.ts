import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAuth } from "../middleware/auth";

export const usageRoutes = new Elysia({ prefix: "/api/usage" })
  .get("/stats", ({ query, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { period } = query as { period?: string };

    let whereClause = "";
    const params: unknown[] = [];
    if (result.user.role !== "admin") {
      whereClause =
        " WHERE rl.session_id IN (SELECT id FROM sessions WHERE user_id = ?)";
      params.push(result.user.id);
    }

    const totalTokens = (
      db
        .query(`SELECT COALESCE(SUM(tokens), 0) as val FROM request_logs rl${whereClause}`)
        .get(...params) as { val: number }
    ).val;
    const totalRequests = (
      db
        .query(`SELECT COUNT(*) as val FROM request_logs rl${whereClause}`)
        .get(...params) as { val: number }
    ).val;
    const avgLatency = (
      db
        .query(`SELECT COALESCE(AVG(latency_ms), 0) as val FROM request_logs rl${whereClause}`)
        .get(...params) as { val: number }
    ).val;

    // Calculate cost from request_logs
    const rows = db
      .query(
        `SELECT cost FROM request_logs rl${whereClause}${whereClause ? " AND" : " WHERE"} cost IS NOT NULL AND cost != '—'`
      )
      .all(...params) as { cost: string }[];
    let totalCost = 0;
    for (const r of rows) {
      const num = parseFloat(r.cost.replace(/[^0-9.]/g, ""));
      if (!isNaN(num)) totalCost += num;
    }

    // Calculate cache hit rate
    const cacheRow = (
      db
        .query(`SELECT COALESCE(SUM(prompt_cache_hit_tokens), 0) as hit, COALESCE(SUM(prompt_cache_miss_tokens), 0) as miss FROM request_logs rl${whereClause}`)
        .get(...params) as { hit: number; miss: number }
    );
    const cacheTotal = cacheRow.hit + cacheRow.miss;
    const cacheHitRate = cacheTotal > 0 ? `${((cacheRow.hit / cacheTotal) * 100).toFixed(1)}%` : "—";

    return {
      totalTokens: totalTokens.toLocaleString(),
      totalRequests: totalRequests.toLocaleString(),
      avgLatency: `${Math.round(avgLatency)}ms`,
      estimatedCost: totalCost > 0 ? `$${totalCost.toFixed(2)}` : "$0.00",
      cacheHitRate,
    };
  })
  .get("/by-model", ({ headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    let whereClause = "";
    const params: unknown[] = [];
    if (result.user.role !== "admin") {
      whereClause = " WHERE rl.session_id IN (SELECT id FROM sessions WHERE user_id = ?)";
      params.push(result.user.id);
    }

    return db
      .query(
        `
      SELECT model, provider, COUNT(*) as requests, COALESCE(SUM(tokens), 0) as tokens,
             COALESCE(AVG(latency_ms), 0) as avg_latency,
             cost
      FROM request_logs rl${whereClause}
      GROUP BY model, provider
      ORDER BY tokens DESC
    `
      )
      .all(...params);
  })
  .get("/trend", ({ headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    let whereClause = "";
    const params: unknown[] = [];
    if (result.user.role !== "admin") {
      whereClause = " WHERE rl.session_id IN (SELECT id FROM sessions WHERE user_id = ?)";
      params.push(result.user.id);
    }

    return db
      .query(
        `
      SELECT date(created_at) as day, provider, COALESCE(SUM(tokens), 0) as tokens
      FROM request_logs rl
      ${whereClause}${whereClause ? " AND" : " WHERE"} created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')
      GROUP BY date(created_at), provider
      ORDER BY day ASC
    `
      )
      .all(...params);
  });
