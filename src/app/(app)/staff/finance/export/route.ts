import { NextResponse, type NextRequest } from "next/server";

import { parseDateInput, toDateInput } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getCurrentUser } from "@/server/auth/current-user";
import { csvResponse } from "@/server/reports/csv";
import { expensesTable, feeClassSummaryTable, feeLedgerTable, feeOverdueTable, feePaymentsTable, feePositionsTable, feeSessionSummaryTable, salaryPaymentsTable } from "@/server/reports/exports";
import { forSchool } from "@/server/tenancy/scope";

/**
 * Finance reports (CSV) for staff with "Finance reports". Each report checks
 * its own permissions in the service — expenses also need "View expenses",
 * salary payments "View payroll". The school always comes from the session.
 */
const KINDS = ["fees", "fees-pending", "fee-payments", "expenses", "salary-payments", "fees-class", "fees-sessions", "fees-overdue", "fees-ledger"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "NON_TEACHING_STAFF" || !user.schoolId) return new NextResponse("Not allowed.", { status: 403 });
  const ctx = { user, schoolId: user.schoolId, schoolSlug: user.schoolSlug ?? "", schoolName: user.schoolName ?? "", db: forSchool(user.schoolId) };
  const params = request.nextUrl.searchParams;
  const kind = params.get("kind") as Kind | null;
  if (!kind || !(KINDS as readonly string[]).includes(kind)) return new NextResponse("Unknown report.", { status: 400 });
  const school = user.schoolSlug || "school";
  const stamp = toDateInput(new Date());
  try {
    if (kind === "fees") return csvResponse(`${school}-fees-${stamp}.csv`, await feePositionsTable(ctx));
    if (kind === "fees-class") return csvResponse(`${school}-fees-by-class-${stamp}.csv`, await feeClassSummaryTable(ctx));
    if (kind === "fees-sessions") return csvResponse(`${school}-fees-by-session-${stamp}.csv`, await feeSessionSummaryTable(ctx));
    if (kind === "fees-overdue") return csvResponse(`${school}-fees-overdue-${stamp}.csv`, await feeOverdueTable(ctx));
    if (kind === "fees-ledger") {
      const studentId = params.get("student");
      if (!studentId) return new NextResponse("Choose a student.", { status: 400 });
      return csvResponse(`${school}-fee-ledger-${stamp}.csv`, await feeLedgerTable(ctx, studentId));
    }
    if (kind === "fees-pending") return csvResponse(`${school}-fees-pending-${stamp}.csv`, await feePositionsTable(ctx, { pendingOnly: true }));
    const from = parseDateInput(params.get("from"));
    const to = parseDateInput(params.get("to"));
    if (!from || !to || from > to) return new NextResponse("Choose a valid date range.", { status: 400 });
    const build = { "fee-payments": feePaymentsTable, expenses: expensesTable, "salary-payments": salaryPaymentsTable }[kind];
    return csvResponse(`${school}-${kind}-${toDateInput(from)}-to-${toDateInput(to)}.csv`, await build(ctx, from, to));
  } catch (error) {
    if (error instanceof ForbiddenError) return new NextResponse("You do not have permission for this report.", { status: 403 });
    if (error instanceof NotFoundError) return new NextResponse("Not found.", { status: 404 });
    throw error;
  }
}
