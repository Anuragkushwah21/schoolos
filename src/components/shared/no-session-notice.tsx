import type { Route } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

/**
 * What a page shows when the school has not marked an academic year current.
 *
 * Almost everything inside a school hangs off the current session — sections,
 * enrollments, registers, the timetable — so a page that reads any of them has
 * nothing to draw before the office opens one. The service layer refuses
 * outright, which is correct for an API and wrong for a screen: an unopened
 * year is a setup step, not a failure, and it is the office's to take, not the
 * teacher's. Saying so in one place keeps the wording the same everywhere.
 */
export function NoSessionNotice({
  title,
  children,
  back,
}: {
  title: string;
  children?: React.ReactNode;
  back?: { href: Route; label: string };
}) {
  return (
    <>
      <PageHeader title={title} back={back} />
      <EmptyState title="The school has no current academic session">
        {children ?? "Your classes, timetable and registers appear here once the school office opens the academic year."}
      </EmptyState>
    </>
  );
}
