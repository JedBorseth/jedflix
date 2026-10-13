import { requireEnv } from "./env";

export default {
  providers: [
    {
      domain: requireEnv("CONVEX_SITE_URL"),
      applicationID: "convex",
    },
  ],
};
