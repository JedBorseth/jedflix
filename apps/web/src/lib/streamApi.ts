import { createStreamClient } from "@jedflix/stream-client";
import { getBackendApiBase } from "@/lib/backendEnv";
import { getDemoRdRequestHeaders } from "@/lib/demoRealDebrid";

const apiBase = getBackendApiBase().replace(/\/$/, "");

const streamClient = createStreamClient({
  apiBase,
  getRequestHeaders: getDemoRdRequestHeaders,
});

export type DemoRdStatus = {
  demo: boolean;
  remaining?: number;
  playLimit?: number;
};

export async function fetchDemoRdStatus(realDebridToken: string): Promise<DemoRdStatus> {
  const token = realDebridToken.trim();
  if (!token) {
    return { demo: false };
  }

  const response = await fetch(`${apiBase}/api/v1/demo-rd/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...getDemoRdRequestHeaders(token),
    },
  });
  if (!response.ok) {
    return { demo: false };
  }
  return (await response.json()) as DemoRdStatus;
}

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
