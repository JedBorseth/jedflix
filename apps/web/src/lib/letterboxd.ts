import { verifyLetterboxdUsername, type LetterboxdVerifyResponse } from "@/lib/streamApi";

const USERNAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,29}$/;

export function normalizeLetterboxdUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function formatLetterboxdUsernameError(value: string): string | undefined {
  const normalized = normalizeLetterboxdUsername(value);
  if (!normalized) {
    return undefined;
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return "Enter a valid Letterboxd username (letters, numbers, underscores, hyphens).";
  }
  return undefined;
}

export async function validateLetterboxdUsername(
  value: string,
): Promise<{ username?: string; error?: string; result?: LetterboxdVerifyResponse }> {
  const normalized = normalizeLetterboxdUsername(value);
  if (!normalized) {
    return { username: undefined };
  }

  const formatError = formatLetterboxdUsernameError(normalized);
  if (formatError) {
    return { error: formatError };
  }

  try {
    const result = await verifyLetterboxdUsername(normalized);
    if (!result.valid) {
      return {
        error: result.error ?? "Unable to verify Letterboxd username.",
        result,
      };
    }
    return { username: result.username || normalized, result };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to verify Letterboxd username. Try again.",
    };
  }
}
