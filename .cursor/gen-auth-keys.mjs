// Generates an RS256 signing key pair for Convex Auth and stores it on the
// local (anonymous) Convex deployment as JWT_PRIVATE_KEY / JWKS, plus SITE_URL.
// This mirrors what `npx @convex-dev/auth` does, but runs non-interactively so
// the Cloud Agent environment can be provisioned without prompts.
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwk = publicKey.export({ format: "jwk" });
const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });

// Convex Auth stores the PKCS8 key with newlines flattened to spaces.
const privValue = pkcs8.trimEnd().replace(/\n/g, " ");

function setEnv(name, value) {
  // Pipe the value over stdin so values that begin with "-" (like the PEM
  // header) are not parsed as CLI flags.
  execFileSync("bunx", ["convex", "env", "set", name], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
}

setEnv("JWT_PRIVATE_KEY", privValue);
setEnv("JWKS", jwks);
setEnv("SITE_URL", process.env.SITE_URL ?? "http://localhost:5173");
console.log("Convex Auth signing keys configured on the local deployment.");
