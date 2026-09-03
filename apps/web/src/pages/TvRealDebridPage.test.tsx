import { afterEach, mock, test, expect } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TvRealDebridPage } from "@/pages/TvRealDebridPage";

const validCode = "abcdefghijklmnopqrstuvwxyz123456";

function renderPage(code: string) {
  const router = createMemoryRouter(
    [{ path: "/tv/rd/:code", element: <TvRealDebridPage /> }],
    { initialEntries: [`/tv/rd/${code}`] },
  );
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  mock.restore();
});

test("shows an invalid state for a missing pairing code", async () => {
  const fetchMock = mock(async () => {
    return new Response(JSON.stringify({ status: "missing" }), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  renderPage(validCode);
  expect(await screen.findByText(/invalid or expired/i)).toBeTruthy();
});

test("submits the API key to the backend dropbox", async () => {
  const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/status")) {
      return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { apiKey?: string };
      if (body.apiKey !== "rd-secret") {
        return new Response("bad key", { status: 400 });
      }
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  renderPage(validCode);

  const input = await screen.findByLabelText(/api key/i);
  fireEvent.change(input, { target: { value: "rd-secret" } });
  fireEvent.click(screen.getByRole("button", { name: /send to tv/i }));

  await waitFor(() => {
    expect(screen.getByText(/key sent/i)).toBeTruthy();
  });
});

test("treats a short code as missing without calling the backend", async () => {
  const fetchMock = mock(async () => new Response("nope", { status: 500 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  renderPage("short");
  expect(await screen.findByText(/invalid or expired/i)).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
