import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { finalizeDueRegisters } from "@/server/attendance/register";
import { prisma } from "@/server/db/prisma";
import { forSchool } from "@/server/tenancy/scope";

/**
 * Submit every draft register whose attendance period has ended, in every
 * school. Drafts are also submitted whenever a page reads registers, so this
 * is the backstop for a quiet school, not the only path.
 *
 * Call with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this).
 * Without `CRON_SECRET` configured the endpoint is off.
 */
export async function GET(request: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }
  const schools = await prisma.attendanceRegister.findMany({
    where: { status: "DRAFT", finalizeAt: { lte: new Date() } },
    distinct: ["schoolId"],
    select: { schoolId: true },
  });
  let submitted = 0;
  for (const { schoolId } of schools) submitted += await finalizeDueRegisters({ db: forSchool(schoolId), schoolId });
  return NextResponse.json({ schools: schools.length, submitted });
}
