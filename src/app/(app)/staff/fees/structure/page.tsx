import type { Metadata, Route } from "next";

import { SetupNotice } from "@/components/shared/setup-notice";
import { FeeStructureScreen } from "@/features/finance/fee-structure-screen";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { getCurrentSession } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Fee structure & charges" };

/**
 * The Accountant's fee structure: fee heads, charging a whole class, and who
 * owes what — the same screen and the same checks as the School Admin's, who
 * keeps all of it. A student's own one-off fee is added at the fee desk.
 */
export default async function StaffFeeStructurePage(props: PageProps<"/staff/fees/structure">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "fees.manage");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Fee structure & charges" need="session" />;

  return (
    <FeeStructureScreen
      ctx={ctx}
      session={session}
      searchParams={await props.searchParams}
      basePath="/staff/fees/structure"
      back={{ href: "/staff/fees", label: "Collect fees" }}
      title="Fee structure & charges"
      paymentsHref="/staff/fees"
      paymentsLabel="Collect fees"
      // The fee desk finds the student by admission number, then selects them.
      studentHref={(row) => `/staff/fees?q=${encodeURIComponent(row.admissionNumber)}&student=${row.studentId}` as Route}
    />
  );
}
