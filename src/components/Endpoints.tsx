import { useState, useEffect, Fragment, useRef, useCallback } from "react";
import { t, useTranslation } from "../i18n";
import type { Endpoint } from "../types";

// ---- column resize helpers ----
const COL_MIN_WIDTH = 40;

function useColumnResize(initialWidths: number[]) {
  const [widths, setWidths] = useState<number[]>(initialWidths);
  const resizing = useRef<{ idx: number; startX: number; startW: number } | null>(null);

  const onMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { idx, startX: e.clientX, startW: widths[idx]! };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [widths]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const { idx, startX, startW } = resizing.current;
      const diff = e.clientX - startX;
      const newW = Math.max(COL_MIN_WIDTH, startW + diff);
      setWidths((prev) => {
        const next = [...prev];
        next[idx] = newW;
        return next;
      });
    };
    const onMouseUp = () => {
      if (resizing.current) {
        resizing.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return { widths, onMouseDown, resizingRef: resizing };
}

interface AddModalProps {
  onClose: () => void;
  onCreated: () => void;
  token: string;
}

// ---- Provider presets ----
// format: "openai" = OpenAI-compatible API, "anthropic" = Anthropic-compatible API
interface ProviderPreset {
  id: string;
  label: string;
  provider_name: string;
  provider_format: string;
  base_url: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "kimi-code-oai",  label: "Kimi Code (OpenAI)",         provider_name: "kimi-code",    provider_format: "openai",    base_url: "https://api.kimi.com/coding/v1" },
  { id: "kimi-code-ant",  label: "Kimi Code (Anthropic)",      provider_name: "kimi-code",    provider_format: "anthropic", base_url: "https://api.kimi.com/coding/v1" },
  { id: "deepseek-oai",   label: "DeepSeek (OpenAI)",         provider_name: "deepseek",     provider_format: "openai",    base_url: "https://api.deepseek.com" },
  { id: "deepseek-ant",   label: "DeepSeek (Anthropic)",      provider_name: "deepseek",     provider_format: "anthropic", base_url: "https://api.deepseek.com/anthropic" },
  { id: "aicodemirror",   label: "AiCodeMirror (Anthropic)",  provider_name: "aicodemirror", provider_format: "anthropic", base_url: "https://api.aicodemirror.com/api/claudecode/v1" },
  { id: "openai",         label: "OpenAI",                    provider_name: "openai",       provider_format: "openai",    base_url: "https://api.openai.com/v1" },
  { id: "anthropic",      label: "Anthropic",                 provider_name: "anthropic",    provider_format: "anthropic", base_url: "https://api.anthropic.com" },
];

function AddModal({ onClose, onCreated, token }: AddModalProps) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState("");
  const [providerFormat, setProviderFormat] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [presetId, setPresetId] = useState("custom");

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (preset) {
      setProviderFormat(preset.provider_format);
      setEndpointUrl(preset.base_url);
    }
  };
  const [modelName, setModelName] = useState("");
  const [extraModels, setExtraModels] = useState<string[]>([]);
  const [newModelInput, setNewModelInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priceInputPerM, setPriceInputPerM] = useState("");
  const [priceOutputPerM, setPriceOutputPerM] = useState("");
  const [priceCacheInputPerM, setPriceCacheInputPerM] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Created endpoint info
  const [createdEndpoint, setCreatedEndpoint] = useState<Endpoint | null>(null);

  // Testing
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const testConnection = async () => {
    if (!endpointUrl || !apiKey) {
      setError(t("ep.testFillFirst"));
      return;
    }
    setError("");
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch("/api/endpoints/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          base_url: endpointUrl,
          api_key: apiKey,
          model_name: modelName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, msg: data.error || t("ep.testFailed") });
        return;
      }
      setTestResult({
        ok: true,
        msg: t("ep.testSuccess", { latency: data.latency_ms, model: data.model_used }),
      });
    } catch {
      setTestResult({ ok: false, msg: t("ep.testNetworkError") });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Build models array from default + extra, deduped
      const modelsFromInput = extraModels.length
        ? [...new Set([modelName, ...extraModels])]
        : [modelName];

      const res = await fetch("/api/endpoints", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          display_name: displayName,
          provider_name: displayName || providerFormat,
          provider_format: providerFormat,
          provider_key: providerFormat === "openai" ? "O" : providerFormat === "anthropic" ? "A" : "",
          endpoint_url: endpointUrl,
          model_name: modelName,
          models: JSON.stringify(modelsFromInput),
          api_key: apiKey,
          price_input_per_m: priceInputPerM ? parseFloat(priceInputPerM) : 0,
          price_output_per_m: priceOutputPerM ? parseFloat(priceOutputPerM) : 0,
          price_cache_input_per_m: priceCacheInputPerM ? parseFloat(priceCacheInputPerM) : 0,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || t("ep.addFailed"));
        return;
      }
      const ep = await res.json() as Endpoint;
      setCreatedEndpoint(ep);
      onCreated();
    } catch {
      setError(t("ep.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="card modal"
        style={{ width: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{t("ep.addEndpoint")}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {createdEndpoint ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="alert alert-success" style={{ padding: 14 }}>✓ {t("ep.created")}</div>

            <div className="info-box">
              <h4 style={{ fontSize: "13px", fontWeight: 650, marginBottom: "12px" }}>{t("ep.externalInfo")}</h4>

              {[
                { label: "Gateway Base URL", value: window.location.origin + (createdEndpoint.provider_format === "anthropic" ? "/anthropic/v1" : "/v1"), mono: true },
                { label: "Models", value: createdEndpoint.models
                    ? JSON.parse(createdEndpoint.models).join(", ")
                    : createdEndpoint.model_name || createdEndpoint.provider_name,
                  mono: true },
              ].map((item) => (
                <div key={item.label} style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "2px" }}>{item.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <code className="copy-row">
                      {item.value}
                    </code>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => navigator.clipboard.writeText(item.value)}
                    >
                      {t("ep.copy")}
                    </button>
                  </div>
                </div>
              ))}

              <div style={{
                marginTop: 12, padding: 10, borderRadius: "var(--radius-sm)",
                background: "var(--surface-3)", fontSize: 12, color: "var(--muted)",
              }}>
                <strong>{t("ep.curlExample")}</strong><br />
                {createdEndpoint.provider_format === "anthropic" ? (
                  <code style={{ fontSize: "11px" }}>
                    curl {window.location.origin}/anthropic/v1/messages \<br />
                    &nbsp;&nbsp;-H "x-api-key: &lt;your-api-key&gt;" \<br />
                    &nbsp;&nbsp;-H "anthropic-version: 2023-06-01" \<br />
                    &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
                    &nbsp;&nbsp;-d '{`{"model":"${createdEndpoint.model_name}","max_tokens":100,"messages":[{"role":"user","content":"hello"}]}`}'
                  </code>
                ) : (
                  <code style={{ fontSize: "11px" }}>
                    curl {window.location.origin}/v1/chat/completions \<br />
                    &nbsp;&nbsp;-H "Authorization: Bearer &lt;your-api-key&gt;" \<br />
                    &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
                    &nbsp;&nbsp;-d '{`{"model":"${createdEndpoint.model_name}","messages":[{"role":"user","content":"hello"}]}`}'
                  </code>
                )}
                <div style={{ marginTop: "6px", fontSize: "11px" }}>
                  {t("ep.getKeyFromApiKeys")}
                </div>
              </div>
            </div>

            <button type="button" className="btn btn-primary" onClick={onClose} style={{ alignSelf: "flex-end" }}>
              {t("ep.cancel")}
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {error && <div className="alert alert-error">{error}</div>}

          {/* Provider preset selector */}
          <div>
            <label className="field-label">{t("ep.providerPreset")}</label>
            <select
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
              className="input"
            >
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="custom">{t("ep.providerCustom")}</option>
            </select>
          </div>

          {/* Custom Display Name (optional — falls back to provider name) */}
          <div>
            <label className="field-label">{t("ep.customName")}</label>
            <input
              type="text"
              placeholder={t("ep.customNameHint")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input"
            />
          </div>

          {/* Provider Format */}
          <div>
            <label className="field-label">{t("ep.providerFormat")}</label>
            <select
              value={providerFormat}
              onChange={(e) => { setProviderFormat(e.target.value); setPresetId("custom"); }}
              required
              className="input"
            >
              <option value="">{t("ep.providerFormatHint")}</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          {/* Base URL + API Key */}
          <div>
            <label className="field-label">Base URL *</label>
            <input
              type="url"
              placeholder={t("ep.baseUrlHint")}
              value={endpointUrl}
              onChange={(e) => { setEndpointUrl(e.target.value); setPresetId("custom"); }}
              required
              className="input"
            />
          </div>

          <div>
            <label className="field-label">API Key *</label>
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              className="input"
            />
          </div>

          {/* Default Model Name */}
          <div>
            <label className="field-label">{t("ep.model")}</label>
            <input
              type="text"
              placeholder={t("ep.modelHint")}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              required
              className="input"
            />
          </div>

          {/* Extra Models */}
          <div>
            <label className="field-label">{t("ep.models")}</label>
            {extraModels.length > 0 && (
              <div className="chips" style={{ marginTop: 0 }}>
                {extraModels.map((m, i) => (
                  <span key={i} className="chip">
                    {m}
                    <button
                      type="button"
                      onClick={() => setExtraModels(extraModels.filter((_, j) => j !== i))}
                      className="chip-x"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                placeholder={t("ep.modelsHint")}
                value={newModelInput}
                onChange={(e) => setNewModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = newModelInput.trim();
                    if (val && val !== modelName && !extraModels.includes(val)) {
                      setExtraModels([...extraModels, val]);
                      setNewModelInput("");
                    }
                  }
                }}
                className="input" style={{ flex: 1, fontSize: "12px" }}
              />
              <button
                type="button"
                onClick={() => {
                  const val = newModelInput.trim();
                  if (val && val !== modelName && !extraModels.includes(val)) {
                    setExtraModels([...extraModels, val]);
                    setNewModelInput("");
                  }
                }}
                disabled={!newModelInput.trim()}
                style={{
                  padding: "6px 14px", fontSize: "13px", fontWeight: 600,
                  background: newModelInput.trim() ? "var(--accent)" : "var(--muted)",
                  color: "#fff", border: "none", borderRadius: "var(--radius-sm)",
                  cursor: newModelInput.trim() ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                }}
              >
                + {t("ep.add").replace("+ ", "")}
              </button>
            </div>
          </div>

          {/* Pricing Configuration */}
          <div className="info-box" style={{ padding: 12 }}>
            <div style={{ fontSize: "12px", fontWeight: 650, marginBottom: "8px", color: "var(--fg)" }}>{t("ep.pricingConfig")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label className="field-label">{t("ep.priceInput")}</label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="0.00"
                  value={priceInputPerM}
                  onChange={(e) => setPriceInputPerM(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="field-label">{t("ep.priceOutput")}</label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="0.00"
                  value={priceOutputPerM}
                  onChange={(e) => setPriceOutputPerM(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="field-label">{t("ep.priceCacheInput")}</label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="0.00"
                  value={priceCacheInputPerM}
                  onChange={(e) => setPriceCacheInputPerM(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>

          {/* Test Connection */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !endpointUrl || !apiKey}
              className="btn btn-sm"
              style={{
                background: testing ? "var(--muted)" : "var(--green)",
                color: "#fff",
                borderColor: "transparent",
              }}
            >
              {testing ? t("ep.testConnecting") : t("ep.testConnection")}
            </button>
            {testResult && (
              <span style={{
                fontSize: "12px",
                color: testResult.ok ? "var(--green)" : "var(--red)",
                fontWeight: 500,
              }}>
                {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
              </span>
            )}
          </div>

          {/* Submit */}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" className="btn" style={{ border: "1px solid var(--border)" }} onClick={onClose}>
              {t("ep.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t("ep.submitting") : t("ep.confirm")}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

function TestPanel({ ep }: { ep: Endpoint }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("");
  const [status, setStatus] = useState<number | null>(null);
  const [format, setFormat] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");

  const parsedModels = (() => {
    try { return ep.models ? JSON.parse(ep.models) : [ep.model_name]; }
    catch { return [ep.model_name]; }
  })();
  const defaultModel = parsedModels[0] || ep.model_name;

  const curlOpenAI = `curl ${window.location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey || '<your-api-key>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${defaultModel}","messages":[{"role":"user","content":"hello"}]}'`;

  const curlAnthropic = `curl ${window.location.origin}/anthropic/v1/messages \\
  -H "x-api-key: ${apiKey || '<your-api-key>'}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${defaultModel}","max_tokens":100,"messages":[{"role":"user","content":"hello"}]}'`;

  const curlCmd = format === "openai" ? curlOpenAI : curlAnthropic;

  const execute = async () => {
    if (!apiKey.trim()) {
      setResult(t("ep.enterApiKeyFirst"));
      setStatus(null);
      return;
    }
    setRunning(true);
    setResult("");
    setStatus(null);
    try {
      const endpoint = format === "openai" ? "/v1/chat/completions" : "/anthropic/v1/messages";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (format === "openai") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      } else {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      }
      const body = format === "openai"
        ? { model: defaultModel, messages: [{ role: "user", content: "hello" }] }
        : { model: defaultModel, max_tokens: 100, messages: [{ role: "user", content: "hello" }] };

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      setStatus(res.status);
      const text = await res.text();
      try { setResult(JSON.stringify(JSON.parse(text), null, 2)); }
      catch { setResult(text); }
    } catch (err: unknown) {
      setStatus(0);
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="info-box" style={{ borderRadius: "var(--radius)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => { setFormat("openai"); setResult(""); setStatus(null); }}
            style={{
              padding: "4px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)",
              border: "1px solid var(--accent)",
              background: format === "openai" ? "var(--accent)" : "transparent",
              color: format === "openai" ? "#fff" : "var(--accent)",
            }}
          >
            OpenAI
          </button>
          <button
            onClick={() => { setFormat("anthropic"); setResult(""); setStatus(null); }}
            style={{
              padding: "4px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
              border: "1px solid var(--amber)",
              background: format === "anthropic" ? "var(--amber)" : "transparent",
              color: format === "anthropic" ? "#fff" : "var(--amber)",
            }}
          >
            Anthropic
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => navigator.clipboard.writeText(curlCmd)}
            className="btn btn-sm"
            style={{ fontSize: "11px", padding: "3px 10px", border: "1px solid var(--border)" }}
          >
            {t("ep.copyCurl")}
          </button>
          <button
            onClick={execute}
            disabled={running}
            className="btn btn-sm"
            style={{
              fontSize: "11px", padding: "3px 14px",
              background: running ? "var(--muted)" : "var(--green)",
              color: "#fff", border: "none", borderRadius: "var(--radius-sm)",
              cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running ? t("ep.running") : t("ep.run")}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
          {t("ep.testApiKey")}
        </label>
        <input
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t("ep.testApiKeyHint")}
          style={{
            width: "100%", padding: "8px 12px", fontSize: "13px",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg)", color: "var(--fg)", boxSizing: "border-box",
          }}
        />
      </div>

      <pre style={{
        margin: "0 0 12px", padding: "12px", fontSize: "12px", lineHeight: "1.6",
        background: "oklch(25% 0.01 250)", color: "oklch(90% 0.01 100)",
        borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}>
        <code>{curlCmd}</code>
      </pre>

      {status !== null && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px",
            fontSize: "12px", fontWeight: 600,
            color: status >= 200 && status < 300 ? "var(--green)" : "var(--red)",
          }}>
            <span>HTTP {status === 0 ? "Error" : status}</span>
            {status >= 200 && status < 300 && <span>{t("ep.testSuccessLabel")}</span>}
            {status >= 400 && <span>{t("ep.testFailLabel")}</span>}
          </div>
          <pre style={{
            margin: 0, padding: "12px", fontSize: "12px", lineHeight: "1.5",
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", overflowX: "auto", whiteSpace: "pre-wrap",
            wordBreak: "break-all", maxHeight: "300px", overflowY: "auto",
          }}>
            <code>{result || t("logs.emptyResponse")}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

interface EditModalProps {
  endpoint: Endpoint;
  onClose: () => void;
  onSaved: () => void;
  token: string;
}

function EditModal({ endpoint, onClose, onSaved, token }: EditModalProps) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(endpoint.display_name || "");
  const [providerFormat, setProviderFormat] = useState(endpoint.provider_format || "");
  const [endpointUrl, setEndpointUrl] = useState(endpoint.endpoint_url || "");
  const [modelName, setModelName] = useState(endpoint.model_name || "");
  const parsedModels = (() => {
    try { return endpoint.models ? JSON.parse(endpoint.models) : []; }
    catch { return []; }
  })();
  const [extraModels, setExtraModels] = useState<string[]>(
    parsedModels.filter((m: string) => m !== endpoint.model_name)
  );
  const [newModelInput, setNewModelInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priceInputPerM, setPriceInputPerM] = useState(String(endpoint.price_input_per_m ?? ""));
  const [priceOutputPerM, setPriceOutputPerM] = useState(String(endpoint.price_output_per_m ?? ""));
  const [priceCacheInputPerM, setPriceCacheInputPerM] = useState(String(endpoint.price_cache_input_per_m ?? ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Testing state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const testConnection = async () => {
    const testUrl = endpointUrl;
    const testKey = apiKey || endpoint.api_key_masked;
    if (!testUrl || !testKey || testKey === endpoint.api_key_masked) {
      setError("Please enter the API Key to test");
      return;
    }
    setError("");
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch("/api/endpoints/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          base_url: testUrl,
          api_key: testKey,
          model_name: modelName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, msg: data.error || t("ep.testFailed") });
        return;
      }
      setTestResult({
        ok: true,
        msg: t("ep.testSuccess", { latency: data.latency_ms, model: data.model_used }),
      });
    } catch (err) {
      console.error("Test connection failed:", err);
      setTestResult({ ok: false, msg: t("ep.testNetworkError") });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Build models array from default + extra, deduped
      const modelsFromInput = extraModels.length
        ? [...new Set([modelName, ...extraModels])]
        : [modelName];

      const payload: Record<string, unknown> = {
        display_name: displayName,
        provider_name: displayName || providerFormat,
        provider_format: providerFormat,
        provider_key: providerFormat === "openai" ? "O" : providerFormat === "anthropic" ? "A" : "",
        endpoint_url: endpointUrl,
        model_name: modelName,
        models: JSON.stringify(modelsFromInput),
        price_input_per_m: priceInputPerM ? parseFloat(priceInputPerM) : 0,
        price_output_per_m: priceOutputPerM ? parseFloat(priceOutputPerM) : 0,
        price_cache_input_per_m: priceCacheInputPerM ? parseFloat(priceCacheInputPerM) : 0,
      };
      // Only send api_key when the admin entered a new value.
      if (apiKey) payload.api_key = apiKey;

      const res = await fetch(`/api/endpoints/${endpoint.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || t("ep.updateFailed"));
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError(t("ep.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="card modal"
        style={{ width: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{t("ep.editEndpoint")}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {error && <div className="alert alert-error">{error}</div>}

          <div>
            <label className="field-label">{t("ep.customName")}</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="input" />
          </div>

          <div>
            <label className="field-label">{t("ep.providerFormat")}</label>
            <select
              value={providerFormat}
              onChange={(e) => setProviderFormat(e.target.value)}
              required
              className="input"
            >
              <option value="">{t("ep.providerFormatHint")}</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          <div>
            <label className="field-label">Base URL *</label>
            <input type="url" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} required className="input" />
          </div>

          <div>
            <label className="field-label">API Key <span style={{ fontWeight: 400 }}>{t("ep.apiKeyEditHint")}</span></label>
            <input type="password" placeholder={endpoint.api_key_masked || "sk-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="input" />
          </div>

          <div>
            <label className="field-label">{t("ep.model")}</label>
            <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} required className="input" />
          </div>

          {/* Extra Models */}
          <div>
            <label className="field-label">{t("ep.models")}</label>
            {extraModels.length > 0 && (
              <div className="chips" style={{ marginTop: 0 }}>
                {extraModels.map((m, i) => (
                  <span key={i} className="chip">
                    {m}
                    <button
                      type="button"
                      onClick={() => setExtraModels(extraModels.filter((_, j) => j !== i))}
                      className="chip-x"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                placeholder={t("ep.modelsHint")}
                value={newModelInput}
                onChange={(e) => setNewModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = newModelInput.trim();
                    if (val && val !== modelName && !extraModels.includes(val)) {
                      setExtraModels([...extraModels, val]);
                      setNewModelInput("");
                    }
                  }
                }}
                className="input" style={{ flex: 1, fontSize: "12px" }}
              />
              <button
                type="button"
                onClick={() => {
                  const val = newModelInput.trim();
                  if (val && val !== modelName && !extraModels.includes(val)) {
                    setExtraModels([...extraModels, val]);
                    setNewModelInput("");
                  }
                }}
                disabled={!newModelInput.trim()}
                style={{
                  padding: "6px 14px", fontSize: "13px", fontWeight: 600,
                  background: newModelInput.trim() ? "var(--accent)" : "var(--muted)",
                  color: "#fff", border: "none", borderRadius: "var(--radius-sm)",
                  cursor: newModelInput.trim() ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                }}
              >
                + {t("ep.add").replace("+ ", "")}
              </button>
            </div>
          </div>

          <div className="info-box" style={{ padding: 12 }}>
            <div style={{ fontSize: "12px", fontWeight: 650, marginBottom: "8px", color: "var(--fg)" }}>{t("ep.pricingConfig")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label className="field-label">{t("ep.priceInput")}</label>
                <input type="number" step="0.000001" placeholder="0.00" value={priceInputPerM} onChange={(e) => setPriceInputPerM(e.target.value)} className="input" />
              </div>
              <div>
                <label className="field-label">{t("ep.priceOutput")}</label>
                <input type="number" step="0.000001" placeholder="0.00" value={priceOutputPerM} onChange={(e) => setPriceOutputPerM(e.target.value)} className="input" />
              </div>
              <div>
                <label className="field-label">{t("ep.priceCacheInput")}</label>
                <input type="number" step="0.000001" placeholder="0.00" value={priceCacheInputPerM} onChange={(e) => setPriceCacheInputPerM(e.target.value)} className="input" />
              </div>
            </div>
          </div>

          {/* Test Connection */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !endpointUrl || (!apiKey && !endpoint.api_key_masked)}
              className="btn btn-sm"
              style={{
                fontSize: "12px",
                padding: "6px 16px",
                opacity: testing ? 0.6 : 1,
                background: testing ? "var(--muted)" : "var(--green)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: testing ? "not-allowed" : "pointer",
              }}
            >
              {testing ? t("ep.testConnecting") : t("ep.testConnection")}
            </button>
            {testResult && (
              <span style={{
                fontSize: "12px",
                color: testResult.ok ? "var(--green)" : "var(--red)",
                fontWeight: 500,
              }}>
                {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" className="btn" style={{ border: "1px solid var(--border)" }} onClick={onClose}>
              {t("ep.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t("ep.saving") : t("ep.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Endpoints({ token }: { token: string }) {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const copyCell = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCell(key);
    setTimeout(() => setCopiedCell((c) => (c === key ? null : c)), 1200);
  };

  // Column widths (px) — 6 columns, icon buttons
  const { widths, onMouseDown, resizingRef } = useColumnResize([
    140,  // Name
    110,  // Provider
    330,  // Endpoint URL — generous
    190,  // Model
    90,   // Status
    120,  // Actions (icons: test / edit / delete)
  ]);

  const fetchEndpoints = () => {
    fetch("/api/endpoints", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEndpoints(data);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchEndpoints();
  }, []);

  const toggleEnabled = async (ep: Endpoint) => {
    const newEnabled = ep.enabled ? 0 : 1;
    await fetch(`/api/endpoints/${ep.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    fetchEndpoints();
  };

  const handleDelete = async (ep: Endpoint) => {
    const name = ep.display_name || ep.provider_name;
    if (!confirm(t("ep.deleteConfirm", { name }))) return;
    const res = await fetch(`/api/endpoints/${ep.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      if (expandedId === ep.id) setExpandedId(null);
      fetchEndpoints();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || t("ep.deleteFailed"));
    }
  };

  const providerColor = (format: string) => {
    if (format === "openai") return "#10a37f";
    if (format === "anthropic") return "#d97757";
    return "var(--accent)";
  };

  const formatLabel = (format: string) => {
    if (format === "openai") return "OA";
    if (format === "anthropic") return "AN";
    return format?.slice(0, 2).toUpperCase() || "??";
  };

  return (
    <section className="section active page">
      <div className="page-header">
        <div className="page-title">
          <h2>{t("ep.pageTitle")}</h2>
          <p>{t("ep.title")}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>{t("ep.add")}</button>
      </div>
      <div className="table-wrap">
        <table>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {[
                t("ep.colName"),
                t("ep.colProvider"),
                t("ep.colEndpointUrl"),
                t("ep.colModel"),
                t("ep.colStatus"),
                t("ep.colActions"),
              ].map((label, idx) => (
                <th key={idx}>
                  {label}
                  <div
                    className={`col-resize-handle${resizingRef.current?.idx === idx ? " active" : ""}`}
                    onMouseDown={(e) => onMouseDown(idx, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {endpoints.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state" style={{ overflow: "visible", whiteSpace: "normal" }}>{t("ep.noEndpoints")}</td>
              </tr>
            ) : endpoints.map((ep) => (
              <Fragment key={ep.id}>
              <tr className="table-row-interactive">
                <td style={{ fontWeight: 600 }} title={ep.display_name || ep.provider_name}>{ep.display_name || ep.provider_name}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "4px",
                        display: "grid",
                        placeItems: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "10px",
                        flexShrink: 0,
                        background: providerColor(ep.provider_format),
                      }}
                    >
                      {formatLabel(ep.provider_format)}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", textTransform: "capitalize" }}>{ep.provider_format || ep.provider_name}</span>
                  </div>
                </td>
                <td
                  className={`mono ${copiedCell === `url-${ep.id}` ? "cell-copied" : ""}`}
                  title={`${ep.endpoint_url}  — ${t("ep.copy")}`}
                  style={{ cursor: "pointer", position: "relative" }}
                  onClick={() => copyCell(`url-${ep.id}`, ep.endpoint_url)}
                >
                  {copiedCell === `url-${ep.id}` && <span className="copy-indicator">✓</span>}
                  {ep.endpoint_url}
                </td>
                <td
                  className={`mono ${copiedCell === `model-${ep.id}` ? "cell-copied" : ""}`}
                  title={(() => {
                    try { return JSON.parse(ep.models || '[]').join(", "); }
                    catch { return ep.model_name; }
                  })()}
                  style={{ fontSize: "12px", cursor: "pointer", position: "relative" }}
                  onClick={() => copyCell(`model-${ep.id}`, ep.model_name)}
                >
                  {copiedCell === `model-${ep.id}` && <span className="copy-indicator">✓</span>}
                  {(() => {
                    try {
                      const models = JSON.parse(ep.models || '[]');
                      if (models.length > 1) return `${models[0]} +${models.length - 1}`;
                      return models[0] || ep.model_name || "—";
                    } catch { return ep.model_name || "—"; }
                  })()}
                </td>
                <td>
                  <span className={`cell-status ${ep.status === "healthy" ? "ok" : "err"}`}>
                    {ep.status === "healthy" ? t("ep.statusHealthy") : t("ep.statusUnhealthy")}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    {/* Test */}
                    <button
                      onClick={() => setExpandedId(expandedId === ep.id ? null : ep.id)}
                      title={t("ep.testBtn").replace(/^[🧪 ]+/, "")}
                      className={`btn-icon ${expandedId === ep.id ? "active" : ""}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={expandedId === ep.id ? "#fff" : "var(--accent)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 3H15M10 21H14M12 17V11"/>
                        <path d="M8 3h8l-1 5H9L8 3Z"/>
                        <path d="M10 8h4l-.8 3.2a4 4 0 0 1-2.4 0L10 8Z"/>
                      </svg>
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => setEditing(ep)}
                      title={t("ep.edit")}
                      className="btn-icon"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(ep)}
                      title={t("ep.delete")}
                      className="btn-icon btn-icon-danger"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
              {expandedId === ep.id && (
                <tr key={`${ep.id}-test`}>
                  <td colSpan={6} style={{ padding: "0 8px 12px", overflow: "visible", whiteSpace: "normal" }}>
                    <TestPanel ep={ep} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddModal onClose={() => setShowModal(false)} onCreated={fetchEndpoints} token={token} />
      )}

      {editing && (
        <EditModal
          endpoint={editing}
          onClose={() => setEditing(null)}
          onSaved={fetchEndpoints}
          token={token}
        />
      )}
    </section>
  );
}
