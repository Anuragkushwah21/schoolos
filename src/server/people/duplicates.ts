import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { DUPLICATE_FIELD, type DuplicateMatch, encodeMatches, mobileKey, nameKey } from "@/lib/student-duplicates";
import { sectionLabel } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * Finding a child who may already be at the school (see
 * `lib/student-duplicates.ts` for the rule). Only this school's students are
 * read — through `ctx.db` — so another school's children never match.
 */

export type DuplicateCandidate = {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  /** The parent mobile(s) given for the new child. */
  parentPhones: string[];
};

const INDEX_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  admissionNumber: true,
  status: true,
  dateOfBirth: true,
  parents: { select: { parent: { select: { firstName: true, lastName: true, phone: true } } } },
  enrollments: {
    where: { academicSession: { isCurrent: true } },
    take: 1,
    select: { section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
  },
} as const satisfies Prisma.StudentSelect;

export type StudentIndexRow = { key: string; row: Prisma.StudentGetPayload<{ select: typeof INDEX_SELECT }> };

/** Students to compare against: all of the school's (for an import), or those sharing a first or last name. */
export async function loadStudentIndex(ctx: TenantContext, near?: { firstName: string; lastName: string }): Promise<StudentIndexRow[]> {
  const rows = await ctx.db.student.findMany({
    where: near
      ? { OR: [{ firstName: { equals: near.firstName.trim(), mode: "insensitive" } }, { lastName: { equals: near.lastName.trim(), mode: "insensitive" } }] }
      : {},
    select: INDEX_SELECT,
  });
  return rows.map((row) => ({ key: nameKey(row.firstName, row.lastName), row }));
}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** The students in `index` that may be this child, most likely first. */
export function matchCandidate(index: StudentIndexRow[], candidate: DuplicateCandidate): DuplicateMatch[] {
  const key = nameKey(candidate.firstName, candidate.lastName);
  const phones = new Set(candidate.parentPhones.map(mobileKey).filter(Boolean));
  const born = day(candidate.dateOfBirth);
  return index
    .filter((entry) => entry.key === key)
    .map(({ row }) => {
      const sameBirth = Boolean(born && day(row.dateOfBirth) === born);
      const differentBirth = Boolean(born && row.dateOfBirth && !sameBirth);
      const samePhone = row.parents.some((link) => phones.has(mobileKey(link.parent.phone)));
      const reasons = ["same name"];
      if (sameBirth) reasons.push("same date of birth");
      if (samePhone) reasons.push("same parent mobile");
      if (differentBirth) reasons.push("different date of birth");
      const placement = row.enrollments[0];
      return {
        id: row.id,
        name: fullName(row),
        admissionNumber: row.admissionNumber,
        status: humanize(row.status),
        group: placement ? sectionLabel(placement.section) : null,
        dateOfBirth: day(row.dateOfBirth),
        parents: row.parents.map((link) => `${fullName(link.parent)} (${link.parent.phone})`),
        reasons,
        likely: sameBirth || samePhone,
      };
    })
    .sort((a, b) => Number(b.likely) - Number(a.likely));
}

/** Students that may be this child — the check behind every way of adding one. */
export async function findPossibleDuplicates(ctx: TenantContext, candidate: DuplicateCandidate): Promise<DuplicateMatch[]> {
  return matchCandidate(await loadStudentIndex(ctx, candidate), candidate);
}

/** The error that brings the matches back to the form, where the office chooses "Add anyway" or "Don't add". */
export function duplicateStudentError(matches: DuplicateMatch[]): ValidationError {
  return new ValidationError(
    matches.length === 1
      ? "This child may already be at the school. Check the student below, then choose."
      : `This child may already be at the school — ${matches.length} students match. Check them below, then choose.`,
    { [DUPLICATE_FIELD]: encodeMatches(matches) },
  );
}
