declare module "@stremio/stremio-video" {
  const StremioVideo: new () => {
    dispatch: (action: Record<string, unknown>, options?: Record<string, unknown>) => void;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
    destroy: () => void;
  };
  export default StremioVideo;
}
