import { describe, expect, test } from "bun:test";
import {
  getAuthorPath,
  getBookDetailPath,
  normalizeAuthorId,
  normalizeWorkId,
  pickRandomBook,
} from "./openlibrary";

describe("openlibrary helpers", () => {
  test("normalizeWorkId extracts OL work ids", () => {
    expect(normalizeWorkId("/works/OL82563W")).toBe("OL82563W");
    expect(normalizeWorkId("OL82563W")).toBe("OL82563W");
    expect(normalizeWorkId("ol82563w")).toBe("OL82563W");
    expect(normalizeWorkId("bad")).toBeNull();
  });

  test("normalizeAuthorId extracts OL author ids", () => {
    expect(normalizeAuthorId("/authors/OL23919A")).toBe("OL23919A");
    expect(normalizeAuthorId("OL23919A")).toBe("OL23919A");
    expect(normalizeAuthorId("bad")).toBeNull();
  });

  test("path helpers", () => {
    expect(getBookDetailPath({ id: "OL82563W" })).toBe("/audiobook/OL82563W");
    expect(getAuthorPath("OL23919A")).toBe("/author/OL23919A");
  });

  test("pickRandomBook prefers covers", () => {
    const book = pickRandomBook([
      {
        id: "OL1W",
        title: "No Cover",
        description: "",
        coverUrl: "https://placehold.co/500x750",
        authors: [],
        authorKeys: [],
        year: null,
        pageCount: null,
        subjects: [],
      },
      {
        id: "OL2W",
        title: "Covered",
        description: "",
        coverUrl: "/stream-api/api/v1/openlibrary/covers/b/id/1.jpg",
        authors: [],
        authorKeys: [],
        year: null,
        pageCount: null,
        subjects: [],
      },
    ]);
    expect(book?.id).toBe("OL2W");
  });
});
