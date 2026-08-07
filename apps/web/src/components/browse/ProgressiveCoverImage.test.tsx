import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressiveCoverImage } from "./ProgressiveCoverImage";

describe("ProgressiveCoverImage", () => {
  test("renders low-res src immediately", () => {
    const html = renderToStaticMarkup(
      <ProgressiveCoverImage
        src="/backend/api/v1/openlibrary/covers/b/id/1.jpg"
        fullSrc="https://covers.openlibrary.org/b/id/1-L.jpg"
        alt="Cover"
      />,
    );
    expect(html).toContain('src="/backend/api/v1/openlibrary/covers/b/id/1.jpg"');
    expect(html).toContain('data-cover-upgraded="false"');
    expect(html).not.toContain("covers.openlibrary.org");
  });

  test("skips upgrade for placeholders", () => {
    const html = renderToStaticMarkup(
      <ProgressiveCoverImage
        src="https://placehold.co/500x750"
        fullSrc="https://covers.openlibrary.org/b/id/1-L.jpg"
        alt="Missing"
      />,
    );
    expect(html).toContain("placehold.co");
  });
});
