import { Elysia } from "elysia";
import { getDb } from "../db";
import { requireAdmin } from "../middleware/auth";
import { notifySessionsChanged } from "../ws";

// How long request_logs rows (with their full request/response bodies) are kept.
// Override with PULSE_LOG_RETENTION_DAYS.
export const RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.PULSE_LOG_RETENTION_DAYS || "3", 10) || 3
);

// How long sessions (and their messages, via ON DELETE CASCADE) are kept.
// Override with PULSE_SESSION_RETENTION_DAYS.
export const SESSION_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.PULSE_SESSION_RETENTION_DAYS || "3", 10) || 3
);

export function cleanupOldLogs(days = RETENTION_DAYS): number {
  const db = getDb();
  const result = db.run(
    "DELETE FROM request_logs WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
    [`-${days} days`]
  );
  return result.changes;
}

/** Delete sessions (and cascade their messages) older than N days. */
export function cleanupOldSessions(days = SESSION_RETENTION_DAYS): number {
  const db = getDb();
  // foreign_keys=ON (set in getDb) cascades to messages on session delete.
  const result = db.run(
    "DELETE FROM sessions WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
    [`-${days} days`]
  );
  return result.changes;
}

export function vacuumIfWorthwhile() {
  const db = getDb();
  // VACUUM rewrites the whole file — only run it when there are freed pages
  // worth reclaiming. Threshold lowered to ~50 pages (~200 KB) so cleanup
  // actually shrinks the file instead of leaving freelist pages behind.
  const { freelist_count } = db.query("PRAGMA freelist_count").get() as { freelist_count: number };
  if (freelist_count > 50) {
    db.run("VACUUM");
  }
}

/** Delete old logs on a daily interval. Returns a stop function. */
export function startLogRetentionLoop(): () => void {
  const run = () => {
    try {
      const deletedLogs = cleanupOldLogs();
      const deletedSessions = cleanupOldSessions();
      if (deletedSessions > 0) notifySessionsChanged();
      if (deletedLogs > 0 || deletedSessions > 0) {
        console.log(
          `🧹 Pruned ${deletedLogs} request log(s) older than ${RETENTION_DAYS} day(s) and ${deletedSessions} session(s) older than ${SESSION_RETENTION_DAYS} day(s)`
        );
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
    const deletedLogs = cleanupOldLogs(days);
    const deletedSessions = cleanupOldSessions(days);
    if (deletedSessions > 0) notifySessionsChanged();
    if (deletedLogs > 0 || deletedSessions > 0) vacuumIfWorthwhile();
    return {
      success: true,
      deletedLogs,
      deletedSessions,
      retentionDays: RETENTION_DAYS,
      sessionRetentionDays: SESSION_RETENTION_DAYS,
      message: `Deleted ${deletedLogs} log(s) and ${deletedSessions} session(s) older than ${days} day(s)`,
    };
  });
