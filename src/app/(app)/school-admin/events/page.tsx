import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMinutes, today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { listEventsForAdmin } from "@/server/communication/events";

export const metadata: Metadata = { title: "Events" };

export default async function AdminEventsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const events = await listEventsForAdmin(ctx);
  const now = today();

  return (
    <>
      <PageHeader
        title="Events"
        description="Published upcoming events appear on dashboards and the school website."
        actions={
          <Button asChild>
            <Link href="/school-admin/events/new">New event</Link>
          </Button>
        }
      />
      {events.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="hidden md:table-cell">Where</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link href={`/school-admin/events/${event.id}`} className="font-medium hover:underline">
                      {event.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {formatDate(event.date)}
                    {event.startMinute !== null ? (
                      <span className="text-muted-foreground text-xs"> · {formatMinutes(event.startMinute)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">{event.location ?? "—"}</TableCell>
                  <TableCell>
                    {event.date < now ? (
                      <StatusBadge status="COMPLETED" label="Past" />
                    ) : event.isPublished ? (
                      <StatusBadge status="PUBLISHED" />
                    ) : (
                      <StatusBadge status="DRAFT" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No events yet" />
      )}
    </>
  );
}
