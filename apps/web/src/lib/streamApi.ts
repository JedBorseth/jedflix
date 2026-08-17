import { createStreamClient } from "@jedflix/stream-client";
import { getBackendApiBase } from "@/lib/backendEnv";
import { getDemoRdRequestHeaders } from "@/lib/demoRealDebrid";

const streamClient = createStreamClient({
  apiBase: getBackendApiBase(),
  getRequestHeaders: getDemoRdRequestHeaders,
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
  PackKind,
  ResolveRequest,
  SourcesRequest,
  StreamFile,
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
