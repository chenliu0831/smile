/**
 * A render error boundary. Without one, ANY throw while rendering (e.g. a malformed agent
 * artifact — a bad report/table/chart/image) unmounts the whole React tree, which runs
 * useRun's cleanup and CLOSES the daemon WebSocket — so a single bad artifact during a
 * "summarize" turn crashed the app and dropped the live agent connection. Wrapping the
 * volatile regions (the artifact canvas, the SQL console) contains a throw to that region:
 * the rest of the app — crucially the chat + its WebSocket — keeps running.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Short label for what failed, shown in the fallback (e.g. "this view"). */
  label?: string;
  /** Reset the boundary when this value changes (e.g. the active artifact ref / view),
   * so navigating away from a bad artifact recovers without a reload. */
  resetKey?: unknown;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for debugging; the chat/WebSocket are unaffected.
    console.error("Render error contained by ErrorBoundary:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-title">⚠ Couldn’t render {this.props.label ?? "this"}.</div>
          <div className="error-boundary-msg">{this.state.error.message}</div>
          <div className="error-boundary-hint">The agent and chat are still connected — try another view or re-run.</div>
        </div>
      );
    }
    return this.props.children;
  }
}
