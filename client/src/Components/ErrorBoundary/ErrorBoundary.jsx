import React from "react";

/**
 * Without this, an uncaught render error anywhere in the tree unmounts the
 * whole app — a blank white screen with nothing in the UI to explain why.
 * This catches it, logs the real error to the console, and shows something
 * a person can act on instead.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Stashr crashed while rendering:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem", background: "#07061A", color: "#e8e8f2" }}>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.6rem" }}>Something broke while loading the page</h1>
          <p style={{ opacity: 0.75, marginBottom: "1.2rem", fontSize: "0.9rem", lineHeight: 1.6 }}>
            Your data is safe — this is a display bug, not a data problem. Reloading usually fixes it.
            If it keeps happening, open the browser console (F12) and send the error shown there.
          </p>
          <details style={{ textAlign: "left", marginBottom: "1.2rem", fontSize: "0.78rem", opacity: 0.65 }}>
            <summary style={{ cursor: "pointer" }}>Technical details</summary>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "0.5rem" }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </details>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: "0.7rem 1.6rem", borderRadius: 999, border: "none", background: "#6d7cff", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
