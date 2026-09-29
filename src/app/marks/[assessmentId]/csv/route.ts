import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/lib/errors";
import { requireTenantForAction } from "@/server/auth/current-user";
import { marksCsvTable } from "@/server/exams/service";
import { csvResponse } from "@/server/reports/csv";

/**
 * A paper's marks as CSV — the blank template before marking, the marks after.
 * The same access rule as the marks sheet: the School Admin, or the teacher of
 * that subject in that section. Everyone else gets 404.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ assessmentId: string }> }) {
  try {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
    const { assessmentId } = await context.params;
    const { filename, table } = await marksCsvTable(ctx, assessmentId);
    return csvResponse(filename, table);
  } catch (error) {
    if (error instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
