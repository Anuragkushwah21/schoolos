import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { requireTenantForAction } from "@/server/auth/current-user";
import { STUDENT_IMPORT_COLUMNS } from "@/server/people/bulk-students";
import { csvResponse } from "@/server/reports/csv";

/** The student import template, with one example row to overwrite. School Admin only. */
export async function GET() {
  try {
    await requireTenantForAction("SCHOOL_ADMIN");
  } catch (error) {
    if (error instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
  return csvResponse("student-import-template.csv", {
    head: [...STUDENT_IMPORT_COLUMNS],
    rows: [["", "Aarav", "Sharma", "Male", "2014-03-12", "Class 5", "A", "1", "Rakesh", "Sharma", "9876543210", "", "Father"]],
  });
}
