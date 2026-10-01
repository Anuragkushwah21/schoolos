import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { requireTenantForAction } from "@/server/auth/current-user";
import { TEACHER_IMPORT_COLUMNS } from "@/server/people/teacher-import";
import { csvResponse } from "@/server/reports/csv";

/** The teacher import template, with one example row to overwrite. School Admin only. */
export async function GET() {
  try {
    await requireTenantForAction("SCHOOL_ADMIN");
  } catch (error) {
    if (error instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
  return csvResponse("teacher-import-template.csv", {
    head: [...TEACHER_IMPORT_COLUMNS],
    rows: [["", "Anita", "Verma", "anita.verma@example.com", "9876500001", "Female", "M.Sc., B.Ed.", "PGT Mathematics", "2026-04-01"]],
  });
}
