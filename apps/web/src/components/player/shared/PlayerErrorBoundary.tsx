import { Component, type ErrorInfo, type ReactNode } from "react";
import { PlayerErrorOverlay } from "./PlayerErrorOverlay";

type PlayerErrorBoundaryProps = {
  backPath?: string;
  children: ReactNode;
};

type PlayerErrorBoundaryState = {
  error: Error | null;
};

export class PlayerErrorBoundary extends Component<
  PlayerErrorBoundaryProps,
  PlayerErrorBoundaryState
> {
  state: PlayerErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PlayerErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Player error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="player-container">
          <PlayerErrorOverlay
            title="Something went wrong"
            message={this.state.error.message || "The player crashed unexpectedly."}
            backPath={this.props.backPath}
            homePath="/"
          />
        </div>
      );
    }

    return this.props.children;
  }
}
