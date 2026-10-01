import { PartyPopperIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EventsScreen } from "@/features/events/events-screen";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Events" };

/**
 * Events — something happening. Status (Upcoming → Today → Completed) follows
 * from the date; only publishing is a choice. Holidays live on the Calendar,
 * notices and meetings on their own pages.
 */
export default async function AdminEventsPage(props: PageProps<"/school-admin/events">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  return (
    <>
      <PageHeader
        icon={PartyPopperIcon}
        tone="blue"
        title="Events"
        description="Sports day, functions, trips. Published events show to everyone and on the school website; past events become Completed by themselves."
        actions={
          <Button asChild>
            <Link href="/school-admin/events/new">
              <PlusIcon aria-hidden />
              Add event
            </Link>
          </Button>
        }
      />
      <EventsScreen ctx={ctx} basePath="/school-admin/events" view={param(search.view)} />
    </>
  );
}
