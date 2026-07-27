import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
import { useTranslation } from "../i18n";
import type { Session, Message, AssistantResponse, ContentBlock } from "../types";

marked.use(markedKatex({ throwOnError: false, output: "html" }));

// ====================== SessionBar ======================
interface SessionBarProps {
  sessions: Session[];
  activeSessionId: string;
  onSelect: (id: string) => void;
}

function SessionBar({ sessions, activeSessionId, onSelect }: SessionBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const filtered = sessions.filter(
    (s) =>
      s.id.toLowerCase().includes(search.toLowerCase()) ||
      s.title.toLowerCase().includes(search.toLowerCase())
  );

  const dotClass = (status: string) => {
    if (status === "live") return "live";
    if (status === "error") return "error";
    return "idle";
  };

  return (
    <div className="session-bar">
      <span className="sb-label">Session</span>
      <div className="sb-select" ref={ref}>
        <button
          className={`sb-trigger${open ? " open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <span className={`si-dot ${active ? dotClass(active.status) : "live"}`} />
          <span className="si-name">{active?.title || t("session.selectSession")}</span>
          <span className="si-provider">{active?.provider || ""}</span>
          <span className="si-chevron">▾</span>
        </button>
        <div className={`sb-dropdown${open ? " open" : ""}`}>
          <div className="sb-search">
            <input
              type="text"
              placeholder={t("session.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div>
            {filtered.map((s) => (
              <div
                key={s.id}
                className={`sb-item${s.id === activeSessionId ? " active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(s.id);
                  setOpen(false);
                }}
              >
                <span className={`si-dot ${dotClass(s.status)}`} />
                <div className="si-info">
                  <div className="si-title">{s.title}</div>
                  <div className="si-sub">
                    {s.provider} · {s.model}
                  </div>
                </div>
                <span className="si-time">
                  {s.updated_at
                    ? parseTime(s.updated_at)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="session-stats">
        <div className="ss-item">
          <div className="ss-val">{active?.tokens?.toLocaleString() || "—"}</div>
          <div className="ss-lbl">Tokens</div>
        </div>
        <div className="ss-item">
          <div className="ss-val">
            {(() => {
              if (!active) return "—";
              const hit = active.cache_hit_tokens || 0;
              const miss = active.cache_miss_tokens || 0;
              const total = hit + miss;
              return total > 0 ? `${Math.round((hit / total) * 100)}%` : "—";
            })()}
          </div>
          <div className="ss-lbl">{t("session.cacheHitRate")}</div>
        </div>
        <div className="ss-item">
          <div className="ss-val">{active?.latency || "—"}</div>
          <div className="ss-lbl">{t("usage.avgLatency")}</div>
        </div>
        <div className="ss-item">
          <div className="ss-val">{active?.cost || "—"}</div>
          <div className="ss-lbl">{t("logs.cost")}</div>
        </div>
      </div>
    </div>
  );
}

// ====================== Content parsing ======================
interface ParsedMessage {
  /** Structured assistant payload (from finalizeSession). */
  structured: AssistantResponse | null;
  /** Plain or parsed content blocks for rendering. */
  blocks: ContentBlock[];
  /** Raw fallback text when nothing else can be derived. */
  fallbackText: string;
}

function isContentBlock(v: unknown): v is ContentBlock {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

function parseMessage(content: string, role: Message["role"]): ParsedMessage {
  const fallback: ParsedMessage = { structured: null, blocks: [], fallbackText: content };

  // 1) Try JSON
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return fallback; }

  // 2) Structured assistant response (saved by finalizeSession)
  if (
    role === "assistant" &&
    parsed && typeof parsed === "object" &&
    typeof (parsed as { text?: unknown }).text === "string"
  ) {
    const ar = parsed as AssistantResponse;
    const blocks: ContentBlock[] = [];
    if (ar.thinking) blocks.push({ type: "thinking", thinking: ar.thinking });
    if (ar.text) blocks.push({ type: "text", text: ar.text });
    if (ar.tool_calls) blocks.push(...ar.tool_calls);
    return { structured: ar, blocks, fallbackText: ar.text || "" };
  }

  // 3) Anthropic/OpenAI content-blocks array
  if (Array.isArray(parsed) && parsed.every(isContentBlock)) {
    return { structured: null, blocks: parsed as ContentBlock[], fallbackText: "" };
  }

  // 4) Single block object
  if (isContentBlock(parsed)) {
    return { structured: null, blocks: [parsed as ContentBlock], fallbackText: "" };
  }

  return fallback;
}

// ====================== Helpers ======================
function formatJSON(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function previewToolInput(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return "";
  const keys = Object.keys(input);
  const head = keys.slice(0, 2).map((k) => {
    const v = input[k];
    const sv = typeof v === "string" ? v : JSON.stringify(v);
    const trimmed = sv.length > 40 ? sv.slice(0, 40) + "…" : sv;
    return `${k}=${trimmed}`;
  });
  return head.join(", ") + (keys.length > 2 ? ` +${keys.length - 2}` : "");
}

function flattenToolResult(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      if (b.type === "text") return (b as { text: string }).text;
      if (b.type === "image") return "[image]";
      return formatJSON(b);
    })
    .join("\n");
}

// ====================== Renderers ======================
function normalizeLatex(text: string): string {
  // Convert \[...\] → $$...$$ and \(...\) → $...$
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, math) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, math) => `$${math}$`);
}

function RichText({ text }: { text: string }) {
  if (!text) return null;
  const html = marked.parse(normalizeLatex(text), { async: false }) as string;
  return <div className="msg-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="msg-thinking">
      <button className="msg-thinking-header" onClick={() => setOpen(!open)}>
        <span className="msg-thinking-arrow">{open ? "▾" : "▸"}</span>
        <span>{t("session.thinking")}</span>
      </button>
      {open && <div className="msg-thinking-content">{text}</div>}
    </div>
  );
}

function SystemBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 100);
  return (
    <div className="msg-system-block">
      <button className="msg-system-header" onClick={() => setOpen(!open)}>
        <span className="msg-system-arrow">{open ? "▾" : "▸"}</span>
        <span>{t("session.system")}</span>
        {!open && <span className="msg-system-preview">{preview}{text.length > 100 ? "…" : ""}</span>}
      </button>
      {open && <div className="msg-system-content"><RichText text={text} /></div>}
    </div>
  );
}

function ToolUseCard({ block }: { block: Extract<ContentBlock, { type: "tool_use" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = previewToolInput(block.input);
  return (
    <div className="tool-card">
      <button className="tool-card-header" onClick={() => setOpen(!open)}>
        <span className="tool-card-icon">⚙</span>
        <span className="tool-card-label">{t("session.toolCall")}</span>
        <span className="tool-card-name">{block.name}</span>
        {preview && <span className="tool-card-preview">{preview}</span>}
        <span className="tool-card-arrow">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="tool-card-body">
          <div className="tool-card-section-label">{t("session.viewInput")}</div>
          <pre className="tool-card-code">{formatJSON(block.input ?? {})}</pre>
          {block.id && <div className="tool-card-id">id: {block.id}</div>}
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ block }: { block: Extract<ContentBlock, { type: "tool_result" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const flat = flattenToolResult(block.content);
  const isError = !!block.is_error;
  const preview = flat.replace(/\s+/g, " ").trim().slice(0, 80);
  return (
    <div className={`tool-card result${isError ? " error" : ""}`}>
      <button className="tool-card-header" onClick={() => setOpen(!open)}>
        <span className="tool-card-icon">{isError ? "✕" : "↩"}</span>
        <span className="tool-card-label">
          {isError ? t("session.toolError") : t("session.toolResult")}
        </span>
        {preview && <span className="tool-card-preview">{preview}{flat.length > 80 ? "…" : ""}</span>}
        <span className="tool-card-arrow">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="tool-card-body">
          <pre className="tool-card-code">{flat}</pre>
          {block.tool_use_id && <div className="tool-card-id">tool_use_id: {block.tool_use_id}</div>}
        </div>
      )}
    </div>
  );
}

function BlocksRenderer({ blocks, role }: { blocks: ContentBlock[]; role?: Message["role"] }) {
  const { t } = useTranslation();
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text": {
            const text = (b as { text: string }).text;
            if (!text) return null;
            // Render system messages in collapsible block
            if (role === "system") {
              return <SystemBlock key={i} text={text} />;
            }
            return <RichText key={i} text={text} />;
          }
          case "thinking":
            return <ThinkingBlock key={i} text={(b as { thinking: string }).thinking || ""} />;
          case "tool_use":
            return <ToolUseCard key={i} block={b as Extract<ContentBlock, { type: "tool_use" }>} />;
          case "tool_result":
            return <ToolResultCard key={i} block={b as Extract<ContentBlock, { type: "tool_result" }>} />;
          case "image":
            return (
              <div key={i} className="msg-bubble msg-image-placeholder">
                <span className="msg-image-icon">🖼</span> {t("session.image")}
              </div>
            );
          default:
            return (
              <div key={i} className="msg-bubble">
                <pre className="msg-code">{formatJSON(b)}</pre>
              </div>
            );
        }
      })}
    </>
  );
}

// ====================== UsageFooter ======================
function UsageFooter({
  usage,
  model,
  stopReason,
}: {
  usage?: AssistantResponse["usage"];
  model?: string;
  stopReason?: string;
}) {
  const { t } = useTranslation();
  if (!usage && !model && !stopReason) return null;
  return (
    <div className="msg-footer">
      {model && <span className="msg-footer-item msg-model-badge">{model}</span>}
      {usage && (
        <>
          <span className="msg-footer-item">
            {t("session.input")} {usage.input_tokens.toLocaleString()}
          </span>
          <span className="msg-footer-item">
            {t("session.output")} {usage.output_tokens.toLocaleString()}
          </span>
          {(usage.cache_read_input_tokens ?? 0) > 0 && (
            <span className="msg-footer-item msg-cache-hit">
              {t("session.cacheHit")} {usage.cache_read_input_tokens!.toLocaleString()}
            </span>
          )}
          {(usage.cache_creation_input_tokens ?? 0) > 0 && (
            <span className="msg-footer-item msg-cache-miss">
              {t("session.cacheWrite")} {usage.cache_creation_input_tokens!.toLocaleString()}
            </span>
          )}
        </>
      )}
      {stopReason && <span className="msg-footer-item msg-stop-reason">{stopReason}</span>}
    </div>
  );
}

// ====================== ChatPanel ======================
interface ChatPanelProps {
  messages: Message[];
  session: Session | null;
}

function parseTime(ts: string | undefined): Date | null {
  if (!ts) return null;
  // SQLite stores UTC timestamps. Old format: "2026-07-27 09:22:12" (no TZ).
  // New format: "2026-07-27T09:22:12Z" (ISO with Z suffix).
  // JavaScript parses tz-less strings as local time, so normalize to ISO.
  const s = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  try { return new Date(s); } catch { return null; }
}

function formatTime(ts: string | undefined): string {
  const d = parseTime(ts);
  return d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

function ChatPanel({ messages, session }: ChatPanelProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const newCount = messages.length;
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = newCount;

    // Only auto-scroll when new messages arrive
    if (newCount <= prevCount) return;

    // Don't interrupt if user has scrolled up to read history
    // (threshold: more than 100px from the bottom)
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 100) return;

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Pre-parse messages once per change
  const parsed = useMemo(
    () => messages.map((m) => ({ msg: m, parsed: parseMessage(m.content, m.role) })),
    [messages]
  );

  if (!session) {
    return (
      <div className="chat-panel">
        <div className="chat-empty">
          <div style={{ fontSize: "2.5rem", marginBottom: "0.8rem", opacity: 0.4 }}>⚡</div>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--fg)", marginBottom: "0.3rem" }}>
            {t("session.emptyHint1")}
          </div>
          <div style={{ color: "var(--muted)" }}>
            {t("session.emptyHint2")}
          </div>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-panel">
        <div className="chat-empty">
          <div style={{ fontSize: "2.5rem", marginBottom: "0.6rem", opacity: 0.4 }}>💬</div>
          {t("session.noMessages")}
        </div>
      </div>
    );
  }

  const providerClass = session.provider === "OpenAI" ? "openai" : "anthropic";
  const providerAbbr = session.provider === "OpenAI" ? "OA" : "AN";

  const roleAvatar = (role: Message["role"]) =>
    role === "user" ? "U" : role === "assistant" ? providerAbbr : role === "tool_result" ? "↩" : "SYS";
  const roleAvatarClass = (role: Message["role"]) =>
    role === "user" ? "user" : role === "assistant" ? `assistant ${providerClass}` : role === "tool_result" ? "tool_result" : "system";
  const roleLabel = (role: Message["role"]) =>
    role === "user"
      ? t("session.roleUser")
      : role === "assistant"
      ? t("session.roleAssistant")
      : role === "tool_result"
      ? t("session.roleToolResult")
      : t("session.roleSystem");

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={containerRef}>
        {parsed.map(({ msg, parsed: p }) => {
          const isAssistant = msg.role === "assistant";
          const hasData = isAssistant && msg.tokens > 0;
          const isBlocked = isAssistant && msg.tokens === 0 && !p.structured && p.blocks.length === 0;
          const blocks = p.blocks;
          const fallback = p.fallbackText;
          const time = formatTime(msg.created_at);

          return (
            <div key={msg.id} className={`msg-row ${msg.role}`}>
              <div className={`msg-avatar ${roleAvatarClass(msg.role)}`}>{roleAvatar(msg.role)}</div>
              <div className="msg-body">
                <div className="msg-headline">
                  <span className="msg-role">{roleLabel(msg.role)}</span>
                  {time && <span className="msg-time">{time}</span>}
                </div>

                {blocks.length > 0 ? (
                  <BlocksRenderer blocks={blocks} role={msg.role} />
                ) : fallback ? (
                  msg.role === "system" ? <SystemBlock text={fallback} /> : <RichText text={fallback} />
                ) : null}

                {p.structured && (
                  <UsageFooter
                    usage={p.structured.usage}
                    model={p.structured.model}
                    stopReason={p.structured.stop_reason}
                  />
                )}

                {(hasData || isBlocked) && (
                  <div className="msg-meta">
                    {hasData && <span className="msg-tokens">{msg.tokens} tokens</span>}
                    {hasData && <span className="msg-latency">{msg.latency}</span>}
                    {isBlocked && <span className="msg-error">{t("session.blocked")}</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {session.status === "live" && (
          <div className="msg-row assistant">
            <div className={`msg-avatar assistant ${providerClass}`}>{providerAbbr}</div>
            <div className="msg-body">
              <div className="msg-bubble" style={{ padding: "10px 14px" }}>
                <div className="typing-indicator">
                  <div className="dot" />
                  <div className="dot" />
                  <div className="dot" />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ====================== SessionMonitor ======================
interface SessionMonitorProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  messages: Message[];
  token: string;
}

export function SessionMonitor({
  sessions,
  activeSessionId,
  onSelectSession,
  messages,
}: SessionMonitorProps) {
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  return (
    <section className="section active" style={{ display: "flex", flexDirection: "column" }}>
      <div className="session-monitor">
        <SessionBar sessions={sessions} activeSessionId={activeSessionId} onSelect={onSelectSession} />
        <ChatPanel messages={messages} session={activeSession} />
      </div>
    </section>
  );
}
