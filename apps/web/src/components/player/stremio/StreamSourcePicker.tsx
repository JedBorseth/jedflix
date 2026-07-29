// Copyright (C) 2017-2023 Smart code 203358507
// Adapted for JedFlix

import type { StreamSource } from "@/lib/streamApi";
import { isCompatFilterError } from "../shared/playbackErrors";

type StreamSourcePickerProps = {
  sources: StreamSource[];
  loading: boolean;
  error?: string;
  disabled?: boolean;
  selectedId?: string;
  compatFiltersRelaxed?: boolean;
  onSelect: (source: StreamSource) => void;
  onRetry: () => void;
  onRelaxCompatFilters?: () => void;
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
  disabled = false,
  selectedId,
  compatFiltersRelaxed = false,
  onSelect,
  onRetry,
  onRelaxCompatFilters,
}: StreamSourcePickerProps) {
  const showRelaxOption =
    Boolean(onRelaxCompatFilters) &&
    !compatFiltersRelaxed &&
    !loading &&
    (sources.length === 0 || isCompatFilterError(error));

  return (
    <div className="player-source-picker">
      <div className="player-source-picker-panel">
        <div className="player-source-picker-header">
          <h2 className="text-lg font-semibold text-white">Choose a stream</h2>
          <p className="text-sm text-zinc-400">
            {compatFiltersRelaxed
              ? "Compatibility filters are off. MKV, Remux, Atmos, TrueHD, and DTS releases may not play in the browser — prefer an external player for those."
              : "Direct streams only. MKV, Remux, Atmos, TrueHD, and DTS releases are filtered because browsers and iOS often cannot play them. Prefer MP4 / H.264 / AAC when available."}
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
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" className="rounded-md bg-white px-4 py-2 text-black" onClick={onRetry}>
                Retry search
              </button>
              {showRelaxOption ? (
                <button
                  type="button"
                  className="rounded-md border border-zinc-500 px-4 py-2 text-white"
                  onClick={onRelaxCompatFilters}
                >
                  Show all streams
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!loading && !error && sources.length === 0 ? (
          <div className="player-source-picker-error">
            <p>No streams matched the current filters.</p>
            {showRelaxOption ? (
              <button
                type="button"
                className="rounded-md border border-zinc-500 px-4 py-2 text-white"
                onClick={onRelaxCompatFilters}
              >
                Remove compatibility filters
              </button>
            ) : (
              <button type="button" className="rounded-md bg-white px-4 py-2 text-black" onClick={onRetry}>
                Retry search
              </button>
            )}
          </div>
        ) : null}

        {!loading && !error && sources.length > 0 ? (
          <ul className="player-source-list">
            {sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={`player-source-item ${
                    selectedId === source.id ? "player-source-item-selected" : ""
                  }`}
                  disabled={disabled}
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
