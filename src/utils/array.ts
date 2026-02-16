export type StringNormalizer = (value: string) => string;

export function uniqueStrings(
  values?: Array<string | null | undefined>,
  normalize?: StringNormalizer
): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalize ? normalize(trimmed) : trimmed;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}
