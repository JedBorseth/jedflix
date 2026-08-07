import { createStreamClient } from "@jedflix/stream-client";
import { getBackendApiBase, getBackendApiKey } from "@/lib/backendEnv";

const streamClient = createStreamClient({
  apiBase: getBackendApiBase(),
  apiKey: getBackendApiKey(),
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
