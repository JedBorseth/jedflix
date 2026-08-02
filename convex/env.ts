/**
 * The Convex runtime exposes deployment environment variables on `process.env`,
 * but the typecheck project for `convex/` intentionally has no Node type
 * definitions, so the global is declared here instead of pulling in `@types/node`.
 */
declare const process: { env: Record<string, string | undefined> };

export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function requireEnv(name: string, hint?: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(hint ?? `${name} is not set in the Convex deployment.`);
  }
  return value;
}
