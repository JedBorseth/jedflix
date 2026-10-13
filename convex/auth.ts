import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { githubProvider } from "./authProviders";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [githubProvider, Google],
});
