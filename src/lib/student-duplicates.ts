/**
 * "Is this child already at the school?" — the matching rule, shared by every
 * way a student is added (the form, application and enquiry conversions, the
 * API and the spreadsheet import) and by the warning the office sees.
 *
 * A child is a possible duplicate when their full name is the same as a
 * student already on file (letters compared without case or extra spaces).
 * A same date of birth or a same parent mobile makes it very likely; a
 * different date of birth is said too, so the office can tell two children
 * who share a common name apart. Nothing is ever blocked for good: the office
 * sees the students and chooses to add anyway or not.
 */

export type DuplicateMatch = {
  id: string;
  name: string;
  admissionNumber: string;
  status: string;
  /** Current class, if placed this session. */
  group: string | null;
  dateOfBirth: string | null;
  parents: string[];
  /** Why it matched, in words: "same name", "same date of birth", "same parent mobile". */
  reasons: string[];
  /** Name and date of birth, or name and parent mobile. */
  likely: boolean;
};

/** The key two names are compared by. */
export function nameKey(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

/** A mobile number by its last ten digits, however it was typed. */
export function mobileKey(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

/** Field-error key carrying the matches back to the form, one JSON string each. */
export const DUPLICATE_FIELD = "possibleDuplicates";

export function encodeMatches(matches: DuplicateMatch[]): string[] {
  return matches.map((match) => JSON.stringify(match));
}

export function decodeMatches(values: string[] | undefined): DuplicateMatch[] {
  return (values ?? []).flatMap((value) => {
    try {
      return [JSON.parse(value) as DuplicateMatch];
    } catch {
      return [];
    }
  });
}

/** One line for an import report or an audit entry: "Rahul Sharma (ADM-2025-00012, Class 5 – A) — same name and date of birth". */
export function describeMatch(match: DuplicateMatch): string {
  return `${match.name} (${[match.admissionNumber, match.group].filter(Boolean).join(", ")}) — ${match.reasons.join(", ")}`;
}
