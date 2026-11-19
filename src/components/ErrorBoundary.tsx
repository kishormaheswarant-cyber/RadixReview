import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMessage = error.message || 'An unexpected error occurred.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; path?: string; operationType?: string };
      if (parsed && parsed.error) {
        displayMessage = `${parsed.error}${parsed.path ? ` (${parsed.operationType || 'operation'} on ${parsed.path})` : ''}`;
      }
    } catch {
      // plain error message
    }
    return { hasError: true, message: displayMessage };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Radix ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF9F6] text-[#111315] flex items-center justify-center px-6">
          <div className="max-w-lg w-full bg-white border border-[#E6E4DF] rounded-2xl p-8 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
              Application Recovery
            </p>
            <h1 className="font-display text-2xl font-bold text-[#111315]">
              Something went wrong
            </h1>
            <p className="text-sm text-[#5C626B] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-[#111315] hover:bg-[#272A2E] rounded-lg transition-colors"
            >
              Reload Radix
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
