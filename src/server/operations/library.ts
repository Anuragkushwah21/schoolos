import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { spanDays } from "@/lib/calendar";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { addDays, formatDate, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import type { BookInput, IssueBookInput } from "@/lib/validation/operations";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";
import type { ReportTable } from "@/server/reports/exports";
import { groupLabel } from "@/server/academics/streams";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { findChild } from "@/server/parent/access";
import { findStudentSelf } from "@/server/student/access";

/**
 * The library: titles, physical copies and loans.
 *
 *   * Every title has numbered copies (BK-0001, …) — as many as its quantity.
 *     A loan lends one specific copy; the copy is ISSUED while the loan is
 *     open and AVAILABLE again on return. Issuing flips the copy from
 *     AVAILABLE in the loan's own transaction, so the same copy can never be
 *     lent to two people, even from two desks at once.
 *   * Loans are refused for a borrower who is not current, who already holds
 *     the school's limit, or on impossible dates. The due date defaults to
 *     the school's loan period. A fine is worked out on return at the
 *     school's per-day rate; a return is never dated in the future.
 *   * The School Admin, or a staff member who runs the library (every
 *     Librarian does), works the desk. Students see their own loans; parents
 *     their children's.
 */

/** Fallback when a school has no setting of its own. */
export const MAX_LOANS_PER_BORROWER = 3;
export const MAX_LOAN_DAYS = 60;

type Tx = Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0];

async function openLoansByBook(ctx: TenantContext, bookIds?: string[]) {
  const rows = await ctx.db.bookIssue.groupBy({
    by: ["bookId"],
    where: { returnedOn: null, ...(bookIds ? { bookId: { in: bookIds } } : {}) },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.bookId, row._count._all]));
}

/** Copies on the shelf, per book. */
async function availableCopiesByBook(ctx: TenantContext, bookIds?: string[]) {
  const rows = await ctx.db.bookCopy.groupBy({
    by: ["bookId"],
    where: { status: "AVAILABLE", ...(bookIds ? { bookId: { in: bookIds } } : {}) },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.bookId, row._count._all]));
}

/** The next `count` copy codes for this school, reserved in the caller's transaction. */
async function nextCopyCodes(tx: Tx, schoolId: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  // One UPDATE: concurrent additions queue on the school row and never share a code.
  const school = await tx.school.update({ where: { id: schoolId }, data: { lastBookCopyNumber: { increment: count } }, select: { lastBookCopyNumber: true } });
  const first = school.lastBookCopyNumber - count + 1;
  return Array.from({ length: count }, (_, i) => `BK-${String(first + i).padStart(4, "0")}`);
}

/**
 * Bring a book's copies in line with its quantity: add numbered copies, or
 * withdraw copies on the shelf (newest first). Copies out on loan are never
 * withdrawn — the quantity cannot drop below them.
 */
async function syncCopies(tx: Tx, schoolId: string, bookId: string, quantity: number): Promise<void> {
  const copies = await tx.bookCopy.findMany({ where: { bookId, status: { in: ["AVAILABLE", "ISSUED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  if (copies.length < quantity) {
    const codes = await nextCopyCodes(tx, schoolId, quantity - copies.length);
    await tx.bookCopy.createMany({ data: codes.map((code) => ({ schoolId, bookId, code })) });
  } else if (copies.length > quantity) {
    const spare = copies.filter((copy) => copy.status === "AVAILABLE").slice(0, copies.length - quantity);
    if (spare.length < copies.length - quantity) {
      const out = copies.length - copies.filter((copy) => copy.status === "AVAILABLE").length;
      throw new ConflictError(`${out} copies are on loan, so the quantity cannot go below ${out}.`);
    }
    await tx.bookCopy.updateMany({ where: { id: { in: spare.map((copy) => copy.id) } }, data: { status: "WITHDRAWN" } });
  }
}

/** Anyone who may see the library: read-only staff and the librarian alike. */
const LIBRARY_READERS = ["VIEW_LIBRARY", "MANAGE_LIBRARY"] as const;

export async function listBooks(ctx: TenantContext, filters: { q?: string; category?: string; availableOnly?: boolean } = {}) {
  // The School Admin, or staff the admin has let see this (read-only).
  await assertAdminOrStaffPermission(ctx, LIBRARY_READERS);
  const where: Prisma.BookWhereInput = {
    ...(filters.category ? { category: { equals: filters.category, mode: "insensitive" } } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { author: { contains: filters.q, mode: "insensitive" } },
            { isbn: { contains: filters.q.replace(/[\s-]/g, "") } },
          ],
        }
      : {}),
  };
  const books = await ctx.db.book.findMany({
    where,
    orderBy: { title: "asc" },
    take: 500,
    select: { id: true, title: true, author: true, isbn: true, category: true, publisher: true, shelf: true, quantity: true, isActive: true },
  });
  const [onLoan, onShelf] = await Promise.all([openLoansByBook(ctx, books.map((book) => book.id)), availableCopiesByBook(ctx, books.map((book) => book.id))]);
  const rows = books.map((book) => ({ ...book, onLoan: onLoan.get(book.id) ?? 0, available: onShelf.get(book.id) ?? 0 }));
  return filters.availableOnly ? rows.filter((row) => row.available > 0 && row.isActive) : rows;
}

export async function bookCategories(ctx: TenantContext): Promise<string[]> {
  await assertAdminOrStaffPermission(ctx, LIBRARY_READERS);
  const rows = await ctx.db.book.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true } });
  return rows.map((row) => row.category!).sort();
}

export async function saveBook(ctx: TenantContext, input: BookInput): Promise<string> {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const { bookId, ...data } = input;
  try {
    // The book and its numbered copies change together.
    const id = await ctx.db.$transaction(async (tx) => {
      let saved: string;
      if (bookId) {
        const { count } = await tx.book.updateMany({ where: { id: bookId }, data });
        if (!count) throw new NotFoundError("That book was not found.");
        saved = bookId;
      } else {
        saved = (await tx.book.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
      }
      await syncCopies(tx, ctx.schoolId, saved, data.quantity);
      return saved;
    });
    await recordAudit({ action: "BOOK_SAVED", entityType: "Book", entityId: id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Book "${data.title}" ${bookId ? "updated" : "added"} (${data.quantity} copies).` });
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A book with that ISBN already exists. Edit it and change the quantity instead.");
    throw error;
  }
}

/**
 * Find the borrower in this school: a current student by id or admission
 * number, or a current teacher or staff member by employee ID.
 */
async function resolveBorrower(ctx: TenantContext, kind: IssueBookInput["borrowerKind"], code: string, studentId?: string | null) {
  if (kind === "STUDENT") {
    const row = await ctx.db.student.findFirst({
      where: studentId ? { id: studentId } : { admissionNumber: { equals: code, mode: "insensitive" } },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
    if (row && !(CURRENT_STUDENT as readonly string[]).includes(row.status)) {
      throw new ConflictError(`${fullName(row)} is not a current student, so no book can be issued.`);
    }
    return row ? { where: { studentId: row.id }, data: { studentId: row.id }, name: fullName(row) } : null;
  }
  if (kind === "TEACHER") {
    const row = await ctx.db.teacher.findFirst({ where: { employeeId: { equals: code, mode: "insensitive" }, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true, firstName: true, lastName: true } });
    return row ? { where: { teacherId: row.id }, data: { teacherId: row.id }, name: fullName(row) } : null;
  }
  const row = await ctx.db.staffMember.findFirst({ where: { employeeId: { equals: code, mode: "insensitive" }, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true, firstName: true, lastName: true } });
  return row ? { where: { staffMemberId: row.id }, data: { staffMemberId: row.id }, name: fullName(row) } : null;
}

/** The school's lending rules. */
export async function libraryRules(ctx: TenantContext) {
  const school = await ctx.db.school.findFirst({ select: { libraryLoanDays: true, libraryMaxLoans: true, libraryFinePerDayMinor: true } });
  return {
    loanDays: Math.min(Math.max(school?.libraryLoanDays ?? 14, 1), MAX_LOAN_DAYS),
    maxLoans: Math.max(school?.libraryMaxLoans ?? MAX_LOANS_PER_BORROWER, 1),
    finePerDayMinor: school?.libraryFinePerDayMinor ?? 0,
  };
}

/** The School Admin sets the lending rules. */
export async function saveLibraryRules(ctx: TenantContext, input: { loanDays: number; maxLoans: number; finePerDayRupees: number }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.school.update({
    where: { id: ctx.schoolId },
    data: { libraryLoanDays: input.loanDays, libraryMaxLoans: input.maxLoans, libraryFinePerDayMinor: Math.round(input.finePerDayRupees * 100) },
  });
  await recordAudit({
    action: "LIBRARY_SETTINGS_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Library rules: ${input.loanDays}-day loans, up to ${input.maxLoans} books, fine ₹${input.finePerDayRupees}/day.`,
  });
}

/**
 * Issue one physical copy. Checked here, whatever the form sent: the borrower
 * is in this school and current, the book is lendable, the copy belongs to it
 * and is on the shelf, and the borrower is under the limit. The copy is taken
 * with a conditional update in the loan's own transaction — the second of two
 * simultaneous issues of one copy finds it gone and is refused.
 */
/** An issue request: the copy and the picked student are optional for older API clients. */
export type IssueRequest = Omit<IssueBookInput, "copyId" | "studentId"> & { copyId?: string | null; studentId?: string | null };

export async function issueBook(ctx: TenantContext, input: IssueRequest): Promise<{ id: string; copyCode: string }> {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const now = today();
  if (input.issuedOn > now) throw new AppError("VALIDATION", "A book cannot be issued on a future date.");
  if (input.issuedOn < addDays(now, -30)) throw new AppError("VALIDATION", "A loan can be back-dated at most 30 days.");
  if (input.dueOn < input.issuedOn) throw new AppError("VALIDATION", "The due date cannot be before the issue date.");
  if (spanDays(input.issuedOn, input.dueOn) > MAX_LOAN_DAYS + 1) throw new AppError("VALIDATION", `A loan can last at most ${MAX_LOAN_DAYS} days.`);

  const book = await ctx.db.book.findFirst({ where: { id: input.bookId }, select: { id: true, title: true, isActive: true } });
  if (!book) throw new NotFoundError("That book was not found.");
  if (!book.isActive) throw new AppError("VALIDATION", "That book is withdrawn from lending.");
  const borrower = await resolveBorrower(ctx, input.borrowerKind, input.borrowerCode, input.studentId);
  if (!borrower) throw new NotFoundError(`No active ${input.borrowerKind.toLowerCase()} with that ${input.borrowerKind === "STUDENT" ? "admission number" : "employee ID"} in this school.`);
  const rules = await libraryRules(ctx);

  const created = await ctx.db.$transaction(async (tx) => {
    const holding = await tx.bookIssue.count({ where: { ...borrower.where, returnedOn: null } });
    if (holding >= rules.maxLoans) throw new ConflictError(`${borrower.name} already has ${holding} book${holding === 1 ? "" : "s"} out (limit ${rules.maxLoans}).`);

    // The copy asked for, or — from the API without one — the first on the shelf.
    const copy = input.copyId
      ? await tx.bookCopy.findFirst({ where: { id: input.copyId }, select: { id: true, code: true, bookId: true } })
      : await tx.bookCopy.findFirst({ where: { bookId: book.id, status: "AVAILABLE" }, orderBy: { code: "asc" }, select: { id: true, code: true, bookId: true } });
    if (!copy) throw new ConflictError(input.copyId ? "That copy was not found." : `No copy of "${book.title}" is free right now.`);
    if (copy.bookId !== book.id) throw new AppError("VALIDATION", "That copy belongs to another book.");
    const taken = await tx.bookCopy.updateMany({ where: { id: copy.id, status: "AVAILABLE" }, data: { status: "ISSUED" } });
    if (!taken.count) throw new ConflictError(`Copy ${copy.code} is already issued or withdrawn. Choose another copy.`);

    const issue = await tx.bookIssue.create({
      data: { schoolId: ctx.schoolId, bookId: book.id, copyId: copy.id, ...borrower.data, issuedOn: input.issuedOn, dueOn: input.dueOn, notes: input.notes, issuedById: ctx.user.id },
      select: { id: true },
    });
    return { id: issue.id, copyCode: copy.code };
  });
  await recordAudit({ action: "BOOK_ISSUED", entityType: "BookIssue", entityId: created.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `"${book.title}" (${created.copyCode}) issued to ${borrower.name}, due ${formatDate(input.dueOn)}.` });
  return created;
}

export async function returnBook(ctx: TenantContext, input: { issueId: string; returnedOn: Date; finePaid: boolean }): Promise<{ fineMinor: number }> {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const issue = await ctx.db.bookIssue.findFirst({
    where: { id: input.issueId },
    select: { id: true, issuedOn: true, dueOn: true, returnedOn: true, copyId: true, book: { select: { title: true } } },
  });
  if (!issue) throw new NotFoundError("That loan was not found.");
  if (issue.returnedOn) throw new ConflictError("That book has already been returned.");
  if (input.returnedOn > today()) throw new AppError("VALIDATION", "A return cannot be dated in the future.");
  if (input.returnedOn < issue.issuedOn) throw new AppError("VALIDATION", "A return cannot be before the book was issued.");

  const school = await ctx.db.school.findFirst({ select: { libraryFinePerDayMinor: true } });
  const lateDays = input.returnedOn > issue.dueOn ? spanDays(issue.dueOn, input.returnedOn) - 1 : 0;
  const fineMinor = lateDays * (school?.libraryFinePerDayMinor ?? 0);

  // The loan closes and its copy goes back on the shelf together.
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.bookIssue.updateMany({ where: { id: issue.id, returnedOn: null }, data: { returnedOn: input.returnedOn, fineMinor, finePaid: fineMinor === 0 ? false : input.finePaid } });
    if (!count) throw new ConflictError("That book has already been returned.");
    if (issue.copyId) await tx.bookCopy.updateMany({ where: { id: issue.copyId, status: "ISSUED" }, data: { status: "AVAILABLE" } });
  });
  await recordAudit({ action: "BOOK_RETURNED", entityType: "BookIssue", entityId: issue.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `"${issue.book.title}" returned${lateDays ? `, ${lateDays} days late` : ""}.` });
  return { fineMinor };
}

export async function markFinePaid(ctx: TenantContext, issueId: string): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const { count } = await ctx.db.bookIssue.updateMany({ where: { id: issueId, fineMinor: { gt: 0 } }, data: { finePaid: true } });
  if (!count) throw new NotFoundError("That fine was not found.");
  await recordAudit({ action: "BOOK_FINE_PAID", entityType: "BookIssue", entityId: issueId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: "Library fine marked as paid." });
}

/**
 * Renew a loan: a new due date for a book still out. The loan keeps its issue
 * date, so the total time out is still capped at `MAX_LOAN_DAYS`, and the
 * renewal is on the audit trail.
 */
export async function renewLoan(ctx: TenantContext, input: { issueId: string; dueOn: Date }): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const issue = await ctx.db.bookIssue.findFirst({
    where: { id: input.issueId },
    select: { id: true, issuedOn: true, dueOn: true, returnedOn: true, book: { select: { title: true } } },
  });
  if (!issue) throw new NotFoundError("That loan was not found.");
  if (issue.returnedOn) throw new ConflictError("That book has already been returned.");
  if (input.dueOn <= issue.dueOn) throw new AppError("VALIDATION", `Choose a date after the current due date (${formatDate(issue.dueOn)}).`);
  if (input.dueOn < today()) throw new AppError("VALIDATION", "The new due date cannot be in the past.");
  if (spanDays(issue.issuedOn, input.dueOn) > MAX_LOAN_DAYS + 1) {
    throw new AppError("VALIDATION", `A loan can last at most ${MAX_LOAN_DAYS} days from the day it was issued.`);
  }
  await ctx.db.bookIssue.updateMany({ where: { id: issue.id, returnedOn: null }, data: { dueOn: input.dueOn } });
  await recordAudit({
    action: "BOOK_RENEWED",
    entityType: "BookIssue",
    entityId: issue.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${issue.book.title}" renewed until ${formatDate(input.dueOn)} (was ${formatDate(issue.dueOn)}).`,
  });
}

/**
 * Who a book can be issued to, for the issue desk's search: students (current
 * by default), teachers and staff — only what the desk needs. Name, admission
 * no. or employee ID, class and section, and books already out. Never a
 * parent's details, fees, marks or an address.
 */
export async function searchBorrowers(ctx: TenantContext, raw: string) {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const q = raw.trim().slice(0, 60);
  if (q.length < 2) return [];
  const like = { contains: q, mode: "insensitive" as const };
  const nameOrCode = (code: "admissionNumber" | "employeeId") => ({ OR: [{ firstName: like }, { lastName: like }, { [code]: like }] });

  // "9-A", "9 A" or "Class 9 A": a class and section; otherwise a class, section or stream name.
  const group = q.match(/^(?:class\s*)?(\d{1,2}|nursery|lkg|ukg)\s*[-–\s]\s*([a-z])$/i);
  const current = { academicSession: { isCurrent: true }, status: "ACTIVE" as const };
  const placementMatch = group
    ? { enrollments: { some: { ...current, class: { name: { in: [group[1]!, `Class ${group[1]}`], mode: "insensitive" as const } }, section: { name: { equals: group[2]!, mode: "insensitive" as const } } } } }
    : { enrollments: { some: { ...current, OR: [{ class: { name: like } }, { stream: { name: like } }, { section: { stream: { name: like } } }] } } };

  const [students, teachers, staff] = await Promise.all([
    ctx.db.student.findMany({
      // Only this school's current students (the client is tenant-scoped).
      where: { status: { in: [...CURRENT_STUDENT] }, OR: [nameOrCode("admissionNumber"), placementMatch] },
      orderBy: [{ firstName: "asc" }],
      take: 12,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        enrollments: {
          where: { academicSession: { isCurrent: true } },
          take: 1,
          select: { rollNumber: true, stream: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
        },
        _count: { select: { bookIssues: { where: { returnedOn: null } } } },
      },
    }),
    group
      ? Promise.resolve([])
      : ctx.db.teacher.findMany({
          where: { status: { in: ["ACTIVE", "ON_LEAVE"] }, ...nameOrCode("employeeId") },
          take: 4,
          select: { id: true, firstName: true, lastName: true, employeeId: true, _count: { select: { bookIssues: { where: { returnedOn: null } } } } },
        }),
    group
      ? Promise.resolve([])
      : ctx.db.staffMember.findMany({
          where: { status: { in: ["ACTIVE", "ON_LEAVE"] }, ...nameOrCode("employeeId") },
          take: 4,
          select: { id: true, firstName: true, lastName: true, employeeId: true, _count: { select: { bookIssues: { where: { returnedOn: null } } } } },
        }),
  ]);

  return [
    ...students.map((row) => {
      const placement = row.enrollments[0];
      return {
        kind: "STUDENT" as const,
        id: row.id,
        name: fullName(row),
        code: row.admissionNumber,
        // "Class 9 – A • Science · Roll 12"
        detail: [placement ? groupLabel(placement.section, placement.stream) : "Not placed this year", placement?.rollNumber ? `Roll ${placement.rollNumber}` : null].filter(Boolean).join(" · "),
        booksOut: row._count.bookIssues,
      };
    }),
    ...teachers.map((row) => ({ kind: "TEACHER" as const, id: row.id, name: fullName(row), code: row.employeeId, detail: "Teacher", booksOut: row._count.bookIssues })),
    ...staff.map((row) => ({ kind: "STAFF" as const, id: row.id, name: fullName(row), code: row.employeeId, detail: "Staff", booksOut: row._count.bookIssues })),
  ];
}

/** Books with a copy on the shelf, and those copies — for the issue form. */
export async function issuableBooks(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, "MANAGE_LIBRARY");
  const books = await ctx.db.book.findMany({
    where: { isActive: true, copies: { some: { status: "AVAILABLE" } } },
    orderBy: { title: "asc" },
    take: 1000,
    select: { id: true, title: true, author: true, copies: { where: { status: "AVAILABLE" }, orderBy: { code: "asc" }, select: { id: true, code: true } } },
  });
  return books.map((book) => ({ value: book.id, label: `${book.title}${book.author ? ` — ${book.author}` : ""} (${book.copies.length} free)`, copies: book.copies.map((copy) => ({ value: copy.id, label: copy.code })) }));
}

/** A book's copies and where each one is, for its page. */
export async function bookCopies(ctx: TenantContext, bookId: string) {
  await assertAdminOrStaffPermission(ctx, LIBRARY_READERS);
  const copies = await ctx.db.bookCopy.findMany({
    where: { bookId },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      status: true,
      issues: { where: { returnedOn: null }, take: 1, select: { dueOn: true, student: { select: { firstName: true, lastName: true } }, teacher: { select: { firstName: true, lastName: true } }, staffMember: { select: { firstName: true, lastName: true } } } },
    },
  });
  return copies.map((copy) => {
    const loan = copy.issues[0];
    const holder = loan?.student ?? loan?.teacher ?? loan?.staffMember ?? null;
    return { id: copy.id, code: copy.code, status: copy.status, heldBy: holder ? fullName(holder) : null, dueOn: loan?.dueOn ?? null };
  });
}

/** The desk's day: issued and returned today, overdue now, copies on the shelf. */
export async function libraryToday(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, LIBRARY_READERS);
  const now = today();
  const [issuedToday, returnedToday, overdue, copies, out, recentIssues, recentReturns] = await Promise.all([
    ctx.db.bookIssue.count({ where: { issuedOn: now } }),
    ctx.db.bookIssue.count({ where: { returnedOn: now } }),
    ctx.db.bookIssue.count({ where: { returnedOn: null, dueOn: { lt: now } } }),
    ctx.db.bookCopy.count({ where: { status: "AVAILABLE", book: { isActive: true } } }),
    Promise.resolve(0),
    ctx.db.bookIssue.findMany({ orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }], take: 5, select: LOAN_SELECT }),
    ctx.db.bookIssue.findMany({ where: { returnedOn: { not: null } }, orderBy: [{ returnedOn: "desc" }, { updatedAt: "desc" }], take: 5, select: LOAN_SELECT }),
  ]);
  const withBorrower = (rows: typeof recentIssues) => rows.map((row) => shapeLoan(row, now));
  return {
    issuedToday,
    returnedToday,
    overdue,
    available: Math.max(copies - out, 0),
    recentIssues: withBorrower(recentIssues),
    recentReturns: withBorrower(recentReturns),
  };
}

const LOAN_SELECT = {
  id: true,
  issuedOn: true,
  dueOn: true,
  returnedOn: true,
  fineMinor: true,
  finePaid: true,
  book: { select: { id: true, title: true, author: true } },
  copy: { select: { code: true } },
  student: {
    select: {
      firstName: true,
      lastName: true,
      admissionNumber: true,
      enrollments: {
        where: { academicSession: { isCurrent: true } },
        take: 1,
        select: { stream: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
      },
    },
  },
  teacher: { select: { firstName: true, lastName: true, employeeId: true } },
  staffMember: { select: { firstName: true, lastName: true, employeeId: true } },
} as const;

type LoanRow = Prisma.BookIssueGetPayload<{ select: typeof LOAN_SELECT }>;

/** "Issued", "Overdue" (due date passed, not back) or "Returned" — a returned book is never overdue. */
export function loanStatus(row: { returnedOn: Date | null; dueOn: Date }, now: Date = today()): "ISSUED" | "OVERDUE" | "RETURNED" {
  if (row.returnedOn) return "RETURNED";
  return row.dueOn < now ? "OVERDUE" : "ISSUED";
}

/** A loan as screens show it: borrower, their class, the copy, and its status. */
function shapeLoan(row: LoanRow, now: Date = today()) {
  const status = loanStatus(row, now);
  return { ...row, borrower: borrowerOf(row), copyCode: row.copy?.code ?? null, status, overdue: status === "OVERDUE" };
}

function borrowerOf(row: Pick<LoanRow, "student" | "teacher" | "staffMember">) {
  if (row.student) {
    const placement = row.student.enrollments[0];
    return { name: fullName(row.student), code: row.student.admissionNumber, kind: "Student", group: placement ? groupLabel(placement.section, placement.stream) : null };
  }
  if (row.teacher) return { name: fullName(row.teacher), code: row.teacher.employeeId, kind: "Teacher", group: null };
  if (row.staffMember) return { name: fullName(row.staffMember), code: row.staffMember.employeeId, kind: "Staff", group: null };
  return { name: "—", code: "", kind: "", group: null };
}

export async function listLoans(ctx: TenantContext, filters: { view?: "open" | "overdue" | "returned" | "fines"; bookId?: string; q?: string } = {}) {
  // The School Admin, or staff the admin has let see this (read-only).
  await assertAdminOrStaffPermission(ctx, LIBRARY_READERS);
  const now = today();
  const where: Prisma.BookIssueWhereInput = {
    ...(filters.bookId ? { bookId: filters.bookId } : {}),
    ...(filters.view === "open" ? { returnedOn: null } : {}),
    ...(filters.view === "overdue" ? { returnedOn: null, dueOn: { lt: now } } : {}),
    ...(filters.view === "returned" ? { returnedOn: { not: null } } : {}),
    ...(filters.view === "fines" ? { fineMinor: { gt: 0 }, finePaid: false } : {}),
    ...(filters.q
      ? {
          OR: [
            { book: { title: { contains: filters.q, mode: "insensitive" } } },
            { student: { OR: [{ firstName: { contains: filters.q, mode: "insensitive" } }, { admissionNumber: { contains: filters.q, mode: "insensitive" } }] } },
            { teacher: { OR: [{ firstName: { contains: filters.q, mode: "insensitive" } }, { employeeId: { contains: filters.q, mode: "insensitive" } }] } },
            { staffMember: { OR: [{ firstName: { contains: filters.q, mode: "insensitive" } }, { employeeId: { contains: filters.q, mode: "insensitive" } }] } },
          ],
        }
      : {}),
  };
  const rows = await ctx.db.bookIssue.findMany({ where, orderBy: [{ returnedOn: "asc" }, { dueOn: "asc" }], take: 500, select: LOAN_SELECT });
  return rows.map((row) => shapeLoan(row, now));
}

/** A parent's view of one linked child's loans — the link is checked first. */
export async function childLoans(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "PARENT");
  const child = await findChild(ctx, studentId);
  const now = today();
  const rows = await ctx.db.bookIssue.findMany({ where: { studentId: child.student.id }, orderBy: { issuedOn: "desc" }, take: 50, select: LOAN_SELECT });
  return rows.map((row) => shapeLoan(row, now));
}

/** A student's own loans. */
export async function myLoans(ctx: TenantContext) {
  assertRole(ctx.user, "STUDENT");
  const self = await findStudentSelf(ctx);
  const now = today();
  const rows = await ctx.db.bookIssue.findMany({ where: { studentId: self.student.id }, orderBy: { issuedOn: "desc" }, take: 50, select: LOAN_SELECT });
  return rows.map((row) => shapeLoan(row, now));
}

export type ImportError = { line: number; message: string };

/**
 * Import books from CSV. A row whose ISBN the library already has updates
 * that title's copies (never below the copies on loan); any other row adds a
 * title. Every row is checked first; nothing is saved unless all pass.
 */
export async function importBooks(ctx: TenantContext, text: string): Promise<{ created: number; updated: number; errors: ImportError[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  let records;
  try {
    records = readCsvRecords(text, { required: ["Title", "Quantity"], maxRows: 2000 });
  } catch (error) {
    if (error instanceof CsvFormatError) return { created: 0, updated: 0, errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  const existing = await ctx.db.book.findMany({ where: { isbn: { not: null } }, select: { id: true, isbn: true } });
  const byIsbn = new Map(existing.map((row) => [row.isbn!, row.id]));
  const onLoan = await openLoansByBook(ctx);
  const errors: ImportError[] = [];
  const creates: Prisma.BookCreateManyInput[] = [];
  const updates: Array<{ id: string; quantity: number; shelf: string | null }> = [];
  const seenIsbn = new Set<string>();

  for (const record of records) {
    const v = record.values;
    const problems: string[] = [];
    const title = v["title"] ?? "";
    if (!title) problems.push("title is missing");
    const quantity = /^\d+$/.test(v["quantity"] ?? "") ? Number(v["quantity"]) : NaN;
    if (!Number.isInteger(quantity) || quantity > 10_000) problems.push("quantity must be a whole number");
    const isbn = (v["isbn"] ?? "").replace(/[\s-]/g, "") || null;
    if (isbn && !/^(\d{9}[\dX]|\d{13})$/i.test(isbn)) problems.push(`ISBN "${v["isbn"]}" is not 10 or 13 digits`);
    if (isbn && seenIsbn.has(isbn)) problems.push("ISBN appears twice in the file");
    if (isbn) seenIsbn.add(isbn);
    const existingId = isbn ? byIsbn.get(isbn) : undefined;
    if (existingId && quantity < (onLoan.get(existingId) ?? 0)) problems.push(`${onLoan.get(existingId)} copies are on loan; quantity cannot be lower`);
    if (problems.length) {
      errors.push({ line: record.line, message: problems.join("; ") });
      continue;
    }
    if (existingId) updates.push({ id: existingId, quantity, shelf: v["shelf"] || null });
    else creates.push({ schoolId: ctx.schoolId, title, author: v["author"] || null, isbn, category: v["category"] || null, publisher: v["publisher"] || null, shelf: v["shelf"] || null, quantity });
  }
  if (errors.length) return { created: 0, updated: 0, errors };
  if (!creates.length && !updates.length) return { created: 0, updated: 0, errors: [{ line: 1, message: "The file has no rows." }] };

  // Books and their numbered copies together; a quantity change adds or withdraws copies.
  await ctx.db.$transaction(
    async (tx) => {
      for (const data of creates) {
        const book = await tx.book.create({ data, select: { id: true } });
        await syncCopies(tx, ctx.schoolId, book.id, data.quantity);
      }
      for (const row of updates) {
        await tx.book.updateMany({ where: { id: row.id }, data: { quantity: row.quantity, ...(row.shelf ? { shelf: row.shelf } : {}) } });
        await syncCopies(tx, ctx.schoolId, row.id, row.quantity);
      }
    },
    { timeout: 60_000 },
  );
  await recordAudit({ action: "BOOKS_IMPORTED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Library import: ${creates.length} titles added, ${updates.length} updated.` });
  return { created: creates.length, updated: updates.length, errors: [] };
}

export async function booksTable(ctx: TenantContext): Promise<ReportTable> {
  const rows = await listBooks(ctx);
  return {
    head: ["Title", "Author", "ISBN", "Category", "Publisher", "Shelf", "Quantity", "On loan", "Available", "Active"],
    rows: rows.map((row) => [row.title, row.author ?? "", row.isbn ?? "", row.category ?? "", row.publisher ?? "", row.shelf ?? "", row.quantity, row.onLoan, row.available, row.isActive ? "Yes" : "No"]),
  };
}

export async function loansTable(ctx: TenantContext, view: "open" | "overdue" | "fines"): Promise<ReportTable> {
  const rows = await listLoans(ctx, { view });
  return {
    head: ["Book", "Borrower", "Type", "ID", "Issued", "Due", "Returned", "Fine (₹)", "Fine paid"],
    rows: rows.map((row) => [
      row.book.title,
      row.borrower.name,
      row.borrower.kind,
      row.borrower.code,
      formatDate(row.issuedOn),
      formatDate(row.dueOn),
      row.returnedOn ? formatDate(row.returnedOn) : "",
      row.fineMinor ? (row.fineMinor / 100).toFixed(0) : "",
      row.fineMinor ? (row.finePaid ? "Yes" : "No") : "",
    ]),
  };
}
