import {
  createStreamClient,
  type OpenLibraryAuthorDetails,
  type OpenLibraryAuthorSummary,
  type OpenLibraryBook,
  type OpenLibraryBrowseResponse,
  type OpenLibrarySearchResponse,
} from "@jedflix/stream-client";
import { getBackendApiBase } from "@/lib/backendEnv";

export type BookItem = OpenLibraryBook;
export type BookDetails = OpenLibraryBook;
export type AuthorSummary = OpenLibraryAuthorSummary;
export type AuthorDetails = OpenLibraryAuthorDetails;
export type BookSearchResults = OpenLibrarySearchResponse;
export type AudiobookBrowseResponse = OpenLibraryBrowseResponse;

const streamClient = createStreamClient({
  apiBase: getBackendApiBase(),
});

export const bookSubjectRows = [
  { title: "NYT Bestsellers", subject: "new_york_times_bestseller" },
  { title: "Science Fiction", subject: "science_fiction" },
  { title: "Fantasy", subject: "fantasy" },
  { title: "Mystery", subject: "mystery" },
  { title: "Thrillers", subject: "thriller" },
  { title: "Romance", subject: "romance" },
  { title: "Horror", subject: "horror" },
  { title: "Biography", subject: "biography" },
  { title: "History", subject: "history" },
  { title: "Young Adult", subject: "young_adult_fiction" },
] as const;

export function getBookDetailPath(book: Pick<BookItem, "id">) {
  return `/audiobook/${book.id}`;
}

export function getListenPath(workId: string) {
  return `/listen/${workId}`;
}

export function getReadPath(workId: string) {
  return `/read/${workId}`;
}

export function getAuthorPath(authorId: string) {
  return `/author/${authorId}`;
}

export function normalizeWorkId(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  const match = /OL\d+W/i.exec(value);
  return match ? match[0].toUpperCase() : null;
}

export function normalizeAuthorId(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  const match = /OL\d+A/i.exec(value);
  return match ? match[0].toUpperCase() : null;
}

export async function getAudiobookBrowse(): Promise<AudiobookBrowseResponse> {
  return streamClient.fetchOpenLibraryBrowse();
}

export async function searchBooksAll(query: string): Promise<BookSearchResults> {
  return streamClient.searchOpenLibrary(query);
}

export async function searchBooks(query: string): Promise<BookItem[]> {
  const result = await streamClient.searchOpenLibrary(query);
  return result.books;
}

export async function searchAuthors(query: string): Promise<AuthorSummary[]> {
  const result = await streamClient.searchOpenLibrary(query);
  return result.authors;
}

export async function getWorkDetails(workId: string): Promise<BookDetails> {
  return streamClient.fetchOpenLibraryWork(workId);
}

export async function getAuthorDetails(authorId: string): Promise<AuthorDetails> {
  return streamClient.fetchOpenLibraryAuthor(authorId);
}

/** @deprecated Prefer getAudiobookBrowse for the home page. */
export async function getSubjectBooks(
  subject: string,
  _options: { limit?: number; offset?: number } = {},
): Promise<BookItem[]> {
  const browse = await getAudiobookBrowse();
  const row = browse.rows.find((entry) => entry.subject === subject);
  return row?.books ?? [];
}

export function pickRandomBook(books: BookItem[]): BookItem | undefined {
  if (books.length === 0) {
    return undefined;
  }
  const withCover = books.filter((book) => !book.coverUrl.includes("placehold.co"));
  const pool = withCover.length > 0 ? withCover : books;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}
