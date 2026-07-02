// Copyright (C) 2017-2023 Smart code 203358507
// Adapted for JedFlix

import type { StreamSource } from "@/lib/streamApi";

type StreamSourcePickerProps = {
  sources: StreamSource[];
  loading: boolean;
  error?: string;
  onSelect: (source: StreamSource) => void;
  onRetry: () => void;
};

function formatSize(sizeGb?: number): string {
  if (sizeGb === undefined) {
    return "Unknown size";
  }
  return `${sizeGb.toFixed(1)} GB`;
}

export function StreamSourcePicker({
  sources,
  loading,
  error,
  onSelect,
  onRetry,
}: StreamSourcePickerProps) {
  return (
    <div className="player-source-picker">
      <div className="player-source-picker-panel">
        <div className="player-source-picker-header">
          <h2 className="text-lg font-semibold text-white">Choose a stream</h2>
          <p className="text-sm text-zinc-400">
            Streams are ranked by quality and Real Debrid cache status.
          </p>
        </div>

        {loading ? (
          <div className="player-source-picker-loading">
            <div className="player-spinner" />
            <p>Searching Torrentio...</p>
          </div>
        ) : null}

        {error ? (
          <div className="player-source-picker-error">
            <p>{error}</p>
            <button type="button" className="rounded-md bg-white px-4 py-2 text-black" onClick={onRetry}>
              Retry search
            </button>
          </div>
        ) : null}

        {!loading && !error ? (
          <ul className="player-source-list">
            {sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className="player-source-item"
                  onClick={() => onSelect(source)}
                >
                  <div className="player-source-title">{source.title}</div>
                  <div className="player-source-meta">
                    <span>{formatSize(source.sizeGb)}</span>
                    {source.seeders !== undefined ? <span>{source.seeders} seeders</span> : null}
                    {source.cached ? <span className="player-source-badge">Cached</span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
