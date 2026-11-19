import { createStreamClient } from "@jedflix/stream-client";
import { getBackendApiBase } from "@/lib/backendEnv";
import { getDemoRdRequestHeaders } from "@/lib/demoRealDebrid";

const apiBase = getBackendApiBase().replace(/\/$/, "");

const streamClient = createStreamClient({
  apiBase,
  getRequestHeaders: getDemoRdRequestHeaders,
});

export type {
  DemoRdStatus,
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
  fetchDemoRdStatus,
  fetchSources,
  resolveStream,
  fetchLetterboxdFilmsByDate,
  verifyLetterboxdUsername,
  fetchOpenLibraryBrowse,
  searchOpenLibrary,
  fetchOpenLibraryWork,
  fetchOpenLibraryAuthor,
} = streamClient;
