import { Component, type ReactNode } from 'react';

/** Asks before anything leaves the computer: the report opens in your browser, and you choose whether to submit it. */
export function ReportButton({ error, where }: { error: Error; where?: string }) {
  if (typeof window.hub?.reportProblem !== 'function') return null;
  return (
    <button className="button" onClick={() => window.hub.reportProblem({ message: error.message, stack: error.stack, where })}>
      Report this problem
    </button>
  );
}

/**
 * If a page of Life Hub breaks, show what happened and a way back instead of
 * a blank window. "Report this problem" opens a filled-in GitHub issue in the
 * browser; nothing is sent unless you submit it there.
 */
export class CrashScreen extends Component<{ where?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong</h2>
        <p className="muted">{error.message || 'Life Hub hit an error.'}</p>
        <div className="crash-buttons">
          <button className="button button-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="button" onClick={() => window.location.reload()}>
            Reload Life Hub
          </button>
          <ReportButton error={error} where={this.props.where} />
        </div>
        <p className="muted small">Reporting opens a GitHub page in your browser with the error filled in. You can read and edit it first; nothing is sent unless you click Submit.</p>
      </div>
    );
  }
}
