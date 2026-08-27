import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info);
  }

  override render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: "2rem",
          textAlign: "center",
          color: "var(--muted)",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠</div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 650, color: "var(--fg)", marginBottom: "0.5rem" }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: "0.85rem", maxWidth: "420px", lineHeight: 1.6 }}>
            {this.state.error.message || "An unexpected error occurred"}
          </p>
          <button
            className="btn"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style={{ marginTop: "1.2rem" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
