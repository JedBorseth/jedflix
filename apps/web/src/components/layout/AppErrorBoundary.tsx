import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

/**
 * Catches render errors outside route errorElement (e.g. layout providers).
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const message = /maximum update depth|Minified React error #185/i.test(this.state.error.message)
        ? "This screen got stuck updating. Try reloading."
        : this.state.error.message || "An unexpected error occurred.";

      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-4 text-center text-white">
          <p className="text-sm font-medium uppercase tracking-widest text-red-500">Error</p>
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-zinc-400">{message}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="outline" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button asChild>
              <Link to="/">Home</Link>
            </Button>
            <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
