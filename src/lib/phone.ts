/**
 * Phone numbers, one way everywhere: a country code (India, +91, by default)
 * and at most 10 local digits, stored as "+91 9876543210".
 *
 * Shared by the PhoneInput component and the server-side schemas, so what the
 * form lets through and what the server accepts are the same rule. Numbers
 * saved before this rule ("98765 43210", "+91-98765-43210", "09876543210",
 * "919876543210") still parse, so existing records keep working and are
 * written back in the standard form the next time they are saved.
 */

export const PHONE_COUNTRIES = [
  { code: "+91", label: "India", min: 10, max: 10 },
  { code: "+977", label: "Nepal", min: 8, max: 10 },
  { code: "+880", label: "Bangladesh", min: 10, max: 10 },
  { code: "+94", label: "Sri Lanka", min: 9, max: 9 },
  { code: "+971", label: "UAE", min: 8, max: 9 },
  { code: "+966", label: "Saudi Arabia", min: 9, max: 9 },
  { code: "+974", label: "Qatar", min: 8, max: 8 },
  { code: "+965", label: "Kuwait", min: 8, max: 8 },
  { code: "+968", label: "Oman", min: 8, max: 8 },
  { code: "+65", label: "Singapore", min: 8, max: 8 },
  { code: "+44", label: "UK", min: 10, max: 10 },
  { code: "+1", label: "USA / Canada", min: 10, max: 10 },
  { code: "+61", label: "Australia", min: 9, max: 9 },
] as const;

export type PhoneCountryCode = (typeof PHONE_COUNTRIES)[number]["code"];

export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = "+91";
/** The most local digits any number may have after its country code. */
export const MAX_LOCAL_DIGITS = 10;

const BY_CODE = new Map<string, (typeof PHONE_COUNTRIES)[number]>(PHONE_COUNTRIES.map((country) => [country.code, country]));
// Longest first, so "+971" is tried before "+97…" could be mistaken for something shorter.
const CODES_LONGEST_FIRST = [...PHONE_COUNTRIES].map((country) => country.code).sort((a, b) => b.length - a.length);

export function phoneCountry(code: string) {
  return BY_CODE.get(code) ?? null;
}

export type ParsedPhone = { country: PhoneCountryCode; digits: string };

/**
 * Read a phone number in any of the forms people type or paste. Returns the
 * country code and local digits, or null when it cannot be a valid number
 * (letters, too few or too many digits, an unknown country code).
 */
export function parsePhone(raw: string | null | undefined): ParsedPhone | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text) return null;
  // Only digits, spaces, hyphens, dots, brackets and one leading "+" are part of a phone number.
  if (!/^\+?[\d\s\-().]+$/.test(text)) return null;
  const plus = text.startsWith("+");
  const digits = text.replace(/\D/g, "");

  let country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY;
  let local = digits;
  if (plus) {
    const code = CODES_LONGEST_FIRST.find((candidate) => digits.startsWith(candidate.slice(1)));
    if (!code) return null;
    country = code as PhoneCountryCode;
    local = digits.slice(code.length - 1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    // "919876543210": India's code typed without the "+".
    local = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    // "09876543210": the trunk zero dialled inside India.
    local = digits.slice(1);
  }
  return validLocal(country, local) ? { country, digits: local } : null;
}

/** Whether these local digits are a whole number for this country. */
export function validLocal(country: string, digits: string): boolean {
  const rule = phoneCountry(country);
  if (!rule || !/^\d+$/.test(digits)) return false;
  if (digits.length < rule.min || digits.length > rule.max) return false;
  // No local number starts with 0 once the country code is in front of it.
  return !digits.startsWith("0");
}

/** The stored form: "+91 9876543210". */
export function formatPhone(parsed: ParsedPhone): string {
  return `${parsed.country} ${parsed.digits}`;
}

/** Normalise any accepted input to the stored form, or null if it is not a valid number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const parsed = parsePhone(raw);
  return parsed ? formatPhone(parsed) : null;
}

/** The message shown for a number that does not pass, specific to the country. */
export function phoneError(country: string = DEFAULT_PHONE_COUNTRY): string {
  const rule = phoneCountry(country) ?? phoneCountry(DEFAULT_PHONE_COUNTRY)!;
  const length = rule.min === rule.max ? `${rule.max}` : `${rule.min}–${rule.max}`;
  return `Enter a ${length}-digit number after ${rule.code}, digits only`;
}

/**
 * Split a stored or legacy value for the input: its country and digits.
 * A value that does not parse keeps +91 and whatever digits fit, so an old
 * record never shows up blank — the person fixes it and saves.
 */
export function splitPhoneForInput(value: string | null | undefined): ParsedPhone {
  const parsed = parsePhone(value);
  if (parsed) return parsed;
  return { country: DEFAULT_PHONE_COUNTRY, digits: (value ?? "").replace(/\D/g, "").slice(-MAX_LOCAL_DIGITS) };
}

/** The message for a value that did not parse: the rule for the country it names, or India's. */
export function phoneErrorFor(raw: string): string {
  const text = raw.trim();
  if (/[^\d\s\-().+]/.test(text)) return "Use digits only — no letters or symbols";
  const digits = text.replace(/\D/g, "");
  const code = text.startsWith("+") ? CODES_LONGEST_FIRST.find((candidate) => digits.startsWith(candidate.slice(1))) : undefined;
  if (text.startsWith("+") && !code) return "Choose a country code from the list";
  return phoneError(code ?? DEFAULT_PHONE_COUNTRY);
}
