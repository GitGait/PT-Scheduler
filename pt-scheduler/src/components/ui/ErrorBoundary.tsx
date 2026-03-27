import { Component, ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; errorMessage: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || "Unknown error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="m-4 rounded border border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-100 p-4 space-y-3"
        >
          <p className="font-medium">Something went wrong.</p>
          {this.state.errorMessage && (
            <p className="text-sm opacity-80">{this.state.errorMessage}</p>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

