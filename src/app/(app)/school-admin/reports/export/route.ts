import { NextResponse, type NextRequest } from "next/server";

import { parseDateInput, toDateInput } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/current-user";
import { sectionReport } from "@/server/attendance/service";
import { csvResponse } from "@/server/reports/csv";
import {
  classStrengthTable,
  examPerformanceTable,
  feePositionsTable,
  staffAttendanceTable,
  studentListReport,
  teacherListReport,
  teacherWorkloadTable,
} from "@/server/reports/exports";
import { ASSET_IMPORT_COLUMNS, assetsTable } from "@/server/operations/inventory";
import { booksTable, loansTable } from "@/server/operations/library";
import { STAFF_IMPORT_COLUMNS, staffTable } from "@/server/operations/staff";
import { transportTable } from "@/server/operations/transport";
import { forSchool } from "@/server/tenancy/scope";

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
] as const;
type Kind = (typeof KINDS)[number];

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SCHOOL_ADMIN" || !user.schoolId) {
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
  const from = parseDateInput(params.get("from"));
  const to = parseDateInput(params.get("to"));
  const stamp = toDateInput(new Date());
  const school = user.schoolSlug || "school";

  switch (kind) {
    case "students":
      return csvResponse(`${school}-students-${stamp}.csv`, await studentListReport(ctx));
    case "teachers":
      return csvResponse(`${school}-teachers-${stamp}.csv`, await teacherListReport(ctx));
    case "class-strength":
      return csvResponse(`${school}-class-strength-${stamp}.csv`, await classStrengthTable(ctx));
    case "fees":
      return csvResponse(`${school}-fees-${stamp}.csv`, await feePositionsTable(ctx));
    case "fees-pending":
      return csvResponse(`${school}-fees-pending-${stamp}.csv`, await feePositionsTable(ctx, { pendingOnly: true }));
    case "exam-performance":
      return csvResponse(`${school}-exam-performance-${stamp}.csv`, await examPerformanceTable(ctx));
    case "teacher-workload": {
      if (!from || !to || from > to) return new NextResponse("Choose a valid date range.", { status: 400 });
      return csvResponse(`${school}-teacher-workload-${toDateInput(from)}-to-${toDateInput(to)}.csv`, await teacherWorkloadTable(ctx, from, to));
    }
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
          head: ["Roll", "Student", "Admission no.", "Present", "Late", "Absent", "Excused", "Marked", "Attended %"],
          rows: report.students.map((s) => [
            s.rollNumber ?? "",
            s.name,
            s.admissionNumber,
            s.counts.PRESENT,
            s.counts.LATE,
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
