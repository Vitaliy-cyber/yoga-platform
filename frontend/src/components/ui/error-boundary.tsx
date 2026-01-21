import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./button";
import { logger } from "../../lib/logger";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
  resetButtonText?: string;
  errorTitle?: string;
  errorDescription?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component to catch JavaScript errors in child components.
 * Prevents entire application from crashing when a component fails.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error for debugging - this goes to error level so it's always shown
    logger.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      // If a custom fallback is provided, use it
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
          <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {this.props.errorTitle || "Something went wrong"}
          </h3>
          <p className="text-sm text-muted-foreground text-center mb-4 max-w-md">
            {this.props.errorDescription ||
              "An unexpected error occurred. Please try again."}
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="text-xs text-red-600 bg-red-100 p-2 rounded mb-4 max-w-full overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <Button
            variant="outline"
            onClick={this.handleReset}
            className="text-red-600 border-red-300 hover:bg-red-100"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {this.props.resetButtonText || "Try again"}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap any component with an error boundary.
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };

  WithErrorBoundary.displayName = `WithErrorBoundary(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return WithErrorBoundary;
}
