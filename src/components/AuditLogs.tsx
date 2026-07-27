import { useState, useEffect, useCallback } from "react";
import { t, useTranslation } from "../i18n";
import type { RequestLog } from "../types";

// Normalize SQLite UTC timestamps: old format lacks timezone, new format has Z suffix.
function toUTC(ts: string): Date {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}

interface AuditLogsProps {
  token: string;
}

const PAGE_SIZE = 20;

function formatJson(raw: string): string {
  if (!raw) return t("logs.emptyResponse");
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditLogs({ token }: AuditLogsProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);

  const allProviders = t("logs.allProviders");
  const allStatus = t("logs.allStatus");

  const fetchLogs = useCallback((p: number, prov: string, st: string) => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String((p - 1) * PAGE_SIZE));
    if (prov && prov !== allProviders) params.set("provider", prov);
    if (st && st !== allStatus) params.set("status", st);

    fetch(`/api/logs?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && Array.isArray(data.logs)) {
          setLogs(data.logs);
          setTotal(data.total || 0);
          setPage(data.page || p);
        }
      })
      .catch(console.error);
  }, [token, allProviders, allStatus]);

  // Initial load
  useEffect(() => {
    if (!provider) setProvider(allProviders);
    if (!status) setStatus(allStatus);
    fetchLogs(1, provider || allProviders, status || allStatus);
  }, [token]); // only on mount; filters trigger via onChange

  // Keep state in sync with translations
  useEffect(() => {
    if (provider && provider !== allProviders && provider !== "OpenAI" && provider !== "Anthropic") {
      setProvider(allProviders);
    }
  }, [allProviders]);

  useEffect(() => {
    const statusValues = ["2xx", "4xx", "5xx"];
    if (status && status !== allStatus && !statusValues.includes(status)) {
      setStatus(allStatus);
    }
  }, [allStatus]);

  const applyFilters = (newProvider: string, newStatus: string) => {
    setProvider(newProvider);
    setStatus(newStatus);
    fetchLogs(1, newProvider, newStatus);
  };

  const goToPage = (p: number) => {
    fetchLogs(p, provider, status);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = logs.filter((l) => {
    if (provider !== t("logs.allProviders") && l.provider !== provider) return false;
    if (search && !l.request_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (status === "2xx" && (l.status_code < 200 || l.status_code >= 300)) return false;
    if (status === "4xx" && (l.status_code < 400 || l.status_code >= 500)) return false;
    if (status === "5xx" && (l.status_code < 500 || l.status_code >= 600)) return false;
    return true;
  });

  const statusClass = (code: number) => {
    if (code >= 200 && code < 300) return "ok";
    if (code >= 400 && code < 500) return "err";
    if (code >= 500) return "warn";
    return "";
  };

  return (
    <section className="section active page">
      <div className="filter-bar">
        <input
          type="text"
          placeholder={t("logs.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={provider} onChange={(e) => applyFilters(e.target.value, status)}>
          <option>{t("logs.allProviders")}</option>
          <option>OpenAI</option>
          <option>Anthropic</option>
        </select>
        <select value={status} onChange={(e) => applyFilters(provider, e.target.value)}>
          <option>{t("logs.allStatus")}</option>
          <option>2xx</option>
          <option>4xx</option>
          <option>5xx</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("logs.time")}</th>
              <th>{t("logs.requestId")}</th>
              <th>Session</th>
              <th>{t("logs.provider")}</th>
              <th>{t("logs.model")}</th>
              <th>{t("logs.status")}</th>
              <th>{t("logs.latency")}</th>
              <th>Tokens</th>
              <th>{t("logs.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr
                key={l.id}
                className="log-row"
                style={{ cursor: (l.response_body || l.request_body) ? "pointer" : "default" }}
                onClick={() => (l.response_body || l.request_body) && setSelectedLog(l)}
                title={l.response_body || l.request_body ? t("logs.clickHint") : ""}
              >
                <td className="mono">
                  {toUTC(l.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </td>
                <td className="mono">{l.request_id}</td>
                <td className="mono">{l.session_id}</td>
                <td>{l.provider}</td>
                <td className="mono">{l.model}</td>
                <td>
                  <span className={`cell-status ${statusClass(l.status_code)}`}>{l.status_code}</span>
                </td>
                <td className="mono">{l.latency_ms}ms</td>
                <td className="mono">{l.tokens > 0 ? l.tokens.toLocaleString() : "—"}</td>
                <td className="mono">{l.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">
            {total.toLocaleString()} {t("logs.records")} · {t("logs.page")} {page}/{totalPages}
          </span>
          <div className="pagination-btns">
            <button disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              ‹ {t("logs.prev")}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => {
                // Show first, last, current, and neighbours (±1)
                return p === 1 || p === totalPages || Math.abs(p - page) <= 1;
              })
              .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="pagination-gap">…</span>
                ) : (
                  <button
                    key={p}
                    className={p === page ? "active" : ""}
                    onClick={() => goToPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
            <button disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
              {t("logs.next")} ›
            </button>
          </div>
        </div>
      )}

      {selectedLog && (
        <div
          className="log-modal-overlay"
          onClick={() => setSelectedLog(null)}
        >
          <div className="log-modal card" onClick={(e) => e.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h3>{t("logs.detailTitle")}</h3>
                <div className="log-modal-meta">
                  <span className="mono">{selectedLog.request_id}</span>
                  <span>·</span>
                  <span>{selectedLog.provider}</span>
                  <span>·</span>
                  <span>{selectedLog.model}</span>
                  <span>·</span>
                  <span className={`cell-status ${statusClass(selectedLog.status_code)}`}>{selectedLog.status_code}</span>
                </div>
              </div>
              <button
                className="log-modal-close"
                onClick={() => setSelectedLog(null)}
              >
                ×
              </button>
            </div>
            <div className="log-modal-sections">
              {selectedLog.request_body && (
                <div className="log-modal-section">
                  <div className="log-modal-section-label">Request</div>
                  <pre className="log-modal-body"><code>{formatJson(selectedLog.request_body)}</code></pre>
                </div>
              )}
              {selectedLog.response_body && (
                <div className="log-modal-section">
                  <div className="log-modal-section-label">Response</div>
                  <pre className="log-modal-body"><code>{formatJson(selectedLog.response_body)}</code></pre>
                </div>
              )}
              {!selectedLog.request_body && !selectedLog.response_body && (
                  <div className="empty-state">{t("logs.noData")}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
