import {
  clearBasicAuthCredentials,
  getBasicAuthHeader,
  needsBasicAuthForUrl,
  notifyBasicAuthRequired,
} from "@/lib/basicAuth";

const nativeFetch = globalThis.fetch.bind(globalThis);

let installed = false;

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers);

  if (needsBasicAuthForUrl(url)) {
    const authHeader = getBasicAuthHeader();
    if (authHeader) {
      headers.set("Authorization", authHeader);
    }
  }

  const response = await nativeFetch(input, { ...init, headers });

  if (response.status === 401 && needsBasicAuthForUrl(url)) {
    clearBasicAuthCredentials();
    notifyBasicAuthRequired();
  }

  return response;
}

export function installAuthenticatedFetch(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  window.fetch = authenticatedFetch as typeof fetch;
}
