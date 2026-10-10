import { NextResponse, type NextRequest } from "next/server";

import { parseDateInput, toDateInput } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/current-user";
import { sectionReport } from "@/server/attendance/service";
import { csvResponse } from "@/server/reports/csv";
import {
  classStrengthTable,
  examPerformanceTable,
  expensesTable,
  feePaymentsTable,
  feeClassSummaryTable,
  feeLedgerTable,
  feeOverdueTable,
  feePositionsTable,
  feeSessionSummaryTable,
  homeworkTable,
  salaryPaymentsTable,
  staffAttendanceTable,
  studentListReport,
  substituteClassesTable,
  supportTable,
  teacherListReport,
  teacherWorkloadTable,
} from "@/server/reports/exports";
import { ASSET_IMPORT_COLUMNS, assetsTable } from "@/server/operations/inventory";
import { booksTable, loansTable } from "@/server/operations/library";
import { STAFF_IMPORT_COLUMNS, staffTable } from "@/server/operations/staff";
import { transportTable } from "@/server/operations/transport";
import { forSchool } from "@/server/tenancy/scope";
import { hasModule } from "@/server/platform/modules";
import { can } from "@/lib/permissions";
import type { OptionalModule } from "@/lib/school-modules";

/**
 * CSV exports for the School Admin.
 *
 * `?kind=` picks the report; without it this is the original section
 * attendance export, so existing links keep working. Route handlers are not
 * wrapped by any page guard, so this one authenticates and scopes on its own —
 * the school always comes from the session, and anything another school owns
 * is simply not found.
 */

const KINDS = [
  "attendance",
  "students",
  "teachers",
  "class-strength",
  "fees",
  "fees-pending",
  "staff-attendance",
  "staff",
  "transport",
  "books",
  "loans-overdue",
  "loans-fines",
  "assets",
  "template-staff",
  "template-books",
  "template-assets",
  "template-transport",
  "exam-performance",
  "teacher-workload",
  "fee-payments",
  "fees-class",
  "fees-sessions",
  "fees-overdue",
  "fees-ledger",
  "expenses",
  "salary-payments",
  "substitutes",
  "homework",
  "support",
] as const;
type Kind = (typeof KINDS)[number];

/** What the Principal may download (attendance by section included, as the default). */
const PRINCIPAL_EXPORTS = new Set<string>(["attendance", "students", "teachers", "class-strength", "staff-attendance", "exam-performance", "teacher-workload", "substitutes", "homework", "support"]);

const EXPORT_MODULE: Partial<Record<string, OptionalModule>> = {
  fees: "FINANCE",
  "fees-pending": "FINANCE",
  "fee-payments": "FINANCE",
  "fees-class": "FINANCE",
  "fees-sessions": "FINANCE",
  "fees-overdue": "FINANCE",
  "fees-ledger": "FINANCE",
  expenses: "EXPENSES",
  "salary-payments": "PAYROLL",
  transport: "TRANSPORT",
  "template-transport": "TRANSPORT",
  books: "LIBRARY",
  "loans-overdue": "LIBRARY",
  "loans-fines": "LIBRARY",
  "template-books": "LIBRARY",
  assets: "INVENTORY",
  "template-assets": "INVENTORY",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  // The School Admin, or the Principal (reports EXPORT), and only inside their own school.
  if (!user || !user.schoolId || !can(user.role, "reports", "EXPORT") || user.mustChangePassword) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ctx = {
    user,
    schoolId: user.schoolId,
    schoolSlug: user.schoolSlug ?? "",
    schoolName: user.schoolName ?? "",
    db: forSchool(user.schoolId),
  };

  const params = request.nextUrl.searchParams;
  const kind = (KINDS as readonly string[]).includes(params.get("kind") ?? "") ? (params.get("kind") as Kind) : "attendance";
  // The Principal oversees: no fee, expense or salary files.
  if (user.role === "PRINCIPAL" && !PRINCIPAL_EXPORTS.has(kind) && params.has("kind")) return new NextResponse("Not found", { status: 404 });
  // A download from a module the school's plan does not include is refused.
  const owner = EXPORT_MODULE[kind];
  if (owner && !(await hasModule(ctx, owner))) return new NextResponse("Not part of your school's plan", { status: 403 });
  const from = parseDateInput(params.get("from"));
  const to = parseDateInput(params.get("to"));
  const stamp = toDateInput(new Date());
  const school = user.schoolSlug || "school";

  switch (kind) {
    case "students":
      return csvResponse(`${school}-students-${stamp}.csv`, await studentListReport(ctx, { sectionId: params.get("section"), classId: params.get("class"), status: params.get("status"), q: params.get("q"), gender: (["MALE", "FEMALE", "OTHER"] as const).find((value) => value === params.get("gender")) ?? null, admitted: params.get("admitted") === "NEW" ? "NEW" : /^\d{4}$/.test(params.get("admitted") ?? "") ? Number(params.get("admitted")) : null }));
    case "teachers":
      return csvResponse(`${school}-teachers-${stamp}.csv`, await teacherListReport(ctx));
    case "class-strength":
      return csvResponse(`${school}-class-strength-${stamp}.csv`, await classStrengthTable(ctx));
    case "fees":
      return csvResponse(`${school}-fees-${stamp}.csv`, await feePositionsTable(ctx));
    case "fees-pending":
      return csvResponse(`${school}-fees-pending-${stamp}.csv`, await feePositionsTable(ctx, { pendingOnly: true }));
    case "fees-class":
      return csvResponse(`${school}-fees-by-class-${stamp}.csv`, await feeClassSummaryTable(ctx));
    case "fees-sessions":
      return csvResponse(`${school}-fees-by-session-${stamp}.csv`, await feeSessionSummaryTable(ctx));
    case "fees-overdue":
      return csvResponse(`${school}-fees-overdue-${stamp}.csv`, await feeOverdueTable(ctx));
    case "fees-ledger": {
      const studentId = params.get("student");
      if (!studentId) return new NextResponse("Choose a student.", { status: 400 });
      return csvResponse(`${school}-fee-ledger-${stamp}.csv`, await feeLedgerTable(ctx, studentId));
    }
    case "exam-performance":
      return csvResponse(`${school}-exam-performance-${stamp}.csv`, await examPerformanceTable(ctx));
    case "teacher-workload": {
      if (!from || !to || from > to) return new NextResponse("Choose a valid date range.", { status: 400 });
      return csvResponse(`${school}-teacher-workload-${toDateInput(from)}-to-${toDateInput(to)}.csv`, await teacherWorkloadTable(ctx, from, to));
    }
    case "fee-payments":
    case "expenses":
    case "salary-payments":
    case "substitutes":
    case "homework": {
      if (!from || !to || from > to) return new NextResponse("Choose a valid date range.", { status: 400 });
      const build = { "fee-payments": feePaymentsTable, expenses: expensesTable, "salary-payments": salaryPaymentsTable, substitutes: substituteClassesTable, homework: homeworkTable }[kind];
      return csvResponse(`${school}-${kind}-${toDateInput(from)}-to-${toDateInput(to)}.csv`, await build(ctx, from, to));
    }
    case "support":
      return csvResponse(`${school}-student-support-${stamp}.csv`, await supportTable(ctx));
    case "staff":
      return csvResponse(`${school}-staff-${stamp}.csv`, await staffTable(ctx));
    case "transport":
      return csvResponse(`${school}-transport-${stamp}.csv`, await transportTable(ctx));
    case "books":
      return csvResponse(`${school}-library-books-${stamp}.csv`, await booksTable(ctx));
    case "loans-overdue":
      return csvResponse(`${school}-library-overdue-${stamp}.csv`, await loansTable(ctx, "overdue"));
    case "loans-fines":
      return csvResponse(`${school}-library-fines-${stamp}.csv`, await loansTable(ctx, "fines"));
    case "assets":
      return csvResponse(`${school}-assets-${stamp}.csv`, await assetsTable(ctx));
    case "template-staff":
      return csvResponse("staff-import-template.csv", { head: [...STAFF_IMPORT_COLUMNS], rows: [["DRV001", "Ramesh", "Yadav", "Driver", "Bus driver", "9876500000", "", "2026-06-01"]] });
    case "template-books":
      return csvResponse("books-import-template.csv", {
        head: ["Title", "Author", "ISBN", "Category", "Publisher", "Shelf", "Quantity"],
        rows: [["Wings of Fire", "A. P. J. Abdul Kalam", "9788173711466", "Biography", "Universities Press", "B-2", "3"]],
      });
    case "template-assets":
      return csvResponse("assets-import-template.csv", {
        head: [...ASSET_IMPORT_COLUMNS],
        rows: [["LAB-PC-001", "Desktop computer", "Computer", "1", "Computer lab", "IT department", "Good", "Active", "2025-07-15", "42000", ""]],
      });
    case "template-transport":
      return csvResponse("transport-import-template.csv", { head: ["Admission no.", "Route", "Stop"], rows: [["ADM0001", "Route 1", "Main gate"]] });
    case "staff-attendance": {
      if (!from || !to || from > to) return new NextResponse("Choose a valid date range.", { status: 400 });
      return csvResponse(
        `${school}-staff-attendance-${toDateInput(from)}-to-${toDateInput(to)}.csv`,
        await staffAttendanceTable(ctx, from, to),
      );
    }
    case "attendance": {
      const sectionId = params.get("section");
      if (!sectionId || !from || !to || from > to) {
        return new NextResponse("Choose a section and a valid date range.", { status: 400 });
      }
      let report;
      try {
        report = await sectionReport(ctx, sectionId, from, to);
      } catch {
        return new NextResponse("Not found", { status: 404 });
      }
      return csvResponse(
        `attendance-${report.section.label}-${toDateInput(from)}-to-${toDateInput(to)}.csv`,
        {
          head: ["Roll", "Student", "Admission no.", "Present", "Late", "Half day", "Absent", "Leave", "Marked", "Attended %"],
          rows: report.students.map((s) => [
            s.rollNumber ?? "",
            s.name,
            s.admissionNumber,
            s.counts.PRESENT,
            s.counts.LATE,
            s.counts.HALF_DAY,
            s.counts.ABSENT,
            s.counts.EXCUSED,
            s.counts.total,
            s.share === null ? "" : Math.round(s.share * 100),
          ]),
        },
      );
    }
  }
}
