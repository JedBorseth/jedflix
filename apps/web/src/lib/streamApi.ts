import { createStreamClient } from "@jedflix/stream-client";

const streamClient = createStreamClient({
  apiBase: import.meta.env.VITE_STREAM_API_URL ?? "/stream-api",
  apiKey: import.meta.env.VITE_STREAM_API_KEY,
});

export type {
  LetterboxdFilm,
  LetterboxdFilmsResponse,
  LetterboxdVerifyResponse,
  OpenLibraryAuthorDetails,
  OpenLibraryAuthorSummary,
  OpenLibraryBook,
  OpenLibraryBrowseResponse,
  OpenLibrarySearchResponse,
  ResolveRequest,
  SourcesRequest,
  StreamResult,
  StreamSource,
} from "@jedflix/stream-client";

export const {
  resolveStreamUrl,
  getPlaybackUrl,
  getExternalPlaybackUrl,
  fetchSources,
  resolveStream,
  fetchLetterboxdFilmsByDate,
  verifyLetterboxdUsername,
  fetchOpenLibraryBrowse,
  searchOpenLibrary,
  fetchOpenLibraryWork,
  fetchOpenLibraryAuthor,
} = streamClient;
