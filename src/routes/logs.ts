import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAuth } from "../middleware/auth";

export const logsRoutes = new Elysia({ prefix: "/api/logs" })
  .get("/", ({ query, headers }) => {
    const result = requireAuth(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const db = getDb();
    const { provider, status, limit, offset } = query as {
      provider?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };

    const pageSize = Math.min(Math.max(limit ? parseInt(limit) : 20, 1), 200);
    const pageOffset = Math.max(offset ? parseInt(offset) : 0, 0);

    // Build the WHERE clause once, then reuse for COUNT and SELECT
    let whereClause = " WHERE 1=1";
    const params: (string | number)[] = [];

    if (result.user.role !== "admin") {
      whereClause = " INNER JOIN sessions s ON rl.session_id = s.id AND s.user_id = ? WHERE 1=1";
      params.push(result.user.id);
    }

    if (provider && provider !== "全部供应商") {
      whereClause += " AND rl.provider = ?";
      params.push(provider);
    }
    if (status) {
      if (status === "2xx") {
        whereClause += " AND rl.status_code >= 200 AND rl.status_code < 300";
      } else if (status === "4xx") {
        whereClause += " AND rl.status_code >= 400 AND rl.status_code < 500";
      } else if (status === "5xx") {
        whereClause += " AND rl.status_code >= 500 AND rl.status_code < 600";
      }
    }

    // COUNT query — use same params (without limit/offset)
    const countSql = `SELECT COUNT(*) as total FROM request_logs rl${whereClause}`;
    const { total } = db.query(countSql).get(...params) as { total: number };

    // Data query
    const dataSql = `SELECT rl.* FROM request_logs rl${whereClause} ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`;
    const logs = db.query(dataSql).all(...[...params, pageSize, pageOffset]);

    return { logs, total, page: Math.floor(pageOffset / pageSize) + 1, pageSize };
  });
