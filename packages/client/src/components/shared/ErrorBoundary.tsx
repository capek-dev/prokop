import { Component, type ReactNode } from 'react';

import {
  isLikelyStaleBuildError,
  reloadJean2,
  resetDownloadedAppFiles,
} from '@/pwa/recovery';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: unknown;
  isRecovering: boolean;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  const message = typeof value === 'string' ? value : String(value);
  return new Error(message || 'Unknown error');
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, isRecovering: false };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error, isRecovering: false };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    const err = toError(error);
    console.error('[ErrorBoundary] Caught render error:', err.message);
    console.error('[ErrorBoundary] Original error type:', typeof error);
    if (error instanceof Error) {
      console.error('[ErrorBoundary] Original error name:', error.name);
      console.error('[ErrorBoundary] Original error message:', error.message);
    }
    console.error('[ErrorBoundary] Original error value:', error);
    if (errorInfo && typeof errorInfo === 'object' && 'componentStack' in errorInfo) {
      console.error('[ErrorBoundary] Component stack:', (errorInfo as React.ErrorInfo).componentStack);
    }
    console.error('[ErrorBoundary] Error stack:', err.stack);
  }

  private handleReload = (): void => {
    this.setState({ isRecovering: true });
    void reloadJean2();
  };

  private handleReset = (): void => {
    const confirmed = window.confirm(
      'Reset Prokopai downloaded app files? Your drafts, settings, and server data will be kept.',
    );
    if (!confirmed) return;

    this.setState({ isRecovering: true });
    void resetDownloadedAppFiles();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const err = toError(this.state.error);
      const isStaleBuildError = isLikelyStaleBuildError(err);

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
            background: 'var(--vscode-editor-background, #1e1e1e)',
            color: 'var(--vscode-editor-foreground, #d4d4d4)',
          }}
        >
          <div style={{ maxWidth: '600px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--vscode-descriptionForeground, #989898)',
                marginBottom: '1rem',
                wordBreak: 'break-word',
              }}
            >
              {isStaleBuildError
                ? 'Prokopai could not load the downloaded app files. Reload to use a consistent version.'
                : err.message || 'Unknown error'}
            </p>
            <pre
              style={{
                fontSize: '0.75rem',
                textAlign: 'left',
                background: 'var(--vscode-textCodeBlock-background, #1a1a1a)',
                padding: '1rem',
                borderRadius: '0.5rem',
                overflow: 'auto',
                maxHeight: '300px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {err.stack || 'No stack trace available'}
            </pre>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginTop: '1rem',
              }}
            >
              <button
                onClick={isStaleBuildError
                  ? this.handleReload
                  : () => this.setState({ hasError: false, error: null, isRecovering: false })}
                disabled={this.state.isRecovering}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--vscode-button-border, #444)',
                  background: 'var(--vscode-button-background, #0078d4)',
                  color: 'var(--vscode-button-foreground, white)',
                  cursor: this.state.isRecovering ? 'default' : 'pointer',
                  fontSize: '0.875rem',
                  opacity: this.state.isRecovering ? 0.6 : 1,
                }}
              >
                {isStaleBuildError
                  ? (this.state.isRecovering ? 'Reloading...' : 'Reload Prokopai')
                  : 'Try Again'}
              </button>
              {isStaleBuildError && (
                <button
                  onClick={this.handleReset}
                  disabled={this.state.isRecovering}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '0.375rem',
                    border: '1px solid var(--vscode-button-border, #444)',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: this.state.isRecovering ? 'default' : 'pointer',
                    fontSize: '0.875rem',
                    opacity: this.state.isRecovering ? 0.6 : 1,
                  }}
                >
                  Reset downloaded app files
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
