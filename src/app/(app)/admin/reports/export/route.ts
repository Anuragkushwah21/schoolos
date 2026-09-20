import { NextResponse, type NextRequest } from "next/server";

import { parseDateInput, toDateInput } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/current-user";
import { sectionReport } from "@/server/attendance/service";
import { forSchool } from "@/server/tenancy/scope";

/**
 * CSV export of a section's attendance report.
 *
 * Route handlers are not wrapped by any page guard, so this one authenticates
 * and scopes on its own. A section from another school is simply not found.
 */

/** Neutralise spreadsheet formula injection and quote every cell. */
function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SCHOOL_ADMIN" || !user.schoolId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const sectionId = params.get("section");
  const from = parseDateInput(params.get("from"));
  const to = parseDateInput(params.get("to"));
  if (!sectionId || !from || !to || from > to) {
    return new NextResponse("Choose a section and a valid date range.", { status: 400 });
  }

  const ctx = {
    user,
    schoolId: user.schoolId,
    schoolSlug: user.schoolSlug ?? "",
    schoolName: user.schoolName ?? "",
    db: forSchool(user.schoolId),
  };

  let report;
  try {
    report = await sectionReport(ctx, sectionId, from, to);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const lines = [
    ["Roll", "Student", "Admission no.", "Present", "Late", "Absent", "Excused", "Marked", "Attended %"],
    ...report.students.map((s) => [
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
  ];

  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  const filename = `attendance-${report.section.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${toDateInput(from)}-to-${toDateInput(to)}.csv`;

  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
