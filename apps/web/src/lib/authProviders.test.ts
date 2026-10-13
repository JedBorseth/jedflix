import { expect, test } from "bun:test";
import { skipStateCheck, validateAuthResponse } from "oauth4webapi";
import { githubProvider } from "@convex/authProviders";

// Convex Auth merges a built-in provider's options into its configuration.
const provider = { ...githubProvider, ...githubProvider.options };
const client = { client_id: "test-client" };

test("accepts GitHub's issuer parameter on the OAuth callback", () => {
  const params = new URLSearchParams({
    code: "test-code",
    iss: "https://github.com/login/oauth",
  });

  const result = validateAuthResponse(
    { issuer: provider.issuer ?? "theremustbeastringhere.dev" },
    client,
    params,
    skipStateCheck,
  );

  expect(result.get("code")).toBe("test-code");
});

test("still rejects a callback from an unexpected issuer", () => {
  const params = new URLSearchParams({
    code: "test-code",
    iss: "https://untrusted.example",
  });

  expect(() =>
    validateAuthResponse(
      { issuer: provider.issuer ?? "theremustbeastringhere.dev" },
      client,
      params,
      skipStateCheck,
    ),
  ).toThrow('unexpected "iss" (issuer) response parameter value');
});
