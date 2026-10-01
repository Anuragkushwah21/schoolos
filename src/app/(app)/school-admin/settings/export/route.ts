import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { requireTenantForAction } from "@/server/auth/current-user";
import { exportSchoolData } from "@/server/export/school-data";

/** Download everything this school owns as JSON. School Admin only; never another school's data or any password. */
export async function GET() {
  let ctx;
  try {
    ctx = await requireTenantForAction("SCHOOL_ADMIN");
  } catch (error) {
    if (error instanceof AppError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
  const data = await exportSchoolData(ctx);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.schoolSlug || "school"}-data-${day}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
