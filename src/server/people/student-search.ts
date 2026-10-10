import type { Prisma } from "@/generated/prisma/client";

/**
 * The student search box, shared by the Students page and its CSV download.
 *
 * Each word must match somewhere — the student's name or admission number,
 * or a parent's name, phone or email — so "Ravi Kumar" finds Ravi Kumar
 * (first and last name are separate columns), and "Ravi 98765" finds Ravi
 * through his father's mobile.
 */
export function studentSearchWhere(q: string | null | undefined): Prisma.StudentWhereInput {
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return {};
  return {
    AND: words.map((word) => ({
      OR: [
        { firstName: { contains: word, mode: "insensitive" } },
        { lastName: { contains: word, mode: "insensitive" } },
        { admissionNumber: { contains: word, mode: "insensitive" } },
        {
          parents: {
            some: {
              parent: {
                OR: [
                  { firstName: { contains: word, mode: "insensitive" } },
                  { lastName: { contains: word, mode: "insensitive" } },
                  { phone: { contains: word } },
                  { email: { contains: word, mode: "insensitive" } },
                ],
              },
            },
          },
        },
      ],
    })) as Prisma.StudentWhereInput[],
  };
}

/** "NEW" = admitted since the session began; a year = admitted in that calendar year. */
export function admittedWhere(admitted: "NEW" | number | undefined | null, sessionStart: Date | null | undefined): Prisma.StudentWhereInput {
  if (admitted === "NEW") return { admissionDate: { gte: sessionStart ?? new Date(8.64e15) } };
  if (typeof admitted === "number") return { admissionDate: { gte: new Date(Date.UTC(admitted, 0, 1)), lt: new Date(Date.UTC(admitted + 1, 0, 1)) } };
  return {};
}
