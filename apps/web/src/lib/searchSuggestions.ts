export type SpellSuggestion = {
  label: string;
  query: string;
};

const DEFAULT_LIMIT = 3;
const MIN_SIMILARITY = 0.5;

/** Normalize for fuzzy compare: lowercase, strip accents/punctuation. */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}

export function textSimilarity(left: string, right: string): number {
  const a = normalizeSearchText(left);
  const b = normalizeSearchText(right);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function isStrongMatch(query: string, candidate: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedCandidate = normalizeSearchText(candidate);
  if (!normalizedQuery || !normalizedCandidate) {
    return false;
  }
  return (
    normalizedCandidate === normalizedQuery ||
    normalizedCandidate.startsWith(normalizedQuery) ||
    normalizedCandidate.includes(` ${normalizedQuery}`) ||
    normalizedCandidate.includes(normalizedQuery)
  );
}

/**
 * Build "Did you mean …?" chips from remote search hits when the typed
 * query looks misspelled relative to popular result titles/names.
 * No local catalog — candidates come from TMDB / Spotify / Open Library.
 */
export function buildSpellSuggestions(
  query: string,
  candidates: string[],
  options: { limit?: number; minSimilarity?: number } = {},
): SpellSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < 2 || candidates.length === 0) {
    return [];
  }

  if (candidates.some((candidate) => isStrongMatch(trimmed, candidate))) {
    return [];
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  const scored = candidates
    .map((label) => ({
      label,
      score: textSimilarity(trimmed, label),
      normalized: normalizeSearchText(label),
    }))
    .filter(
      (entry) =>
        entry.normalized.length > 0 &&
        entry.score >= minSimilarity &&
        entry.normalized !== normalizeSearchText(trimmed),
    )
    .sort((left, right) => right.score - left.score);

  const seen = new Set<string>();
  const suggestions: SpellSuggestion[] = [];
  for (const entry of scored) {
    if (seen.has(entry.normalized)) {
      continue;
    }
    seen.add(entry.normalized);
    suggestions.push({ label: entry.label, query: entry.label });
    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
}
