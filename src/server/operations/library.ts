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
import { findStudentSelf } from "@/server/student/access";

/**
 * The library: titles, copies and loans.
 *
 * Copies available are computed as quantity minus open loans, so they cannot
 * drift. Loans are refused when no copy is free, when the borrower already
 * holds the maximum, or on impossible dates. A fine is worked out on return at
 * the school's per-day rate; a return is never dated in the future.
 *
 * School Admin runs the library. A student sees only their own loans.
 */

export const MAX_LOANS_PER_BORROWER = 3;
export const MAX_LOAN_DAYS = 60;

async function openLoansByBook(ctx: TenantContext, bookIds?: string[]) {
  const rows = await ctx.db.bookIssue.groupBy({
    by: ["bookId"],
    where: { returnedOn: null, ...(bookIds ? { bookId: { in: bookIds } } : {}) },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.bookId, row._count._all]));
}

export async function listBooks(ctx: TenantContext, filters: { q?: string; category?: string; availableOnly?: boolean } = {}) {
  // The School Admin, or staff the admin has let see this (read-only).
  await assertAdminOrStaffPermission(ctx, "VIEW_LIBRARY");
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
  const onLoan = await openLoansByBook(ctx, books.map((book) => book.id));
  const rows = books.map((book) => {
    const loaned = onLoan.get(book.id) ?? 0;
    return { ...book, onLoan: loaned, available: Math.max(book.quantity - loaned, 0) };
  });
  return filters.availableOnly ? rows.filter((row) => row.available > 0 && row.isActive) : rows;
}

export async function bookCategories(ctx: TenantContext): Promise<string[]> {
  const rows = await ctx.db.book.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true } });
  return rows.map((row) => row.category!).sort();
}

export async function saveBook(ctx: TenantContext, input: BookInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { bookId, ...data } = input;
  if (bookId) {
    const onLoan = (await openLoansByBook(ctx, [bookId])).get(bookId) ?? 0;
    if (data.quantity < onLoan) throw new ConflictError(`${onLoan} copies are on loan, so the quantity cannot go below ${onLoan}.`);
  }
  try {
    let id: string;
    if (bookId) {
      const { count } = await ctx.db.book.updateMany({ where: { id: bookId }, data });
      if (!count) throw new NotFoundError("That book was not found.");
      id = bookId;
    } else {
      id = (await ctx.db.book.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
    }
    await recordAudit({ action: "BOOK_SAVED", entityType: "Book", entityId: id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Book "${data.title}" ${bookId ? "updated" : "added"} (${data.quantity} copies).` });
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A book with that ISBN already exists. Edit it and change the quantity instead.");
    throw error;
  }
}

/** Find the borrower by admission number (student) or employee ID (teacher, staff). */
async function resolveBorrower(ctx: TenantContext, kind: IssueBookInput["borrowerKind"], code: string) {
  if (kind === "STUDENT") {
    const row = await ctx.db.student.findFirst({ where: { admissionNumber: { equals: code, mode: "insensitive" }, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } });
    return row ? { where: { studentId: row.id }, data: { studentId: row.id }, name: fullName(row) } : null;
  }
  if (kind === "TEACHER") {
    const row = await ctx.db.teacher.findFirst({ where: { employeeId: { equals: code, mode: "insensitive" }, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true, firstName: true, lastName: true } });
    return row ? { where: { teacherId: row.id }, data: { teacherId: row.id }, name: fullName(row) } : null;
  }
  const row = await ctx.db.staffMember.findFirst({ where: { employeeId: { equals: code, mode: "insensitive" }, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true, firstName: true, lastName: true } });
  return row ? { where: { staffMemberId: row.id }, data: { staffMemberId: row.id }, name: fullName(row) } : null;
}

export async function issueBook(ctx: TenantContext, input: IssueBookInput): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const now = today();
  if (input.issuedOn > now) throw new AppError("VALIDATION", "A book cannot be issued on a future date.");
  if (input.issuedOn < addDays(now, -30)) throw new AppError("VALIDATION", "A loan can be back-dated at most 30 days.");
  if (input.dueOn < input.issuedOn) throw new AppError("VALIDATION", "The due date cannot be before the issue date.");
  if (spanDays(input.issuedOn, input.dueOn) > MAX_LOAN_DAYS + 1) throw new AppError("VALIDATION", `A loan can last at most ${MAX_LOAN_DAYS} days.`);

  const book = await ctx.db.book.findFirst({ where: { id: input.bookId }, select: { id: true, title: true, quantity: true, isActive: true } });
  if (!book) throw new NotFoundError("That book was not found.");
  if (!book.isActive) throw new AppError("VALIDATION", "That book is withdrawn from lending.");
  const borrower = await resolveBorrower(ctx, input.borrowerKind, input.borrowerCode);
  if (!borrower) throw new NotFoundError(`No active ${input.borrowerKind.toLowerCase()} with that ${input.borrowerKind === "STUDENT" ? "admission number" : "employee ID"}.`);

  const [onLoan, holding] = await Promise.all([
    ctx.db.bookIssue.count({ where: { bookId: book.id, returnedOn: null } }),
    ctx.db.bookIssue.count({ where: { ...borrower.where, returnedOn: null } }),
  ]);
  if (onLoan >= book.quantity) throw new ConflictError(`No copy of "${book.title}" is free right now.`);
  if (holding >= MAX_LOANS_PER_BORROWER) throw new ConflictError(`${borrower.name} already has ${holding} books out (limit ${MAX_LOANS_PER_BORROWER}).`);

  const created = await ctx.db.bookIssue.create({
    data: { schoolId: ctx.schoolId, bookId: book.id, ...borrower.data, issuedOn: input.issuedOn, dueOn: input.dueOn, notes: input.notes, issuedById: ctx.user.id },
    select: { id: true },
  });
  await recordAudit({ action: "BOOK_ISSUED", entityType: "BookIssue", entityId: created.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `"${book.title}" issued to ${borrower.name}, due ${formatDate(input.dueOn)}.` });
  return created;
}

export async function returnBook(ctx: TenantContext, input: { issueId: string; returnedOn: Date; finePaid: boolean }): Promise<{ fineMinor: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const issue = await ctx.db.bookIssue.findFirst({
    where: { id: input.issueId },
    select: { id: true, issuedOn: true, dueOn: true, returnedOn: true, book: { select: { title: true } } },
  });
  if (!issue) throw new NotFoundError("That loan was not found.");
  if (issue.returnedOn) throw new ConflictError("That book has already been returned.");
  if (input.returnedOn > today()) throw new AppError("VALIDATION", "A return cannot be dated in the future.");
  if (input.returnedOn < issue.issuedOn) throw new AppError("VALIDATION", "A return cannot be before the book was issued.");

  const school = await ctx.db.school.findFirst({ select: { libraryFinePerDayMinor: true } });
  const lateDays = input.returnedOn > issue.dueOn ? spanDays(issue.dueOn, input.returnedOn) - 1 : 0;
  const fineMinor = lateDays * (school?.libraryFinePerDayMinor ?? 0);

  await ctx.db.bookIssue.updateMany({ where: { id: issue.id }, data: { returnedOn: input.returnedOn, fineMinor, finePaid: fineMinor === 0 ? false : input.finePaid } });
  await recordAudit({ action: "BOOK_RETURNED", entityType: "BookIssue", entityId: issue.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `"${issue.book.title}" returned${lateDays ? `, ${lateDays} days late` : ""}.` });
  return { fineMinor };
}

export async function markFinePaid(ctx: TenantContext, issueId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.bookIssue.updateMany({ where: { id: issueId, fineMinor: { gt: 0 } }, data: { finePaid: true } });
  if (!count) throw new NotFoundError("That fine was not found.");
}

const LOAN_SELECT = {
  id: true,
  issuedOn: true,
  dueOn: true,
  returnedOn: true,
  fineMinor: true,
  finePaid: true,
  book: { select: { id: true, title: true, author: true } },
  student: { select: { firstName: true, lastName: true, admissionNumber: true } },
  teacher: { select: { firstName: true, lastName: true, employeeId: true } },
  staffMember: { select: { firstName: true, lastName: true, employeeId: true } },
} as const;

function borrowerOf(row: { student: { firstName: string; lastName: string; admissionNumber: string } | null; teacher: { firstName: string; lastName: string; employeeId: string } | null; staffMember: { firstName: string; lastName: string; employeeId: string } | null }) {
  if (row.student) return { name: fullName(row.student), code: row.student.admissionNumber, kind: "Student" };
  if (row.teacher) return { name: fullName(row.teacher), code: row.teacher.employeeId, kind: "Teacher" };
  if (row.staffMember) return { name: fullName(row.staffMember), code: row.staffMember.employeeId, kind: "Staff" };
  return { name: "—", code: "", kind: "" };
}

export async function listLoans(ctx: TenantContext, filters: { view?: "open" | "overdue" | "returned" | "fines"; bookId?: string; q?: string } = {}) {
  // The School Admin, or staff the admin has let see this (read-only).
  await assertAdminOrStaffPermission(ctx, "VIEW_LIBRARY");
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
  return rows.map((row) => ({ ...row, borrower: borrowerOf(row), overdue: !row.returnedOn && row.dueOn < now }));
}

/** A student's own loans. */
export async function myLoans(ctx: TenantContext) {
  assertRole(ctx.user, "STUDENT");
  const self = await findStudentSelf(ctx);
  const now = today();
  const rows = await ctx.db.bookIssue.findMany({ where: { studentId: self.student.id }, orderBy: { issuedOn: "desc" }, take: 50, select: LOAN_SELECT });
  return rows.map((row) => ({ ...row, overdue: !row.returnedOn && row.dueOn < now }));
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

  await ctx.db.$transaction([
    ...(creates.length ? [ctx.db.book.createMany({ data: creates })] : []),
    ...updates.map((row) => ctx.db.book.updateMany({ where: { id: row.id }, data: { quantity: row.quantity, ...(row.shelf ? { shelf: row.shelf } : {}) } })),
  ]);
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
