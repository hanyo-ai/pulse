import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAdmin } from "../middleware/auth";

// How long request_logs rows (with their full request/response bodies) are kept.
// Override with PULSE_LOG_RETENTION_DAYS. Sessions/messages are NOT affected —
// only the bulky audit logs are pruned.
export const RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.PULSE_LOG_RETENTION_DAYS || "7", 10) || 7
);

export function cleanupOldLogs(days = RETENTION_DAYS): number {
  const db = getDb();
  const result = db.run(
    "DELETE FROM request_logs WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
    [`-${days} days`]
  );
  return result.changes;
}

export function vacuumIfWorthwhile() {
  const db = getDb();
  // Only VACUUM when the freelist is a meaningful share of the DB —
  // VACUUM rewrites the whole file, so don't do it for a handful of rows.
  const { freelist_count } = db.query("PRAGMA freelist_count").get() as { freelist_count: number };
  const { page_count } = db.query("PRAGMA page_count").get() as { page_count: number };
  if (page_count > 0 && freelist_count / page_count > 0.2 && freelist_count > 100) {
    db.run("VACUUM");
  }
}

/** Delete old logs on a daily interval. Returns a stop function. */
export function startLogRetentionLoop(): () => void {
  const run = () => {
    try {
      const deleted = cleanupOldLogs();
      if (deleted > 0) {
        console.log(`🧹 Pruned ${deleted} request log(s) older than ${RETENTION_DAYS} day(s)`);
        vacuumIfWorthwhile();
      }
    } catch (err) {
      console.error("Log retention cleanup failed:", err);
    }
  };
  run(); // initial sweep at startup
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

export const retentionRoutes = new Elysia({ prefix: "/api/logs" })
  // Manual trigger, also useful to check current retention policy
  .post("/cleanup", ({ headers, query }) => {
    const result = requireAdmin(headers["authorization"] ?? null);
    if (result instanceof Response) return result;

    const days = Math.max(
      1,
      parseInt((query as { days?: string }).days || "", 10) || RETENTION_DAYS
    );
    const deleted = cleanupOldLogs(days);
    if (deleted > 0) vacuumIfWorthwhile();
    return {
      success: true,
      deleted,
      retentionDays: RETENTION_DAYS,
      message: `Deleted ${deleted} log(s) older than ${days} day(s)`,
    };
  });
