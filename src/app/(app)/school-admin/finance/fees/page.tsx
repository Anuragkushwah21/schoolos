import type { Metadata, Route } from "next";

import { SetupNotice } from "@/components/shared/setup-notice";
import { FeeStructureScreen } from "@/features/finance/fee-structure-screen";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Fee collection" };

/** Fee heads, charging a class, and who owes what. */
export default async function FeeCollectionPage(props: PageProps<"/school-admin/finance/fees">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Fee collection" need="session" />;

  return (
    <FeeStructureScreen
      ctx={ctx}
      session={session}
      searchParams={await props.searchParams}
      basePath="/school-admin/finance/fees"
      back={{ href: "/school-admin/finance", label: "Finance" }}
      title="Fee collection"
      paymentsHref="/school-admin/finance/payments"
      paymentsLabel="Record a payment"
      studentHref={(row) => `/school-admin/students/${row.studentId}` as Route}
    />
  );
}
