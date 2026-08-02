import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { readEnv } from "./env";
import { exchangeAuthorizationCode, getProfile } from "./spotifyApi";

const http = httpRouter();

auth.addHttpRoutes(http);

function appUrl(path: string, params: Record<string, string>): string {
  const siteUrl = readEnv("SITE_URL") ?? "http://localhost:5173";
  const url = new URL(path, siteUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

http.route({
  path: "/spotify/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    const denied = url.searchParams.get("error");

    const pending = state
      ? await ctx.runMutation(internal.spotify.consumeOauthState, { state })
      : null;
    const redirectPath = pending?.redirectPath ?? "/music";

    if (!pending) {
      return Response.redirect(
        appUrl(redirectPath, {
          spotify: "error",
          spotifyMessage: "Link request expired. Try connecting Spotify again.",
        }),
        302,
      );
    }
    if (denied || !code) {
      return Response.redirect(
        appUrl(redirectPath, {
          spotify: "error",
          spotifyMessage:
            denied === "access_denied" ? "Spotify access was declined." : "Spotify did not return an authorization code.",
        }),
        302,
      );
    }

    try {
      const tokens = await exchangeAuthorizationCode(code);
      if (!tokens.refreshToken) {
        throw new Error("Spotify did not return a refresh token");
      }
      const profile = await getProfile(tokens.accessToken);
      await ctx.runMutation(internal.spotify.saveAccount, {
        userId: pending.userId,
        spotifyUserId: profile.id,
        displayName: profile.displayName,
        product: profile.product ?? undefined,
        imageUrl: profile.imageUrl ?? undefined,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      });
      return Response.redirect(appUrl(redirectPath, { spotify: "linked" }), 302);
    } catch (error) {
      return Response.redirect(
        appUrl(redirectPath, {
          spotify: "error",
          spotifyMessage: error instanceof Error ? error.message : "Failed to link Spotify",
        }),
        302,
      );
    }
  }),
});

export default http;
