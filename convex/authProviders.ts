import GitHub from "@auth/core/providers/github";

export const githubProvider = GitHub({
  // GitHub includes this issuer in OAuth callbacks (RFC 9207).
  issuer: "https://github.com/login/oauth",
});
