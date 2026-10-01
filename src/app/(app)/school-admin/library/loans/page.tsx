import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { LibraryDesk, LibraryTodayPanel, LOAN_VIEWS } from "@/features/operations/library-desk";
import { enumParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { issuableBooks, libraryRules, libraryToday, listLoans } from "@/server/operations/library";

export const metadata: Metadata = { title: "Loans" };


export default async function LoansPage(props: PageProps<"/school-admin/library/loans">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const view = enumParam(search.view, LOAN_VIEWS) ?? "open";
  const q = param(search.q);
  const [loans, available, todayStats] = await Promise.all([
    listLoans(ctx, { view, q }),
    issuableBooks(ctx),
    libraryToday(ctx),
  ]);
  const rules = await libraryRules(ctx);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/library", label: "Library" }}
        title="Issue & return"
        actions={
          <Button asChild variant="outline">
            <Link href={`/school-admin/reports/export?kind=${view === "fines" ? "loans-fines" : "loans-overdue"}`} prefetch={false}>
              Export {view === "fines" ? "fines" : "overdue"} CSV
            </Link>
          </Button>
        }
      />
      <LibraryTodayPanel today={todayStats} basePath="/school-admin/library/loans" canManage addBookHref="/school-admin/library" />
      <LibraryDesk basePath="/school-admin/library/loans" view={view} q={q} loans={loans} available={available} canManage loanDays={rules.loanDays} />
    </>
  );
}
