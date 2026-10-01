import { PartyPopperIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EventsScreen } from "@/features/events/events-screen";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Events" };

/** School events — something happening. Notices and meetings have their own pages. */
export default async function EventsPage(props: PageProps<"/teacher/events">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  return (
    <>
      <PageHeader icon={PartyPopperIcon} tone="blue" title="Events" description="What is happening at school — sports day, functions, trips. Each one counts down to its day." />
      <EventsScreen ctx={ctx} basePath="/teacher/events" view={param(search.view)} />
    </>
  );
}
