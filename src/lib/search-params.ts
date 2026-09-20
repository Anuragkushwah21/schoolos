/**
 * Readers for `searchParams` values, which may be a string, an array (the key
 * appeared twice) or absent. URL input is untrusted: every value is treated as
 * a filter hint, never as authorization.
 */

export function param(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function pageParam(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(param(value) ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

/** Accept a value only if it is one of `allowed`. */
export function enumParam<const T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const raw = param(value);
  return allowed.find((item) => item === raw);
}
